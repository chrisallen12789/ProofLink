const {
  json,
  manualPaymentsOnlyMessage,
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
    await requireOperatorContext(event, '');
    return json(503, {
      ok: false,
      error: manualPaymentsOnlyMessage(),
      code: 'manual_payments_only',
      next_step: 'Use invoice, check, cash, Zelle, or Cash App outside ProofLink.',
    });
  } catch (error) {
    return json(Number(error.statusCode || 500), {
      ok: false,
      error: error.message || 'Unable to open billing settings',
    });
  }
};
