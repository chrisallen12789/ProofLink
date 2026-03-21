// netlify/functions/admin-get-audit-log.js
// Admin-only. Returns recent conduct actions across all tenants.
//
// GET /.netlify/functions/admin-get-audit-log?limit=50&offset=0&tenant_id=<uuid>

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
  const limit    = Math.min(parseInt(params.limit  || '50', 10), 200);
  const offset   = parseInt(params.offset || '0', 10);
  const tenantId = params.tenant_id || null;

  let query = supabase
    .from('tenant_conduct_log')
    .select(
      'id, tenant_id, action, reason_code, admin_notes, performed_by, performed_at, tenants!tenant_id(name, slug)',
      { count: 'exact' }
    )
    .order('performed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data: log, error, count } = await query;

  if (error) return respond(500, { error: 'Failed to load audit log: ' + error.message });

  return respond(200, { log: log || [], total: count || 0, limit, offset });
};
