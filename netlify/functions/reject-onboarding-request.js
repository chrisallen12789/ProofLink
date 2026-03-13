// netlify/functions/reject-onboarding-request.js
// Operator-only. Rejects an onboarding request and optionally emails the applicant.
// POST body: { id, rejection_reason? }

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const { id, rejection_reason } = body;
  if (!id) return respond(400, { error: 'Request id is required' });

  // Load request
  const { data: req, error: fetchErr } = await supabase
    .from('tenant_onboarding_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !req) return respond(404, { error: 'Request not found' });

  if (!['submitted', 'approved', 'failed'].includes(req.status)) {
    return respond(409, {
      error: `Cannot reject a request with status '${req.status}'`,
    });
  }

  // Update status
  const { error: updateErr } = await supabase
    .from('tenant_onboarding_requests')
    .update({
      status          : 'rejected',
      rejection_reason: rejection_reason || null,
    })
    .eq('id', id);

  if (updateErr) {
    return respond(500, { error: 'Failed to update request' });
  }

  // Email applicant (non-fatal)
  try {
    await sendEmail(templates.rejected({
      owner_name      : req.owner_name,
      business_name   : req.business_name,
      owner_email     : req.owner_email,
      rejection_reason: rejection_reason || null,
    }));
  } catch (emailErr) {
    console.warn('[reject] Email failed:', emailErr.message);
  }

  return respond(200, { success: true, id });
};
