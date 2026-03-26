// FILE: netlify/functions/contact.js
// Contact form handler using Turnstile + Resend.

const { getRequiredResendApiKey } = require("./utils/runtime-config");

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "";
const MIN_SUBMIT_MS = Number(process.env.MIN_SUBMIT_MS || 2500);
const MAX_SUBMIT_MS = Number(process.env.MAX_SUBMIT_MS || 60 * 60 * 1000);

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

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function buildAdminHtml(payload) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#2f2a26;line-height:1.6;">
    <h2 style="margin:0 0 16px;">New contact message</h2>
    <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(payload.subject)}</p>
    <div style="margin-top:12px;padding:14px;border:1px solid #e6e1db;border-radius:10px;background:#faf8f4;white-space:pre-wrap;">${escapeHtml(payload.message)}</div>
  </div>`;
}

function buildCustomerHtml(payload) {
  const tenantName = escapeHtml(payload.tenantBusinessName || payload.tenant_business_name || "Our team");
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#2f2a26;line-height:1.6;">
    <h2 style="margin:0 0 16px;">Message received</h2>
    <p>Hi ${escapeHtml(payload.name || "there")},</p>
    <p>We received your message and will follow up soon.</p>
    <div style="margin-top:12px;padding:14px;border:1px solid #e6e1db;border-radius:10px;background:#faf8f4;">
      <div><strong>Subject:</strong> ${escapeHtml(payload.subject)}</div>
      <div style="margin-top:8px;white-space:pre-wrap;">${escapeHtml(payload.message)}</div>
    </div>
    <p style="margin-top:14px;">— ${tenantName}</p>
  </div>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    const payload = parseBody(event);
    spamGate(payload);

    const ip =
      event.headers?.["x-nf-client-connection-ip"] ||
      event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim();

    const ts = await verifyTurnstile(payload.turnstileToken, ip);
    if (TURNSTILE_SECRET_KEY && !ts.success) {
      throw Object.assign(new Error("Submission rejected."), { statusCode: 400 });
    }

    const mailFrom = process.env.MAIL_FROM || "";
    const mailTo = process.env.MAIL_TO || "";
    if (!mailFrom || !mailTo) throw new Error("Missing MAIL_FROM or MAIL_TO");

    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim();
    const subject = String(payload.subject || "").trim();
    const message = String(payload.message || "").trim();

    if (!name || !email || !subject || !message) {
      return json(400, { ok: false, error: "Missing required contact fields" });
    }

    await sendResendEmail({
      from: mailFrom,
      to: mailTo,
      replyTo: email,
      subject: `${subject} — contact form`,
      html: buildAdminHtml(payload)
    });

    await sendResendEmail({
      from: mailFrom,
      to: email,
      subject: `We received your message`,
      html: buildCustomerHtml(payload)
    });

    return json(200, { ok: true });
  } catch (e) {
    const statusCode = Number(e?.statusCode || 500);
    return json(statusCode, {
      ok: false,
      error: e?.code === "configuration_error" ? "configuration_error" : String(e?.message || e),
    });
  }
};
