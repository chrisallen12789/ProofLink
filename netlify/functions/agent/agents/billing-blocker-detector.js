'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getBillingBlockerQueueContext, getJobRecordAuditContext } = require('../tools');
const { analyzeJobRecordAudit } = require('./job-record-auditor');

async function runBillingBlockerDetector({ supabase, tenantId, input }) {
  const context = await getBillingBlockerQueueContext(supabase, tenantId, input || {});
  const candidates = Array.isArray(context.candidate_jobs) ? context.candidate_jobs : [];
  const limit = Math.max(1, Math.min(12, Number(input?.limit || candidates.length || 8)));
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];
  const queue = [];

  for (const candidate of candidates.slice(0, limit)) {
    const detail = await getJobRecordAuditContext(supabase, tenantId, candidate.id);
    const audit = analyzeJobRecordAudit(detail);
    if (!audit.blockers.length && audit.billing_readiness?.status === 'ready') continue;
    queue.push({ job: detail.job, audit });
  }

  queue.sort((a, b) => {
    const scoreA = Number(a.audit?.billing_readiness?.score || 100);
    const scoreB = Number(b.audit?.billing_readiness?.score || 100);
    if (scoreA !== scoreB) return scoreA - scoreB;
    const blockersA = Array.isArray(a.audit?.blockers) ? a.audit.blockers.length : 0;
    const blockersB = Array.isArray(b.audit?.blockers) ? b.audit.blockers.length : 0;
    if (blockersA !== blockersB) return blockersB - blockersA;
    return new Date(b.job?.updated_at || 0).getTime() - new Date(a.job?.updated_at || 0).getTime();
  });

  queue.forEach(({ job, audit }, index) => {
    const blocker = audit.blockers[0];
    const queueEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'billing_readiness',
      label: `Billing blocker queue item ${index + 1}`,
      value: `${job.title || 'Job'} | ${audit.billing_readiness?.status || 'review_needed'} | ${blocker?.title || 'needs review'}`,
    });
    findings.push({
      id: `billing_queue_${index + 1}`,
      severity: blocker && Number(audit.billing_readiness?.score || 0) < 50 ? 'critical' : blocker ? 'warning' : 'info',
      category: 'billing',
      title: `${job.title || 'Job'} needs billing follow-through`,
      detail: blocker
        ? `${blocker.title}: ${blocker.detail}`
        : 'This job still needs a billing review even though no hard blocker was returned.',
      evidence_ids: [queueEvidence],
      record_refs: [buildRecordRef('job', job.id, job.title || 'Job')],
    });
  });

  if (queue.length) {
    const first = queue[0];
    blockers.push({
      id: 'billing_queue_open',
      title: 'Invoice-ready work is still waiting on cleanup',
      detail: `${queue.length} job(s) should be reviewed before invoicing or collections work moves ahead. The top queue item is ${first.job.title || 'a job'} and its first blocker is "${first.audit.blockers[0]?.title || 'review needed'}".`,
      evidence_ids: evidence.list().slice(0, 1).map((item) => item.id),
      record_refs: [buildRecordRef('job', first.job.id, first.job.title || 'Job')],
    });
    actions.push({
      id: 'billing_queue_review',
      title: 'Work through the billing blocker queue in priority order',
      detail: 'Open each flagged job, clear the first blocker, then rerun the audit so the queue shrinks from the top instead of spreading effort across half-finished reviews.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_jobs',
      evidence_ids: evidence.list().slice(0, 3).map((item) => item.id),
      record_refs: queue.slice(0, 4).map((item) => buildRecordRef('job', item.job.id, item.job.title || 'Job')),
    });
  }

  return {
    report: {
      agent_key: 'billing_blocker_detector',
      agent_label: 'Billing Blocker Detector',
      summary: queue.length
        ? `${queue.length} job(s) are still waiting on billing cleanup or proof review. Use this queue to clear invoice blockers before they age into collections work.`
        : 'No open billing blocker queue items were found in the current review set.',
      summary_status: queue.length ? 'review_needed' : 'ready',
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: [],
      confidence: {
        score: queue.length ? 0.73 : 0.78,
        rationale: 'Confidence is based on direct job-audit checks across the candidate billing queue.',
      },
      recommended_actions: actions,
      data_used: context.data_used || [],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_billing_blocker_queue_context', 'get_job_record_audit_context'],
      context_summary: {
      candidate_jobs: candidates.length,
      queued_jobs: queue.length,
    },
  };
}

module.exports = { runBillingBlockerDetector };
