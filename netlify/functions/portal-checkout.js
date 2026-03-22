// FILE: netlify/functions/portal-checkout.js
// PUBLIC endpoint — no operator auth required.
// Lets a customer pay an outstanding order balance via Stripe Checkout.
//
// GET ?order_id=<uuid>&email=<customer_email>

const { getAdminClient, respond } = require('./utils/auth');
const { stripeRequest, getBaseUrl } = require('./_prooflink_payments');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

const TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'void', 'paid']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, { ok: true });
  if (event.httpMethod !== 'GET') {
    return respond(405, { ok: false, error: 'Method not allowed' });
  }

  // Rate limit: 30 portal checkout requests per minute per IP
  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `portal-checkout:${ip}`, maxRequests: 30, windowMs: 60000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const params = event.queryStringParameters || {};
    const orderId = (params.order_id || '').trim();
    const email   = (params.email   || '').trim();

    if (!orderId || !email) {
      return respond(400, { ok: false, error: 'order_id and email query parameters are required' });
    }

    const supabase = getAdminClient();

    // --- Fetch the order ---
    const { data: orderRows, error: orderErr } = await supabase
      .from('orders')
      .select('id, tenant_id, customer_email, total_cents, amount_paid_cents, status, title')
      .eq('id', orderId)
      .limit(1);

    if (orderErr) {
      console.error('[portal-checkout] order fetch error:', orderErr);
      return respond(500, { ok: false, error: 'Failed to fetch order' });
    }

    const order = Array.isArray(orderRows) ? orderRows[0] : null;
    if (!order) {
      return respond(404, { ok: false, error: 'Order not found' });
    }

    // --- Verify email matches (case-insensitive) ---
    const storedEmail  = (order.customer_email || '').toLowerCase();
    const providedEmail = email.toLowerCase();
    if (!storedEmail || storedEmail !== providedEmail) {
      return respond(403, { ok: false, error: 'Email does not match order records' });
    }

    // --- Verify order is in a payable state ---
    const status = (order.status || '').toLowerCase();
    if (TERMINAL_STATUSES.has(status)) {
      const messages = {
        paid      : 'This order has already been paid in full.',
        cancelled : 'This order has been cancelled and cannot be paid.',
        canceled  : 'This order has been cancelled and cannot be paid.',
        void      : 'This order has been voided and cannot be paid.',
      };
      return respond(400, {
        ok     : false,
        error  : messages[status] || `Order status "${order.status}" cannot be paid online.`,
        status : order.status,
      });
    }

    // --- Calculate outstanding balance ---
    const totalCents     = Number(order.total_cents)       || 0;
    const amountPaid     = Number(order.amount_paid_cents) || 0;
    const balanceCents   = totalCents - amountPaid;

    if (balanceCents <= 0) {
      return respond(400, { ok: false, error: 'No outstanding balance' });
    }

    if (balanceCents < 50) {
      return respond(400, { ok: false, error: 'Outstanding balance is below the minimum charge amount ($0.50)' });
    }

    // --- Fetch tenant Stripe account ---
    const { data: tenantRows, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, stripe_connect_account_id, stripe_account_id')
      .eq('id', order.tenant_id)
      .limit(1);

    if (tenantErr) {
      console.error('[portal-checkout] tenant fetch error:', tenantErr);
      return respond(500, { ok: false, error: 'Failed to fetch provider details' });
    }

    const tenant = Array.isArray(tenantRows) ? tenantRows[0] : null;
    const stripeAccountId = (
      tenant?.stripe_connect_account_id ||
      tenant?.stripe_account_id         ||
      ''
    ).trim();

    if (!stripeAccountId) {
      return respond(400, {
        ok            : false,
        error         : 'Provider has not set up online payments',
        contact_needed: true,
      });
    }

    // --- Build success / cancel URLs ---
    const baseUrl    = getBaseUrl(event);
    const successUrl = `${baseUrl}/portal.html?checkout=success&order_id=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${baseUrl}/portal.html?checkout=cancel&order_id=${encodeURIComponent(orderId)}`;

    // --- Create Stripe Checkout session ---
    const productName = (order.title || 'Outstanding Balance').trim();

    const session = await stripeRequest('/checkout/sessions', 'POST', {
      mode                                              : 'payment',
      success_url                                       : successUrl,
      cancel_url                                        : cancelUrl,
      customer_email                                    : email,
      'line_items[0][price_data][currency]'             : 'usd',
      'line_items[0][price_data][unit_amount]'          : balanceCents,
      'line_items[0][price_data][product_data][name]'   : productName,
      'line_items[0][quantity]'                         : 1,
      'payment_intent_data[transfer_data][destination]' : stripeAccountId,
      'payment_intent_data[metadata][order_id]'         : orderId,
      'payment_intent_data[metadata][tenant_id]'        : order.tenant_id,
      'payment_intent_data[metadata][source]'           : 'portal_checkout',
      'metadata[order_id]'                              : orderId,
      'metadata[tenant_id]'                             : order.tenant_id,
      'metadata[source]'                                : 'portal_checkout',
    });

    return respond(200, { ok: true, checkout_url: session.url });

  } catch (e) {
    console.error('[portal-checkout] unexpected error:', e);
    return respond(Number(e.statusCode || 500), {
      ok   : false,
      error: e.message || String(e),
    });
  }
};
