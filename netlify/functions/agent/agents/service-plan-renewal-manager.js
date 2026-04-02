'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getServicePlanRenewalContext } = require('../tools');

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  return Math.floor((date.getTime() - Date.now()) / 86400000);
}

function mapById(rows = []) {
  return new Map((rows || []).map((row) => [String(row?.id || '').trim(), row]));
}

async function runServicePlanRenewalManager({ supabase, tenantId, input }) {
  const context = await getServicePlanRenewalContext(supabase, tenantId, input || {});
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];
  const customersById = mapById(context.customers || []);
  const ordersById = mapById(context.related_orders || []);
  const focusPlanId = String(context.focus_plan_id || '').trim();

  const activePlans = (context.service_plans || [])
    .filter((row) => String(row?.status || '').trim().toLowerCase() === 'active')
    .sort((a, b) => {
      if (focusPlanId) {
        if (a.id === focusPlanId) return -1;
        if (b.id === focusPlanId) return 1;
      }
      return new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime();
    });

  const buckets = {
    due_soon: [],
    missing_next_run: [],
    reactivation_needed: [],
  };

  activePlans.forEach((plan) => {
    const nextRunDays = daysUntil(plan.next_run_on);
    if (nextRunDays == null) {
      buckets.missing_next_run.push(plan);
      return;
    }
    if (nextRunDays < 0) {
      buckets.reactivation_needed.push(plan);
      return;
    }
    if (nextRunDays <= 14) {
      buckets.due_soon.push(plan);
    }
  });

  Object.entries(buckets).forEach(([bucketKey, rows]) => {
    rows.slice(0, 3).forEach((plan, index) => {
      const customer = customersById.get(String(plan?.customer_id || '').trim()) || null;
      const lastOrder = ordersById.get(String(plan?.last_generated_order_id || '').trim()) || null;
      const evidenceId = evidence.add({
        record_type: 'plan',
        record_id: plan.id,
        field: 'renewal_state',
        label: `Plan renewal ${bucketKey.replace(/_/g, ' ')}`,
        value: `${customer?.name || 'Customer'} | ${plan.title || 'Recurring plan'} | ${plan.next_run_on || 'no next run'} | ${lastOrder?.title || 'no generated order yet'}`,
      });
      const recordRefs = [buildRecordRef('plan', plan.id, plan.title || 'Recurring plan')];
      if (customer?.id) recordRefs.push(buildRecordRef('customer', customer.id, customer.name || 'Customer'));
      findings.push({
        id: `service_plan_${bucketKey}_${index + 1}`,
        severity: bucketKey === 'due_soon' ? 'info' : 'warning',
        category: bucketKey,
        title: `${customer?.name || 'Customer'} is ${bucketKey === 'due_soon'
          ? 'coming due soon'
          : bucketKey === 'missing_next_run'
            ? 'missing the next renewal date'
            : 'already overdue for the next recurring move'}`,
        detail: bucketKey === 'due_soon'
          ? `This active plan already has the next run attached, but it is due within the next two weeks and should stay visible with the linked work and money context.`
          : bucketKey === 'missing_next_run'
            ? `This active plan does not yet carry a usable next-run date, so renewal and scheduling are drifting out of one inspectable queue.`
            : `This active plan is already past its next-run timing, which means the account needs recovery before it turns into a quiet repeat-service miss.`,
        evidence_ids: [evidenceId],
        record_refs: recordRefs,
      });
    });
  });

  if (buckets.missing_next_run.length) {
    blockers.push({
      id: 'service_plan_missing_next_run',
      title: 'Some active service plans are missing the next run date',
      detail: 'Renewal and repeat-work timing should be attached to the plan before the account goes quiet or the office has to reconstruct the schedule from memory.',
      evidence_ids: findings.filter((item) => item.category === 'missing_next_run').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
      record_refs: findings.filter((item) => item.category === 'missing_next_run').flatMap((item) => item.record_refs || []).slice(0, 4),
    });
  }

  if (buckets.reactivation_needed.length) {
    blockers.push({
      id: 'service_plan_reactivation_needed',
      title: 'Some recurring accounts already need schedule recovery',
      detail: 'At least one plan is past the next-run timing, so the recurring promise should be recovered before another cycle is missed.',
      evidence_ids: findings.filter((item) => item.category === 'reactivation_needed').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
      record_refs: findings.filter((item) => item.category === 'reactivation_needed').flatMap((item) => item.record_refs || []).slice(0, 4),
    });
  }

  actions.push({
    id: 'service_plan_attach_missing_dates',
    title: 'Attach the next run before repeat work drifts',
    detail: 'Start with active plans missing a usable next-run date so the renewal queue is grounded in real schedule timing instead of memory.',
    priority: buckets.missing_next_run.length ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'open_plans',
    evidence_ids: findings.filter((item) => item.category === 'missing_next_run').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
    record_refs: findings.filter((item) => item.category === 'missing_next_run').flatMap((item) => item.record_refs || []).slice(0, 4),
  });
  actions.push({
    id: 'service_plan_recover_overdue_accounts',
    title: 'Recover the overdue recurring accounts next',
    detail: 'When a plan is already past the next-run timing, pull it back into the calendar or generate the next recurring work before the customer falls out of rhythm.',
    priority: buckets.reactivation_needed.length ? 'high' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'open_plans',
    evidence_ids: findings.filter((item) => item.category === 'reactivation_needed').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
    record_refs: findings.filter((item) => item.category === 'reactivation_needed').flatMap((item) => item.record_refs || []).slice(0, 4),
  });
  actions.push({
    id: 'service_plan_keep_due_soon_visible',
    title: 'Keep the due-soon plans attached to the next work and money step',
    detail: 'Use the due-soon queue to keep the next visit, customer promise, and collections follow-through visible together.',
    priority: buckets.due_soon.length ? 'medium' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'open_plans',
    evidence_ids: findings.filter((item) => item.category === 'due_soon').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
    record_refs: findings.filter((item) => item.category === 'due_soon').flatMap((item) => item.record_refs || []).slice(0, 4),
  });

  return {
    report: {
      agent_key: 'service_plan_renewal_manager',
      agent_label: 'Service Plan Renewal Manager',
      summary: activePlans.length
        ? `The recurring-plan queue has ${activePlans.length} active plan(s). ProofLink separated due-soon plans, plans missing the next run, and accounts that already need schedule recovery.`
        : 'No active service plans were returned for the current renewal review.',
      summary_status: blockers.length ? 'blocked' : (activePlans.length ? 'review_needed' : 'ready'),
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: [],
      confidence: {
        score: activePlans.length ? 0.78 : 0.7,
        rationale: 'Confidence depends on whether the active plan, next-run, customer, and linked recurring-work records are all present together.',
      },
      recommended_actions: actions,
      data_used: context.data_used || [],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_service_plan_renewal_context'],
    context_summary: {
      active_plans: activePlans.length,
      due_soon: buckets.due_soon.length,
      missing_next_run: buckets.missing_next_run.length,
      reactivation_needed: buckets.reactivation_needed.length,
    },
  };
}

module.exports = { runServicePlanRenewalManager };
