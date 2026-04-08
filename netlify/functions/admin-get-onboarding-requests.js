// netlify/functions/admin-get-onboarding-requests.js
//
// Operator-only endpoint (called by admin dashboard).
// Extended version of list-onboarding-requests with:
//   - needs_review status support
//   - Full-text search on business_name, owner_name, owner_email (?q=)
//   - Pagination (?limit=50&offset=0)
//   - Returns all fields needed for the admin table + detail view
//
// GET  ?status=submitted|approved|provisioning|provisioned|failed|rejected|needs_review
// GET  ?q=search+term
// GET  ?id=<uuid>            — single request
// GET  ?limit=50&offset=0   — pagination

const { requireAdminContext, respond } = require('./utils/auth');

const VALID_STATUSES = new Set([
  'submitted', 'approved', 'provisioning', 'provisioned',
  'failed', 'rejected', 'needs_review',
]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')     return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;
  const params = event.queryStringParameters || {};
  const { id, status, q } = params;
  const parsedLimit = parseInt(params.limit || '100', 10);
  const parsedOffset = parseInt(params.offset || '0', 10);
  const limit = Math.min(parsedLimit, 250);
  const offset = parsedOffset;

  if (status && !VALID_STATUSES.has(status)) {
    return respond(400, { error: 'Invalid status filter' });
  }
  if (!Number.isFinite(limit) || limit < 1) {
    return respond(400, { error: 'limit must be a positive integer' });
  }
  if (!Number.isFinite(offset) || offset < 0) {
    return respond(400, { error: 'offset must be a non-negative integer' });
  }

  // ── Single request lookup ────────────────────────────────────────────────
  if (id) {
    const { data, error } = await supabase
      .from('tenant_onboarding_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return respond(500, { error: 'Database error', detail: error.message });
    }
    if (!data) return respond(404, { error: 'Request not found' });

    return respond(200, { request: data });
  }

  // ── List with optional filters ────────────────────────────────────────────
  let query = supabase
    .from('tenant_onboarding_requests')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  if (q && q.trim()) {
    const safe = String(q || '').trim().replace(/[^a-zA-Z0-9 @._-]/g, '').slice(0, 100);
    if (safe) {
      query = query.or(
        `business_name.ilike.%${safe}%,owner_name.ilike.%${safe}%,owner_email.ilike.%${safe}%`
      );
    }
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('[admin-get-onboarding-requests] error:', error);
    return respond(500, { error: 'Database error', detail: error.message });
  }

  return respond(200, {
    requests: data || [],
    count   : count || 0,
    limit,
    offset,
  });
};
