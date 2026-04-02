'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getEstimateRecordContext } = require('../tools');

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

async function runEstimatingAssistant({ supabase, tenantId, input }) {
  const context = await getEstimateRecordContext(supabase, tenantId, input || {});
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const recommendedActions = [];
  const missingData = [...(context.missing_data || [])];
  const assumptions = [...(context.assumptions || [])];

  const primary = context.primary_record || {};
  const primaryType = context.primary_record_type || 'record';
  const primaryRef = primary?.id ? buildRecordRef(primaryType, primary.id, primary.title || primary.contact_name || 'Estimate record') : null;
  const scopeSummary = [
    primary.project_summary,
    primary.scope_of_work,
    primary.summary,
    primary.description,
    primary.notes,
    primary.internal_notes,
  ].filter((value) => String(value || '').trim()).join(' | ');
  const scopeAddress = primary.service_address || primary.address || '';

  const factsEvidence = evidence.add({
    record_type: primaryType,
    record_id: primary.id,
    field: 'scope',
    label: 'Known scope facts',
    value: [
      primary.title || primary.requested_service || primary.summary || '',
      scopeAddress,
      scopeSummary,
    ].filter(Boolean).join(' | ') || 'No scope facts were found on the current record.',
  });

  if (primaryRef) {
    findings.push({
      id: 'estimate_known_scope',
      severity: 'info',
      category: 'facts',
      title: 'Known estimate facts were pulled from the current record',
      detail: 'The estimate assistant is using the current service title, address, notes, and linked customer context only. Anything not present in these records remains unknown.',
      evidence_ids: [factsEvidence],
      record_refs: [primaryRef],
    });
  }

  const pricedTotal = Number(context.known_price_total_cents || 0);
  if (pricedTotal > 0) {
    const pricingEvidence = evidence.add({
      record_type: primaryType,
      record_id: primary.id,
      field: 'known_price_total_cents',
      label: 'Known priced work',
      value: `Stored priced work totals ${money(pricedTotal)} on the current record.`,
    });
    findings.push({
      id: 'estimate_known_pricing_present',
      severity: 'info',
      category: 'pricing',
      title: 'Stored pricing already exists on this record',
      detail: 'Known prices already exist in the linked record. The assistant will not invent new pricing and should be used to highlight scope gaps, assumptions, or items that still need review.',
      evidence_ids: [pricingEvidence],
      record_refs: [primaryRef].filter(Boolean),
    });
  }

  if (!String(scopeSummary).trim()) {
    blockers.push({
      id: 'estimate_missing_scope_summary',
      title: 'Scope summary is missing',
      detail: 'The current record does not clearly describe what should be estimated yet.',
      evidence_ids: [factsEvidence],
      record_refs: [primaryRef].filter(Boolean),
    });
    recommendedActions.push({
      id: 'add_scope_summary',
      title: 'Capture the scope before drafting pricing',
      detail: 'Add a concise description of what the customer needs, what is included, and what still needs to be verified on site.',
      priority: 'high',
      requires_operator_approval: true,
      suggested_ui_action: 'open_record',
      evidence_ids: [factsEvidence],
      record_refs: [primaryRef].filter(Boolean),
    });
  }

  if (!String(primary.service_address || primary.address || '').trim()) {
    missingData.push({
      id: 'estimate_missing_service_address',
      label: 'Service address is missing',
      detail: 'The estimate record does not include the actual worksite address.',
      field: 'service_address',
      required_for: 'estimate_accuracy',
    });
  }

  if (!context.customer?.id) {
    missingData.push({
      id: 'estimate_missing_customer',
      label: 'Customer record is missing',
      detail: 'There is no linked customer record for the estimate context.',
      field: 'customer_id',
      required_for: 'estimate_followthrough',
    });
  }

  if (!context.has_measurements) {
    missingData.push({
      id: 'estimate_missing_measurements',
      label: 'Measurements or quantity inputs are missing',
      detail: 'No measured quantities, equipment counts, or unit totals were found in the current estimate context.',
      field: 'quantities',
      required_for: 'pricing_review',
    });
    blockers.push({
      id: 'estimate_missing_measurements',
      title: 'Measured scope is still missing',
      detail: 'This estimate needs actual quantities, dimensions, unit counts, or another measurable scope input before pricing should be treated as reliable.',
      evidence_ids: [factsEvidence],
      record_refs: [primaryRef].filter(Boolean),
    });
  }

  recommendedActions.push({
    id: 'review_actual_price_sources',
    title: 'Use actual stored prices or bid profiles only',
    detail: 'Review the catalog, bid templates, or prior approved work before setting pricing. This assistant does not invent price points.',
    priority: 'high',
    requires_operator_approval: true,
    suggested_ui_action: 'open_pricing',
    evidence_ids: [],
    record_refs: [primaryRef].filter(Boolean),
  });

  if (context.prior_similar_records?.length) {
    const priorEvidence = evidence.add({
      record_type: 'customer',
      record_id: context.customer?.id || '',
      field: 'prior_similar_records',
      label: 'Prior related work',
      value: `${context.prior_similar_records.length} prior related job(s) or order(s) were found for this customer.`,
    });
    findings.push({
      id: 'estimate_prior_history_available',
      severity: 'info',
      category: 'history',
      title: 'Prior related work is available for review',
      detail: 'Similar work already exists in the customer history, which can help the operator compare scope and make a grounded pricing decision.',
      evidence_ids: [priorEvidence],
      record_refs: [primaryRef].filter(Boolean),
    });
  }

  const summary = blockers.length
    ? 'The estimate draft is not ready to price yet. The assistant found missing scope inputs that should be filled before pricing is reviewed.'
    : 'The estimate context is usable for a draft review. Known facts were separated from missing inputs, and no pricing was invented.';

  return {
    report: {
      agent_key: 'estimating_assistant',
      agent_label: 'Estimating Assistant',
      summary,
      summary_status: blockers.length ? 'blocked' : (missingData.length ? 'review_needed' : 'ready'),
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions,
      missing_data: missingData,
      confidence: {
        score: blockers.length ? 0.48 : 0.68,
        rationale: 'Confidence depends on whether the record includes a clear scope, site details, measurable inputs, and prior approved work to compare against.',
      },
      recommended_actions: recommendedActions,
      data_used: context.data_used || [],
      scope: {
        job_id: context.job?.id || '',
        order_id: context.order?.id || '',
        customer_id: context.customer?.id || '',
        tenant_id: tenantId,
      },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_estimate_record_context'],
    context_summary: {
      primary_record_type: primaryType,
      primary_record_id: primary.id || '',
      bid_id: context.bid?.id || '',
      prior_similar_records: (context.prior_similar_records || []).length,
    },
  };
}

module.exports = { runEstimatingAssistant };
