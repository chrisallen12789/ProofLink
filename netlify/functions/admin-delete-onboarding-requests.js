// netlify/functions/admin-delete-onboarding-requests.js
// Admin-only. Hard-deletes one or more onboarding requests by ID.
//
// POST { ids: string[] }

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { ids } = body;

  if (!Array.isArray(ids) || !ids.length) {
    return respond(400, { error: 'ids must be a non-empty array' });
  }
  if (ids.length > 100) {
    return respond(400, { error: 'Cannot delete more than 100 requests at once' });
  }

  const { error, count } = await supabase
    .from('tenant_onboarding_requests')
    .delete({ count: 'exact' })
    .in('id', ids);

  if (error) return respond(500, { error: 'Delete failed: ' + error.message });

  return respond(200, { ok: true, deleted: count || ids.length });
};
