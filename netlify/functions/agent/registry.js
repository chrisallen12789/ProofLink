'use strict';

const { runBillingBlockerDetector } = require('./agents/billing-blocker-detector');
const { runCollectionsFollowUpAssistant } = require('./agents/collections-follow-up-assistant');
const { runDispatchSchedulingAssistant } = require('./agents/dispatch-scheduling-assistant');
const { runAiSystemsArchitect } = require('./agents/ai-systems-architect');
const { runAgentWorkforceArchitect } = require('./agents/agent-workforce-architect');
const { runAccountingContinuityAuditor } = require('./agents/accounting-continuity-auditor');
const { runEstimatingAssistant } = require('./agents/estimating-assistant');
const { runFieldCloseoutCoach } = require('./agents/field-closeout-coach');
const { runImportMigrationAssistant } = require('./agents/import-migration-assistant');
const { runJobRecordAuditor } = require('./agents/job-record-auditor');
const { runProposalReadinessAuditor } = require('./agents/proposal-readiness-auditor');
const { runQuoteRescueManager } = require('./agents/quote-rescue-manager');
const { runRetentionReactivationManager } = require('./agents/retention-reactivation-manager');
const { runServicePlanRenewalManager } = require('./agents/service-plan-renewal-manager');
const { runSitePacketBuilder } = require('./agents/site-packet-builder');

const AGENTS = {
  field_closeout_coach: {
    key: 'field_closeout_coach',
    label: 'Field Closeout Coach',
    purpose: 'Reviews a live job closeout package so proof, timing, manifests, and field follow-through gaps are caught before the office has to clean them up later.',
    inputs: [{ key: 'job_id', required: true, description: 'The job record to review for closeout readiness.' }],
    allowed_tools: ['get_field_closeout_context'],
    forbidden_behaviors: [
      'Do not complete jobs, upload proof, or change field records automatically.',
      'Do not claim the field package is ready when proof, timing, or compliance gaps are still open.',
      'Do not invent signatures, photos, or field notes.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on whether proof, time, cost, and trade-specific closeout records are all available together.',
    missing_data_handling: 'Call out missing proof, field timing, or closeout notes explicitly before handing the record back to the office.',
    recommended_actions: 'Recommend exact next closeout moves only; execution stays manual.',
    execute: runFieldCloseoutCoach,
  },
  ai_systems_architect: {
    key: 'ai_systems_architect',
    label: 'AI Systems Architect',
    purpose: 'Reviews the shipped AI stack, freeform copilot lanes, model-driven surfaces, and tenant pressure to recommend the next internal AI upgrades with the highest leverage.',
    inputs: [],
    allowed_tools: ['get_agent_workforce_context'],
    forbidden_behaviors: [
      'Do not create, modify, or delete prompts, models, or agents automatically.',
      'Do not recommend a new AI lane without tying it to either the shipped AI surface map or live tenant workload pressure.',
      'Do not treat AI file hardening ideas as complete before the shared config or surface gap is actually closed.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on whether tenant workload, recent AI usage, and the shipped AI surface inventory are all available together.',
    missing_data_handling: 'Call out missing workload or AI-usage signals explicitly before recommending platform AI changes.',
    recommended_actions: 'Recommend the next internal AI architecture, exposure, or file-hardening moves only; execution stays manual.',
    admin_only: true,
    execute: runAiSystemsArchitect,
  },
  agent_workforce_architect: {
    key: 'agent_workforce_architect',
    label: 'AI Workforce Architect',
    purpose: 'Reviews live tenant workload, import-learning history, and agent usage to identify missing specialist agents and the existing lanes that need sharper training.',
    inputs: [],
    allowed_tools: ['get_agent_workforce_context'],
    forbidden_behaviors: [
      'Do not create, modify, or delete agents automatically.',
      'Do not claim a new agent is needed without pointing to actual workload or learned-data pressure.',
      'Do not treat training ideas as facts when the supporting tenant signals are missing.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on whether workload, import-learning, service-plan, and recent agent-audit signals are all available together.',
    missing_data_handling: 'Call out unavailable workload or audit signals explicitly before recommending a new specialist lane.',
    recommended_actions: 'Recommend inspectable next agent additions or training targets only; execution stays manual.',
    admin_only: true,
    execute: runAgentWorkforceArchitect,
  },
  job_record_auditor: {
    key: 'job_record_auditor',
    label: 'Job Record Auditor',
    purpose: 'Reviews a single job record, its linked order, proof, timestamps, costs, invoices, and payment state to produce a billing-readiness report.',
    inputs: [{ key: 'job_id', required: true, description: 'The job record to audit.' }],
    allowed_tools: ['get_job_record_audit_context'],
    forbidden_behaviors: [
      'Do not change job, order, invoice, payment, or proof records.',
      'Do not claim billing readiness when required proof or billing links are missing.',
      'Do not fabricate signatures, photos, notes, prices, or payment events.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence rises when job, order, proof, billing, and cost data are all present.',
    missing_data_handling: 'List any missing fields or unavailable tables explicitly in missing_data or assumptions.',
    recommended_actions: 'Recommend exact next operator actions with evidence references.',
    execute: runJobRecordAuditor,
  },
  site_packet_builder: {
    key: 'site_packet_builder',
    label: 'Site Packet Builder',
    purpose: 'Builds a grounded site packet for a job from the linked customer, site, recent work history, and proof so crews arrive with better context.',
    inputs: [{ key: 'job_id', required: true, description: 'The job record to build a site packet around.' }],
    allowed_tools: ['get_site_packet_context'],
    forbidden_behaviors: [
      'Do not invent access notes, contact details, or prior work history.',
      'Do not claim a site packet is complete when address, access, or contact context is still missing.',
      'Do not dispatch or reassign work automatically.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on whether the job, customer, site, history, and proof records can all be grounded from the tenant data.',
    missing_data_handling: 'Call out missing site address, access notes, or contact path explicitly.',
    recommended_actions: 'Recommend site-packet and crew-prep moves only; execution stays manual.',
    execute: runSitePacketBuilder,
  },
  estimating_assistant: {
    key: 'estimating_assistant',
    label: 'Estimating Assistant',
    purpose: 'Builds a grounded estimate review from known service facts, stored pricing, and missing inputs without inventing price points.',
    inputs: [
      { key: 'bid_id', required: false, description: 'Optional walkthrough bid to review.' },
      { key: 'lead_id', required: false, description: 'Optional lead to review.' },
      { key: 'order_id', required: false, description: 'Optional order to review.' },
      { key: 'job_id', required: false, description: 'Optional job to review.' },
    ],
    allowed_tools: ['get_estimate_record_context'],
    forbidden_behaviors: [
      'Do not invent pricing, quantities, or scope.',
      'Do not mark assumptions as confirmed facts.',
      'Do not send or save customer-facing estimates.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on how complete the scope, site details, and known pricing inputs are.',
    missing_data_handling: 'Highlight which inputs are still missing before pricing should be reviewed.',
    recommended_actions: 'Recommend evidence-backed estimate next steps only.',
    execute: runEstimatingAssistant,
  },
  proposal_readiness_auditor: {
    key: 'proposal_readiness_auditor',
    label: 'Proposal Readiness Auditor',
    purpose: 'Reviews proposal defaults, signer readiness, validity timing, terms coverage, and deposit setup before a walkthrough bid is sent or converted.',
    inputs: [
      { key: 'bid_id', required: true, description: 'The walkthrough bid or proposal draft to review.' },
    ],
    allowed_tools: ['get_proposal_readiness_context'],
    forbidden_behaviors: [
      'Do not send, approve, or convert proposals automatically.',
      'Do not claim proposal delivery is ready when signer, terms, exclusions, or validity fields are still missing.',
      'Do not invent branding defaults, signature assets, or customer-facing terms.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on whether the bid record, tenant proposal defaults, signer profile, and reusable template coverage are all available together.',
    missing_data_handling: 'Call out missing branding defaults, signer details, delivery text, and validity timing explicitly before a proposal is sent.',
    recommended_actions: 'Recommend proposal-readiness fixes only; execution stays manual.',
    execute: runProposalReadinessAuditor,
  },
  quote_rescue_manager: {
    key: 'quote_rescue_manager',
    label: 'Quote Rescue Manager',
    purpose: 'Builds a grounded rescue queue for aging quotes and walkthrough proposals so operators can separate follow-up-ready work from estimate cleanup and stale records that should be reworked first.',
    inputs: [],
    allowed_tools: ['get_quote_rescue_manager_context'],
    forbidden_behaviors: [
      'Do not send follow-up messages automatically.',
      'Do not mark a quote as current when scope, pricing, or validity proof is weak.',
      'Do not convert a proposal into booked work without operator action.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on live quote and proposal state, validity timing, and stored pricing facts being present together.',
    missing_data_handling: 'Call out missing estimate facts before suggesting customer follow-up.',
    recommended_actions: 'Recommend queue-based proposal rescue moves only; execution stays manual.',
    execute: runQuoteRescueManager,
  },
  service_plan_renewal_manager: {
    key: 'service_plan_renewal_manager',
    label: 'Service Plan Renewal Manager',
    purpose: 'Builds a grounded renewal queue for recurring service plans so next-run timing, missing cadence, and overdue repeat-service accounts stay visible before they drift.',
    inputs: [{ key: 'plan_id', required: false, description: 'Optional recurring plan to focus the review on.' }],
    allowed_tools: ['get_service_plan_renewal_context'],
    forbidden_behaviors: [
      'Do not generate recurring orders or change plan dates automatically.',
      'Do not hide missing next-run timing behind generic retention advice.',
      'Do not blend collections urgency into renewal state unless the linked records show both.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on whether plan cadence, next-run timing, linked customers, and recent generated work are all available together.',
    missing_data_handling: 'Call out missing cadence or next-run timing explicitly before recommending renewal moves.',
    recommended_actions: 'Recommend repeat-work review moves only; execution stays manual.',
    execute: runServicePlanRenewalManager,
  },
  retention_reactivation_manager: {
    key: 'retention_reactivation_manager',
    label: 'Retention / Reactivation Manager',
    purpose: 'Builds a grounded reactivation queue for quiet customers so repeat-service signals, plan overlap, and open-work holds stay inspectable before outreach starts.',
    inputs: [{ key: 'customer_id', required: false, description: 'Optional customer to focus the reactivation review on.' }],
    allowed_tools: ['get_retention_reactivation_context'],
    forbidden_behaviors: [
      'Do not send outreach automatically.',
      'Do not claim a customer is dormant when active work is still open.',
      'Do not collapse renewal recovery and general reactivation into one unsupported guess.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on stale-customer timing, recurring-service signals, and recent work history being available together.',
    missing_data_handling: 'Call out missing repeat-service or recent-work signals before ranking reactivation priority.',
    recommended_actions: 'Recommend evidence-backed reactivation moves only; execution stays manual.',
    execute: runRetentionReactivationManager,
  },
  dispatch_scheduling_assistant: {
    key: 'dispatch_scheduling_assistant',
    label: 'Dispatch / Scheduling Assistant',
    purpose: 'Reviews upcoming jobs and schedule context to recommend safer, clearer dispatch moves without executing them.',
    inputs: [
      { key: 'days', required: false, description: 'Optional forward-looking horizon in days.' },
      { key: 'target_date', required: false, description: 'Optional YYYY-MM-DD focus date for day-specific dispatch review.' },
      { key: 'job_type', required: false, description: 'Optional job type filter such as hydrovac.' },
    ],
    allowed_tools: ['get_dispatch_scheduling_context'],
    forbidden_behaviors: [
      'Do not change assignments, dates, or route order automatically.',
      'Do not pretend route geometry or traffic detail exists when it does not.',
      'Do not mark conflicts as resolved without operator action.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on schedule dates, assignments, and route detail being present on the jobs.',
    missing_data_handling: 'Call out any missing schedule or assignment data before making stronger recommendations.',
    recommended_actions: 'Recommend review moves only; execution stays with the operator.',
    execute: runDispatchSchedulingAssistant,
  },
  billing_blocker_detector: {
    key: 'billing_blocker_detector',
    label: 'Billing Blocker Detector',
    purpose: 'Finds jobs that should be invoice-ready but are still blocked by missing proof, missing invoice state, or conflicting money records.',
    inputs: [{ key: 'limit', required: false, description: 'Optional max number of candidate jobs to inspect.' }],
    allowed_tools: ['get_billing_blocker_queue_context', 'get_job_record_audit_context'],
    forbidden_behaviors: [
      'Do not send invoices or collections messages.',
      'Do not change payment state or mark work as ready without proof.',
      'Do not hide blockers just because money is urgent.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence rises when candidate jobs can be re-audited directly from their linked work and billing records.',
    missing_data_handling: 'Surface queue uncertainty clearly when the linked records are incomplete.',
    recommended_actions: 'Recommend a prioritized blocker-clearing sequence.',
    execute: runBillingBlockerDetector,
  },
  collections_followup_assistant: {
    key: 'collections_followup_assistant',
    label: 'Collections / Follow-up Assistant',
    purpose: 'Builds a grounded follow-up queue from actual balances, due dates, invoices, and payment history without overstating what is overdue.',
    inputs: [],
    allowed_tools: ['get_collections_followup_context'],
    forbidden_behaviors: [
      'Do not fabricate overdue claims.',
      'Do not claim work was completed unless the record says so.',
      'Do not send messages or alter balances.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on due dates, invoice records, and current payment state being present.',
    missing_data_handling: 'Label open balances separately from truly overdue balances when date proof is missing.',
    recommended_actions: 'Recommend safe follow-up actions grounded in actual status.',
    execute: runCollectionsFollowUpAssistant,
  },
  import_migration_assistant: {
    key: 'import_migration_assistant',
    label: 'Import Migration Assistant',
    purpose: 'Reviews legacy CSV headers and sample rows, explains what ProofLink can route safely, and suggests a reusable import profile without writing records.',
    inputs: [
      { key: 'headers', required: true, description: 'Normalized or raw CSV headers from the current import file.' },
      { key: 'sample_rows', required: false, description: 'Optional sample rows from the current import preview.' },
      { key: 'import_kind', required: false, description: 'Optional requested import lane such as customers, open_work, or payments.' },
      { key: 'file_name', required: false, description: 'Optional source filename for the profile suggestion.' },
      { key: 'active_profile', required: false, description: 'Optional saved import profile currently applied to the file.' },
    ],
    allowed_tools: ['analyze_import_migration_context'],
    forbidden_behaviors: [
      'Do not write customers, orders, jobs, payments, or import profiles automatically.',
      'Do not claim a column is mapped when the header evidence is missing.',
      'Do not treat a guessed route as a confirmed record outcome.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on header coverage, row cleanliness, and whether the current file already matches a saved import profile.',
    missing_data_handling: 'Call out missing identity, amount, or schedule fields before recommending import approval.',
    recommended_actions: 'Recommend safe import review and profile-saving moves only.',
    execute: runImportMigrationAssistant,
  },
  accounting_continuity_auditor: {
    key: 'accounting_continuity_auditor',
    label: 'Accounting Continuity Auditor',
    purpose: 'Reviews the order, linked job, invoices, payments, and import-learning signals to keep outside-accounting references traceable across ProofLink work.',
    inputs: [
      { key: 'order_id', required: false, description: 'Optional booked-work record to review.' },
      { key: 'job_id', required: false, description: 'Optional job record to review when continuity should be checked from field work.' },
    ],
    allowed_tools: ['get_accounting_continuity_context'],
    forbidden_behaviors: [
      'Do not fabricate invoice numbers, doc numbers, or external accounting status.',
      'Do not write to QuickBooks or any outside accounting system.',
      'Do not claim continuity is healthy when the records disagree or the reference is missing.',
    ],
    output_schema: 'prooflink.agent.report.v1',
    confidence_signal: 'Confidence depends on whether the order, job, invoice, payment, and import-learning records agree on the same continuity reference.',
    missing_data_handling: 'Call out missing or conflicting external references explicitly before recommending follow-through.',
    recommended_actions: 'Recommend inspectable continuity fixes only; execution stays manual.',
    execute: runAccountingContinuityAuditor,
  },
};

function getAgentDefinition(key) {
  const normalizedKey = String(key || '').trim().toLowerCase();
  return AGENTS[normalizedKey] || null;
}

function listAgentDefinitions() {
  return Object.values(AGENTS);
}

function publicAgentDefinition(definition) {
  if (!definition) return null;
  return {
    key: definition.key,
    label: definition.label,
    purpose: definition.purpose,
    inputs: definition.inputs,
    admin_only: definition.admin_only === true,
    allowed_tools: definition.allowed_tools,
    forbidden_behaviors: definition.forbidden_behaviors,
    output_schema: definition.output_schema,
    confidence_signal: definition.confidence_signal,
    missing_data_handling: definition.missing_data_handling,
    recommended_actions: definition.recommended_actions,
  };
}

module.exports = {
  getAgentDefinition,
  listAgentDefinitions,
  publicAgentDefinition,
};
