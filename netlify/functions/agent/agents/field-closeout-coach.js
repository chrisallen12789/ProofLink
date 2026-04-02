'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getFieldCloseoutContext } = require('../tools');

function countPhotos(photos = [], type) {
  return (Array.isArray(photos) ? photos : []).filter((photo) => {
    return String(photo?.photo_type || '').trim().toLowerCase() === String(type || '').trim().toLowerCase();
  }).length;
}

function unresolvedAlerts(alerts = []) {
  return (Array.isArray(alerts) ? alerts : []).filter((alert) => alert && alert.resolved !== true);
}

function unresolvedManifests(manifests = []) {
  return (Array.isArray(manifests) ? manifests : []).filter((manifest) => {
    const status = String(manifest?.status || '').trim().toLowerCase();
    return status !== 'confirmed' || manifest?.invoiced !== true;
  });
}

function hasText(...values) {
  return values.some((value) => String(value || '').trim());
}

function calculateConfidence(context, blockers, findings, missingData) {
  const coverage = [
    context?.job ? 0.22 : 0,
    Array.isArray(context?.photos) ? 0.18 : 0,
    Array.isArray(context?.time_segments) ? 0.16 : 0,
    Array.isArray(context?.expenses) ? 0.12 : 0,
    Array.isArray(context?.waste_manifests) ? 0.1 : 0,
    Array.isArray(context?.compliance_alerts) ? 0.08 : 0,
    context?.order ? 0.08 : 0,
    context?.customer ? 0.06 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const penalty = Math.min(0.38, (blockers.length * 0.05) + (missingData.length * 0.02) + ((context?.assumptions || []).length * 0.03));
  const score = Math.max(0.24, Math.min(0.95, coverage - penalty));
  return {
    score: Number(score.toFixed(2)),
    rationale: findings.length
      ? 'Confidence depends on whether proof, closeout timing, manifests, and crew follow-through records are all present together.'
      : 'Confidence is stronger when the field closeout package includes proof, time, and any trade-specific closeout records.',
  };
}

function analyzeFieldCloseout(context = {}) {
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const recommendedActions = [];
  const missingData = [];

  const job = context.job || {};
  const order = context.order || null;
  const customer = context.customer || null;
  const photos = Array.isArray(context.photos) ? context.photos : [];
  const timeSegments = Array.isArray(context.time_segments) ? context.time_segments : [];
  const expenses = Array.isArray(context.expenses) ? context.expenses : [];
  const manifests = Array.isArray(context.waste_manifests) ? context.waste_manifests : [];
  const alerts = unresolvedAlerts(context.compliance_alerts);
  const status = String(job.status || '').trim().toLowerCase();
  const isCompleted = status === 'completed';
  const jobRef = buildRecordRef('job', job.id, job.title || 'Job');
  const orderRef = order?.id ? buildRecordRef('order', order.id, order.title || order.customer_name || 'Linked order') : null;
  const customerRef = customer?.id ? buildRecordRef('customer', customer.id, customer.company_name || customer.name || 'Customer') : null;

  const pushFinding = (config = {}) => findings.push({
    id: config.id,
    severity: config.severity,
    category: config.category,
    title: config.title,
    detail: config.detail,
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const pushBlocker = (config = {}) => blockers.push({
    id: config.id,
    title: config.title,
    detail: config.detail,
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const pushAction = (config = {}) => recommendedActions.push({
    id: config.id,
    title: config.title,
    detail: config.detail,
    priority: config.priority || 'medium',
    requires_operator_approval: true,
    suggested_ui_action: config.suggested_ui_action || '',
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const closeoutEvidenceId = evidence.add({
    record_type: 'job',
    record_id: job.id,
    field: 'closeout_package',
    label: 'Field closeout package',
    value: [
      `status ${job.status || 'unknown'}`,
      `${countPhotos(photos, 'before')} before`,
      `${countPhotos(photos, 'after')} after`,
      `signature ${job.signature_data_url ? 'present' : 'missing'}`,
      `time segments ${timeSegments.length}`,
    ].join(' | '),
  });

  if (!hasText(job.service_address, order?.service_address, customer?.address_line1)) {
    const addressEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'service_address',
      label: 'Service address',
      value: 'No site address is attached to the field record.',
    });
    pushFinding({
      id: 'closeout_missing_service_address',
      severity: 'warning',
      category: 'site_context',
      title: 'Field record is missing the service address',
      detail: 'The closeout package is weaker because the work location is not captured on the job or linked order.',
      evidence_ids: [addressEvidenceId],
      record_refs: [jobRef, orderRef, customerRef],
    });
    missingData.push({
      id: 'closeout_missing_service_address',
      label: 'Service address is missing',
      detail: 'Capture the actual service address so the closeout record stays defensible.',
      field: 'job.service_address',
      required_for: 'field_closeout',
    });
  }

  if (!hasText(job.completion_note, job.crew_notes, job.notes)) {
    const noteEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'completion_note',
      label: 'Closeout notes',
      value: 'No completion note, crew note, or field note is stored yet.',
    });
    pushFinding({
      id: 'closeout_missing_note',
      severity: isCompleted ? 'warning' : 'info',
      category: 'proof',
      title: 'Closeout note still needs to be captured',
      detail: isCompleted
        ? 'The work is marked complete, but the field record does not yet explain what was done, what changed, or what the office should remember.'
        : 'Leave a plain-English field note before the work is handed back so the office does not have to reconstruct the visit later.',
      evidence_ids: [noteEvidenceId],
      record_refs: [jobRef],
    });
    if (isCompleted) {
      pushBlocker({
        id: 'closeout_missing_note',
        title: 'Add the closeout note before office follow-through',
        detail: 'Capture what was completed, what changed on site, and any follow-up the office should carry into invoicing or scheduling.',
        evidence_ids: [noteEvidenceId],
        record_refs: [jobRef],
      });
    }
  }

  if (isCompleted && countPhotos(photos, 'after') === 0 && job.completion_photo_required !== false) {
    pushFinding({
      id: 'closeout_missing_after_photo',
      severity: 'critical',
      category: 'proof',
      title: 'After photo is still missing',
      detail: 'The work is complete, but the closeout package still does not include final proof photos.',
      evidence_ids: [closeoutEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'closeout_missing_after_photo',
      title: 'Upload the final proof photo',
      detail: 'Attach the after photo before the office treats this field record as complete.',
      evidence_ids: [closeoutEvidenceId],
      record_refs: [jobRef],
    });
    missingData.push({
      id: 'closeout_missing_after_photo',
      label: 'After photo is missing',
      detail: 'At least one after photo should be attached for completed work that requires proof.',
      field: 'job_photos.after',
      required_for: 'field_closeout',
    });
  }

  if (isCompleted && !job.signature_data_url) {
    pushFinding({
      id: 'closeout_missing_signature',
      severity: 'warning',
      category: 'proof',
      title: 'Customer sign-off is still missing',
      detail: 'No signature or sign-off proof is attached to the completed field record yet.',
      evidence_ids: [closeoutEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'closeout_missing_signature',
      title: 'Capture the field sign-off',
      detail: 'Save the customer signature or approval acknowledgment before the office has to answer proof questions later.',
      evidence_ids: [closeoutEvidenceId],
      record_refs: [jobRef],
    });
  }

  const openTimeSegments = timeSegments.filter((segment) => segment && segment.started_at && !segment.ended_at);
  if (openTimeSegments.length) {
    const timeEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'time_segments',
      label: 'Open time segments',
      value: `${openTimeSegments.length} time segment(s) still need an end time.`,
    });
    pushFinding({
      id: 'closeout_open_time_segments',
      severity: 'warning',
      category: 'timing',
      title: 'The work timer is not fully closed out',
      detail: 'At least one time segment is still open, which makes labor handoff and billing backup weaker.',
      evidence_ids: [timeEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'closeout_open_time_segments',
      title: 'Close the remaining time entries',
      detail: 'Finish the open time segment so the closeout timing reflects a real work window.',
      evidence_ids: [timeEvidenceId],
      record_refs: [jobRef],
    });
  }

  const actualStart = job.actual_start_at || job.started_at || '';
  const actualEnd = job.actual_end_at || job.completed_at || '';
  if (isCompleted && !actualEnd) {
    const timingEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'actual_end_at',
      label: 'Completion time',
      value: 'The job is complete, but no actual end time is stored.',
    });
    pushFinding({
      id: 'closeout_missing_completion_time',
      severity: 'critical',
      category: 'timing',
      title: 'Completion time is still missing',
      detail: 'The closeout package does not yet include the actual completion time for this visit.',
      evidence_ids: [timingEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'closeout_missing_completion_time',
      title: 'Capture the actual completion time',
      detail: 'Update the job so the field record shows when the crew actually finished.',
      evidence_ids: [timingEvidenceId],
      record_refs: [jobRef],
    });
  } else if (actualStart && actualEnd && new Date(actualEnd).getTime() < new Date(actualStart).getTime()) {
    const contradictoryEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'actual_start_at',
      label: 'Contradictory field timing',
      value: `start ${actualStart} | end ${actualEnd}`,
    });
    pushFinding({
      id: 'closeout_contradictory_timing',
      severity: 'critical',
      category: 'timing',
      title: 'Field timing is contradictory',
      detail: 'The recorded end time is earlier than the start time, so the closeout package cannot be trusted yet.',
      evidence_ids: [contradictoryEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'closeout_contradictory_timing',
      title: 'Correct the field timing',
      detail: 'Review the start and end timestamps before the office uses this record for billing or dispute support.',
      evidence_ids: [contradictoryEvidenceId],
      record_refs: [jobRef],
    });
  }

  if (!expenses.length && isCompleted) {
    const costEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'expenses',
      label: 'Field cost capture',
      value: 'No expense or cost records are attached to this completed job yet.',
    });
    pushFinding({
      id: 'closeout_missing_cost_capture',
      severity: 'info',
      category: 'costs',
      title: 'No field cost capture is attached yet',
      detail: 'If labor, materials, disposal, or vendor costs matter on this visit, now is the safest time to attach them before the office loses context.',
      evidence_ids: [costEvidenceId],
      record_refs: [jobRef, orderRef],
    });
  }

  if (alerts.length) {
    const alertEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'compliance_alerts',
      label: 'Open compliance alerts',
      value: `${alerts.length} unresolved compliance alert(s) are still tied to the job.`,
    });
    pushFinding({
      id: 'closeout_unresolved_compliance_alerts',
      severity: 'critical',
      category: 'compliance',
      title: 'Compliance alerts are still open on the field record',
      detail: 'The closeout package still has unresolved compliance alerts attached, so the office should not treat the record as finished yet.',
      evidence_ids: [alertEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'closeout_unresolved_compliance_alerts',
      title: 'Resolve the open compliance alerts',
      detail: 'Clear or document the remaining compliance issues before final closeout.',
      evidence_ids: [alertEvidenceId],
      record_refs: [jobRef],
    });
  }

  const openManifests = unresolvedManifests(manifests);
  if (openManifests.length) {
    const manifestEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'waste_manifests',
      label: 'Manifest closeout',
      value: `${openManifests.length} waste manifest(s) still need confirmation or invoicing cleanup.`,
    });
    pushFinding({
      id: 'closeout_open_manifests',
      severity: 'critical',
      category: 'compliance',
      title: 'Manifest closeout is still open',
      detail: 'At least one haul or disposal manifest still needs confirmation or billing follow-through before the field record is truly closed.',
      evidence_ids: [manifestEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'closeout_open_manifests',
      title: 'Finish the manifest closeout',
      detail: 'Confirm the remaining manifests and make sure disposal or billing details are attached before this job leaves the field lane.',
      evidence_ids: [manifestEvidenceId],
      record_refs: [jobRef],
    });
  }

  if (status === 'in_progress' || status === 'blocked') {
    pushAction({
      id: 'closeout_prepare_before_completion',
      title: 'Prepare the closeout package before marking the visit complete',
      detail: 'Capture the final note, proof photos, and any field costs while the crew still has the visit fresh in hand.',
      priority: 'high',
      suggested_ui_action: 'open_job',
      evidence_ids: [closeoutEvidenceId],
      record_refs: [jobRef],
    });
  }

  if (blockers.some((item) => item.id === 'closeout_missing_after_photo' || item.id === 'closeout_missing_signature' || item.id === 'closeout_missing_note')) {
    pushAction({
      id: 'closeout_capture_remaining_proof',
      title: 'Capture the remaining proof before office handoff',
      detail: 'Finish the note, photos, and signature package so the office can invoice or follow up from one solid record.',
      priority: 'high',
      suggested_ui_action: 'open_job',
      evidence_ids: [closeoutEvidenceId],
      record_refs: [jobRef],
    });
  }

  if (openTimeSegments.length || blockers.some((item) => item.id === 'closeout_missing_completion_time' || item.id === 'closeout_contradictory_timing')) {
    pushAction({
      id: 'closeout_fix_field_timing',
      title: 'Fix the field timing before the record moves downstream',
      detail: 'The closeout timing still needs cleanup. Correct it now so billing, labor review, and dispute support stay trustworthy.',
      priority: 'high',
      suggested_ui_action: 'open_job',
      evidence_ids: evidence.list().filter((item) => item.field === 'time_segments' || item.field === 'actual_end_at' || item.field === 'actual_start_at').map((item) => item.id),
      record_refs: [jobRef],
    });
  }

  if (alerts.length || openManifests.length) {
    pushAction({
      id: 'closeout_clear_trade_specific_records',
      title: 'Finish the trade-specific closeout records',
      detail: 'Clear the remaining compliance or manifest items before the office treats this visit as fully closed.',
      priority: 'high',
      suggested_ui_action: 'open_job',
      evidence_ids: evidence.list().filter((item) => item.field === 'compliance_alerts' || item.field === 'waste_manifests').map((item) => item.id),
      record_refs: [jobRef],
    });
  }

  if (isCompleted && Number(job.amount_due_cents || order?.amount_due_cents || 0) > 0) {
    pushAction({
      id: 'closeout_handoff_money_followthrough',
      title: 'Hand the finished field record back with the money follow-through visible',
      detail: 'This visit looks complete in the field, but money is still open. Keep the office handoff tied to the same record so invoice and payment follow-through stay traceable.',
      priority: 'medium',
      suggested_ui_action: 'open_order',
      evidence_ids: [closeoutEvidenceId],
      record_refs: [jobRef, orderRef, customerRef],
    });
  }

  const confidence = calculateConfidence(context, blockers, findings, missingData);
  const summaryStatus = blockers.length ? 'blocked' : (status === 'completed' ? 'ready' : 'review_needed');
  const summary = blockers.length
    ? 'The field closeout still has blocking gaps. Capture the missing proof, timing, or trade-specific records before the office takes over.'
    : status === 'completed'
      ? 'The field closeout package looks strong enough to hand back to the office. Proof, timing, and follow-through records are largely in place.'
      : 'The visit is still in progress, but the closeout coach can already see what should be captured before the crew leaves the site.';

  return {
    agent_key: 'field_closeout_coach',
    agent_label: 'Field Closeout Coach',
    summary,
    summary_status: summaryStatus,
    findings,
    blockers,
    evidence: evidence.list(),
    assumptions: context.assumptions || [],
    missing_data: missingData,
    confidence,
    recommended_actions: recommendedActions,
    data_used: context.data_used || [],
    scope: {
      tenant_id: context.tenant_id || '',
      job_id: job.id || '',
      order_id: order?.id || '',
      customer_id: customer?.id || '',
    },
    generated_at: new Date().toISOString(),
  };
}

async function runFieldCloseoutCoach({ supabase, tenantId, input }) {
  const jobId = String(input?.job_id || input?.jobId || '').trim();
  if (!jobId) {
    const err = new Error('job_id is required');
    err.statusCode = 400;
    throw err;
  }

  const context = await getFieldCloseoutContext(supabase, tenantId, jobId);
  return {
    report: analyzeFieldCloseout(context),
    tools_used: ['get_field_closeout_context'],
    context_summary: {
      job_id: jobId,
      photo_count: Array.isArray(context.photos) ? context.photos.length : 0,
      time_segments: Array.isArray(context.time_segments) ? context.time_segments.length : 0,
      compliance_alerts: Array.isArray(context.compliance_alerts) ? context.compliance_alerts.length : 0,
      waste_manifests: Array.isArray(context.waste_manifests) ? context.waste_manifests.length : 0,
    },
  };
}

module.exports = {
  analyzeFieldCloseout,
  runFieldCloseoutCoach,
};
