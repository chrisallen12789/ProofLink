'use strict';

const LOAD_STATUS_VALUES = new Set(['truck_clear', 'live_load_remaining', 'no_load']);
const PERMIT_STATUS_VALUES = new Set(['not_required', 'open_and_safe', 'closed', 'needs_office_followup']);
const OFFICE_FOLLOW_UP_VALUES = new Set(['customer_records', 'audit_packet', 'invoice', 'disposal_ticket', 'site_return']);

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, max = 800) {
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanDateValue(value) {
  const text = cleanText(value, 32);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function boolOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function titleCaseKey(value = '') {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildHydrovacCompletionNarrative(handoff = {}) {
  const followUp = Array.isArray(handoff.office_follow_up)
    ? handoff.office_follow_up.map((item) => titleCaseKey(item)).join(', ')
    : '';
  const loadSummary = handoff.load_status === 'truck_clear'
    ? 'Truck clear'
    : handoff.load_status === 'no_load'
      ? 'No load hauled'
      : `Live load remains${handoff.disposal_ready_by ? ` until ${handoff.disposal_ready_by}` : ''}${handoff.live_load_hold_reason ? ` (${handoff.live_load_hold_reason})` : ''}`;
  const locateSummary = handoff.locates_verified_on_site === true
    ? 'Locate verified on site'
    : handoff.locates_verified_on_site === false
      ? 'Locate still needs office follow-up'
      : 'Locate verification not captured';
  const permitSummary = handoff.permit_status ? `Permit ${handoff.permit_status.replace(/_/g, ' ')}` : '';
  const parts = [
    `Hydrovac closeout: ${loadSummary}.`,
    handoff.bol_number ? `BOL ${handoff.bol_number}.` : '',
    `${locateSummary}.`,
    permitSummary ? `${permitSummary}.` : '',
    handoff.field_summary ? `Field summary: ${handoff.field_summary}` : '',
    handoff.customer_note ? `Customer note: ${handoff.customer_note}` : '',
    followUp ? `Office follow-up: ${followUp}.` : '',
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function mergeCrewCloseoutMetadata(metadata = {}, handoff = null) {
  const base = safeObject(metadata);
  if (!handoff) return base;
  return {
    ...base,
    crew_closeout: {
      ...handoff,
      version: 1,
      captured_at: handoff.captured_at || new Date().toISOString(),
    },
  };
}

function mergeCrewCloseoutIntoCustomFields(customFields = {}, handoff = null) {
  const base = safeObject(customFields);
  if (!handoff) return base;
  return {
    ...base,
    crew_closeout: {
      ...handoff,
      version: 1,
      captured_at: handoff.captured_at || new Date().toISOString(),
    },
  };
}

function buildHydrovacCloseoutPatch(job = {}, handoff = null) {
  const patch = {};
  if (!handoff) return patch;

  const hasMetadataColumn = Object.prototype.hasOwnProperty.call(job || {}, 'metadata');
  const hasCustomFieldsColumn = Object.prototype.hasOwnProperty.call(job || {}, 'custom_fields');

  if (hasMetadataColumn) {
    patch.metadata = mergeCrewCloseoutMetadata(job.metadata, handoff);
  }
  if (hasCustomFieldsColumn || !hasMetadataColumn) {
    patch.custom_fields = mergeCrewCloseoutIntoCustomFields(job.custom_fields, handoff);
  }
  return patch;
}

function extractHydrovacCompletionHandoff(job = {}) {
  const metadata = safeObject(job.metadata);
  const closeout = safeObject(metadata.crew_closeout);
  if (Object.keys(closeout).length) return closeout;

  const customFields = safeObject(job.custom_fields);
  const customFieldCloseout = safeObject(customFields.crew_closeout);
  return Object.keys(customFieldCloseout).length ? customFieldCloseout : null;
}

async function jobHasConfinedSpacePermit(adminSb, tenantId, jobId) {
  if (!adminSb || !tenantId || !jobId) return false;
  const { data, error } = await adminSb
    .from('confined_space_permits')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('job_id', jobId);
  if (error) throw new Error('Failed to verify permit status for closeout.');
  return Array.isArray(data) && data.length > 0;
}

async function normalizeHydrovacCompletionHandoff({ adminSb, tenantId, job, raw }) {
  const input = safeObject(raw);
  if (!Object.keys(input).length) {
    return { error: 'completion_handoff is required for hydrovac closeout.' };
  }

  const load_status = cleanText(input.load_status, 48);
  if (!LOAD_STATUS_VALUES.has(load_status)) {
    return { error: 'Hydrovac closeout requires a valid load_status.' };
  }

  const permitStatusRequired = job?.requires_confined_space_permit === true
    || await jobHasConfinedSpacePermit(adminSb, tenantId, job?.id);
  const permit_status = cleanText(input.permit_status, 48);
  if (permitStatusRequired && !PERMIT_STATUS_VALUES.has(permit_status)) {
    return { error: 'Hydrovac closeout requires a permit_status for this job.' };
  }
  if (!permitStatusRequired && permit_status && !PERMIT_STATUS_VALUES.has(permit_status)) {
    return { error: 'Hydrovac closeout permit_status is invalid.' };
  }
  if (permitStatusRequired && permit_status === 'not_required') {
    return { error: 'This job already carries permit pressure, so permit_status cannot be not_required.' };
  }

  const officeFollowUpRaw = Array.isArray(input.office_follow_up)
    ? input.office_follow_up
    : input.office_follow_up == null
      ? []
      : [input.office_follow_up];
  const office_follow_up = [...new Set(
    officeFollowUpRaw
      .map((item) => cleanText(item, 48))
      .filter(Boolean)
  )];
  const invalidFollowUp = office_follow_up.find((item) => !OFFICE_FOLLOW_UP_VALUES.has(item));
  if (invalidFollowUp) {
    return { error: `Unknown office follow-up key: ${invalidFollowUp}.` };
  }

  const normalized = {
    load_status,
    bol_number: cleanText(input.bol_number, 120),
    live_load_hold_reason: cleanText(input.live_load_hold_reason, 240),
    disposal_ready_by: cleanDateValue(input.disposal_ready_by),
    locates_verified_on_site: boolOrNull(input.locates_verified_on_site),
    permit_status: permit_status || '',
    permit_note: cleanText(input.permit_note, 240),
    field_summary: cleanText(input.field_summary, 800),
    customer_note: cleanText(input.customer_note, 400),
    office_follow_up,
    captured_at: new Date().toISOString(),
  };

  if (!normalized.field_summary) {
    return { error: 'Hydrovac closeout requires a field_summary.' };
  }
  if (normalized.load_status === 'live_load_remaining' && !normalized.live_load_hold_reason) {
    return { error: 'Hydrovac closeout requires a live_load_hold_reason when a live load remains.' };
  }
  if (normalized.load_status === 'live_load_remaining' && !normalized.disposal_ready_by) {
    return { error: 'Hydrovac closeout requires a disposal_ready_by date when a live load remains.' };
  }

  return {
    value: normalized,
    permitStatusRequired,
  };
}

module.exports = {
  LOAD_STATUS_VALUES,
  PERMIT_STATUS_VALUES,
  OFFICE_FOLLOW_UP_VALUES,
  buildHydrovacCompletionNarrative,
  buildHydrovacCloseoutPatch,
  mergeCrewCloseoutMetadata,
  extractHydrovacCompletionHandoff,
  normalizeHydrovacCompletionHandoff,
};
