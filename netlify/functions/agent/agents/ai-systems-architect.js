'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getAgentWorkforceContext } = require('../tools');
const {
  AI_GOVERNANCE_SIGNALS,
  listCopilotSpecialistLanes,
  listModelDrivenAiSurfaces,
  listStructuredAgentSurfaces,
} = require('../system-map');

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function countModeUsage(agentAudit = {}, modes = []) {
  const usage = agentAudit?.usage_by_mode || {};
  return modes.reduce((sum, mode) => sum + numberValue(usage[mode]), 0);
}

function workspaceRef(tab, label = '') {
  return buildRecordRef('workspace', String(tab || '').trim(), label || `${String(tab || '').trim()} workspace`);
}

function aiSurfaceRef(key, label = '') {
  return buildRecordRef('ai_surface', String(key || '').trim(), label || String(key || '').trim());
}

function aiAgentRef(key, label = '') {
  return buildRecordRef('agent', String(key || '').trim(), label || String(key || '').trim());
}

function confidenceScore(context = {}) {
  const signals = [
    context?.tenant?.business_name ? 1 : 0,
    context?.context_summary?.billing_candidates ? 1 : 0,
    context?.context_summary?.open_balances ? 1 : 0,
    context?.context_summary?.active_service_plans ? 1 : 0,
    context?.context_summary?.recent_agent_runs >= 0 ? 1 : 0,
    listStructuredAgentSurfaces().length ? 1 : 0,
    listModelDrivenAiSurfaces().length >= 2 ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const penalties = Math.min(0.16, numberValue(context?.assumptions?.length) * 0.03);
  return Math.max(0.56, Math.min(0.94, 0.61 + (signals * 0.04) - penalties));
}

async function runAiSystemsArchitect({ supabase, tenantId }) {
  const context = await getAgentWorkforceContext(supabase, tenantId);
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];

  const businessContext = context?.business_context || {};
  const compensationSummary = context?.compensation_summary || {};
  const servicePlanSummary = context?.service_plan_summary || {};
  const agentAudit = context?.agent_audit || {};
  const structuredSurfaces = listStructuredAgentSurfaces();
  const copilotLanes = listCopilotSpecialistLanes();
  const modelSurfaces = listModelDrivenAiSurfaces();
  const operatorSurfaces = structuredSurfaces.filter((item) => item.surface_scope === 'operator');
  const operatorExposedSurfaces = operatorSurfaces.filter((item) => item.exposed);
  const operatorUnexposedSurfaces = operatorSurfaces.filter((item) => !item.exposed);
  const freeformOnlyLanes = copilotLanes.filter((lane) => lane.coverage === 'freeform_only');

  const pendingQuotes = Array.isArray(businessContext.pending_quotes) ? businessContext.pending_quotes : [];
  const expiredQuotes = Array.isArray(businessContext.expired_quotes) ? businessContext.expired_quotes : [];
  const staleCustomers = Array.isArray(businessContext.stale_customers) ? businessContext.stale_customers : [];
  const multiLocationCustomers = Array.isArray(businessContext.multi_location_customers)
    ? businessContext.multi_location_customers
    : [];
  const atRiskPlans = numberValue(servicePlanSummary.at_risk_count);
  const activePlans = numberValue(servicePlanSummary.active_count);
  const quotePressure = pendingQuotes.length + expiredQuotes.length;
  const retentionPressure = staleCustomers.length + atRiskPlans;
  const compensationPressure = numberValue(compensationSummary.active_assignment_count)
    + numberValue(compensationSummary.active_override_count)
    + numberValue(compensationSummary.members_on_contract_floor_count);
  const recentAiRuns = numberValue(agentAudit.event_count);
  const quoteRescueUsage = countModeUsage(agentAudit, ['copilot:quote_rescue']);
  const systemEvidenceId = evidence.add({
    record_type: 'tenant',
    record_id: tenantId,
    field: 'ai_system_inventory',
    label: 'AI systems inventory snapshot',
    value: [
      `${structuredSurfaces.length} structured agent(s)`,
      `${operatorExposedSurfaces.length} operator-exposed lane(s)`,
      `${operatorUnexposedSurfaces.length} shipped lane(s) still hidden`,
      `${freeformOnlyLanes.length} freeform-only copilot lane(s)`,
      `${compensationPressure} compensation pressure signal(s)`,
      `${modelSurfaces.length} model-driven AI surface(s)`,
    ].join(' | '),
  });

  const addFinding = (item) => findings.push(item);
  const addAction = (item) => actions.push(item);

  if (compensationPressure > 0) {
    const compensationEvidenceId = evidence.add({
      record_type: 'tenant',
      record_id: tenantId,
      field: 'compensation_surface_gap',
      label: 'Compensation workflow without structured AI coverage',
      value: [
        `${numberValue(compensationSummary.contract_count)} contract(s)`,
        `${numberValue(compensationSummary.active_assignment_count)} active assignment(s)`,
        `${numberValue(compensationSummary.active_override_count)} active override(s)`,
        `${numberValue(compensationSummary.members_using_fallback_count)} fallback-only member(s)`,
      ].join(' | '),
    });
    addFinding({
      id: 'systems_gap_compensation_readiness_auditor',
      severity: numberValue(compensationSummary.members_using_fallback_count) >= 2 ? 'warning' : 'info',
      category: 'agent_gap',
      title: 'Add a structured compensation readiness lane',
      detail: 'ProofLink now has live compensation and labor-contract workflows in Team, but the AI surface map still has no structured lane that can review fallback-only crew records, missing classification setup, contract-floor pressure, and above-scale overrides before payroll-prep or labor-costing work expands.',
      evidence_ids: [systemEvidenceId, compensationEvidenceId],
      record_refs: [
        workspaceRef('team', 'Team workspace'),
        workspaceRef('jobs', 'Jobs workspace'),
      ],
    });
    addAction({
      id: 'systems_action_add_compensation_readiness_lane',
      title: 'Promote Team compensation review into a structured agent lane',
      detail: 'Design the next structured lane around contract coverage, assignment readiness, override review, and floor-versus-configured pay so operators can inspect labor setup without reading raw compensation records one by one.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_team',
      evidence_ids: [compensationEvidenceId],
      record_refs: [workspaceRef('team', 'Team workspace')],
    });
  }

  const estimatingSurface = operatorUnexposedSurfaces.find((item) => item.key === 'estimating_assistant') || null;
  if (estimatingSurface && quotePressure >= 2) {
    const quoteEvidenceId = evidence.add({
      record_type: 'tenant',
      record_id: tenantId,
      field: 'quote_pressure',
      label: 'Quote and estimate pressure',
      value: `${pendingQuotes.length} pending quote(s) and ${expiredQuotes.length} expired quote(s) still need structured estimate review support.`,
    });
    addFinding({
      id: 'systems_expose_estimating_assistant',
      severity: quotePressure >= 4 ? 'warning' : 'info',
      category: 'agent_exposure',
      title: 'Expose the Estimating Assistant as a first-class workflow',
      detail: 'ProofLink already ships an Estimating Assistant, but it still has no dedicated workspace entry. Quotes are active enough that this lane should move out of hidden infrastructure and into an operator review flow.',
      evidence_ids: [systemEvidenceId, quoteEvidenceId],
      record_refs: [
        aiAgentRef('estimating_assistant', 'Estimating Assistant'),
        workspaceRef('quotes', 'Quotes workspace'),
        workspaceRef('orders', 'Orders workspace'),
      ],
    });
    addAction({
      id: 'systems_action_expose_estimating_assistant',
      title: 'Give estimate review its own visible operator entry point',
      detail: 'Add the Estimating Assistant to the quote or order workflow so estimate facts, missing inputs, and pricing uncertainty become inspectable before a quote stalls.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_quotes',
      evidence_ids: [quoteEvidenceId],
      record_refs: [workspaceRef('quotes', 'Quotes workspace')],
    });
  }

  const quoteRescueLane = freeformOnlyLanes.find((lane) => lane.key === 'quote_rescue') || null;
  if (quoteRescueLane && (quotePressure >= 3 || quoteRescueUsage > 0)) {
    const quoteLaneEvidenceId = evidence.add({
      record_type: 'ai_surface',
      record_id: 'ai_copilot_quote_rescue',
      field: 'freeform_only_lane',
      label: 'Quote rescue is still freeform only',
      value: `Quote rescue is available in AI Copilot, but there is no structured report lane while ${quotePressure} quote(s) are still pending or expired.`,
    });
    addFinding({
      id: 'systems_gap_quote_rescue_manager',
      severity: quotePressure >= 5 || quoteRescueUsage > 0 ? 'warning' : 'info',
      category: 'agent_gap',
      title: 'Add a structured Quote Rescue Manager',
      detail: 'Quote rescue currently lives only in the freeform copilot lane. The next step is a structured agent that separates stale quotes, missing scope detail, and follow-up timing so operators get an inspectable rescue queue instead of only conversational advice.',
      evidence_ids: [systemEvidenceId, quoteLaneEvidenceId],
      record_refs: [
        aiSurfaceRef('ai_copilot', 'AI Copilot'),
        workspaceRef('quotes', 'Quotes workspace'),
      ],
    });
    addAction({
      id: 'systems_action_add_quote_rescue_manager',
      title: 'Promote quote rescue into a structured report lane',
      detail: 'Use the quote backlog to design a report that can rank rescue candidates, flag missing estimate facts, and keep follow-up timing grounded in real quote state.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_quotes',
      evidence_ids: [quoteLaneEvidenceId],
      record_refs: [workspaceRef('quotes', 'Quotes workspace')],
    });
  }

  const retentionLane = freeformOnlyLanes.find((lane) => lane.key === 'retention') || null;
  if (retentionLane && (retentionPressure >= 6 || atRiskPlans >= 2)) {
    const retentionEvidenceId = evidence.add({
      record_type: 'tenant',
      record_id: tenantId,
      field: 'retention_pressure',
      label: 'Retention and renewal pressure',
      value: `${staleCustomers.length} stale customer(s), ${activePlans} active plan(s), ${atRiskPlans} at-risk plan(s).`,
    });
    addFinding({
      id: 'systems_gap_retention_reactivation_manager',
      severity: atRiskPlans >= 3 || staleCustomers.length >= 8 ? 'warning' : 'info',
      category: 'agent_gap',
      title: 'Add a structured Retention / Reactivation Manager',
      detail: 'Retention guidance currently depends on a freeform copilot specialist. The system is ready for a structured lane that can rank dormant customers, renewal-risk plans, and reactivation timing with evidence instead of leaving those calls inside general conversation.',
      evidence_ids: [systemEvidenceId, retentionEvidenceId],
      record_refs: [
        aiSurfaceRef('ai_copilot', 'AI Copilot'),
        workspaceRef('customers', 'Customers workspace'),
        workspaceRef('plans', 'Plans workspace'),
      ],
    });
    addAction({
      id: 'systems_action_add_retention_manager',
      title: 'Promote retention into a structured renewal queue',
      detail: 'Design the next lane around stale-customer reactivation, at-risk service plans, and the exact customer records that should come back onto the calendar first.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_customers',
      evidence_ids: [retentionEvidenceId],
      record_refs: [workspaceRef('customers', 'Customers workspace')],
    });
  }

  if (!AI_GOVERNANCE_SIGNALS.shared_model_config && modelSurfaces.length >= 2) {
    const modelEvidenceId = evidence.add({
      record_type: 'ai_surface',
      record_id: 'model_config',
      field: 'shared_model_policy',
      label: 'Model configuration still lives in multiple places',
      value: `${modelSurfaces.length} model-driven surfaces are active, but model selection is not yet centralized behind one shared AI config module.`,
    });
    addFinding({
      id: 'systems_harden_shared_model_config',
      severity: 'warning',
      category: 'ai_file_hardening',
      title: 'Centralize model policy across AI Brief and AI Copilot',
      detail: 'ProofLink now has multiple model-driven AI surfaces. A shared model-config layer would make upgrades, safety defaults, and rollout decisions consistent across the other AI files instead of leaving those choices split between endpoints.',
      evidence_ids: [systemEvidenceId, modelEvidenceId],
      record_refs: [
        aiSurfaceRef('ai_brief', 'AI Brief'),
        aiSurfaceRef('ai_copilot', 'AI Copilot'),
      ],
    });
    addAction({
      id: 'systems_action_shared_model_config',
      title: 'Pull model choice and AI defaults into one shared module',
      detail: 'Move shared model selection, default token limits, and future safety toggles into a single helper so every model-driven surface upgrades through the same lane.',
      priority: 'medium',
      requires_operator_approval: true,
      suggested_ui_action: 'open_dashboard',
      evidence_ids: [modelEvidenceId],
      record_refs: [
        aiSurfaceRef('ai_brief', 'AI Brief'),
        aiSurfaceRef('ai_copilot', 'AI Copilot'),
      ],
    });
  }

  if (recentAiRuns < 3) {
    blockers.push({
      id: 'systems_blocker_low_ai_telemetry',
      title: 'The internal AI layer still needs more live usage signal',
      detail: 'The system can recommend the next lanes, but low recent AI usage means the strongest product decisions should still follow actual operator runs rather than pure architecture theory.',
      evidence_ids: [systemEvidenceId],
      record_refs: [
        workspaceRef('ai-control', 'Admin AI control'),
        workspaceRef('dashboard', 'Command center'),
      ],
    });
    addAction({
      id: 'systems_action_raise_ai_telemetry',
      title: 'Keep collecting live AI usage before the next expansion wave',
      detail: 'Use the shipped review lanes and internal admin reviews enough to show which recommendations are recurring product pressure versus one-off architecture ideas.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_dashboard',
      evidence_ids: [systemEvidenceId],
      record_refs: [workspaceRef('dashboard', 'Command center')],
    });
  }

  if (!findings.length) {
    addFinding({
      id: 'systems_healthy_coverage',
      severity: 'info',
      category: 'agent_gap',
      title: 'The current AI surface map is covering the strongest visible opportunities',
      detail: 'No higher-leverage AI systems change stands out right now beyond continuing to exercise the shipped lanes and tightening the existing prompt and model surfaces with real usage.',
      evidence_ids: [systemEvidenceId],
      record_refs: [workspaceRef('ai-control', 'Admin AI control')],
    });
  }

  const exposureGapCount = findings.filter((item) => item.category === 'agent_exposure').length;
  const newLaneCount = findings.filter((item) => item.category === 'agent_gap' && item.id !== 'systems_healthy_coverage').length;
  const aiFileTargetCount = findings.filter((item) => item.category === 'ai_file_hardening').length;
  const score = confidenceScore(context);

  return {
    report: {
      agent_key: 'ai_systems_architect',
      agent_label: 'AI Systems Architect',
      summary: (exposureGapCount || newLaneCount || aiFileTargetCount)
        ? `ProofLink should expose ${exposureGapCount} shipped AI lane${exposureGapCount === 1 ? '' : 's'}, add ${newLaneCount} new structured lane${newLaneCount === 1 ? '' : 's'}, and harden ${aiFileTargetCount} shared AI file area${aiFileTargetCount === 1 ? '' : 's'} based on the current tenant pressure and internal AI surface map.`
        : 'The current AI surface map covers the strongest visible product and architecture opportunities right now.',
      summary_status: blockers.length ? 'blocked' : (exposureGapCount || newLaneCount || aiFileTargetCount ? 'review_needed' : 'ready'),
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: [],
      confidence: {
        score,
        rationale: 'Confidence rises when tenant workload, recent AI usage, and the shipped AI surface inventory are all available together.',
      },
      recommended_actions: actions.slice(0, 6),
      data_used: [
        ...(context.data_used || []),
        { label: 'Structured AI surface map', count: structuredSurfaces.length, detail: 'agent/system-map.js' },
        { label: 'Copilot specialist lanes', count: copilotLanes.length, detail: 'agent/system-map.js' },
        { label: 'Model-driven AI surfaces', count: modelSurfaces.length, detail: 'agent/system-map.js' },
      ],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_agent_workforce_context'],
    context_summary: {
      exposure_gaps: exposureGapCount,
      new_lane_candidates: newLaneCount,
      ai_file_targets: aiFileTargetCount,
      operator_exposed_agents: operatorExposedSurfaces.length,
      hidden_operator_agents: operatorUnexposedSurfaces.length,
      freeform_only_lanes: freeformOnlyLanes.length,
      recent_ai_runs: recentAiRuns,
      compensation_pressure: compensationPressure,
      multi_location_customers: multiLocationCustomers.length,
      quote_pressure: quotePressure,
      retention_pressure: retentionPressure,
    },
  };
}

module.exports = { runAiSystemsArchitect };
