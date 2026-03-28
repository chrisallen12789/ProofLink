// FILE: netlify/functions/order.js
// Receives JSON from /api/order
// Verifies Turnstile
// Saves the order to Supabase via the local proxy
// Sends admin + customer emails via Resend

const { getConfiguredSiteUrl, getRequiredResendApiKey } = require("./utils/runtime-config");
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

const DEFAULT_TENANT_BUSINESS_NAME = process.env.TENANT_BUSINESS_NAME || "Your Business";
const PLATFORM_NAME = process.env.PLATFORM_NAME || "ProofLink";
const TENANT_REPLY_TO_NAME = process.env.TENANT_REPLY_TO_NAME || DEFAULT_TENANT_BUSINESS_NAME;
const TENANT_CITY_STATE = process.env.TENANT_CITY_STATE || "";

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "";
const MIN_SUBMIT_MS = Number(process.env.MIN_SUBMIT_MS || 2500);
const MAX_SUBMIT_MS = Number(process.env.MAX_SUBMIT_MS || 60 * 60 * 1000);
const ORDER_PROXY_TIMEOUT_MS = Number(process.env.ORDER_PROXY_TIMEOUT_MS || 10000);

function localCaptchaBypassEnabled() {
  const allowBypass = String(process.env.ALLOW_LOCAL_TURNSTILE_BYPASS || "").trim().toLowerCase() === "true";
  const siteUrl = String(
    process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.URL || ""
  ).trim().toLowerCase();
  const isLocalUrl =
    siteUrl.startsWith("http://127.0.0.1") ||
    siteUrl.startsWith("http://localhost") ||
    siteUrl.startsWith("https://127.0.0.1") ||
    siteUrl.startsWith("https://localhost");

  return allowBypass && isLocalUrl;
}

function getSiteUrl() {
  return getConfiguredSiteUrl();
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(obj)
  };
}

function parseBody(event) {
  const ct = (event.headers?.["content-type"] || event.headers?.["Content-Type"] || "").toLowerCase();
  const raw = event.body || "";

  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  }

  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizePayload(input) {
  const payload = input && typeof input === "object" ? input : {};
  return {
    ...payload,
    tenantId: normalizeString(payload.tenantId || payload.tenant_id),
    tenantSlug: normalizeString(payload.tenantSlug || payload.tenant_slug),
    tenantBusinessName: normalizeString(payload.tenantBusinessName || payload.tenant_business_name) || DEFAULT_TENANT_BUSINESS_NAME,
    customer_name: normalizeString(payload.customer_name || payload.name),
    email: normalizeString(payload.email).toLowerCase(),
    phone: normalizeString(payload.phone),
    fulfillment: normalizeString(payload.fulfillment).toLowerCase(),
    requestedDate: normalizeString(payload.requestedDate || payload.scheduled_date),
    requestedTime: normalizeString(payload.requestedTime || payload.scheduled_time),
    deliveryZip: normalizeString(payload.deliveryZip || payload.delivery_zip),
    cartSummary: normalizeString(payload.cartSummary || payload.cart_summary),
    notes: payload.notes ? String(payload.notes).trim() : null,
    items: Array.isArray(payload.items) ? payload.items : [],
    turnstileToken: normalizeString(payload.turnstileToken),
    startedAt: payload.startedAt,
    fax: normalizeString(payload.fax),
    website: normalizeString(payload.website),
  };
}

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET_KEY) {
    if (localCaptchaBypassEnabled()) return { skipped: true, success: true, bypassed: true };
    throw Object.assign(new Error("CAPTCHA is not configured."), {
      statusCode: 503,
      code: "configuration_error",
    });
  }
  if (!token) return { success: false };

  const form = new URLSearchParams();
  form.set("secret", TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(8000),
  });

  const data = await res.json().catch(() => null);
  return data || { success: false };
}

function spamGate(payload) {
  if (payload.fax) {
    throw Object.assign(new Error("Submission rejected."), { statusCode: 400 });
  }

  const startedAt = Number(payload.startedAt || 0);
  if (startedAt) {
    const delta = Date.now() - startedAt;
    if (delta < MIN_SUBMIT_MS || delta > MAX_SUBMIT_MS) {
      throw Object.assign(new Error("Submission rejected."), { statusCode: 400 });
    }
  }

  if (payload.website && String(payload.website).trim() !== "") {
    throw Object.assign(new Error("Spam detected."), { statusCode: 400 });
  }
}

function validatePayload(payload) {
  if (!payload.tenantId) throw Object.assign(new Error("tenantId is required"), { statusCode: 400 });
  if (!payload.tenantSlug) throw Object.assign(new Error("tenantSlug is required"), { statusCode: 400 });
  if (!payload.customer_name) throw Object.assign(new Error("Name required"), { statusCode: 400 });
  if (!payload.email) throw Object.assign(new Error("Email required"), { statusCode: 400 });
  if (!payload.phone) throw Object.assign(new Error("Phone required"), { statusCode: 400 });
  if (!payload.fulfillment) throw Object.assign(new Error("Fulfillment required"), { statusCode: 400 });
  if (!Array.isArray(payload.items) || !payload.items.length) {
    throw Object.assign(new Error("Your cart is empty."), { statusCode: 400 });
  }
  if (payload.deliveryZip && !/^\d{5}$/.test(payload.deliveryZip)) {
    throw Object.assign(new Error("Delivery ZIP code must be 5 digits."), { statusCode: 400 });
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function tenantName(payload) {
  return escapeHtml(payload.tenantBusinessName || DEFAULT_TENANT_BUSINESS_NAME);
}

function fulfillmentPreference(payload) {
  const raw = String(payload.fulfillment || "").trim().toLowerCase();
  if (raw === "delivery") return "Delivery";
  if (raw === "pickup") return "Pickup";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Not specified";
}

function buildAdminHtml(payload) {
  const name = escapeHtml(payload.customer_name || "");
  const email = escapeHtml(payload.email || "");
  const phone = escapeHtml(payload.phone || "");
  const notes = escapeHtml(payload.notes || "");
  const cartSummary = escapeHtml(payload.cartSummary || "");
  const requestedDate = escapeHtml(payload.requestedDate || "");
  const requestedTime = escapeHtml(payload.requestedTime || "");
  const fulfill = escapeHtml(fulfillmentPreference(payload));

  return `
  <div style="margin:0;padding:0;background:#f8f5f0;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8f5f0;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#2f2a26;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #efe7de;">
            <tr>
              <td style="padding:22px 26px;background:#3b2314;color:#ffffff;">
                <div style="font-size:14px;letter-spacing:0.2px;">${tenantName(payload)}</div>
                <div style="font-size:20px;font-weight:700;margin-top:6px;">New order request</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 26px;font-size:14px;line-height:1.55;">
                <p style="margin:0 0 10px 0;"><strong>From</strong> ${name} &lt;${email}&gt;</p>
                <p style="margin:0 0 10px 0;"><strong>Phone</strong> ${phone || "Not provided"}</p>
                <p style="margin:0 0 10px 0;"><strong>Tenant</strong> ${tenantName(payload)} (${escapeHtml(payload.tenantId || "default")})</p>
                <p style="margin:0 0 10px 0;"><strong>Fulfillment</strong> ${fulfill}</p>
                <p style="margin:0 0 10px 0;"><strong>Requested date</strong> ${requestedDate || "Not provided"}</p>
                <p style="margin:0 0 12px 0;"><strong>Requested time</strong> ${requestedTime || "Not provided"}</p>
                <div style="margin-top:10px;padding:14px;border:1px solid #e6e1db;border-radius:10px;background:#faf8f4;">
                  <div style="font-weight:700;margin-bottom:8px;">Cart summary</div>
                  <div style="white-space:pre-wrap;">${cartSummary || "No cart details provided"}</div>
                </div>
                ${notes ? `<div style="margin-top:12px;padding:14px;border:1px solid #e6e1db;border-radius:10px;background:#faf8f4;"><div style="font-weight:700;margin-bottom:8px;">Customer notes</div><div style="white-space:pre-wrap;">${notes}</div></div>` : ""}
                <p style="margin:16px 0 0 0;color:#6b625c;font-size:13px;">Sent from ${tenantName(payload)} via ${escapeHtml(PLATFORM_NAME)}.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

function buildCustomerHtml(payload) {
  const name = escapeHtml(payload.customer_name || "");
  const cartSummary = escapeHtml(payload.cartSummary || "");
  const requestedDate = escapeHtml(payload.requestedDate || "");
  const requestedTime = escapeHtml(payload.requestedTime || "");
  const fulfill = escapeHtml(fulfillmentPreference(payload));
  const logoUrl = `${getSiteUrl()}/assets/logo.png`;

  return `
  <div style="margin:0;padding:0;background:#f8f5f0;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8f5f0;padding:24px 0;font-family:Arial,Helvetica,sans-serif;color:#2f2a26;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #efe7de;">
            <tr>
              <td style="padding:22px 26px;background:#3b2314;color:#ffffff;">
                <div style="font-size:14px;letter-spacing:0.2px;">${tenantName(payload)}</div>
                <div style="font-size:20px;font-weight:700;margin-top:6px;">Request received</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 26px;font-size:15px;line-height:1.65;">
                <p style="margin:0 0 12px 0;">Hi ${name || "there"},</p>
                <p style="margin:0 0 12px 0;">We received your request and will confirm details before finalizing anything.</p>
                <div style="margin:14px 0 0 0;padding:14px;border:1px solid #e6e1db;border-radius:10px;background:#faf8f4;">
                  <div style="font-weight:700;margin-bottom:8px;">Your request</div>
                  <div style="font-size:14px;line-height:1.55;">
                    <div><strong>Fulfillment</strong> ${fulfill}</div>
                    <div><strong>Requested date</strong> ${requestedDate || "Not provided"}</div>
                    <div><strong>Requested time</strong> ${requestedTime || "Not provided"}</div>
                  </div>
                </div>
                <div style="margin:12px 0 0 0;padding:14px;border:1px solid #e6e1db;border-radius:10px;background:#faf8f4;">
                  <div style="font-weight:700;margin-bottom:8px;">Cart summary</div>
                  <div style="white-space:pre-wrap;font-size:14px;line-height:1.55;">${cartSummary || "No cart details provided"}</div>
                </div>
                <p style="margin:14px 0 0 0;">We will follow up by email shortly.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px;border-top:1px solid #efe7de;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="font-size:13.5px;line-height:1.55;color:#2f2a26;">
                      <div style="font-weight:700;">${escapeHtml(TENANT_REPLY_TO_NAME)}</div>
                      <div style="color:#6b625c;">${tenantName(payload)}</div>
                      <div style="color:#6b625c;">${escapeHtml(TENANT_CITY_STATE)}</div>
                    </td>
                    <td align="right" style="width:140px;">
                      <img src="${logoUrl}" alt="${tenantName(payload)}" width="110" style="display:block;border:0;outline:none;text-decoration:none;">
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

async function sendResendEmail({ from, to, replyTo, subject, html }) {
  const apiKey = getRequiredResendApiKey();
  if (!apiKey) return { skipped: true, localOnly: true };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo ? [replyTo] : undefined,
      subject,
      html
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Resend send failed: ${res.status} ${txt}`);
  }

  return res.json().catch(() => ({}));
}

async function saveOrderToSupabase(payload) {
  const siteUrl = getSiteUrl();

  const apiUrl = `${siteUrl.replace(/\/$/, "")}/.netlify/functions/supabase-order-proxy`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ORDER_PROXY_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Order save failed (${res.status})`);
  }

  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const clientIp = getClientIP(event);
  const rl = checkRateLimit({ key: `order:${clientIp}`, maxRequests: 5, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const payload = normalizePayload(parseBody(event));
    spamGate(payload);
    validatePayload(payload);

    const ts = await verifyTurnstile(payload.turnstileToken, clientIp);
    if (TURNSTILE_SECRET_KEY && !ts.success) {
      throw Object.assign(new Error("Submission rejected."), { statusCode: 400 });
    }

    const mailFrom = process.env.MAIL_FROM || "";
    const mailTo = process.env.MAIL_TO || "";
    if (!mailFrom || !mailTo) throw new Error("Missing MAIL_FROM or MAIL_TO");

    const saveResult = await saveOrderToSupabase(payload);

    await sendResendEmail({
      from: mailFrom,
      to: mailTo,
      replyTo: payload.email,
      subject: `${payload.tenantBusinessName || DEFAULT_TENANT_BUSINESS_NAME} order request`,
      html: buildAdminHtml(payload)
    });

    await sendResendEmail({
      from: mailFrom,
      to: payload.email,
      subject: `${payload.tenantBusinessName || DEFAULT_TENANT_BUSINESS_NAME} received your request`,
      html: buildCustomerHtml(payload)
    });

    return json(200, { ok: true, orderId: saveResult?.orderId || null });
  } catch (e) {
    const statusCode = Number(e?.statusCode || 500);
    return json(statusCode, {
      ok: false,
      error: e?.code === "configuration_error" ? "configuration_error" : String(e?.message || e),
    });
  }
};
