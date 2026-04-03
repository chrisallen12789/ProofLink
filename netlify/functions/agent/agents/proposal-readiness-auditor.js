'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getProposalReadinessContext } = require('../tools');

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function hasText(value) {
  return !!String(value || '').trim();
}

function firstText(...values) {
  return values.find((value) => hasText(value)) || '';
}

function statusFromChecks(checks = []) {
  const missingRequired = checks.filter((item) => item.required && !item.ready);
  if (missingRequired.length) return 'blocked';
  return checks.some((item) => !item.ready) ? 'review_needed' : 'ready';
}

async function runProposalReadinessAuditor({ supabase, tenantId, input }) {
  const context = await getProposalReadinessContext(supabase, tenantId, input || {});
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];
  const missingData = [...(context.missing_data || [])];
  const bid = context.bid || null;
  const customer = context.customer || null;
  const bidRef = bid?.id ? buildRecordRef('bid', bid.id, bid.title || 'Proposal') : null;
  const customerRef = customer?.id ? buildRecordRef('customer', customer.id, customer.name || customer.company_name || 'Customer') : null;

  if (!bid?.id) {
    missingData.push({
      id: 'proposal_readiness_missing_bid',
      label: 'No walkthrough bid was provided',
      detail: 'The proposal readiness review needs a saved walkthrough bid before it can inspect signer, terms, and delivery readiness.',
      field: 'bid_id',
      required_for: 'analysis',
    });
    return {
      report: {
        agent_key: 'proposal_readiness_auditor',
        agent_label: 'Proposal Readiness Auditor',
        summary: 'Save the walkthrough bid before running proposal readiness review.',
        summary_status: 'blocked',
        findings: [],
        blockers: [{
          id: 'proposal_readiness_missing_bid',
          title: 'A saved bid record is required first',
          detail: 'The readiness review works from a stored walkthrough bid so it can inspect delivery settings, signer setup, and reusable defaults.',
          evidence_ids: [],
          record_refs: [],
        }],
        evidence: [],
        assumptions: context.assumptions || [],
        missing_data: missingData,
        confidence: {
          score: 0.38,
          rationale: 'Confidence is low until a saved bid record and its proposal defaults are available together.',
        },
        recommended_actions: [{
          id: 'proposal_readiness_save_bid',
          title: 'Save the proposal draft first',
          detail: 'Persist the walkthrough bid so ProofLink can inspect sender, template, validity, and deposit settings against tenant defaults.',
          priority: 'high',
          requires_operator_approval: true,
          suggested_ui_action: 'open_bids',
          evidence_ids: [],
          record_refs: [],
        }],
        data_used: context.data_used || [],
        scope: { tenant_id: tenantId },
        generated_at: new Date().toISOString(),
      },
      tools_used: ['get_proposal_readiness_context'],
      context_summary: {
        bid_id: '',
        ready_checks: 0,
        missing_required_checks: 1,
        missing_optional_checks: 0,
      },
    };
  }

  const checks = [
    { key: 'company_name', label: 'Company name', ready: context.status.company_name, required: true, focus: 'companyName' },
    { key: 'logo', label: 'Logo', ready: context.status.logo, required: false, focus: 'logo' },
    { key: 'default_terms', label: 'Default terms', ready: context.status.default_terms, required: true, focus: 'defaultTerms' },
    { key: 'default_exclusions', label: 'Default exclusions', ready: context.status.default_exclusions, required: true, focus: 'defaultExclusions' },
    { key: 'default_signer', label: 'Default signer', ready: context.status.default_signer, required: true, focus: 'defaultSigner' },
    { key: 'default_signer_signature', label: 'Signer signature image', ready: context.status.default_signer_signature, required: true, focus: 'defaultSignerSignature' },
    { key: 'bid_sender', label: 'Bid sender', ready: context.status.bid_sender, required: true, focus: 'defaultSigner' },
    { key: 'delivery_note', label: 'Delivery note', ready: context.status.delivery_note, required: true, focus: 'bidCoverNote' },
    { key: 'valid_until', label: 'Validity window', ready: context.status.valid_until, required: true, focus: 'bidValidUntil' },
    { key: 'terms_applied', label: 'Terms applied', ready: context.status.terms_applied, required: true, focus: 'defaultTerms' },
    { key: 'exclusions_applied', label: 'Exclusions applied', ready: context.status.exclusions_applied, required: true, focus: 'defaultExclusions' },
  ];

  const readinessEvidenceId = evidence.add({
    record_type: 'bid',
    record_id: bid.id,
    field: 'proposal_readiness',
    label: 'Proposal readiness snapshot',
    value: checks.map((item) => `${item.label}: ${item.ready ? 'ready' : 'missing'}`).join(' | '),
  });

  const readyCount = checks.filter((item) => item.ready).length;
  const missingRequired = checks.filter((item) => item.required && !item.ready);
  const missingOptional = checks.filter((item) => !item.required && !item.ready);

  findings.push({
    id: 'proposal_readiness_snapshot',
    severity: missingRequired.length ? 'warning' : 'info',
    category: 'readiness',
    title: missingRequired.length
      ? 'Proposal delivery still has missing required setup'
      : 'Proposal delivery has the required setup in place',
    detail: missingRequired.length
      ? `${missingRequired.length} required readiness check(s) are still missing across proposal defaults, signer setup, or bid delivery fields.`
      : 'The required proposal defaults, signer setup, and bid delivery fields are present for this walkthrough draft.',
    evidence_ids: [readinessEvidenceId],
    record_refs: [bidRef, customerRef].filter(Boolean),
  });

  if (missingRequired.length) {
    blockers.push({
      id: 'proposal_readiness_missing_required_setup',
      title: 'Proposal send/convert readiness is still blocked',
      detail: `Missing required items: ${missingRequired.map((item) => item.label).join(', ')}.`,
      evidence_ids: [readinessEvidenceId],
      record_refs: [bidRef, customerRef].filter(Boolean),
    });
  }

  if (context.status.deposit_requested && !context.status.valid_until) {
    blockers.push({
      id: 'proposal_readiness_deposit_without_validity',
      title: 'Deposit timing is weak without a validity window',
      detail: 'This proposal requests a deposit, but the validity window is blank, so the payment expectation is not anchored to a visible timeline yet.',
      evidence_ids: [readinessEvidenceId],
      record_refs: [bidRef].filter(Boolean),
    });
  }

  const senderEvidenceValue = [
    context.active_sender?.full_name || context.active_sender?.email || 'No signer profile',
    context.active_sender?.job_title || '',
    context.active_sender?.signature_image_url ? 'signature ready' : 'signature missing',
  ].filter(Boolean).join(' | ');
  const senderEvidenceId = evidence.add({
    record_type: 'bid',
    record_id: bid.id,
    field: 'proposal_sender',
    label: 'Proposal sender readiness',
    value: senderEvidenceValue || 'No sender readiness data was available.',
  });

  findings.push({
    id: 'proposal_readiness_sender_state',
    severity: context.status.default_signer_signature && context.status.bid_sender ? 'info' : 'warning',
    category: 'signer',
    title: context.status.default_signer_signature && context.status.bid_sender
      ? 'Signer profile is attached to the proposal path'
      : 'Signer profile still needs setup before delivery',
    detail: context.status.default_signer_signature && context.status.bid_sender
      ? `The proposal is currently tied to ${firstText(context.active_sender?.full_name, context.active_sender?.email, 'the selected signer')} with a stored signature asset.`
      : 'The proposal defaults or the active bid sender still need enough signer detail for a customer-facing send.',
    evidence_ids: [senderEvidenceId],
    record_refs: [bidRef].filter(Boolean),
  });

  if (!context.status.terms_applied || !context.status.exclusions_applied) {
    findings.push({
      id: 'proposal_readiness_terms_gap',
      severity: 'warning',
      category: 'terms',
      title: 'Proposal legal defaults still need attachment',
      detail: 'Terms or exclusions are not clearly attached through either bid-specific selection or the tenant defaults, so the operator should tighten that before delivery.',
      evidence_ids: [readinessEvidenceId],
      record_refs: [bidRef].filter(Boolean),
    });
  }

  if (context.status.deposit_requested) {
    findings.push({
      id: 'proposal_readiness_deposit_visible',
      severity: 'info',
      category: 'deposit',
      title: 'Deposit expectation is visible on the proposal',
      detail: `This walkthrough bid is carrying a deposit expectation of ${money(context.deposit_amount_cents)} before scheduling or conversion continues.`,
      evidence_ids: [readinessEvidenceId],
      record_refs: [bidRef].filter(Boolean),
    });
  }

  actions.push({
    id: 'proposal_readiness_fix_required_setup',
    title: 'Clear the proposal blockers in defaults and delivery fields',
    detail: missingRequired.length
      ? `Start with ${missingRequired.map((item) => item.label).join(', ')} so the proposal can move toward send or convert without hidden delivery gaps.`
      : 'Keep the proposal defaults and delivery fields aligned before sending or converting this work.',
    priority: missingRequired.length ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'open_bids',
    evidence_ids: [readinessEvidenceId],
    record_refs: [bidRef].filter(Boolean),
  });
  actions.push({
    id: 'proposal_readiness_open_settings',
    title: 'Use Proposal settings to fix reusable defaults',
    detail: 'If branding, signer, terms, or exclusions are missing, fix them once in Proposal settings so the next walkthrough draft inherits the same improvement.',
    priority: missingRequired.some((item) => ['company_name', 'logo', 'default_terms', 'default_exclusions', 'default_signer', 'default_signer_signature'].includes(item.key)) ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'open_proposal_settings',
    evidence_ids: [readinessEvidenceId, senderEvidenceId],
    record_refs: [bidRef].filter(Boolean),
  });

  return {
    report: {
      agent_key: 'proposal_readiness_auditor',
      agent_label: 'Proposal Readiness Auditor',
      summary: missingRequired.length
        ? `This walkthrough bid is not ready to send or convert yet. ${missingRequired.length} required proposal-readiness check(s) are still missing across defaults, signer setup, or delivery fields.`
        : 'This walkthrough bid has the required proposal defaults, signer setup, and delivery fields in place for a manual send or conversion review.',
      summary_status: statusFromChecks(checks),
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: missingData,
      confidence: {
        score: missingRequired.length ? 0.64 : 0.82,
        rationale: 'Confidence depends on whether the saved bid, reusable proposal defaults, signer profile, and delivery fields are all available together.',
      },
      recommended_actions: actions,
      data_used: context.data_used || [],
      scope: {
        bid_id: bid.id,
        customer_id: customer?.id || '',
        tenant_id: tenantId,
      },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_proposal_readiness_context'],
    context_summary: {
      bid_id: bid.id,
      ready_checks: readyCount,
      missing_required_checks: missingRequired.length,
      missing_optional_checks: missingOptional.length,
      deposit_requested: context.status.deposit_requested ? 1 : 0,
    },
  };
}

module.exports = { runProposalReadinessAuditor };
