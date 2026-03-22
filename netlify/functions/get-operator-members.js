// netlify/functions/get-operator-members.js
// Returns all active members for the authenticated operator's tenant.
// GET (no query params needed)
// Requires operator auth.
// Returns { members: [...] }

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  const { data: members, error } = await supabase
    .from('operator_members')
    .select('id, user_id, display_name, email, role, role_title, max_jobs_per_day, default_hourly_rate_cents')
    .eq('tenant_id', tenantId)
    .neq('is_active', false)
    .order('display_name');

  if (error) {
    console.error('[get-operator-members]', error);
    return respond(500, { error: 'Failed to fetch members' });
  }

  return respond(200, { members: members || [] });
};
