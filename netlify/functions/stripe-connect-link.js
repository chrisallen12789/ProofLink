const {
  clean,
  json,
  manualPaymentsOnlyMessage,
  readJson,
  requireOperatorContext,
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

    await requireOperatorContext(event, tenantId);

    return json(503, {
      ok: false,
      error: manualPaymentsOnlyMessage(),
      code: 'manual_payments_only',
      next_step: 'Track off-platform payment instructions in tenant settings until a replacement payment provider is selected.',
    });
  } catch (e) {
    return json(Number(e.statusCode || 500), {
      ok: false,
      error: e.message || String(e),
    });
  }
};
