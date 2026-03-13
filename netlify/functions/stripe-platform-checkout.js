const {
  clean,
  getBaseUrl,
  getEnv,
  json,
  patchTenant,
  readJson,
  requireOperatorContext,
  stripeRequest,
} = require('./_prooflink_payments');

const PLAN_MAP = {
  starter: getEnv('STRIPE_PRICE_STARTER_MONTHLY'),
  growth: getEnv('STRIPE_PRICE_GROWTH_MONTHLY'),
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  try {
    const body = readJson(event);
    const tenantId = clean(body.tenantId || body.tenant_id);
    if (!tenantId) {
      throw Object.assign(new Error('tenantId is required.'), { statusCode: 400 });
    }

    const ctx = await requireOperatorContext(event, tenantId);
    const planKey = clean(body.planKey || body.plan_key || 'starter').toLowerCase();
    const priceId = PLAN_MAP[planKey];

    if (!priceId) {
      throw Object.assign(
        new Error(`Stripe price is not configured for plan ${planKey}.`),
        { statusCode: 400 }
      );
    }

    const baseUrl = getBaseUrl(event);
    const successUrl = clean(body.successUrl) || `${baseUrl}/operator/?billing=success&plan=${encodeURIComponent(planKey)}#payments`;
    const cancelUrl = clean(body.cancelUrl) || `${baseUrl}/operator/?billing=cancel&plan=${encodeURIComponent(planKey)}#payments`;

    const session = await stripeRequest('/checkout/sessions', 'POST', {
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      allow_promotion_codes: 'true',
      billing_address_collection: 'auto',
      client_reference_id: tenantId,
      'custom_text[submit][message]': 'You are subscribing to ProofLink platform billing.',
      'metadata[tenant_id]': tenantId,
      'metadata[operator_id]': ctx.operatorId,
      'metadata[purpose]': 'prooflink_platform_billing',
      'metadata[plan_key]': planKey,
      'subscription_data[metadata][tenant_id]': tenantId,
      'subscription_data[metadata][purpose]': 'prooflink_platform_billing',
      'subscription_data[metadata][plan_key]': planKey,
    });

    await patchTenant(tenantId, {
      billing_status: 'checkout_started',
      prooflink_plan_key: planKey,
      stripe_customer_id: session.customer || null,
      updated_at: new Date().toISOString(),
    }).catch(() => null);

    return json(200, {
      ok: true,
      url: session.url,
      id: session.id,
      customer: session.customer || null,
    });
  } catch (e) {
    return json(Number(e.statusCode || 500), {
      ok: false,
      error: e.message || String(e),
    });
  }
};