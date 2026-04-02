'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getAccountingContinuityContext } = require('../tools');

function compactText(value, max = 180) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, max);
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 120);
}

function collectReferenceEntries(record = {}, labelPrefix = '') {
  if (!record || typeof record !== 'object') return [];
  const entries = [];
  const push = (field, rawValue) => {
    const value = compactText(rawValue);
    if (!value) return;
    const normalized = normalizeToken(value);
    if (!normalized) return;
    entries.push({
      field,
      label: labelPrefix ? `${labelPrefix} ${field}` : field,
      value,
      normalized,
    });
  };

  [
    'invoice_number',
    'external_invoice_number',
    'quickbooks_invoice_number',
    'quickbooks_doc_number',
    'doc_number',
    'document_number',
    'external_reference',
    'external_ref',
    'source_ref',
    'source_reference',
    'reference',
    'payment_reference',
    'external_id',
    'order_external_id',
    'invoice_ref',
  ].forEach((field) => push(field, record[field]));

  const metadata = record?.metadata && typeof record.metadata === 'object'
    ? record.metadata
    : {};
  [
    'invoice_number',
    'external_invoice_number',
    'quickbooks_invoice_number',
    'quickbooks_doc_number',
    'doc_number',
    'reference',
    'order_external_id',
  ].forEach((field) => push(`metadata.${field}`, metadata[field]));

  return entries;
}

function uniqueReferenceValues(entries = []) {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry?.normalized) return;
    if (!map.has(entry.normalized)) {
      map.set(entry.normalized, entry);
    }
  });
  return [...map.values()];
}

function referenceValuesVisibleInNotes(noteText, refs = []) {
  const normalizedNote = normalizeToken(noteText);
  if (!normalizedNote) return [];
  return (Array.isArray(refs) ? refs : []).filter((entry) => normalizedNote.includes(entry.normalized));
}

function calculateConfidence(context, blockers, findings) {
  const coverage = [
    context?.order ? 0.24 : 0,
    context?.job ? 0.18 : 0,
    Array.isArray(context?.payments) ? 0.16 : 0,
    Array.isArray(context?.invoices) ? 0.16 : 0,
    context?.customer ? 0.08 : 0,
    context?.import_learning ? 0.1 : 0,
    context?.tenant ? 0.08 : 0,
  ].reduce((sum, value) => sum + value, 0);
  const penalty = Math.min(0.34, (blockers.length * 0.06) + ((context?.assumptions || []).length * 0.03));
  return {
    score: Number(Math.max(0.24, Math.min(0.95, coverage - penalty)).toFixed(2)),
    rationale: findings.length
      ? 'Confidence depends on whether the order, job, invoices, payments, and import-learning profile agree on the same outside-accounting reference.'
      : 'Confidence is strongest when one external invoice reference stays visible across the work, invoice, and payment trail.',
  };
}

function analyzeAccountingContinuity(context = {}) {
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const recommendedActions = [];
  const missingData = [];

  const order = context.order || null;
  const job = context.job || null;
  const customer = context.customer || null;
  const payments = Array.isArray(context.payments) ? context.payments : [];
  const invoices = Array.isArray(context.invoices) ? context.invoices : [];
  const importLearning = context.import_learning || {};
  const sourceSystems = Array.isArray(importLearning.source_systems) ? importLearning.source_systems : [];
  const correctionHotspots = Array.isArray(importLearning.correction_field_hotspots) ? importLearning.correction_field_hotspots : [];
  const continuitySignals = [
    ...sourceSystems,
    ...correctionHotspots.map((item) => String(item?.field || '').trim().toLowerCase()),
  ];
  const expectsExternalContinuity = continuitySignals.some((value) => [
    'quickbooks',
    'invoice_number',
    'doc_number',
    'order_external_id',
  ].includes(value));

  const orderRefs = collectReferenceEntries(order, 'order');
  const jobRefs = collectReferenceEntries(job, 'job');
  const invoiceRefs = invoices.flatMap((row) => collectReferenceEntries(row, 'invoice'));
  const paymentRefs = payments.flatMap((row) => collectReferenceEntries(row, 'payment'));
  const allRefs = uniqueReferenceValues([...orderRefs, ...jobRefs, ...invoiceRefs, ...paymentRefs]);
  const noteText = [
    job?.completion_note,
    job?.crew_notes,
    job?.notes,
    order?.notes,
  ].filter(Boolean).join(' ');
  const visibleRefs = referenceValuesVisibleInNotes(noteText, allRefs);
  const quickbooksMode = sourceSystems.includes('quickbooks');
  const orderRef = order?.id ? buildRecordRef('order', order.id, order.title || order.customer_name || 'Order') : null;
  const jobRef = job?.id ? buildRecordRef('job', job.id, job.title || 'Linked job') : null;
  const customerRef = customer?.id ? buildRecordRef('customer', customer.id, customer.company_name || customer.name || 'Customer') : null;

  const pushFinding = (config = {}) => findings.push({
    id: config.id,
    severity: config.severity,
    category: config.category,
    title: config.title,
    detail: config.detail,
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const pushBlocker = (config = {}) => blockers.push({
    id: config.id,
    title: config.title,
    detail: config.detail,
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const pushAction = (config = {}) => recommendedActions.push({
    id: config.id,
    title: config.title,
    detail: config.detail,
    priority: config.priority || 'medium',
    requires_operator_approval: true,
    suggested_ui_action: config.suggested_ui_action || '',
    evidence_ids: config.evidence_ids || [],
    record_refs: (config.record_refs || []).filter(Boolean),
  });

  const continuityEvidenceId = evidence.add({
    record_type: order?.id ? 'order' : 'job',
    record_id: order?.id || job?.id || '',
    field: 'accounting_continuity',
    label: 'Accounting continuity snapshot',
    value: [
      quickbooksMode ? 'quickbooks continuity expected' : 'outside-accounting continuity optional',
      `${allRefs.length} unique reference(s)`,
      `${payments.length} payment record(s)`,
      `${invoices.length} invoice record(s)`,
      visibleRefs.length ? 'reference visible in service notes' : 'reference not visible in service notes',
    ].join(' | '),
  });

  if ((expectsExternalContinuity || payments.length || invoices.length) && !allRefs.length) {
    pushFinding({
      id: 'accounting_missing_external_reference',
      severity: 'critical',
      category: 'continuity',
      title: 'No outside-accounting reference is attached to this work chain',
      detail: quickbooksMode
        ? 'QuickBooks continuity signals are present, but this order/job/invoice/payment trail still does not carry a visible QuickBooks invoice or doc number.'
        : 'This work chain has money records or import-learning signals, but no shared outside-accounting reference is attached yet.',
      evidence_ids: [continuityEvidenceId],
      record_refs: [orderRef, jobRef, customerRef],
    });
    pushBlocker({
      id: 'accounting_missing_external_reference',
      title: 'Attach the external invoice or doc number',
      detail: quickbooksMode
        ? 'Map the QuickBooks invoice or doc number onto the order, payment reference, or service report notes so ProofLink and QuickBooks stay traceable.'
        : 'Attach one external accounting reference so invoices, payments, and service proof stay tied together.',
      evidence_ids: [continuityEvidenceId],
      record_refs: [orderRef, jobRef, customerRef],
    });
    missingData.push({
      id: 'accounting_missing_external_reference',
      label: 'Outside-accounting reference is missing',
      detail: 'The work chain needs one shared external invoice or document number when outside accounting stays in use.',
      field: 'invoice_number|doc_number|source_ref|reference',
      required_for: 'accounting_continuity',
    });
  }

  if (allRefs.length > 1) {
    const conflictEvidenceId = evidence.add({
      record_type: order?.id ? 'order' : 'job',
      record_id: order?.id || job?.id || '',
      field: 'reference_conflict',
      label: 'Conflicting outside-accounting references',
      value: allRefs.map((entry) => entry.value).join(' | '),
    });
    pushFinding({
      id: 'accounting_conflicting_references',
      severity: 'critical',
      category: 'continuity',
      title: 'More than one external reference is competing on the same work',
      detail: 'The order, job, invoice, or payment records disagree about the outside-accounting reference. Pick one canonical number before reconciliation drifts further.',
      evidence_ids: [conflictEvidenceId],
      record_refs: [orderRef, jobRef, customerRef],
    });
    pushBlocker({
      id: 'accounting_conflicting_references',
      title: 'Standardize one canonical external reference',
      detail: 'Choose the correct invoice or doc number, then line the order, job, invoices, and payments back up to that same value.',
      evidence_ids: [conflictEvidenceId],
      record_refs: [orderRef, jobRef, customerRef],
    });
  }

  if (allRefs.length === 1 && !visibleRefs.length && job?.id) {
    const noteEvidenceId = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'notes',
      label: 'Service-report visibility',
      value: `Canonical reference ${allRefs[0].value} is not visible in the job closeout or service notes.`,
    });
    pushFinding({
      id: 'accounting_reference_not_visible_in_service_report',
      severity: 'warning',
      category: 'continuity',
      title: 'The canonical reference is not visible in the service record',
      detail: 'ProofLink has one outside-accounting reference, but the job/service report does not visibly carry it yet. That weakens field-to-accounting traceability.',
      evidence_ids: [continuityEvidenceId, noteEvidenceId],
      record_refs: [jobRef, orderRef],
    });
  }

  if (payments.length && !paymentRefs.length && allRefs.length) {
    pushFinding({
      id: 'accounting_payment_refs_missing',
      severity: 'info',
      category: 'continuity',
      title: 'Payments are not carrying the same reference yet',
      detail: 'The work chain has an external accounting reference, but the current payment records are not visibly carrying it. That makes later reconciliation heavier than it needs to be.',
      evidence_ids: [continuityEvidenceId],
      record_refs: [orderRef],
    });
  }

  if (invoices.length && !invoiceRefs.length && allRefs.length) {
    pushFinding({
      id: 'accounting_invoice_refs_missing',
      severity: 'info',
      category: 'continuity',
      title: 'Invoices are not carrying the shared reference yet',
      detail: 'There is a continuity reference in the work chain, but the current invoice records do not visibly carry it yet.',
      evidence_ids: [continuityEvidenceId],
      record_refs: [orderRef],
    });
  }

  if (allRefs.length === 1) {
    const canonicalRef = allRefs[0];
    const canonicalEvidenceId = evidence.add({
      record_type: order?.id ? 'order' : 'job',
      record_id: order?.id || job?.id || '',
      field: canonicalRef.field,
      label: 'Canonical continuity reference',
      value: canonicalRef.value,
    });
    pushFinding({
      id: 'accounting_canonical_reference_found',
      severity: blockers.length ? 'info' : 'info',
      category: 'continuity',
      title: 'One canonical outside-accounting reference is already present',
      detail: `The strongest continuity anchor on this work is ${canonicalRef.value}. Keep that same number visible across the order, field closeout, invoices, and payment trail.`,
      evidence_ids: [canonicalEvidenceId],
      record_refs: [orderRef, jobRef, customerRef],
    });
  }

  if (quickbooksMode) {
    pushAction({
      id: 'accounting_keep_quickbooks_reference_visible',
      title: 'Keep the QuickBooks invoice or doc number visible end to end',
      detail: allRefs.length
        ? `Use ${allRefs[0].value} as the continuity anchor and keep it visible in the service report or job notes, the booked work record, and any imported payment references.`
        : 'Map the QuickBooks invoice or doc number into the booked work or payment reference fields, then label it in the service report/job notes so ProofLink and QuickBooks stay traceable.',
      priority: 'high',
      suggested_ui_action: 'open_orders',
      evidence_ids: [continuityEvidenceId],
      record_refs: [orderRef, jobRef, customerRef],
    });
  } else {
    pushAction({
      id: 'accounting_attach_shared_reference',
      title: 'Use one shared outside-accounting reference across the work chain',
      detail: 'Attach the same external invoice or document number to the order, any imported payments, and the service-report notes so reconciliation does not depend on memory.',
      priority: 'high',
      suggested_ui_action: 'open_orders',
      evidence_ids: [continuityEvidenceId],
      record_refs: [orderRef, jobRef, customerRef],
    });
  }

  if (allRefs.length > 1) {
    pushAction({
      id: 'accounting_reconcile_reference_conflicts',
      title: 'Reconcile the conflicting continuity numbers',
      detail: 'Choose the authoritative external reference, then correct the mismatched order, invoice, payment, or field-note values so the records line up again.',
      priority: 'high',
      suggested_ui_action: 'open_import',
      evidence_ids: evidence.list().filter((item) => item.field === 'reference_conflict').map((item) => item.id),
      record_refs: [orderRef, jobRef],
    });
  }

  if (allRefs.length === 1 && !visibleRefs.length && job?.id) {
    pushAction({
      id: 'accounting_label_service_report',
      title: 'Label the service report with the canonical reference',
      detail: `Add ${allRefs[0].value} into the job closeout or service-report notes so field proof and outside accounting stay linked without guesswork.`,
      priority: 'medium',
      suggested_ui_action: 'open_job',
      evidence_ids: [continuityEvidenceId],
      record_refs: [jobRef, orderRef],
    });
  }

  if (payments.length && !paymentRefs.length && allRefs.length || invoices.length && !invoiceRefs.length && allRefs.length) {
    pushAction({
      id: 'accounting_extend_reference_to_money_records',
      title: 'Carry the same reference into invoices and imported payments',
      detail: 'Use the same continuity number on invoices and payment references so accounting updates can be matched back without manual archaeology.',
      priority: 'medium',
      suggested_ui_action: 'open_payments',
      evidence_ids: [continuityEvidenceId],
      record_refs: [orderRef],
    });
  }

  const confidence = calculateConfidence(context, blockers, findings);
  const summary = blockers.length
    ? 'The outside-accounting continuity on this work still needs cleanup. The reference is missing or conflicting, so reconciliation is not trustworthy yet.'
    : allRefs.length
      ? `The work chain has a visible outside-accounting anchor${allRefs.length === 1 ? `: ${allRefs[0].value}` : ''}. The next step is keeping that same reference visible everywhere it matters.`
      : 'No strong outside-accounting signal was found on this work. If this tenant keeps books elsewhere, add one shared reference before the trail gets colder.';

  return {
    agent_key: 'accounting_continuity_auditor',
    agent_label: 'Accounting Continuity Auditor',
    summary,
    summary_status: blockers.length ? 'blocked' : (allRefs.length ? 'review_needed' : 'ready'),
    findings,
    blockers,
    evidence: evidence.list(),
    assumptions: context.assumptions || [],
    missing_data: missingData,
    confidence,
    recommended_actions: recommendedActions,
    data_used: context.data_used || [],
    scope: {
      tenant_id: context.tenant_id || '',
      order_id: order?.id || '',
      job_id: job?.id || '',
      customer_id: customer?.id || '',
    },
    generated_at: new Date().toISOString(),
  };
}

async function runAccountingContinuityAuditor({ supabase, tenantId, input }) {
  const orderId = String(input?.order_id || input?.orderId || '').trim();
  const jobId = String(input?.job_id || input?.jobId || '').trim();
  if (!orderId && !jobId) {
    const err = new Error('order_id or job_id is required');
    err.statusCode = 400;
    throw err;
  }

  const context = await getAccountingContinuityContext(supabase, tenantId, input || {});
  return {
    report: analyzeAccountingContinuity(context),
    tools_used: ['get_accounting_continuity_context'],
    context_summary: {
      order_id: context.order?.id || '',
      job_id: context.job?.id || '',
      payments: Array.isArray(context.payments) ? context.payments.length : 0,
      invoices: Array.isArray(context.invoices) ? context.invoices.length : 0,
      source_systems: Array.isArray(context.import_learning?.source_systems) ? context.import_learning.source_systems.length : 0,
    },
  };
}

module.exports = {
  analyzeAccountingContinuity,
  runAccountingContinuityAuditor,
};
