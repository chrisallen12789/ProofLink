const {
  clean,
  json,
  manualPaymentsOnlyMessage,
  readJson,
  requireOperatorContext,
} = require('./_prooflink_payments');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(200, { ok: true });
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const body = readJson(event);
    const tenantId = clean(body.tenantId || body.tenant_id);
    if (!tenantId) {
      return json(400, { ok: false, error: 'Missing tenantId' });
    }

    await requireOperatorContext(event, tenantId);

    return json(503, {
      ok: false,
      error: manualPaymentsOnlyMessage(),
      code: 'manual_payments_only',
      next_step: 'Contact ProofLink support to discuss plan changes while billing is offline.',
    });
  } catch (error) {
    return json(Number(error.statusCode || 500), {
      ok: false,
      error: error.message || 'Unable to create billing session',
    });
  }
};
