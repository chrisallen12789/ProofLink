'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;

  const { count: manualEnabledCount, error: manualErr } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('payments_enabled', true);

  const { count: onlineCount, error: onlineErr } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('online_payments_enabled', true);

  const readinessOk = !manualErr && !onlineErr;

  return respond(200, {
    summary: {
      ok: readinessOk,
      message: 'ProofLink is running in manual-payments mode. Stripe checks are retired.',
    },
    stripe_key: {
      ok: true,
      message: 'Stripe is intentionally disabled. No API key is required.',
    },
    connect: {
      ok: true,
      message: 'Operator payments are handled manually while replacement payment options are evaluated.',
      count: manualEnabledCount || 0,
      online_payments_enabled_count: onlineCount || 0,
      billing_customer_count: 0,
    },
    webhook: {
      ok: true,
      message: 'Stripe webhook monitoring is retired in manual-payments mode.',
      platform_secret_present: false,
      billing_secret_present: false,
    },
  });
};
