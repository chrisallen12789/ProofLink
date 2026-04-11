const { json, manualPaymentsOnlyMessage } = require('./_prooflink_payments');
const getManualPaymentsOnlyMessage = () =>
  typeof manualPaymentsOnlyMessage === 'function'
    ? manualPaymentsOnlyMessage()
    : 'ProofLink is currently running in manual-payments mode. Online checkout and automated billing are unavailable.';

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  return json(410, {
    ok: false,
    error: getManualPaymentsOnlyMessage(),
    code: 'manual_payments_only',
    retired: true,
  });
};
