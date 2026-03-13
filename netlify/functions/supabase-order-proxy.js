// FILE: netlify/functions/supabase-order-proxy.js
// Saves a storefront order into Supabase by calling the submit_storefront_order RPC.

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

function normalizeMoney(value) {
  return Number.isFinite(+value) ? Math.max(0, Math.round(+value)) : 0;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: normalizeString(item?.id),
      name: normalizeString(item?.name),
      qty: Number.isFinite(+item?.qty) ? Math.max(1, Math.round(+item.qty)) : 1,
      pricing_mode: normalizeString(item?.pricingMode || item?.pricing_mode || "quote") || "quote",
      price_cents: normalizeMoney(item?.priceCents ?? item?.price_cents),
      starting_price_cents: normalizeMoney(item?.startingPriceCents ?? item?.starting_price_cents),
      unit_cents_override: Number.isFinite(+item?.unitCentsOverride) ? Math.max(0, Math.round(+item.unitCentsOverride)) : null,
      delivery_eligible: item?.deliveryEligible !== false,
      thumb: normalizeString(item?.thumb),
      variant_id: normalizeString(item?.variantId || item?.variant_id),
    }))
    .filter((item) => item.id && item.name);
}

function normalizePayload(input) {
  const payload = input && typeof input === "object" ? input : {};
  const items = normalizeItems(payload.items);
  const subtotalCents = normalizeMoney(payload.subtotal_cents ?? payload.subtotalCents);
  const totalCents = normalizeMoney(payload.total_cents ?? payload.totalCents ?? payload.estimated_total_cents ?? payload.estimatedTotalCents);

  return {
    tenant_id: normalizeString(payload.tenant_id || payload.tenantId),
    tenant_slug: normalizeString(payload.tenant_slug || payload.tenantSlug),
    tenant_business_name: normalizeString(payload.tenant_business_name || payload.tenantBusinessName),
    operator_id: normalizeString(payload.operator_id || payload.operatorId) || null,
    status: normalizeString(payload.status || "new") || "new",
    fulfillment: normalizeString(payload.fulfillment),
    scheduled_date: normalizeString(payload.scheduled_date || payload.requestedDate) || null,
    scheduled_time: normalizeString(payload.scheduled_time || payload.requestedTime) || null,
    customer_name: normalizeString(payload.customer_name || payload.name),
    email: normalizeString(payload.email).toLowerCase(),
    phone: normalizeString(payload.phone),
    preferred_contact: normalizeString(payload.preferred_contact || payload.preferred || payload.preferredContact) || "email",
    items,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: normalizeMoney(payload.delivery_fee_cents ?? payload.deliveryFeeCents),
    total_cents: totalCents,
    notes: normalizeString(payload.notes) || null,
    cart_summary: normalizeString(payload.cart_summary || payload.cartSummary),
    estimated_total_cents: normalizeMoney(payload.estimated_total_cents ?? payload.estimatedTotalCents ?? totalCents),
    unpriced_count: Number.isFinite(+payload.unpriced_count ?? +payload.unpricedCount) ? Math.max(0, Math.round(+(payload.unpriced_count ?? payload.unpricedCount))) : 0,
    item_count: Number.isFinite(+payload.item_count ?? +payload.itemCount) ? Math.max(0, Math.round(+(payload.item_count ?? payload.itemCount))) : items.length,
    source_type: "storefront",
  };
}

function validatePayload(payload) {
  if (!payload.tenant_id) throw Object.assign(new Error("tenant_id is required"), { statusCode: 400 });
  if (!payload.tenant_slug) throw Object.assign(new Error("tenant_slug is required"), { statusCode: 400 });
  if (!payload.customer_name) throw Object.assign(new Error("customer_name is required"), { statusCode: 400 });
  if (!payload.email) throw Object.assign(new Error("email is required"), { statusCode: 400 });
  if (!payload.phone) throw Object.assign(new Error("phone is required"), { statusCode: 400 });
  if (!payload.fulfillment) throw Object.assign(new Error("fulfillment is required"), { statusCode: 400 });
  if (!Array.isArray(payload.items) || !payload.items.length) throw Object.assign(new Error("items are required"), { statusCode: 400 });
}

async function callSubmitStorefrontOrder(payload) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/submit_storefront_order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    },
    body: JSON.stringify({ payload })
  });

  const text = await res.text().catch(() => "");
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!res.ok) {
    throw new Error(
      `Supabase RPC failed (${res.status})${
        data ? `: ${typeof data === "string" ? data : JSON.stringify(data)}` : ""
      }`
    );
  }

  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    const raw = parseBody(event);
    const payload = normalizePayload(raw);
    validatePayload(payload);

    const result = await callSubmitStorefrontOrder(payload);
    const orderId =
      typeof result === "string"
        ? result
        : result?.order_id || result?.id || result?.orderId || null;

    return json(200, { ok: true, orderId, result });
  } catch (e) {
    return json(Number(e?.statusCode || 500), {
      ok: false,
      error: String(e?.message || e)
    });
  }
};
