'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getDispatchSchedulingContext } = require('../tools');

function keyForAssignedConflict(job) {
  return [
    String(job.assigned_member_id || job.assigned_operator_id || 'unassigned').trim(),
    String(job.scheduled_date || '').trim(),
    String(job.scheduled_time || '').trim() || 'unspecified',
  ].join('::');
}

function dispatchAssignmentId(job) {
  return String(job?.assigned_member_id || job?.assigned_operator_id || '').trim();
}

function keyForBundleOpportunity(job) {
  return [
    String(job.scheduled_date || '').trim(),
    String(job.customer_id || '').trim() || String(job.service_address || '').trim().toLowerCase(),
  ].join('::');
}

async function runDispatchSchedulingAssistant({ supabase, tenantId, input }) {
  const context = await getDispatchSchedulingContext(supabase, tenantId, input || {});
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];

  const upcomingJobs = Array.isArray(context.upcoming_jobs) ? context.upcoming_jobs : [];
  const unscheduledJobs = upcomingJobs.filter((job) => !String(job.scheduled_date || '').trim());
  const unassignedJobs = upcomingJobs.filter((job) => !dispatchAssignmentId(job));
  const untimedJobs = upcomingJobs.filter((job) => String(job.scheduled_date || '').trim() && !String(job.scheduled_time || '').trim());
  const focusCopy = context.target_date
    ? `for ${context.target_date}`
    : 'across the current planning horizon';

  if (unscheduledJobs.length) {
    const unscheduledEvidence = evidence.add({
      record_type: 'job',
      record_id: unscheduledJobs[0].id,
      field: 'scheduled_date',
      label: 'Unscheduled jobs',
      value: `${unscheduledJobs.length} open job(s) are missing a scheduled date.`,
    });
    findings.push({
      id: 'dispatch_unscheduled_jobs',
      severity: 'warning',
      category: 'scheduling',
      title: 'Open jobs still need dates',
      detail: `${unscheduledJobs.length} open job(s) are still missing a scheduled date, which makes dispatch planning weaker ${focusCopy}.`,
      evidence_ids: [unscheduledEvidence],
      record_refs: unscheduledJobs.slice(0, 4).map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
    blockers.push({
      id: 'dispatch_unscheduled_jobs',
      title: 'Assign dates to the unscheduled jobs',
      detail: 'Pick a service date for each open job so the crew plan and route view stop carrying hidden work.',
      evidence_ids: [unscheduledEvidence],
      record_refs: unscheduledJobs.slice(0, 4).map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
  }

  if (unassignedJobs.length) {
    const unassignedEvidence = evidence.add({
      record_type: 'job',
      record_id: unassignedJobs[0].id,
      field: 'assigned_member_id',
      label: 'Unassigned jobs',
      value: `${unassignedJobs.length} open job(s) are missing a crew assignment.`,
    });
    findings.push({
      id: 'dispatch_unassigned_jobs',
      severity: 'warning',
      category: 'dispatch',
      title: 'Open jobs still need an owner',
      detail: `${unassignedJobs.length} open job(s) do not yet have an assigned crew member or operator.`,
      evidence_ids: [unassignedEvidence],
      record_refs: unassignedJobs.slice(0, 4).map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
  }

  if (untimedJobs.length) {
    const untimedEvidence = evidence.add({
      record_type: 'job',
      record_id: untimedJobs[0].id,
      field: 'scheduled_time',
      label: 'Jobs missing a scheduled time',
      value: `${untimedJobs.length} scheduled job(s) still need a concrete time.`,
    });
    findings.push({
      id: 'dispatch_missing_times',
      severity: 'warning',
      category: 'scheduling',
      title: 'Some scheduled jobs still need a time',
      detail: `${untimedJobs.length} job(s) have a date but no scheduled time, which makes route order and customer expectations less reliable.`,
      evidence_ids: [untimedEvidence],
      record_refs: untimedJobs.slice(0, 4).map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
  }

  const byAssignedSlot = new Map();
  upcomingJobs.forEach((job) => {
    const key = keyForAssignedConflict(job);
    const rows = byAssignedSlot.get(key) || [];
    rows.push(job);
    byAssignedSlot.set(key, rows);
  });
  const conflicts = [...byAssignedSlot.values()].filter((rows) => {
    const assigned = dispatchAssignmentId(rows[0]);
    const scheduledDate = String(rows[0]?.scheduled_date || '').trim();
    return assigned && scheduledDate && rows.length > 1;
  });
  if (conflicts.length) {
    const firstConflict = conflicts[0];
    const conflictEvidence = evidence.add({
      record_type: 'job',
      record_id: firstConflict[0].id,
      field: 'assigned_member_id',
      label: 'Crew timing conflict',
      value: `${firstConflict.length} jobs share the same assigned operator and scheduled slot.`,
    });
    findings.push({
      id: 'dispatch_assignment_conflict',
      severity: 'warning',
      category: 'dispatch',
      title: 'The same crew slot is carrying multiple jobs',
      detail: 'At least one assigned operator is booked into overlapping work slots. Review the route order or reassign the extra job before the day starts.',
      evidence_ids: [conflictEvidence],
      record_refs: firstConflict.map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
    blockers.push({
      id: 'dispatch_assignment_conflict',
      title: 'Resolve the overlapping crew slot',
      detail: 'Move or reassign one of the overlapping jobs so the route is executable in the real world.',
      evidence_ids: [conflictEvidence],
      record_refs: firstConflict.map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
  }

  const bundleGroupsByDay = new Map();
  upcomingJobs.forEach((job) => {
    const key = keyForBundleOpportunity(job);
    if (!String(job.scheduled_date || '').trim()) return;
    if (!key || key.endsWith('::')) return;
    const rows = bundleGroupsByDay.get(key) || [];
    rows.push(job);
    bundleGroupsByDay.set(key, rows);
  });
  const bundleOpportunities = [...bundleGroupsByDay.values()].filter((rows) => rows.length > 1);
  if (bundleOpportunities.length) {
    const firstBundle = bundleOpportunities[0];
    const bundleEvidence = evidence.add({
      record_type: 'job',
      record_id: firstBundle[0].id,
      field: 'scheduled_date',
      label: 'Same-day bundling opportunity',
      value: `${firstBundle.length} jobs share the same customer or site on one day.`,
    });
    findings.push({
      id: 'dispatch_bundle_opportunity',
      severity: 'info',
      category: 'dispatch',
      title: 'Same-day work could be bundled',
      detail: 'At least one day carries multiple jobs for the same customer or site. Review whether those stops should be grouped to reduce windshield time.',
      evidence_ids: [bundleEvidence],
      record_refs: firstBundle.map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
  }

  actions.push({
    id: 'dispatch_review_unscheduled_work',
    title: 'Review unscheduled and unassigned work first',
    detail: 'Clear missing dates and assignments before making finer route changes so the next-day board stops hiding work in limbo.',
    priority: blockers.length ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'open_dispatch',
    evidence_ids: evidence.list().map((item) => item.id).slice(0, 3),
    record_refs: [],
  });

  if (bundleOpportunities.length || untimedJobs.length) {
    actions.push({
      id: 'dispatch_tighten_route_shape',
      title: 'Tighten the route before crews roll',
      detail: 'Bundle same-site work where it makes sense, then assign concrete times so the office and field crew are working from the same plan.',
      priority: blockers.length ? 'medium' : 'low',
      requires_operator_approval: true,
      suggested_ui_action: 'open_dispatch',
      evidence_ids: evidence.list().map((item) => item.id).slice(0, 4),
      record_refs: bundleOpportunities[0]
        ? bundleOpportunities[0].slice(0, 4).map((job) => buildRecordRef('job', job.id, job.title || 'Job'))
        : untimedJobs.slice(0, 4).map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
    });
  }

  const summaryPrefix = context.target_date
    ? `The dispatch plan for ${context.target_date}`
    : 'The upcoming schedule';

  return {
    report: {
      agent_key: 'dispatch_scheduling_assistant',
      agent_label: 'Dispatch / Scheduling Assistant',
      summary: blockers.length
        ? `${summaryPrefix} needs operator review before it is truly executable. Missing dates, missing assignments, or overlapping crew slots are still open.`
        : `${summaryPrefix} looks workable at a glance. The assistant found route opportunities and a few items worth tightening before dispatch.`,
      summary_status: blockers.length ? 'blocked' : 'review_needed',
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: [],
      confidence: {
        score: blockers.length ? 0.58 : 0.7,
        rationale: 'Confidence depends on whether upcoming jobs carry dates, assignees, and enough route detail to spot collisions or route opportunities.',
      },
      recommended_actions: actions,
      data_used: context.data_used || [],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_dispatch_scheduling_context'],
    context_summary: {
      upcoming_jobs: upcomingJobs.length,
      unscheduled_jobs: unscheduledJobs.length,
      unassigned_jobs: unassignedJobs.length,
      untimed_jobs: untimedJobs.length,
      assignment_conflicts: conflicts.length,
      bundle_opportunities: bundleOpportunities.length,
      target_date: context.target_date || '',
      job_type: context.job_type || '',
    },
  };
}

module.exports = { runDispatchSchedulingAssistant };
