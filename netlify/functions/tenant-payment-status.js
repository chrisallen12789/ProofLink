// FILE: netlify/functions/tenant-payment-status.js
const {
  buildTenantPaymentState,
  clean,
  findTenantById,
  json,
  manualPaymentsOnlyMessage,
  readJson,
  requireOperatorContext,
} = require('./_prooflink_payments');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const body = event.httpMethod === 'POST' ? readJson(event) : {};
    const qsTenantId = clean(
      event.queryStringParameters?.tenantId ||
      event.queryStringParameters?.tenant_id
    );

    const requestedTenantId = clean(
      body.tenantId ||
      body.tenant_id ||
      qsTenantId
    );

    const ctx = await requireOperatorContext(event, requestedTenantId || '');
    const resolvedTenantId = requestedTenantId || clean(ctx.tenantId || '');

    const tenant = await findTenantById(resolvedTenantId);

    if (!tenant) {
      throw Object.assign(new Error('Tenant not found.'), { statusCode: 404 });
    }

    const state = buildTenantPaymentState(tenant);

    return json(200, {
      ok: true,
      tenantId: clean(tenant.tenant_id || tenant.id || tenant.slug),
      tenantSlug: clean(tenant.slug),
      paymentState: {
        ...state,
        planLabel: state.prooflinkPlanKey === 'growth' ? 'Growth' : 'Starter',
        onlinePaymentsReason: state.onlinePaymentsEligible
          ? 'Online payments are eligible.'
          : manualPaymentsOnlyMessage(),
      },
      raw: {
        billing_status: clean(tenant.billing_status),
        connect_status: clean(tenant.connect_status),
        prooflink_plan_key: clean(tenant.prooflink_plan_key),
        stripe_customer_id: clean(tenant.stripe_customer_id),
        stripe_subscription_id: clean(tenant.stripe_subscription_id),
        stripe_connect_account_id: clean(tenant.stripe_connect_account_id),
        payments_enabled: tenant.payments_enabled === true,
        online_payments_enabled: tenant.online_payments_enabled === true,
        manual_mode: true,
      }
    });
  } catch (e) {
    return json(Number(e.statusCode || 500), {
      ok: false,
      error: e.message || String(e),
    });
  }
};
