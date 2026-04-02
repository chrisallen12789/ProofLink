// FILE: netlify/functions/supabase-order-proxy.js
// Saves a storefront order into Supabase by calling the submit_storefront_order RPC.
// The server is authoritative for catalog pricing, delivery fees, and order status.

const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const { getAdminClient } = require('./utils/auth');

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(obj)
  };
}

function parseBody(event) {
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
  const raw = event.body || '';

  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  }

  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function clean(value) {
  return String(value || '').trim();
}

function normalizeMoney(value) {
  return Number.isFinite(+value) ? Math.max(0, Math.round(+value)) : 0;
}

function clampQty(value) {
  const qty = Number.parseInt(value, 10);
  return Number.isFinite(qty) ? Math.max(1, Math.min(99, qty)) : 1;
}

function normalizeZip(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 5);
}

function normalizePricingMode(value, sellCents = 0, startCents = 0) {
  const mode = clean(value).toLowerCase();
  const sell = normalizeMoney(sellCents);
  const start = normalizeMoney(startCents);

  if (mode === 'fixed' && sell > 0) return 'fixed';
  if (mode === 'starts_at' && start > 0) return 'starts_at';
  if (mode === 'quote' && sell <= 0 && start <= 0) return 'quote';
  if (sell > 0) return 'fixed';
  if (start > 0) return 'starts_at';
  return 'quote';
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeRequestedItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => ({
      id: clean(item?.id),
      qty: clampQty(item?.qty),
      variant_id: clean(item?.variantId || item?.variant_id),
    }))
    .filter((item) => item.id);
}

function unitEstimateCents(item) {
  if (item.pricing_mode === 'fixed') return normalizeMoney(item.sell_price_cents);
  if (item.pricing_mode === 'starts_at') return normalizeMoney(item.starting_price_cents);
  return null;
}

function displayPrice(item) {
  const unit = unitEstimateCents(item);
  if (unit === null) return 'Quote';
  if (item.pricing_mode === 'starts_at') return `Starts at $${(unit / 100).toFixed(2)}`;
  return `$${(unit / 100).toFixed(2)}`;
}

function buildCartSummary(items, totals) {
  const lines = items.map((item) => `${item.qty} x ${item.name} (${displayPrice(item)})`);
  lines.push(`Estimated subtotal: $${(totals.subtotal_cents / 100).toFixed(2)}`);
  if (totals.delivery_fee_cents > 0) {
    lines.push(`Delivery: $${(totals.delivery_fee_cents / 100).toFixed(2)}`);
  }
  lines.push(`Estimated total: $${(totals.estimated_total_cents / 100).toFixed(2)}`);
  if (totals.unpriced_count > 0) {
    lines.push(`${totals.unpriced_count} item(s) require quote confirmation`);
  }
  return lines.join('\n');
}

function normalizePayload(input) {
  const payload = input && typeof input === 'object' ? input : {};
  return {
    tenant_id: clean(payload.tenant_id || payload.tenantId),
    tenant_slug: clean(payload.tenant_slug || payload.tenantSlug),
    customer_name: clean(payload.customer_name || payload.name),
    email: clean(payload.email).toLowerCase(),
    phone: clean(payload.phone),
    preferred_contact: clean(payload.preferred_contact || payload.preferred || payload.preferredContact) || 'email',
    fulfillment: clean(payload.fulfillment).toLowerCase(),
    scheduled_date: clean(payload.scheduled_date || payload.requestedDate) || null,
    scheduled_time: clean(payload.scheduled_time || payload.requestedTime) || null,
    notes: clean(payload.notes) || null,
    delivery_zip: normalizeZip(payload.delivery_zip || payload.deliveryZip),
    items: normalizeRequestedItems(payload.items),
  };
}

function validatePayload(payload) {
  if (!payload.tenant_id) throw Object.assign(new Error('tenant_id is required'), { statusCode: 400 });
  if (!payload.tenant_slug) throw Object.assign(new Error('tenant_slug is required'), { statusCode: 400 });
  if (!payload.customer_name) throw Object.assign(new Error('customer_name is required'), { statusCode: 400 });
  if (!payload.email) throw Object.assign(new Error('email is required'), { statusCode: 400 });
  if (!payload.phone) throw Object.assign(new Error('phone is required'), { statusCode: 400 });
  if (!['pickup', 'delivery'].includes(payload.fulfillment)) {
    throw Object.assign(new Error('fulfillment is required'), { statusCode: 400 });
  }
  if (!Array.isArray(payload.items) || !payload.items.length) {
    throw Object.assign(new Error('items are required'), { statusCode: 400 });
  }
}

async function loadTenantContext(supabase, payload) {
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, slug, business_name, name, active')
    .eq('id', payload.tenant_id)
    .maybeSingle();

  if (tenantErr || !tenant || tenant.active === false) {
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
  }

  if (clean(tenant.slug).toLowerCase() !== payload.tenant_slug.toLowerCase()) {
    throw Object.assign(new Error('tenant_slug does not match tenant_id'), { statusCode: 400 });
  }

  const { data: cfgRow, error: cfgErr } = await supabase
    .from('tenant_config')
    .select('config_value')
    .eq('tenant_id', tenant.id)
    .eq('config_key', 'site_settings')
    .maybeSingle();

  if (cfgErr) {
    throw Object.assign(new Error('Failed to load tenant settings'), { statusCode: 500 });
  }

  const productIds = payload.items.map((item) => item.id);
  const { data: products, error: productsErr } = await supabase
    .from('products')
    .select('id, name, image_url, pricing_mode, sell_price_cents, starting_price_cents, delivery_eligible, is_available, is_active')
    .eq('tenant_id', tenant.id)
    .in('id', productIds);

  if (productsErr) {
    throw Object.assign(new Error('Failed to load storefront catalog'), { statusCode: 500 });
  }

  return {
    tenant,
    config: parseConfig(cfgRow?.config_value),
    products: Array.isArray(products) ? products : [],
  };
}

function buildSanitizedItems(payload, products) {
  const productsById = new Map(
    (products || []).map((product) => [clean(product.id), product])
  );

  return payload.items.map((item) => {
    const product = productsById.get(item.id);
    if (!product || product.is_active === false || product.is_available === false) {
      throw Object.assign(new Error(`Product is unavailable: ${item.id}`), { statusCode: 400 });
    }

    const pricingMode = normalizePricingMode(
      product.pricing_mode,
      product.sell_price_cents,
      product.starting_price_cents
    );

    return {
      id: clean(product.id),
      name: clean(product.name) || item.id,
      qty: item.qty,
      pricing_mode: pricingMode,
      price_cents: normalizeMoney(product.sell_price_cents),
      starting_price_cents: normalizeMoney(product.starting_price_cents),
      delivery_eligible: product.delivery_eligible !== false,
      thumb: clean(product.image_url),
      variant_id: item.variant_id || '',
    };
  });
}

function computeDeliveryFee(payload, items, config) {
  if (payload.fulfillment !== 'delivery') return 0;

  if (!items.every((item) => item.delivery_eligible !== false)) {
    throw Object.assign(new Error('One or more items in this cart are pickup only.'), { statusCode: 400 });
  }

  const zip = payload.delivery_zip;
  if (!zip) {
    throw Object.assign(new Error('delivery_zip is required for delivery orders'), { statusCode: 400 });
  }

  const zipFees = config?.zip_fees && typeof config.zip_fees === 'object'
    ? config.zip_fees
    : {};

  const zoneFee = normalizeMoney(zipFees[zip]);
  if (!zoneFee) {
    throw Object.assign(new Error('Delivery is not available for the selected ZIP code.'), { statusCode: 400 });
  }

  const subtotal = items.reduce((sum, item) => {
    const unit = unitEstimateCents(item);
    return unit === null ? sum : sum + unit * item.qty;
  }, 0);

  const freeThreshold = normalizeMoney(config?.free_threshold_cents);
  if (freeThreshold > 0 && subtotal >= freeThreshold) {
    return 0;
  }

  return zoneFee;
}

function buildServerPayload(rawPayload, tenant, config, items) {
  let subtotalCents = 0;
  let unpricedCount = 0;

  items.forEach((item) => {
    const unit = unitEstimateCents(item);
    if (unit === null) {
      unpricedCount += 1;
      return;
    }
    subtotalCents += unit * item.qty;
  });

  const deliveryFeeCents = computeDeliveryFee(rawPayload, items, config);
  const estimatedTotalCents = subtotalCents + deliveryFeeCents;

  const payload = {
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    tenant_business_name: clean(tenant.business_name || tenant.name || tenant.slug),
    status: 'new',
    fulfillment: rawPayload.fulfillment,
    scheduled_date: rawPayload.scheduled_date,
    scheduled_time: rawPayload.scheduled_time,
    customer_name: rawPayload.customer_name,
    email: rawPayload.email,
    phone: rawPayload.phone,
    preferred_contact: rawPayload.preferred_contact,
    items,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    total_cents: estimatedTotalCents,
    estimated_total_cents: estimatedTotalCents,
    unpriced_count: unpricedCount,
    item_count: items.length,
    notes: rawPayload.notes,
    cart_summary: '',
    source_type: 'storefront',
  };

  payload.cart_summary = buildCartSummary(items, payload);
  return payload;
}

async function callSubmitStorefrontOrder(supabase, payload) {
  const { data, error } = await supabase.rpc('submit_storefront_order', { payload });
  if (error) {
    throw new Error(`Supabase RPC failed: ${error.message}`);
  }
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `supabase-order-proxy:${ip}`, maxRequests: 5, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const raw = parseBody(event);
    const payload = normalizePayload(raw);
    validatePayload(payload);

    const supabase = getAdminClient();
    const { tenant, config, products } = await loadTenantContext(supabase, payload);
    const items = buildSanitizedItems(payload, products);
    const serverPayload = buildServerPayload(payload, tenant, config, items);
    const result = await callSubmitStorefrontOrder(supabase, serverPayload);
    const orderId =
      typeof result === 'string'
        ? result
        : result?.order_id || result?.id || result?.orderId || null;

    return json(200, {
      ok: true,
      orderId,
      result,
      normalized: serverPayload,
    });
  } catch (e) {
    return json(Number(e?.statusCode || 500), {
      ok: false,
      error: String(e?.message || e)
    });
  }
};
