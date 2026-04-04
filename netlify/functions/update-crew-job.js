// netlify/functions/update-crew-job.js
// PATCH /.netlify/functions/update-crew-job
// Crew-member authenticated. Updates job status and/or adds notes.
// Body: { job_id, status?, crew_notes?, blocker_note?, actual_start_at?, actual_end_at?, check_in_lat?, check_in_lng?, completion_handoff? }

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');
const { requireHydrovacOperatorContext } = require('./utils/hydrovac');
const { collectHydrovacLifecycleIssues, hydrovacJobType, logComplianceAlerts, resolveComplianceAlerts } = require('./lib/hydrovac-compliance');
const {
  buildHydrovacCompletionNarrative,
  extractHydrovacCompletionHandoff,
  mergeCrewCloseoutMetadata,
  normalizeHydrovacCompletionHandoff,
} = require('./lib/hydrovac-closeout');

const ALLOWED_CREW_STATUSES = new Set(['in_progress', 'blocked', 'completed']);
const ADMIN_ROLES = new Set(['admin', 'owner', 'manager', 'platform_admin']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'PATCH' && event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { user, tenantId, role } = ctx;
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

  const { job_id, status, crew_notes, blocker_note, actual_start_at, actual_end_at, check_in_lat, check_in_lng, completion_handoff } = body;

  if (!job_id) return respond(400, { error: 'job_id is required' });

  // Validate status if provided
  if (status !== undefined && !ALLOWED_CREW_STATUSES.has(status)) {
    return respond(400, { error: `Invalid status. Crew may only set: ${[...ALLOWED_CREW_STATUSES].join(', ')}` });
  }

  // Fetch the job to verify ownership and tenant
  const { data: job, error: jobErr } = await adminSb
    .from('jobs')
    .select('id, tenant_id, assigned_operator_id, assigned_member_id, status, actual_start_at, actual_end_at, job_type, service_type, requires_confined_space_permit, total_loads_hauled, total_disposal_cost_cents, disposal_cost_cents, disposal_site, disposal_manifest_number, metadata')
    .eq('id', job_id)
    .maybeSingle();

  if (jobErr) {
    console.error('[update-crew-job] job fetch error:', jobErr);
    return respond(500, { error: 'Failed to fetch job' });
  }

  if (!job) return respond(404, { error: 'Job not found' });
  if (job.tenant_id !== tenantId) return respond(403, { error: 'Job does not belong to your tenant' });

  // Resolve member record
  const { data: member, error: memberErr } = await adminSb
    .from('operator_members')
    .select('operator_id, role, role_title')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (memberErr) {
    console.error('[update-crew-job] member lookup error:', memberErr);
    return respond(500, { error: 'Failed to resolve crew member record' });
  }

  // Authorization: must be assigned to this job OR be an admin/owner/manager
  const isAdmin = ADMIN_ROLES.has(role) || (member && ADMIN_ROLES.has(member.role));
  const assignmentKeys = new Set([
    String(member?.id || '').trim(),
    String(member?.operator_id || '').trim(),
    String(user.id || '').trim(),
  ].filter(Boolean));
  const isAssigned = !!(
    (job.assigned_member_id && assignmentKeys.has(String(job.assigned_member_id).trim())) ||
    (job.assigned_operator_id && assignmentKeys.has(String(job.assigned_operator_id).trim()))
  );

  if (!isAssigned && !isAdmin) {
    return respond(403, { error: 'You are not assigned to this job' });
  }

  // Build patch object from allowed fields only
  const patch = {};
  const isHydrovacLifecycle = hydrovacCtx && hydrovacJobType(job);
  let normalizedCloseout = null;

  if (status !== undefined) patch.status = status;
  if (crew_notes !== undefined) patch.crew_notes = crew_notes;
  if (blocker_note !== undefined) patch.blocker_note = blocker_note;
  if (actual_start_at !== undefined) patch.actual_start_at = actual_start_at;
  if (actual_end_at !== undefined) patch.actual_end_at = actual_end_at;
  if (check_in_lat !== undefined) patch.check_in_lat = check_in_lat;
  if (check_in_lng !== undefined) patch.check_in_lng = check_in_lng;

  if (isHydrovacLifecycle && (status === 'completed' || completion_handoff !== undefined)) {
    const normalized = await normalizeHydrovacCompletionHandoff({
      adminSb,
      tenantId,
      job,
      raw: completion_handoff,
    });
    if (normalized.error) {
      return respond(400, { error: normalized.error });
    }
    normalizedCloseout = normalized.value;
    patch.metadata = mergeCrewCloseoutMetadata(job.metadata, normalizedCloseout);
    if (status === 'completed') {
      patch.completion_note = buildHydrovacCompletionNarrative(normalizedCloseout);
      if (crew_notes === undefined) patch.crew_notes = patch.completion_note;
    }
  }

  // Auto-set timestamps based on status transitions
  if (status === 'completed' && !actual_end_at && !job.actual_end_at) {
    patch.actual_end_at = new Date().toISOString();
  }
  if (status === 'in_progress' && !actual_start_at && !job.actual_start_at) {
    patch.actual_start_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return respond(400, { error: 'No valid fields provided to update' });
  }

  patch.updated_at = new Date().toISOString();

  if (isHydrovacLifecycle && (status === 'in_progress' || status === 'completed')) {
    const issues = await collectHydrovacLifecycleIssues({
      adminSb,
      tenantId,
      hydrovacSettings: hydrovacCtx.hydrovacSettings,
      job,
      targetStatus: status,
    });
    if (issues.length) {
      await logComplianceAlerts(adminSb, tenantId, issues, {
        referenceType: 'job',
        referenceId: job.id,
        actorLabel: ctx.email || user.email || 'crew',
      });
      return respond(409, { error: issues[0].message, issues });
    }
  }

  const { data: updated, error: updateErr } = await adminSb
    .from('jobs')
    .update(patch)
    .eq('id', job_id)
    .eq('tenant_id', tenantId)
    .select()
    .maybeSingle();

  if (updateErr) {
    console.error('[update-crew-job] update error:', updateErr);
    return respond(500, { error: 'Failed to update job' });
  }

  if (isHydrovacLifecycle && (status === 'in_progress' || status === 'completed')) {
    await resolveComplianceAlerts(adminSb, tenantId, {
      referenceType: 'job',
      referenceId: job_id,
      alertTypes: [
        'locate_ticket_missing',
        'confined_space_permit_missing',
        'manifest_missing',
        'manifest_unconfirmed',
        'manifest_facility_missing',
        'manifest_ticket_missing',
        'manifest_quantity_missing',
      ],
    });
  }

  return respond(200, {
    job: {
      ...updated,
      completion_handoff: normalizedCloseout || extractHydrovacCompletionHandoff(updated),
    },
  });
};
