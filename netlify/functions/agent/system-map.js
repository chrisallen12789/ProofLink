'use strict';

const STRUCTURED_AGENT_SURFACES = {
  job_record_auditor: {
    label: 'Job Record Auditor',
    ui_surface: 'Jobs workspace billing audit',
    exposed: true,
    surface_scope: 'operator',
  },
  field_closeout_coach: {
    label: 'Field Closeout Coach',
    ui_surface: 'Jobs workspace closeout review',
    exposed: true,
    surface_scope: 'operator',
  },
  site_packet_builder: {
    label: 'Site Packet Builder',
    ui_surface: 'Jobs workspace site packet review',
    exposed: true,
    surface_scope: 'operator',
  },
  billing_blocker_detector: {
    label: 'Billing Blocker Detector',
    ui_surface: 'Money workspace and command center',
    exposed: true,
    surface_scope: 'operator',
  },
  dispatch_scheduling_assistant: {
    label: 'Dispatch / Scheduling Assistant',
    ui_surface: 'Dispatch workspace and command center',
    exposed: true,
    surface_scope: 'operator',
  },
  collections_followup_assistant: {
    label: 'Collections / Follow-up Assistant',
    ui_surface: 'Payments workspace and command center',
    exposed: true,
    surface_scope: 'operator',
  },
  import_migration_assistant: {
    label: 'Import Migration Assistant',
    ui_surface: 'Import workspace migration review',
    exposed: true,
    surface_scope: 'operator',
  },
  accounting_continuity_auditor: {
    label: 'Accounting Continuity Auditor',
    ui_surface: 'Orders workspace continuity review',
    exposed: true,
    surface_scope: 'operator',
  },
  estimating_assistant: {
    label: 'Estimating Assistant',
    ui_surface: 'Walkthrough Bids workspace estimate review',
    exposed: true,
    surface_scope: 'operator',
  },
  proposal_readiness_auditor: {
    label: 'Proposal Readiness Auditor',
    ui_surface: 'Walkthrough Bids workspace proposal readiness review',
    exposed: true,
    surface_scope: 'operator',
  },
  quote_rescue_manager: {
    label: 'Quote Rescue Manager',
    ui_surface: 'Walkthrough Bids workspace proposal rescue review',
    exposed: true,
    surface_scope: 'operator',
  },
  service_plan_renewal_manager: {
    label: 'Service Plan Renewal Manager',
    ui_surface: 'Recurring Plans workspace renewal review',
    exposed: true,
    surface_scope: 'operator',
  },
  retention_reactivation_manager: {
    label: 'Retention / Reactivation Manager',
    ui_surface: 'Customers workspace reactivation review',
    exposed: true,
    surface_scope: 'operator',
  },
  agent_workforce_architect: {
    label: 'AI Workforce Architect',
    ui_surface: 'Admin internal AI control',
    exposed: true,
    surface_scope: 'admin',
  },
  ai_systems_architect: {
    label: 'AI Systems Architect',
    ui_surface: 'Admin internal AI control',
    exposed: true,
    surface_scope: 'admin',
  },
};

const COPILOT_SPECIALIST_LANES = [
  {
    key: 'collections',
    label: 'Collections',
    structured_agent_keys: ['collections_followup_assistant'],
    coverage: 'paired',
  },
  {
    key: 'crew_prep',
    label: 'Crew Prep',
    structured_agent_keys: ['dispatch_scheduling_assistant', 'site_packet_builder'],
    coverage: 'paired',
  },
  {
    key: 'quote_rescue',
    label: 'Quote Rescue',
    structured_agent_keys: ['quote_rescue_manager'],
    coverage: 'paired',
  },
  {
    key: 'retention',
    label: 'Retention',
    structured_agent_keys: ['service_plan_renewal_manager', 'retention_reactivation_manager'],
    coverage: 'paired',
  },
];

const MODEL_DRIVEN_AI_SURFACES = [
  {
    key: 'ai_brief',
    label: 'AI Brief',
    prompt_builders: ['buildBriefingPrompt'],
    output_mode: 'freeform_text',
    env_model_override: false,
  },
  {
    key: 'ai_copilot',
    label: 'AI Copilot',
    prompt_builders: ['buildCopilotPrompt', 'buildDraftPrompt'],
    output_mode: 'freeform_text',
    env_model_override: true,
  },
];

const AI_GOVERNANCE_SIGNALS = {
  shared_model_config: false,
  prompt_builder_tests: true,
  structured_report_schema_validation: true,
  admin_internal_boundary: true,
  audit_logging: true,
};

function listStructuredAgentSurfaces() {
  return Object.entries(STRUCTURED_AGENT_SURFACES).map(([key, value]) => ({
    key,
    label: value.label,
    ui_surface: value.ui_surface,
    exposed: value.exposed === true,
    surface_scope: value.surface_scope || 'operator',
  }));
}

function listCopilotSpecialistLanes() {
  return COPILOT_SPECIALIST_LANES.map((lane) => ({
    key: lane.key,
    label: lane.label,
    structured_agent_keys: Array.isArray(lane.structured_agent_keys)
      ? lane.structured_agent_keys.slice()
      : [],
    coverage: lane.coverage || 'freeform_only',
  }));
}

function listModelDrivenAiSurfaces() {
  return MODEL_DRIVEN_AI_SURFACES.map((surface) => ({
    key: surface.key,
    label: surface.label,
    prompt_builders: Array.isArray(surface.prompt_builders) ? surface.prompt_builders.slice() : [],
    output_mode: surface.output_mode || 'freeform_text',
    env_model_override: surface.env_model_override === true,
  }));
}

module.exports = {
  AI_GOVERNANCE_SIGNALS,
  listCopilotSpecialistLanes,
  listModelDrivenAiSurfaces,
  listStructuredAgentSurfaces,
};
