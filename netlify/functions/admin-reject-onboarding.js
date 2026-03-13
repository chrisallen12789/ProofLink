// netlify/functions/admin-reject-onboarding.js
//
// Operator-only (admin) endpoint.
// Rejects an onboarding request, optionally stores a reason, and emails the applicant.
//
// POST body: { id: "<uuid>", rejection_reason?: "..." }
//
// Valid statuses to reject from: submitted, approved, failed, needs_review

const { requireAdminContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');

const REJECTABLE = new Set(['submitted', 'approved', 'failed', 'needs_review']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { id, rejection_reason } = body;
  if (!id) return respond(400, { error: 'Request id is required' });

  // Load request
  const { data: req, error: fetchErr } = await supabase
    .from('tenant_onboarding_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !req) {
    return respond(404, { error: 'Onboarding request not found' });
  }

  if (!REJECTABLE.has(req.status)) {
    return respond(409, {
      error : `Cannot reject a request with status '${req.status}'`,
      status: req.status,
    });
  }

  // Update status
  const { error: updateErr } = await supabase
    .from('tenant_onboarding_requests')
    .update({
      status          : 'rejected',
      rejection_reason: rejection_reason?.trim() || null,
    })
    .eq('id', id);

  if (updateErr) {
    console.error('[admin-reject] update error:', updateErr);
    return respond(500, { error: 'Failed to update request status' });
  }

  // Email applicant (non-fatal)
  sendEmail(templates.rejected({
    owner_name      : req.owner_name,
    business_name   : req.business_name,
    owner_email     : req.owner_email,
    rejection_reason: rejection_reason?.trim() || null,
  })).catch((e) => console.warn('[admin-reject] email failed:', e.message));

  return respond(200, {
    success         : true,
    id,
    rejection_reason: rejection_reason?.trim() || null,
  });
};
