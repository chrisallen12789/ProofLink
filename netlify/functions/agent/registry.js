'use strict';

const { runBillingBlockerDetector } = require('./agents/billing-blocker-detector');
const { runCollectionsFollowUpAssistant } = require('./agents/collections-follow-up-assistant');
const { runDispatchSchedulingAssistant } = require('./agents/dispatch-scheduling-assistant');
const { runAgentWorkforceArchitect } = require('./agents/agent-workforce-architect');
const { runEstimatingAssistant } = require('./agents/estimating-assistant');
const { runImportMigrationAssistant } = require('./agents/import-migration-assistant');
const { runJobRecordAuditor } = require('./agents/job-record-auditor');

const AGENTS = {
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
  estimating_assistant: {
    key: 'estimating_assistant',
    label: 'Estimating Assistant',
    purpose: 'Builds a grounded estimate review from known service facts, stored pricing, and missing inputs without inventing price points.',
    inputs: [
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
