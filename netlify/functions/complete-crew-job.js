// netlify/functions/complete-crew-job.js
// POST /.netlify/functions/complete-crew-job
// Crew-member authenticated. Marks a job complete with completion note + optional signature.
// Body: { job_id, completion_note, signature_data_url? }
// Returns { job: {...}, ok: true }

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');
const { requireHydrovacOperatorContext } = require('./utils/hydrovac');
const { collectHydrovacLifecycleIssues, hydrovacJobType } = require('./lib/hydrovac-compliance');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId } = ctx;
  const adminSb = getAdminClient();
  let hydrovacCtx = null;
  try {
    hydrovacCtx = await requireHydrovacOperatorContext(event);
  } catch (_) {
    hydrovacCtx = null;
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON body' }); }

  const { job_id, completion_note, signature_data_url } = body;

  if (!job_id) return respond(400, { error: 'job_id is required' });
  if (!completion_note) return respond(400, { error: 'completion_note is required' });

  // Verify job belongs to tenant
  const { data: job, error: jobErr } = await adminSb
    .from('jobs')
    .select('id, tenant_id, status, job_type, service_type, requires_confined_space_permit, total_loads_hauled, total_disposal_cost_cents, disposal_cost_cents, disposal_site, disposal_manifest_number')
    .eq('id', job_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (jobErr) {
    console.error('[complete-crew-job] job fetch error:', jobErr);
    return respond(500, { error: 'Failed to fetch job' });
  }

  if (!job) return respond(404, { error: 'Job not found or does not belong to your tenant' });

  if (hydrovacCtx && hydrovacJobType(job)) {
    const issues = await collectHydrovacLifecycleIssues({
      adminSb,
      tenantId,
      hydrovacSettings: hydrovacCtx.hydrovacSettings,
      job,
      targetStatus: 'completed',
    });
    if (issues.length) {
      return respond(409, { error: issues[0].message, issues });
    }
  }

  // Build update patch
  const patch = {
    status          : 'completed',
    completion_note,
    actual_end_at   : new Date().toISOString(),
  };

  if (signature_data_url !== undefined) {
    patch.signature_data_url = signature_data_url;
  }

  const { data: updated, error: updateErr } = await adminSb
    .from('jobs')
    .update(patch)
    .eq('id', job_id)
    .eq('tenant_id', tenantId)
    .select()
    .maybeSingle();

  if (updateErr) {
    console.error('[complete-crew-job] update error:', updateErr);
    return respond(500, { error: 'Failed to complete job' });
  }

  return respond(200, { ok: true, job: updated });
};
