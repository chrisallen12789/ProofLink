'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getRetentionReactivationContext } = require('../tools');

function firstText(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function groupByCustomer(rows = []) {
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const customerId = String(row?.customer_id || '').trim();
    if (!customerId) return;
    const bucket = grouped.get(customerId) || [];
    bucket.push(row);
    grouped.set(customerId, bucket);
  });
  return grouped;
}

function hasActiveWork(rows = []) {
  return (rows || []).some((row) => !['completed', 'cancelled', 'archived', 'paid', 'void'].includes(String(row?.status || '').trim().toLowerCase()));
}

function repeatSignal(customer = {}) {
  return firstText(
    customer.service_plan_name,
    customer.recurring_notes,
    customer.service_schedule,
    customer.frequency,
    customer.follow_up_notes,
    customer.maintenance_notes,
    customer.parts_follow_up,
    customer.warranty_notes,
    customer.seasonal_notes
  );
}

async function runRetentionReactivationManager({ supabase, tenantId, input }) {
  const context = await getRetentionReactivationContext(supabase, tenantId, input || {});
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];
  const customers = context.customers || [];
  const staleCustomerIds = new Set((context.stale_customers || []).map((row) => String(row?.id || '').trim()).filter(Boolean));
  const plansByCustomer = groupByCustomer(context.service_plans || []);
  const ordersByCustomer = groupByCustomer(context.recent_orders || []);
  const jobsByCustomer = groupByCustomer(context.recent_jobs || []);
  const focusCustomerId = String(context.focus_customer_id || '').trim();

  const sortedCustomers = [...customers].sort((a, b) => {
    if (focusCustomerId) {
      if (a.id === focusCustomerId) return -1;
      if (b.id === focusCustomerId) return 1;
    }
    const aStale = staleCustomerIds.has(String(a?.id || '').trim()) ? 0 : 1;
    const bStale = staleCustomerIds.has(String(b?.id || '').trim()) ? 0 : 1;
    if (aStale !== bStale) return aStale - bStale;
    return new Date(a?.updated_at || a?.created_at || 0).getTime() - new Date(b?.updated_at || b?.created_at || 0).getTime();
  });

  const buckets = {
    reactivate_now: [],
    recent_work_still_open: [],
    plan_recovery: [],
    light_touch_reactivation: [],
  };

  sortedCustomers.forEach((customer) => {
    const customerId = String(customer?.id || '').trim();
    if (!customerId) return;
    const customerPlans = plansByCustomer.get(customerId) || [];
    const customerOrders = ordersByCustomer.get(customerId) || [];
    const customerJobs = jobsByCustomer.get(customerId) || [];
    const activePlans = customerPlans.filter((row) => String(row?.status || '').trim().toLowerCase() === 'active');
    const openWork = hasActiveWork(customerOrders) || hasActiveWork(customerJobs);
    const signal = repeatSignal(customer);
    const isStale = staleCustomerIds.has(customerId);
    if (activePlans.some((row) => !String(row?.next_run_on || '').trim())) {
      buckets.plan_recovery.push(customer);
      return;
    }
    if (openWork) {
      buckets.recent_work_still_open.push(customer);
      return;
    }
    if (signal && isStale) {
      buckets.reactivate_now.push(customer);
      return;
    }
    if (isStale || customerId === focusCustomerId) {
      buckets.light_touch_reactivation.push(customer);
    }
  });

  Object.entries(buckets).forEach(([bucketKey, rows]) => {
    rows.slice(0, 3).forEach((customer, index) => {
      const customerId = String(customer?.id || '').trim();
      const planCount = (plansByCustomer.get(customerId) || []).length;
      const workCount = (ordersByCustomer.get(customerId) || []).length + (jobsByCustomer.get(customerId) || []).length;
      const evidenceId = evidence.add({
        record_type: 'customer',
        record_id: customerId,
        field: 'retention_state',
        label: `Retention ${bucketKey.replace(/_/g, ' ')}`,
        value: `${customer.name || customer.company_name || 'Customer'} | ${repeatSignal(customer) || 'no repeat signal on file'} | ${planCount} plan(s) | ${workCount} recent work record(s)`,
      });
      findings.push({
        id: `retention_${bucketKey}_${index + 1}`,
        severity: bucketKey === 'reactivate_now' ? 'warning' : 'info',
        category: bucketKey,
        title: `${customer.name || customer.company_name || 'Customer'} should ${bucketKey === 'reactivate_now'
          ? 'be reactivated now'
          : bucketKey === 'recent_work_still_open'
            ? 'finish the current work path first'
            : bucketKey === 'plan_recovery'
              ? 'be recovered through the plan lane'
              : 'get a lighter follow-up touch'}`,
        detail: bucketKey === 'reactivate_now'
          ? 'This customer still looks like repeat-service work, but the record has gone quiet and there is no active plan or open work keeping the next visit visible.'
          : bucketKey === 'recent_work_still_open'
            ? 'There is still open work or a current operational path attached to this customer, so reactivation should wait until that flow closes cleanly.'
            : bucketKey === 'plan_recovery'
              ? 'This customer already has a recurring-plan signal, but the active plan needs renewal recovery before a separate reactivation move is layered on top.'
              : 'The account is quiet enough to deserve a follow-up touch, even if the repeat-service signal is lighter than the top-priority reactivation set.'
        ,
        evidence_ids: [evidenceId],
        record_refs: [buildRecordRef('customer', customerId, customer.name || customer.company_name || 'Customer')],
      });
    });
  });

  if (buckets.plan_recovery.length) {
    blockers.push({
      id: 'retention_plan_recovery_overlap',
      title: 'Some quiet accounts really belong in the plan-recovery lane first',
      detail: 'At least one customer has recurring-plan drift that should be recovered before a separate reactivation motion is started.',
      evidence_ids: findings.filter((item) => item.category === 'plan_recovery').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
      record_refs: findings.filter((item) => item.category === 'plan_recovery').flatMap((item) => item.record_refs || []).slice(0, 4),
    });
  }

  actions.push({
    id: 'retention_reactivate_now',
    title: 'Start with the strongest repeat-service reactivation candidates',
    detail: 'Use the customers that still show repeat-service signals but no active plan or open work as the first follow-up set.',
    priority: buckets.reactivate_now.length ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'open_customers',
    evidence_ids: findings.filter((item) => item.category === 'reactivate_now').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
    record_refs: findings.filter((item) => item.category === 'reactivate_now').flatMap((item) => item.record_refs || []).slice(0, 4),
  });
  actions.push({
    id: 'retention_finish_open_work_first',
    title: 'Do not layer reactivation on top of still-open work',
    detail: 'When the customer already has open jobs or orders, close that loop before pushing a separate reactivation motion.',
    priority: buckets.recent_work_still_open.length ? 'medium' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'open_orders',
    evidence_ids: findings.filter((item) => item.category === 'recent_work_still_open').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
    record_refs: findings.filter((item) => item.category === 'recent_work_still_open').flatMap((item) => item.record_refs || []).slice(0, 4),
  });
  actions.push({
    id: 'retention_route_plan_overlap',
    title: 'Route plan-drift accounts into renewal recovery',
    detail: 'Keep plan renewal and general customer reactivation separate so the team does not blend repeat-service schedule recovery with broader relationship outreach.',
    priority: buckets.plan_recovery.length ? 'medium' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'open_plans',
    evidence_ids: findings.filter((item) => item.category === 'plan_recovery').map((item) => item.evidence_ids?.[0]).filter(Boolean).slice(0, 3),
    record_refs: findings.filter((item) => item.category === 'plan_recovery').flatMap((item) => item.record_refs || []).slice(0, 4),
  });

  return {
    report: {
      agent_key: 'retention_reactivation_manager',
      agent_label: 'Retention / Reactivation Manager',
      summary: customers.length
        ? `The customer reactivation review inspected ${customers.length} focus account(s). ProofLink separated immediate reactivation candidates, open-work holds, plan-recovery overlaps, and lighter-touch follow-up customers.`
        : 'No customer records were returned for the current retention review.',
      summary_status: blockers.length ? 'blocked' : (customers.length ? 'review_needed' : 'ready'),
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: [],
      confidence: {
        score: customers.length ? 0.74 : 0.68,
        rationale: 'Confidence depends on whether stale-customer timing, recent work history, and recurring-service signals are all available together.',
      },
      recommended_actions: actions,
      data_used: context.data_used || [],
      scope: { customer_id: focusCustomerId, tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_retention_reactivation_context'],
    context_summary: {
      focus_customers: customers.length,
      stale_customers: (context.stale_customers || []).length,
      reactivate_now: buckets.reactivate_now.length,
      recent_work_still_open: buckets.recent_work_still_open.length,
      plan_recovery: buckets.plan_recovery.length,
      light_touch_reactivation: buckets.light_touch_reactivation.length,
    },
  };
}

module.exports = { runRetentionReactivationManager };
