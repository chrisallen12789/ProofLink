// netlify/functions/process-recurring-orders.js
// Scheduled function. Runs daily to create new orders from active service plans.
// Trigger via Netlify scheduled functions (cron: "0 8 * * *") or call manually.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  // Allow scheduled invocation or manual admin trigger
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const supabase = getAdminClient();
  const { data: result, error } = await supabase.rpc('generate_due_service_plans', {
    p_tenant_id: null,
  });

  if (error) {
    console.error('[process-recurring-orders] generate_due_service_plans failed:', error);
    return respond(500, { error: 'Failed to process recurring service plans' });
  }
  const payload = {
    ok: true,
    processed: Number(result?.processed || 0),
    created: Number(result?.created || 0),
    skipped: Number(result?.existing || 0),
    failed: Number(result?.failed || 0),
  };
  console.log('[process-recurring-orders] completed:', payload);
  return respond(200, payload);
};
