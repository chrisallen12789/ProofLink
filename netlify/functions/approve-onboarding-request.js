// netlify/functions/approve-onboarding-request.js
//
// Operator-only endpoint.
// Sets an onboarding request status to 'approved'.
// POST body: { id: "<uuid>" }

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  // ── Require operator auth
  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  // ── Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { id } = body;
  if (!id) return respond(400, { error: 'Missing request id' });

  const { supabase } = ctx;

  // Fetch current state
  const { data: existing, error: fetchErr } = await supabase
    .from('tenant_onboarding_requests')
    .select('id, status, business_name, owner_name, owner_email')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return respond(404, { error: 'Onboarding request not found' });
  }

  if (existing.status === 'provisioned') {
    return respond(400, { error: 'Request is already provisioned' });
  }

  if (!['submitted','failed'].includes(existing.status)) {
    return respond(400, {
      error          : 'Can only approve requests with status submitted or failed',
      current_status : existing.status,
    });
  }

  // Update to approved
  const { data: updated, error: updateErr } = await supabase
    .from('tenant_onboarding_requests')
    .update({
      status         : 'approved',
      approved_at    : new Date().toISOString(),
      provision_error: null,
    })
    .eq('id', id)
    .select('id, status, business_name, approved_at')
    .single();

  if (updateErr) {
    console.error('approve-onboarding-request update error:', updateErr);
    return respond(500, { error: 'Failed to approve request' });
  }

  // Email applicant — non-fatal
  sendEmail(templates.approved({
    owner_name   : existing.owner_name,
    business_name: updated.business_name,
    owner_email  : existing.owner_email,
  })).catch((e) => console.warn('[approve] email failed:', e.message));

  return respond(200, {
    message : `Request for "${updated.business_name}" approved`,
    request : updated,
  });
};
