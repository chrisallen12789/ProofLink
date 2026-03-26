// netlify/functions/list-onboarding-requests.js
//
// Operator-only endpoint.
// Returns onboarding requests, optionally filtered by status.
// Supports:  GET ?status=submitted|approved|provisioning|provisioned|failed
//            GET ?id=<uuid>  — fetch single request

const { requireOnboardingAdminContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  // CORS pre-flight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Method not allowed' });
  }

  // ── Require operator auth
  let ctx;
  try {
    ctx = await requireOnboardingAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase }   = ctx;
  const params         = event.queryStringParameters || {};
  const { status, id } = params;

  // ── Fetch single request by id
  if (id) {
    const { data, error } = await supabase
      .from('tenant_onboarding_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('list-onboarding-requests single error:', error);
      return respond(500, { error: 'Database error' });
    }
    if (!data) return respond(404, { error: 'Request not found' });

    return respond(200, { request: data });
  }

  // ── Fetch list, optionally filtered by status
  let query = supabase
    .from('tenant_onboarding_requests')
    .select('*')
    .order('created_at', { ascending: false });

  const validStatuses = ['submitted','approved','provisioning','provisioned','failed','rejected','needs_review'];
  if (status && validStatuses.includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('list-onboarding-requests list error:', error);
    return respond(500, { error: 'Database error' });
  }

  return respond(200, {
    requests : data || [],
    count    : (data || []).length,
  });
};
