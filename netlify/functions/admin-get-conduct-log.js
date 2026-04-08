// netlify/functions/admin-get-conduct-log.js
// Admin-only. Returns the conduct log for a specific tenant.
//
// GET /.netlify/functions/admin-get-conduct-log?tenant_id=<uuid>&limit=50

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'GET')     return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase } = ctx;
  const params   = event.queryStringParameters || {};
  const tenantId = params.tenant_id;
  if (!tenantId) return respond(400, { error: 'tenant_id is required' });

  const parsedLimit = parseInt(params.limit || '50', 10);
  if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
    return respond(400, { error: 'limit must be a positive integer' });
  }

  const limit = Math.min(parsedLimit, 200);

  const { data: log, error } = await supabase
    .from('tenant_conduct_log')
    .select('id, action, reason_code, admin_notes, performed_by, performed_at')
    .eq('tenant_id', tenantId)
    .order('performed_at', { ascending: false })
    .limit(limit);

  if (error) return respond(500, { error: 'Failed to load conduct log: ' + error.message });

  return respond(200, { log: log || [] });
};
