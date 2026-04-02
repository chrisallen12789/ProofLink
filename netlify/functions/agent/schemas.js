'use strict';

const REPORT_SCHEMA_VERSION = 'prooflink.agent.report.v1';
const FINDING_SEVERITIES = new Set(['critical', 'warning', 'info']);
const ACTION_PRIORITIES = new Set(['high', 'medium', 'low']);
const REPORT_STATUSES = new Set(['ready', 'review_needed', 'blocked']);

function asText(value, fallback = '', max = 2000) {
  const text = String(value == null ? fallback : value).trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeStringList(values, maxItems = 20, itemMax = 300) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => asText(value, '', itemMax))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeRecordRefs(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => ({
      record_type: asText(value?.record_type, 'record', 80),
      record_id: asText(value?.record_id, '', 120),
      label: asText(value?.label, '', 180),
    }))
    .filter((value) => value.record_id);
}

function normalizeFinding(item = {}, index = 0) {
  return {
    id: asText(item.id, `finding_${index + 1}`, 120),
    severity: FINDING_SEVERITIES.has(String(item.severity || '').trim())
      ? String(item.severity).trim()
      : 'info',
    category: asText(item.category, 'operations', 120),
    title: asText(item.title, `Finding ${index + 1}`, 180),
    detail: asText(item.detail, '', 1200),
    evidence_ids: normalizeStringList(item.evidence_ids, 12, 120),
    record_refs: normalizeRecordRefs(item.record_refs),
  };
}

function normalizeBlocker(item = {}, index = 0) {
  return {
    id: asText(item.id, `blocker_${index + 1}`, 120),
    title: asText(item.title, `Blocker ${index + 1}`, 180),
    detail: asText(item.detail, '', 1200),
    evidence_ids: normalizeStringList(item.evidence_ids, 12, 120),
    record_refs: normalizeRecordRefs(item.record_refs),
  };
}

function normalizeMissingDataItem(item = {}, index = 0) {
  if (typeof item === 'string') {
    return {
      id: `missing_${index + 1}`,
      label: asText(item, `Missing item ${index + 1}`, 180),
      detail: asText(item, '', 500),
      field: '',
      required_for: 'analysis',
    };
  }
  return {
    id: asText(item.id, `missing_${index + 1}`, 120),
    label: asText(item.label, `Missing item ${index + 1}`, 180),
    detail: asText(item.detail, '', 500),
    field: asText(item.field, '', 120),
    required_for: asText(item.required_for, 'analysis', 120),
  };
}

function normalizeRecommendedAction(item = {}, index = 0) {
  const priority = ACTION_PRIORITIES.has(String(item.priority || '').trim())
    ? String(item.priority).trim()
    : 'medium';
  return {
    id: asText(item.id, `action_${index + 1}`, 120),
    title: asText(item.title, `Recommended action ${index + 1}`, 180),
    detail: asText(item.detail, '', 1200),
    priority,
    requires_operator_approval: item.requires_operator_approval !== false,
    suggested_ui_action: asText(item.suggested_ui_action, '', 120),
    evidence_ids: normalizeStringList(item.evidence_ids, 12, 120),
    record_refs: normalizeRecordRefs(item.record_refs),
  };
}

function normalizeDataUsed(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => ({
      label: asText(value?.label, '', 180),
      count: Math.max(0, Math.round(asNumber(value?.count, 0))),
      detail: asText(value?.detail, '', 240),
    }))
    .filter((value) => value.label);
}

function normalizeConfidence(value = {}, fallbackRationale = '') {
  const rawScore = Math.max(0, Math.min(1, asNumber(value.score, 0.5)));
  const label = rawScore >= 0.8 ? 'high' : rawScore >= 0.55 ? 'medium' : 'low';
  return {
    score: Number(rawScore.toFixed(2)),
    label,
    rationale: asText(
      value.rationale,
      fallbackRationale || 'Confidence is based on how much structured business data was available.',
      500
    ),
  };
}

function validateLinkedEvidence(report) {
  const evidenceIds = new Set((report.evidence || []).map((item) => item.id));
  const linkedSections = [
    ...(report.findings || []),
    ...(report.blockers || []),
    ...(report.recommended_actions || []),
  ];

  linkedSections.forEach((item) => {
    (item.evidence_ids || []).forEach((evidenceId) => {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Unknown evidence reference "${evidenceId}" in report output`);
      }
    });
  });
}

function validateAgentReport(report, agentDefinition = {}) {
  const normalized = {
    schema_version: REPORT_SCHEMA_VERSION,
    agent_key: asText(report?.agent_key, agentDefinition.key || '', 120),
    agent_label: asText(report?.agent_label, agentDefinition.label || '', 180),
    summary: asText(report?.summary, '', 2000),
    summary_status: REPORT_STATUSES.has(String(report?.summary_status || '').trim())
      ? String(report.summary_status).trim()
      : 'review_needed',
    findings: Array.isArray(report?.findings)
      ? report.findings.map((item, index) => normalizeFinding(item, index))
      : [],
    blockers: Array.isArray(report?.blockers)
      ? report.blockers.map((item, index) => normalizeBlocker(item, index))
      : [],
    evidence: Array.isArray(report?.evidence)
      ? report.evidence.map((item, index) => ({
        id: asText(item?.id, `evidence_${index + 1}`, 120),
        kind: asText(item?.kind, 'record_field', 80),
        label: asText(item?.label, `Evidence ${index + 1}`, 180),
        record_type: asText(item?.record_type, 'record', 80),
        record_id: asText(item?.record_id, '', 120),
        field: asText(item?.field, '', 120),
        value_excerpt: asText(item?.value_excerpt, '', 240),
      }))
      : [],
    assumptions: normalizeStringList(report?.assumptions, 20, 300),
    missing_data: Array.isArray(report?.missing_data)
      ? report.missing_data.map((item, index) => normalizeMissingDataItem(item, index))
      : [],
    confidence: normalizeConfidence(report?.confidence, agentDefinition.confidence_signal),
    recommended_actions: Array.isArray(report?.recommended_actions)
      ? report.recommended_actions.map((item, index) => normalizeRecommendedAction(item, index))
      : [],
    data_used: normalizeDataUsed(report?.data_used),
    scope: {
      job_id: asText(report?.scope?.job_id, '', 120),
      order_id: asText(report?.scope?.order_id, '', 120),
      customer_id: asText(report?.scope?.customer_id, '', 120),
      tenant_id: asText(report?.scope?.tenant_id, '', 120),
    },
    billing_readiness: report?.billing_readiness
      ? {
          ready: report.billing_readiness.ready === true,
          status: REPORT_STATUSES.has(String(report.billing_readiness.status || '').trim())
            ? String(report.billing_readiness.status).trim()
            : (report.billing_readiness.ready ? 'ready' : 'review_needed'),
          score: Math.max(0, Math.min(100, Math.round(asNumber(report.billing_readiness.score, 0)))),
          rationale: asText(report.billing_readiness.rationale, '', 500),
        }
      : null,
    generated_at: asText(report?.generated_at, new Date().toISOString(), 120),
  };

  if (!normalized.agent_key) throw new Error('Agent report is missing agent_key');
  if (!normalized.agent_label) throw new Error('Agent report is missing agent_label');
  if (!normalized.summary) throw new Error('Agent report is missing summary');

  validateLinkedEvidence(normalized);
  return normalized;
}

module.exports = {
  ACTION_PRIORITIES,
  FINDING_SEVERITIES,
  REPORT_SCHEMA_VERSION,
  REPORT_STATUSES,
  validateAgentReport,
};
