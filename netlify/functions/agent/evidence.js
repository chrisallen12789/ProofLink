'use strict';

function truncateText(value, max = 180) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function safeLabel(value, fallback = 'Evidence') {
  const text = String(value || '').trim();
  return text || fallback;
}

function buildRecordRef(recordType, recordId, label = '') {
  return {
    record_type: String(recordType || 'record').trim() || 'record',
    record_id: String(recordId || '').trim(),
    label: safeLabel(label, ''),
  };
}

function normalizeEvidence(config = {}, index = 0) {
  const recordType = String(config.record_type || 'record').trim() || 'record';
  const recordId = String(config.record_id || '').trim();
  const field = String(config.field || '').trim();
  const label = safeLabel(config.label, `${recordType} evidence`);
  const valueExcerpt = truncateText(
    config.value_excerpt != null ? config.value_excerpt : config.value,
    220
  );
  const id = String(config.id || '').trim()
    || [recordType, recordId || 'unknown', field || label || `evidence_${index + 1}`]
      .join('_')
      .replace(/[^a-z0-9_]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();

  return {
    id,
    kind: String(config.kind || 'record_field').trim() || 'record_field',
    label,
    record_type: recordType,
    record_id: recordId,
    field,
    value_excerpt: valueExcerpt,
  };
}

function createEvidenceBuilder() {
  const evidenceById = new Map();

  return {
    add(config = {}) {
      const evidence = normalizeEvidence(config, evidenceById.size);
      if (!evidence.id) return '';
      if (!evidenceById.has(evidence.id)) {
        evidenceById.set(evidence.id, evidence);
      }
      return evidence.id;
    },
    list() {
      return [...evidenceById.values()];
    },
  };
}

module.exports = {
  buildRecordRef,
  createEvidenceBuilder,
  normalizeEvidence,
  truncateText,
};
