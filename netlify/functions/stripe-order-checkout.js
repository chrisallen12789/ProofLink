const {
  clean,
  json,
  manualPaymentsOnlyMessage,
  readJson,
  requireOperatorContext,
} = require('./_prooflink_payments');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const getManualPaymentsOnlyMessage = () =>
  typeof manualPaymentsOnlyMessage === 'function'
    ? manualPaymentsOnlyMessage()
    : 'ProofLink is currently running in manual-payments mode. Online checkout and automated billing are unavailable.';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `checkout:${ip}`, maxRequests: 20, windowMs: 60000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const body = readJson(event);
    const tenantId = clean(body.tenantId || body.tenant_id);
    if (!tenantId) {
      throw Object.assign(new Error('tenantId is required.'), { statusCode: 400 });
    }

    await requireOperatorContext(event, tenantId);

    return json(503, {
      ok: false,
      error: getManualPaymentsOnlyMessage(),
      code: 'manual_payments_only',
      next_step: 'Send an invoice or collect payment offline.',
    });
  } catch (e) {
    return json(Number(e.statusCode || 500), {
      ok: false,
      error: e.message || String(e),
    });
  }
};
