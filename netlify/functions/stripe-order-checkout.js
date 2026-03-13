// FILE: netlify/functions/stripe-order-checkout.js
const {
  buildTenantPaymentState,
  clean,
  getBaseUrl,
  json,
  readJson,
  requireOperatorContext,
  stripeRequest,
  supabaseAdmin,
  upsertPaymentRecord,
  findTenantById,
} = require('./_prooflink_payments');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  // Rate limit: 20 checkout requests per minute per IP
  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `checkout:${ip}`, maxRequests: 20, windowMs: 60000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const body = readJson(event);
    const tenantId = clean(body.tenantId || body.tenant_id);
    const orderId = clean(body.orderId || body.order_id);

    if (!tenantId || !orderId) {
      throw Object.assign(new Error('tenantId and orderId are required.'), { statusCode: 400 });
    }

    const ctx = await requireOperatorContext(event, tenantId);

    const orders = await supabaseAdmin(
      `/rest/v1/orders?select=*&id=eq.${encodeURIComponent(orderId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&operator_id=eq.${encodeURIComponent(ctx.operatorId)}&limit=1`
    );
    const order = Array.isArray(orders) ? orders[0] : null;

    if (!order) {
      throw Object.assign(new Error('Order not found inside this tenant scope.'), { statusCode: 404 });
    }

    const tenant = await findTenantById(tenantId).catch(() => null);
    const paymentState = buildTenantPaymentState(tenant || {});
    const stripeAccountId = clean(
      body.stripeAccountId ||
      body.stripe_account_id ||
      tenant?.stripe_connect_account_id ||
      tenant?.stripe_account_id
    );

    if (!stripeAccountId) {
      throw Object.assign(new Error('Stripe Connect account is not connected for this tenant.'), { statusCode: 400 });
    }

    if (!paymentState.onlinePaymentsEligible) {
      throw Object.assign(
        new Error('Online payments are disabled until ProofLink billing is active and Stripe Connect is fully connected.'),
        { statusCode: 403 }
      );
    }

    const amount = Number(order.total_cents || order.subtotal_cents || body.amount_total || 0);
    if (!Number.isFinite(amount) || amount < 50) {
      throw Object.assign(new Error('Order total must be at least $0.50 to create checkout.'), { statusCode: 400 });
    }

    const feeBps = Math.max(0, Number(body.applicationFeeBps ?? tenant?.application_fee_bps ?? 0));
    const applicationFee = feeBps > 0 ? Math.round(amount * (feeBps / 10000)) : 0;
    const currency = clean(body.currency || tenant?.currency || 'usd').toLowerCase();
    const baseUrl = getBaseUrl(event);
    const successUrl =
      clean(body.successUrl) ||
      `${baseUrl}/operator/?order_checkout=success&session_id={CHECKOUT_SESSION_ID}#payments`;
    const cancelUrl =
      clean(body.cancelUrl) ||
      `${baseUrl}/operator/?order_checkout=cancel#payments`;
    const customerEmail = clean(body.customerEmail || order.email || '');
    const productName = clean(body.productName || order.customer_name || 'Order payment');

    const session = await stripeRequest('/checkout/sessions', 'POST', {
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail || undefined,
      'custom_text[submit][message]':
        'Customer payment is processed for the tenant order. Final payment truth comes from ProofLink webhook handling.',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][product_data][name]': productName,
      'line_items[0][price_data][unit_amount]': amount,
      'line_items[0][quantity]': 1,
      'payment_intent_data[application_fee_amount]': applicationFee,
      'payment_intent_data[transfer_data][destination]': stripeAccountId,
      'payment_intent_data[metadata][tenant_id]': tenantId,
      'payment_intent_data[metadata][order_id]': orderId,
      'payment_intent_data[metadata][purpose]': 'tenant_order_checkout',
      'metadata[tenant_id]': tenantId,
      'metadata[order_id]': orderId,
      'metadata[operator_id]': ctx.operatorId,
      'metadata[purpose]': 'tenant_order_checkout',
    });

    await upsertPaymentRecord({
      tenant_id: tenantId,
      operator_id: ctx.operatorId,
      order_id: orderId,
      customer_id: order.customer_id || null,
      stripe_account_id: stripeAccountId,
      stripe_checkout_session_id: session.id,
      stripe_customer_id: session.customer || null,
      payment_mode: 'pay_online',
      amount_subtotal: amount,
      amount_total: amount,
      amount_platform_fee: applicationFee,
      currency,
      status: 'checkout_created',
      livemode: !!session.livemode,
      metadata: {
        source: 'operator',
        checkout_url: session.url,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).catch(() => null);

    return json(200, {
      ok: true,
      url: session.url,
      id: session.id,
      amount,
      applicationFee
    });
  } catch (e) {
    return json(Number(e.statusCode || 500), {
      ok: false,
      error: e.message || String(e)
    });
  }
};