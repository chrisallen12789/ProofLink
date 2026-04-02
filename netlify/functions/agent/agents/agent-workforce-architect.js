'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getAgentWorkforceContext } = require('../tools');

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function countAgentRuns(agentAudit = {}, agentKeys = []) {
  const usage = agentAudit?.usage_by_agent || {};
  return agentKeys.reduce((sum, key) => sum + numberValue(usage[key]), 0);
}

function workspaceRef(tab, label = '') {
  return buildRecordRef('workspace', String(tab || '').trim(), label || `${String(tab || '').trim()} workspace`);
}

function confidenceScore(context = {}) {
  const signals = [
    context?.tenant?.business_name ? 1 : 0,
    context?.context_summary?.billing_candidates ? 1 : 0,
    context?.context_summary?.open_balances ? 1 : 0,
    context?.context_summary?.multi_location_customers ? 1 : 0,
    context?.context_summary?.import_profiles ? 1 : 0,
    context?.context_summary?.active_service_plans ? 1 : 0,
    context?.agent_audit?.event_count ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const penalties = Math.min(0.18, numberValue(context?.assumptions?.length) * 0.03);
  return Math.max(0.52, Math.min(0.93, 0.58 + (signals * 0.05) - penalties));
}

async function runAgentWorkforceArchitect({ supabase, tenantId }) {
  const context = await getAgentWorkforceContext(supabase, tenantId);
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];

  const businessContext = context?.business_context || {};
  const billingContext = context?.billing_context || {};
  const collectionsContext = context?.collections_context || {};
  const dispatchContext = context?.dispatch_context || {};
  const importLearning = context?.import_learning || {};
  const agentAudit = context?.agent_audit || {};
  const servicePlanSummary = context?.service_plan_summary || {};
  const tenant = context?.tenant || {};

  const billingCandidates = Array.isArray(billingContext.candidate_jobs) ? billingContext.candidate_jobs : [];
  const openBalances = Array.isArray(collectionsContext.open_balances) ? collectionsContext.open_balances : [];
  const dispatchJobs = Array.isArray(dispatchContext.upcoming_jobs) ? dispatchContext.upcoming_jobs : [];
  const multiLocationCustomers = Array.isArray(businessContext.multi_location_customers) ? businessContext.multi_location_customers : [];
  const staleCustomers = Array.isArray(businessContext.stale_customers) ? businessContext.stale_customers : [];
  const sourceSystems = Array.isArray(importLearning.source_systems) ? importLearning.source_systems : [];
  const correctionFieldHotspots = Array.isArray(importLearning.correction_field_hotspots)
    ? importLearning.correction_field_hotspots
    : [];
  const fieldCloseoutRuns = countAgentRuns(agentAudit, ['field_closeout_coach']);
  const sitePacketRuns = countAgentRuns(agentAudit, ['site_packet_builder']);
  const accountingContinuityRuns = countAgentRuns(agentAudit, ['accounting_continuity_auditor']);

  const missingDueDateCount = openBalances.filter((row) => {
    return !String(row?.invoice_due_date || '').trim() && !String(row?.payment_due_date || '').trim();
  }).length;
  const unscheduledJobs = dispatchJobs.filter((job) => !String(job?.scheduled_date || '').trim());
  const unassignedJobs = dispatchJobs.filter((job) => {
    return String(job?.scheduled_date || '').trim()
      && !String(job?.assigned_member_id || job?.assigned_operator_id || '').trim();
  });

  const workforceEvidenceId = evidence.add({
    record_type: 'tenant',
    record_id: tenantId,
    field: 'workforce_summary',
    label: 'AI workforce review snapshot',
    value: [
      tenant.business_name || 'Tenant',
      `${billingCandidates.length} billing candidate(s)`,
      `${multiLocationCustomers.length} multi-location customer(s)`,
      `${openBalances.length} open balance(s)`,
      `${numberValue(importLearning.profile_count)} import profile(s)`,
      `${numberValue(servicePlanSummary.active_count)} active service plan(s)`,
    ].join(' | '),
  });

  const addFinding = (finding) => findings.push(finding);
  const addAction = (action) => actions.push(action);

  if (billingCandidates.length >= 3) {
    const jobsEvidenceId = evidence.add({
      record_type: 'job',
      record_id: String(billingCandidates[0]?.id || 'billing_queue'),
      field: 'billing_candidates',
      label: 'Billing-ready work still hitting cleanup',
      value: `${billingCandidates.length} job(s) are still landing in the billing blocker queue.`,
    });
    addFinding({
      id: 'workforce_training_field_closeout_coach',
      severity: billingCandidates.length >= 6 || !fieldCloseoutRuns ? 'warning' : 'info',
      category: 'agent_training',
      title: 'Train the Field Closeout Coach on the real blocker patterns',
      detail: `${billingCandidates.length} job(s) are still reaching billing review with cleanup pressure. Keep teaching the closeout coach to catch the missing proof, signature, timing, manifest, and note gaps before the office sees them.`,
      evidence_ids: [workforceEvidenceId, jobsEvidenceId],
      record_refs: [
        workspaceRef('jobs', 'Jobs workspace'),
        ...billingCandidates.slice(0, 2).map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
      ],
    });
    addAction({
      id: 'workforce_action_train_field_closeout_coach',
      title: 'Run the Field Closeout Coach where crews hand work back',
      detail: fieldCloseoutRuns
        ? 'Keep feeding the closeout coach real blocker outcomes from Jobs so the field package gets tighter before billing review.'
        : 'Start running the closeout coach from Jobs so it can learn the real proof, note, and timing gaps your team keeps cleaning up downstream.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_jobs',
      evidence_ids: [jobsEvidenceId],
      record_refs: [workspaceRef('jobs', 'Jobs workspace')],
    });
  }

  if (multiLocationCustomers.length >= 1 && dispatchJobs.length >= 4) {
    const multiSiteEvidenceId = evidence.add({
      record_type: 'customer',
      record_id: String(multiLocationCustomers[0]?.customer_id || 'multi_site'),
      field: 'site_count',
      label: 'Multi-location customer pressure',
      value: `${multiLocationCustomers.length} multi-location customer(s) are active while ${dispatchJobs.length} upcoming job(s) are still being coordinated.`,
    });
    addFinding({
      id: 'workforce_training_site_packet_builder',
      severity: multiLocationCustomers.length >= 3 || !sitePacketRuns ? 'warning' : 'info',
      category: 'agent_training',
      title: 'Train the Site Packet Builder on multi-building dispatch pressure',
      detail: 'Crews are operating across customers with multiple buildings or campuses. Keep sharpening the site-packet lane around building-specific access notes, prior proof, recurring issues, and arrival contacts.',
      evidence_ids: [workforceEvidenceId, multiSiteEvidenceId],
      record_refs: [
        workspaceRef('customers', 'Customers workspace'),
        workspaceRef('dispatch', 'Dispatch workspace'),
        ...multiLocationCustomers.slice(0, 2).map((customer) => buildRecordRef('customer', customer.customer_id, customer.name || 'Customer')),
      ],
    });
    addAction({
      id: 'workforce_action_train_site_packet_builder',
      title: 'Keep the site-packet lane tied to Customers, Jobs, and Dispatch',
      detail: sitePacketRuns
        ? 'Use real multi-site dispatch work to teach the site packet where crews still need stronger arrival context.'
        : 'Start running the site packet from Jobs and multi-location customer records so crews stop arriving without the best-known site context.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_customers',
      evidence_ids: [multiSiteEvidenceId],
      record_refs: [workspaceRef('customers', 'Customers workspace')],
    });
  }

  const hasAccountingContinuitySignal = sourceSystems.includes('quickbooks')
    || correctionFieldHotspots.some((item) => ['order_external_id', 'invoice_number', 'doc_number'].includes(String(item?.field || '').trim().toLowerCase()));
  if (hasAccountingContinuitySignal) {
    const accountingEvidenceId = evidence.add({
      record_type: 'tenant',
      record_id: tenantId,
      field: 'accounting_continuity',
      label: 'Accounting continuity signal',
      value: sourceSystems.includes('quickbooks')
        ? `Import learning already shows ${sourceSystems.join(', ')} continuity requirements.`
        : 'Import corrections repeatedly touch external invoice reference fields.',
    });
    addFinding({
      id: 'workforce_training_accounting_continuity_auditor',
      severity: accountingContinuityRuns ? 'info' : 'warning',
      category: 'agent_training',
      title: 'Train the Accounting Continuity Auditor on real outside-accounting traces',
      detail: 'This tenant is carrying outside-accounting references through imports and payment follow-through. Keep teaching the continuity auditor to hold QuickBooks or other external invoice numbers visible across service reports, orders, and payment reconciliation.',
      evidence_ids: [workforceEvidenceId, accountingEvidenceId],
      record_refs: [
        workspaceRef('import', 'Import workspace'),
        workspaceRef('payments', 'Payments workspace'),
        workspaceRef('orders', 'Orders workspace'),
      ],
    });
    addAction({
      id: 'workforce_action_train_accounting_continuity',
      title: 'Run the continuity audit wherever outside accounting touches work',
      detail: accountingContinuityRuns
        ? 'Keep the continuity audit active in Import, Orders, and Payments so the learned QuickBooks and external-reference patterns get sharper with every correction.'
        : 'Start running the continuity audit in Import, Orders, and Payments so outside-accounting references become part of the real workflow instead of side knowledge.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_import',
      evidence_ids: [accountingEvidenceId],
      record_refs: [workspaceRef('import', 'Import workspace')],
    });
  }

  if (numberValue(servicePlanSummary.active_count) >= 4
    && (numberValue(servicePlanSummary.at_risk_count) >= 2 || staleCustomers.length >= 6)) {
    const retentionEvidenceId = evidence.add({
      record_type: 'tenant',
      record_id: tenantId,
      field: 'service_plans',
      label: 'Renewal-risk service plans',
      value: `${numberValue(servicePlanSummary.active_count)} active plan(s), ${numberValue(servicePlanSummary.at_risk_count)} at-risk plan(s), ${staleCustomers.length} stale customer(s).`,
    });
    addFinding({
      id: 'workforce_training_service_plan_renewal_manager',
      severity: 'warning',
      category: 'agent_training',
      title: 'Train the Service Plan Renewal Manager on live renewal drift',
      detail: 'Repeat-service revenue is active enough that the new renewal manager should stay grounded in next-run drift, quiet accounts, and return-visit follow-through before repeat work cools off.',
      evidence_ids: [workforceEvidenceId, retentionEvidenceId],
      record_refs: [
        workspaceRef('plans', 'Plans workspace'),
        workspaceRef('customers', 'Customers workspace'),
        ...servicePlanSummary.sample_customer_ids
          .slice(0, 2)
          .map((customerId) => buildRecordRef('customer', customerId, 'Service-plan customer')),
      ],
    });
    addAction({
      id: 'workforce_action_train_service_plan_manager',
      title: 'Keep the renewal manager tied to Plans and Customers',
      detail: 'Use real renewal-risk accounts from Plans and Customers so the manager keeps surfacing next-run drift and repeat-service recovery before the schedule goes quiet.',
      priority: 'medium',
      requires_operator_approval: true,
      suggested_ui_action: 'open_plans',
      evidence_ids: [retentionEvidenceId],
      record_refs: [workspaceRef('plans', 'Plans workspace')],
    });
  }

  if (numberValue(importLearning.profile_count) > 0 && correctionFieldHotspots.length) {
    const hotspotEvidenceId = evidence.add({
      record_type: 'tenant',
      record_id: tenantId,
      field: 'import_hotspots',
      label: 'Import-learning correction hotspots',
      value: correctionFieldHotspots
        .slice(0, 3)
        .map((item) => `${item.field} (${item.count})`)
        .join(', '),
    });
    addFinding({
      id: 'workforce_training_import_migration_assistant',
      severity: 'info',
      category: 'agent_training',
      title: 'Train the Import Migration Assistant on repeated correction hotspots',
      detail: `Operators have already taught ProofLink where imports go wrong most often. Fold ${correctionFieldHotspots.slice(0, 3).map((item) => item.field).join(', ')} back into walkthrough coaching, profile suggestions, and post-import warnings.`,
      evidence_ids: [hotspotEvidenceId],
      record_refs: [workspaceRef('import', 'Import workspace')],
    });
    addAction({
      id: 'workforce_action_train_import_assistant',
      title: 'Turn recurring import corrections into stronger walkthrough guidance',
      detail: 'Use the learned profile hotspots to sharpen import coaching, recommended field mappings, and cleanup-inbox prioritization.',
      priority: 'medium',
      requires_operator_approval: true,
      suggested_ui_action: 'open_import',
      evidence_ids: [hotspotEvidenceId],
      record_refs: [workspaceRef('import', 'Import workspace')],
    });
  }

  if (missingDueDateCount > 0) {
    const dueDateEvidenceId = evidence.add({
      record_type: 'order',
      record_id: String(openBalances[0]?.order_id || 'open_balances'),
      field: 'missing_due_dates',
      label: 'Collections due-date uncertainty',
      value: `${missingDueDateCount} open balance(s) are missing both invoice and payment due dates.`,
    });
    addFinding({
      id: 'workforce_training_collections_assistant',
      severity: missingDueDateCount >= 3 ? 'warning' : 'info',
      category: 'agent_training',
      title: 'Train the Collections Assistant to guard against due-date ambiguity',
      detail: 'The collections lane is only as strong as the due-date trail behind it. Tighten the assistant around blank due dates, invoice-number continuity, and safer follow-up wording when overdue status is uncertain.',
      evidence_ids: [dueDateEvidenceId],
      record_refs: [
        workspaceRef('payments', 'Payments workspace'),
        ...openBalances.slice(0, 2).map((row) => buildRecordRef('order', row.order_id, row.order_title || 'Order')),
      ],
    });
  }

  if (unscheduledJobs.length || unassignedJobs.length || (multiLocationCustomers.length && dispatchJobs.length >= 4)) {
    const dispatchEvidenceId = evidence.add({
      record_type: 'job',
      record_id: String(dispatchJobs[0]?.id || 'dispatch_lane'),
      field: 'dispatch_training',
      label: 'Dispatch training pressure',
      value: `${unscheduledJobs.length} unscheduled job(s), ${unassignedJobs.length} scheduled-but-unassigned job(s), ${multiLocationCustomers.length} multi-location customer(s).`,
    });
    addFinding({
      id: 'workforce_training_dispatch_assistant',
      severity: (unscheduledJobs.length + unassignedJobs.length) >= 4 ? 'warning' : 'info',
      category: 'agent_training',
      title: 'Train the Dispatch Assistant on site bundling and assignment pressure',
      detail: 'The dispatch lane should lean harder into multi-site bundling, missing assignments, and same-customer route shaping so operators see the crew-pressure story sooner.',
      evidence_ids: [dispatchEvidenceId],
      record_refs: [
        workspaceRef('dispatch', 'Dispatch workspace'),
        ...dispatchJobs.slice(0, 2).map((job) => buildRecordRef('job', job.id, job.title || 'Job')),
      ],
    });
  }

  const coreQueueRunCount = countAgentRuns(agentAudit, [
    'billing_blocker_detector',
    'collections_followup_assistant',
    'dispatch_scheduling_assistant',
  ]);
  if (!coreQueueRunCount && (billingCandidates.length || openBalances.length || dispatchJobs.length)) {
    blockers.push({
      id: 'workforce_blocker_low_agent_adoption',
      title: 'The current AI queue is not being exercised enough yet',
      detail: 'ProofLink already has grounded agent rails for billing blockers, collections, and dispatch review, but the recent agent audit history does not show those lanes being run. Adoption needs to come up before the next agent wave will pay off fully.',
      evidence_ids: [workforceEvidenceId],
      record_refs: [workspaceRef('dashboard', 'Command center')],
    });
    addAction({
      id: 'workforce_action_raise_agent_adoption',
      title: 'Make the AI ops review part of the daily operator rhythm',
      detail: 'Keep running the command-center AI queue so the current grounded agents build operator trust and reveal the next gaps from real usage instead of theory.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_dashboard',
      evidence_ids: [workforceEvidenceId],
      record_refs: [workspaceRef('dashboard', 'Command center')],
    });
  }

  if (!findings.length) {
    addFinding({
      id: 'workforce_healthy_coverage',
      severity: 'info',
      category: 'agent_gap',
      title: 'The current structured agent layer covers the strongest visible pressure points',
      detail: 'No additional specialist agent stands out as immediately higher leverage than deepening the existing queues and continuing to capture learned import, dispatch, and billing signals.',
      evidence_ids: [workforceEvidenceId],
      record_refs: [workspaceRef('dashboard', 'Command center')],
    });
  }

  const newAgentCount = findings.filter((finding) => finding.category === 'agent_gap' && finding.id !== 'workforce_healthy_coverage').length;
  const trainingTargetCount = findings.filter((finding) => finding.category === 'agent_training').length;
  const score = confidenceScore(context);

  return {
    report: {
      agent_key: 'agent_workforce_architect',
      agent_label: 'AI Workforce Architect',
      summary: newAgentCount || trainingTargetCount
        ? `ProofLink should add ${newAgentCount} specialist agent${newAgentCount === 1 ? '' : 's'} and sharpen ${trainingTargetCount} current agent lane${trainingTargetCount === 1 ? '' : 's'} based on the live workload, import learning, and agent usage signals in this tenant.`
        : 'The current structured agent layer covers the strongest visible workflow pressure points right now.',
      summary_status: blockers.length ? 'blocked' : (newAgentCount || trainingTargetCount ? 'review_needed' : 'ready'),
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: [],
      confidence: {
        score,
        rationale: 'Confidence rises when tenant workload, import-learning history, service-plan pressure, and recent agent-audit events are all available together.',
      },
      recommended_actions: actions.slice(0, 6),
      data_used: context.data_used || [],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_agent_workforce_context'],
    context_summary: {
      new_agent_candidates: newAgentCount,
      training_targets: trainingTargetCount,
      billing_candidates: billingCandidates.length,
      multi_location_customers: multiLocationCustomers.length,
      open_balances: openBalances.length,
      import_profiles: numberValue(importLearning.profile_count),
      recent_agent_runs: numberValue(agentAudit.event_count),
    },
  };
}

module.exports = { runAgentWorkforceArchitect };
