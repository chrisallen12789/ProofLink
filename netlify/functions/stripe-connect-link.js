const {
  clean,
  getBaseUrl,
  json,
  patchTenant,
  readJson,
  requireOperatorContext,
  stripeRequest,
  findTenantById,
} = require('./_prooflink_payments');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const body = readJson(event);
    const tenantId = clean(body.tenantId || body.tenant_id);
    if (!tenantId) {
      throw Object.assign(new Error('tenantId is required.'), { statusCode: 400 });
    }

    const ctx = await requireOperatorContext(event, tenantId);
    const tenant = await findTenantById(tenantId).catch(() => null);

    let accountId = clean(
      body.stripeAccountId ||
      body.stripe_account_id ||
      tenant?.stripe_connect_account_id ||
      tenant?.stripe_account_id
    );

    if (!accountId) {
      const account = await stripeRequest('/accounts', 'POST', {
        type: 'express',
        country: clean(body.country || 'US'),
        email: clean(body.email || tenant?.email || ctx.user?.email),
        'metadata[tenant_id]': clean(tenant?.slug || tenant?.tenant_id || tenantId),
        'metadata[tenant_slug]': clean(tenant?.slug || tenantId),
        'metadata[operator_id]': ctx.operatorId,
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
        business_type: 'company',
      });

      accountId = clean(account.id);

      await patchTenant(tenantId, {
        stripe_connect_account_id: accountId,
        stripe_account_id: accountId,
        connect_status: 'connect_incomplete',
        payments_enabled: false,
        online_payments_enabled: false,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
    }

    const baseUrl = getBaseUrl(event);
    const refreshUrl =
      clean(body.refreshUrl) || `${baseUrl}/operator/?connect=refresh#payments`;
    const returnUrl =
      clean(body.returnUrl) || `${baseUrl}/operator/?connect=return#payments`;

    const link = await stripeRequest('/account_links', 'POST', {
      account: accountId,
      type: 'account_onboarding',
      refresh_url: refreshUrl,
      return_url: returnUrl,
    });

    await patchTenant(tenantId, {
      stripe_connect_account_id: accountId,
      stripe_account_id: accountId,
      connect_status: 'connect_incomplete',
      payments_enabled: false,
      online_payments_enabled: false,
      updated_at: new Date().toISOString(),
    }).catch(() => null);

    return json(200, {
      ok: true,
      url: link.url,
      accountId,
      connectStatus: 'connect_incomplete',
    });
  } catch (e) {
    return json(Number(e.statusCode || 500), {
      ok: false,
      error: e.message || String(e),
    });
  }
};