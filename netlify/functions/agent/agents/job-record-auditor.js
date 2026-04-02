'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getJobRecordAuditContext } = require('../tools');

function money(cents) {
  const value = Number(cents || 0);
  return `$${(value / 100).toFixed(2)}`;
}

function fmtDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function countPhotos(photos = [], type) {
  return (Array.isArray(photos) ? photos : []).filter((photo) => String(photo?.photo_type || '').trim().toLowerCase() === String(type || '').trim().toLowerCase()).length;
}

function countUnresolvedAlerts(alerts = []) {
  return (Array.isArray(alerts) ? alerts : []).filter((alert) => alert && alert.resolved !== true).length;
}

function confirmedUninvoicedManifests(manifests = []) {
  return (Array.isArray(manifests) ? manifests : []).filter((manifest) => {
    const status = String(manifest?.status || '').trim().toLowerCase();
    return status === 'confirmed' && manifest?.invoiced !== true;
  });
}

function hasAnyText(...values) {
  return values.some((value) => String(value || '').trim());
}

function calculateConfidence(context, blockerCount, missingCount) {
  const coverageParts = [
    context.job ? 0.2 : 0,
    context.order ? 0.18 : 0,
    Array.isArray(context.photos) ? 0.12 : 0,
    Array.isArray(context.payments) ? 0.12 : 0,
    Array.isArray(context.expenses) ? 0.1 : 0,
    Array.isArray(context.invoices) ? 0.08 : 0,
    Array.isArray(context.time_segments) ? 0.08 : 0,
    Array.isArray(context.compliance_alerts) ? 0.06 : 0,
    Array.isArray(context.waste_manifests) ? 0.06 : 0,
  ].reduce((sum, value) => sum + value, 0);

  const penalty = Math.min(0.35, (blockerCount * 0.04) + (missingCount * 0.02) + ((context.assumptions || []).length * 0.03));
  return Math.max(0.2, Math.min(0.98, coverageParts - penalty));
}

function analyzeJobRecordAudit(context) {
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const recommendedActions = [];
  const missingData = [];
  const assumptions = [...(context.assumptions || [])];

  const job = context.job || {};
  const order = context.order || null;
  const customer = context.customer || null;
  const location = context.customer_location || null;
  const photos = Array.isArray(context.photos) ? context.photos : [];
  const payments = Array.isArray(context.payments) ? context.payments : [];
  const expenses = Array.isArray(context.expenses) ? context.expenses : [];
  const timeSegments = Array.isArray(context.time_segments) ? context.time_segments : [];
  const invoices = Array.isArray(context.invoices) ? context.invoices : [];
  const manifests = Array.isArray(context.waste_manifests) ? context.waste_manifests : [];
  const alerts = Array.isArray(context.compliance_alerts) ? context.compliance_alerts : [];

  const jobRef = buildRecordRef('job', job.id, job.title || 'Job');
  const orderRef = order?.id ? buildRecordRef('order', order.id, order.title || order.customer_name || 'Linked order') : null;
  const customerRef = customer?.id ? buildRecordRef('customer', customer.id, customer.company_name || customer.name || 'Customer') : null;

  const pushFinding = (config = {}) => {
    findings.push({
      id: config.id,
      severity: config.severity,
      category: config.category,
      title: config.title,
      detail: config.detail,
      evidence_ids: config.evidence_ids || [],
      record_refs: (config.record_refs || []).filter(Boolean),
    });
  };

  const pushBlocker = (config = {}) => {
    blockers.push({
      id: config.id,
      title: config.title,
      detail: config.detail,
      evidence_ids: config.evidence_ids || [],
      record_refs: (config.record_refs || []).filter(Boolean),
    });
  };

  const pushAction = (config = {}) => {
    recommendedActions.push({
      id: config.id,
      title: config.title,
      detail: config.detail,
      priority: config.priority,
      requires_operator_approval: true,
      suggested_ui_action: config.suggested_ui_action || '',
      evidence_ids: config.evidence_ids || [],
      record_refs: (config.record_refs || []).filter(Boolean),
    });
  };

  const statusEvidenceId = evidence.add({
    record_type: 'job',
    record_id: job.id,
    field: 'status',
    label: 'Job status',
    value: `${job.status || 'unknown'} | payment ${job.payment_state || 'unknown'}`,
  });

  const orderMoneyEvidenceId = order?.id ? evidence.add({
    record_type: 'order',
    record_id: order.id,
    field: 'money',
    label: 'Order money state',
    value: `total ${money(order.total_cents || 0)} | due ${money(order.amount_due_cents || 0)} | paid ${money(order.amount_paid_cents || 0)} | payment state ${order.payment_state || 'unknown'}`,
  }) : '';

  const proofEvidenceId = evidence.add({
    record_type: 'job',
    record_id: job.id,
    field: 'proof',
    label: 'Proof package',
    value: `${countPhotos(photos, 'before')} before | ${countPhotos(photos, 'during')} during | ${countPhotos(photos, 'after')} after | signature ${job.signature_data_url ? 'present' : 'missing'}`,
  });

  if (!order?.id) {
    const orderLinkEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'order_id',
      label: 'Linked order',
      value: 'Missing linked order on the job record.',
    });
    pushFinding({
      id: 'job_missing_order_link',
      severity: 'critical',
      category: 'billing',
      title: 'Job is not linked to booked work',
      detail: 'Billing readiness is blocked because this job has no linked order. The office cannot generate or reconcile invoice-ready work cleanly until the field record is tied back to booked work.',
      evidence_ids: [orderLinkEvidence],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_missing_order_link',
      title: 'Link the job to booked work',
      detail: 'Attach this execution record to the correct order before invoicing or collections work starts.',
      evidence_ids: [orderLinkEvidence],
      record_refs: [jobRef],
    });
    missingData.push({
      id: 'missing_order_link',
      label: 'Linked order is missing',
      detail: 'The job needs an order_id so billing, payments, and invoices stay attached to the same work record.',
      field: 'job.order_id',
      required_for: 'billing_readiness',
    });
    pushAction({
      id: 'link_job_to_order',
      title: 'Link this job to the correct order',
      detail: 'Open the booked-work record and attach this job so invoice, payment, and review follow-through land on the same chain of records.',
      priority: 'high',
      suggested_ui_action: 'open_order',
      evidence_ids: [orderLinkEvidence],
      record_refs: [jobRef],
    });
  }

  if (!customer?.id && !job.customer_id && !order?.customer_id) {
    const customerEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'customer_id',
      label: 'Customer linkage',
      value: 'No customer is linked to the job or order.',
    });
    pushFinding({
      id: 'job_missing_customer_link',
      severity: 'warning',
      category: 'linkage',
      title: 'Customer link is missing',
      detail: 'This job is not tied to a customer record. That makes history, proof review, and follow-up harder to audit later.',
      evidence_ids: [customerEvidence],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_missing_customer_link',
      title: 'Link the customer record',
      detail: 'Attach the right customer before closeout so payment and future service history stay in one place.',
      evidence_ids: [customerEvidence],
      record_refs: [jobRef],
    });
    missingData.push({
      id: 'missing_customer_link',
      label: 'Customer record is missing',
      detail: 'The linked customer is missing from both the job and the order.',
      field: 'job.customer_id',
      required_for: 'operational_history',
    });
  }

  const serviceAddress = String(job.service_address || order?.service_address || location?.address_line1 || '').trim();
  if (!serviceAddress) {
    const addressEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'service_address',
      label: 'Service address',
      value: 'No service address is recorded on the job, order, or linked site.',
    });
    pushFinding({
      id: 'job_missing_service_address',
      severity: 'warning',
      category: 'scope',
      title: 'Service address is missing',
      detail: 'The work location is still blank, so the record is weaker for billing backup and future repeat service.',
      evidence_ids: [addressEvidence],
      record_refs: [jobRef, orderRef, customerRef],
    });
    missingData.push({
      id: 'missing_service_address',
      label: 'Service address is missing',
      detail: 'The job should keep the actual service address tied to the execution record.',
      field: 'job.service_address',
      required_for: 'record_quality',
    });
  }

  const actualStart = job.actual_start_at || job.started_at || null;
  const actualEnd = job.actual_end_at || job.completed_at || null;
  if (job.status === 'completed' && !actualEnd) {
    const endEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'actual_end_at',
      label: 'Completion timestamp',
      value: 'Job is marked completed but no end timestamp is present.',
    });
    pushFinding({
      id: 'job_missing_completion_timestamp',
      severity: 'critical',
      category: 'timing',
      title: 'Completion timestamp is missing',
      detail: 'The job is marked completed without an actual end time. Billing readiness is blocked because the closeout timing is incomplete.',
      evidence_ids: [statusEvidenceId, endEvidence],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_missing_completion_timestamp',
      title: 'Capture the actual completion time',
      detail: 'Update the job so the end timestamp reflects when the work actually finished.',
      evidence_ids: [endEvidence],
      record_refs: [jobRef],
    });
  }

  if (actualStart && actualEnd && new Date(actualEnd).getTime() < new Date(actualStart).getTime()) {
    const timingEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'actual_start_at',
      label: 'Actual timing',
      value: `start ${fmtDate(actualStart)} | end ${fmtDate(actualEnd)}`,
    });
    pushFinding({
      id: 'job_contradictory_timing',
      severity: 'critical',
      category: 'timing',
      title: 'Job timing is contradictory',
      detail: 'The recorded end time is earlier than the start time. Review the crew timestamps before this record is used for billing or dispute support.',
      evidence_ids: [timingEvidence],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_contradictory_timing',
      title: 'Correct the start and end timestamps',
      detail: 'Fix the actual timing values so the job record reflects a real work window.',
      evidence_ids: [timingEvidence],
      record_refs: [jobRef],
    });
  }

  if (job.status === 'completed' && !hasAnyText(job.completion_note, job.crew_notes, job.notes)) {
    const noteEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'completion_note',
      label: 'Closeout note',
      value: 'No completion note, crew note, or operator note is stored on the completed job.',
    });
    pushFinding({
      id: 'job_missing_closeout_note',
      severity: 'warning',
      category: 'proof',
      title: 'Closeout note is missing',
      detail: 'The crew finished the work without leaving a usable closeout note. That weakens billing backup and makes future callbacks harder to explain.',
      evidence_ids: [noteEvidence],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_missing_closeout_note',
      title: 'Add the closeout note',
      detail: 'Capture what was completed, anything changed on site, and any follow-up the office needs to remember.',
      evidence_ids: [noteEvidence],
      record_refs: [jobRef],
    });
    missingData.push({
      id: 'missing_closeout_note',
      label: 'Closeout note is missing',
      detail: 'A completed job should include a completion note, crew note, or operator note.',
      field: 'job.completion_note',
      required_for: 'billing_readiness',
    });
  }

  const afterPhotos = countPhotos(photos, 'after');
  const completionPhotoRequired = job.completion_photo_required !== false;
  if (job.status === 'completed' && completionPhotoRequired && afterPhotos === 0) {
    pushFinding({
      id: 'job_missing_after_photo',
      severity: 'critical',
      category: 'proof',
      title: 'Completion proof photo is missing',
      detail: 'The job requires completion proof, but no after photo is attached yet.',
      evidence_ids: [proofEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_missing_after_photo',
      title: 'Upload the after photo',
      detail: 'Attach the final proof photo before treating this job as fully billing ready.',
      evidence_ids: [proofEvidenceId],
      record_refs: [jobRef],
    });
    missingData.push({
      id: 'missing_after_photo',
      label: 'After photo is missing',
      detail: 'A completed job with completion proof required should include at least one after photo.',
      field: 'job_photos.after',
      required_for: 'billing_readiness',
    });
  }

  if (job.status === 'completed' && !job.signature_data_url) {
    pushFinding({
      id: 'job_missing_signature',
      severity: 'warning',
      category: 'proof',
      title: 'Customer signature is missing',
      detail: 'No customer signature is attached to the completed job. If this business depends on signed closeout, collect and save it before billing disputes show up.',
      evidence_ids: [proofEvidenceId],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_missing_signature',
      title: 'Capture the customer signature',
      detail: 'Save the signed approval or completion acknowledgment on the job record if your team requires signed closeout proof.',
      evidence_ids: [proofEvidenceId],
      record_refs: [jobRef],
    });
  }

  const openTimeSegments = timeSegments.filter((segment) => segment && segment.started_at && !segment.ended_at);
  if (openTimeSegments.length) {
    const timeEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'time_segments',
      label: 'Open time segments',
      value: `${openTimeSegments.length} time segment(s) have a start time but no end time.`,
    });
    pushFinding({
      id: 'job_open_time_segments',
      severity: 'warning',
      category: 'timing',
      title: 'Open time entries still need review',
      detail: 'At least one job time segment has not been closed out yet. That can distort labor totals or billable hours.',
      evidence_ids: [timeEvidence],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_open_time_segments',
      title: 'Close the open time segments',
      detail: 'Review and finish the time entries before using this record for final labor billing.',
      evidence_ids: [timeEvidence],
      record_refs: [jobRef],
    });
  }

  const orderTotal = Number(order?.total_cents || 0);
  if (order?.id && orderTotal <= 0) {
    pushFinding({
      id: 'order_has_no_billable_total',
      severity: 'critical',
      category: 'billing',
      title: 'Linked order has no billable total',
      detail: 'The job is linked to booked work, but the order total is still zero. There is nothing priced to invoice yet.',
      evidence_ids: [orderMoneyEvidenceId].filter(Boolean),
      record_refs: [jobRef, orderRef],
    });
    pushBlocker({
      id: 'order_has_no_billable_total',
      title: 'Price the linked order before invoicing',
      detail: 'Review line items, scope, or billing method so the order reflects what should actually be billed.',
      evidence_ids: [orderMoneyEvidenceId].filter(Boolean),
      record_refs: [jobRef, orderRef],
    });
  }

  if (order?.id && String(order.payment_state || '').trim().toLowerCase() === 'paid' && Number(order.amount_due_cents || 0) > 0) {
    pushFinding({
      id: 'order_payment_state_conflict',
      severity: 'critical',
      category: 'billing',
      title: 'Payment state conflicts with amount due',
      detail: 'The order is marked paid while money is still shown as outstanding. Reconcile payment state before sending follow-up or closing the books on this job.',
      evidence_ids: [orderMoneyEvidenceId].filter(Boolean),
      record_refs: [orderRef],
    });
    pushBlocker({
      id: 'order_payment_state_conflict',
      title: 'Reconcile the order payment state',
      detail: 'Review the order and related payment records so the balance and status agree.',
      evidence_ids: [orderMoneyEvidenceId].filter(Boolean),
      record_refs: [orderRef],
    });
  }

  if (order?.id && payments.length === 0 && Number(order.amount_paid_cents || 0) > 0) {
    const paymentEvidence = evidence.add({
      record_type: 'order',
      record_id: order.id,
      field: 'amount_paid_cents',
      label: 'Paid amount without payment rows',
      value: `amount paid ${money(order.amount_paid_cents || 0)} | payment rows ${payments.length}`,
    });
    pushFinding({
      id: 'order_paid_without_payment_records',
      severity: 'warning',
      category: 'billing',
      title: 'Paid amount exists without matching payment records',
      detail: 'The order shows money collected, but no payment record was found in this audit context. Reconcile before relying on this record for collections or reporting.',
      evidence_ids: [paymentEvidence],
      record_refs: [orderRef],
    });
  }

  if (!context.tables?.invoices_available) {
    assumptions.push('Invoice records were not included because the invoices table is unavailable in this environment.');
  } else if (order?.id && job.status === 'completed' && Number(order.amount_due_cents || 0) > 0 && invoices.length === 0) {
    const invoiceEvidence = evidence.add({
      record_type: 'order',
      record_id: order.id,
      field: 'invoices',
      label: 'Invoice records',
      value: 'No invoice records were found for a completed job with money still due.',
    });
    pushFinding({
      id: 'invoice_missing_for_completed_job',
      severity: 'critical',
      category: 'billing',
      title: 'Invoice draft has not been created yet',
      detail: 'The work is complete and balance is still open, but no invoice record is attached to the linked order.',
      evidence_ids: [invoiceEvidence, orderMoneyEvidenceId].filter(Boolean),
      record_refs: [jobRef, orderRef],
    });
    pushBlocker({
      id: 'invoice_missing_for_completed_job',
      title: 'Create the invoice draft',
      detail: 'Generate the invoice from the linked order before collections or final payment follow-up starts.',
      evidence_ids: [invoiceEvidence, orderMoneyEvidenceId].filter(Boolean),
      record_refs: [jobRef, orderRef],
    });
    pushAction({
      id: 'create_invoice_draft',
      title: 'Create the invoice draft on the linked order',
      detail: 'Generate the invoice now so the balance, line items, and customer-facing follow-up stay tied to the completed work.',
      priority: 'high',
      suggested_ui_action: 'open_order',
      evidence_ids: [invoiceEvidence, orderMoneyEvidenceId].filter(Boolean),
      record_refs: [jobRef, orderRef],
    });
  } else if (invoices.length) {
    const latestInvoice = [...invoices].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
    const invoiceEvidence = evidence.add({
      record_type: 'invoice',
      record_id: latestInvoice.id,
      field: 'status',
      label: 'Latest invoice',
      value: `status ${latestInvoice.status || 'unknown'} | total ${money(latestInvoice.total_cents || 0)}${latestInvoice.due_date ? ` | due ${latestInvoice.due_date}` : ''}`,
    });
    pushFinding({
      id: 'invoice_record_present',
      severity: 'info',
      category: 'billing',
      title: 'Invoice record is already attached',
      detail: `An invoice record already exists for this work and is currently marked ${latestInvoice.status || 'draft'}.`,
      evidence_ids: [invoiceEvidence],
      record_refs: [orderRef],
    });
  }

  const uninvoicedManifests = confirmedUninvoicedManifests(manifests);
  if (uninvoicedManifests.length) {
    const manifestEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'waste_manifests',
      label: 'Confirmed uninvoiced manifests',
      value: `${uninvoicedManifests.length} confirmed manifest(s) are still not marked invoiced.`,
    });
    pushFinding({
      id: 'hydrovac_uninvoiced_manifests',
      severity: 'critical',
      category: 'billing',
      title: 'Confirmed disposal work still needs invoice sync',
      detail: 'At least one confirmed waste manifest is still not marked invoiced. Review the hydrovac invoice draft so disposal charges are not missed.',
      evidence_ids: [manifestEvidence],
      record_refs: [jobRef, orderRef],
    });
    pushBlocker({
      id: 'hydrovac_uninvoiced_manifests',
      title: 'Sync confirmed manifests into billing',
      detail: 'Generate or refresh the hydrovac invoice so confirmed disposal charges move onto the linked order.',
      evidence_ids: [manifestEvidence],
      record_refs: [jobRef, orderRef],
    });
  }

  const unresolvedAlertCount = countUnresolvedAlerts(alerts);
  if (unresolvedAlertCount > 0) {
    const alertEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'compliance_alerts',
      label: 'Open compliance alerts',
      value: `${unresolvedAlertCount} unresolved compliance alert(s) remain on this job.`,
    });
    pushFinding({
      id: 'job_unresolved_compliance_alerts',
      severity: 'critical',
      category: 'compliance',
      title: 'Open compliance alerts still need resolution',
      detail: 'This job still has unresolved compliance alerts. Clear them before treating the record as fully billing ready.',
      evidence_ids: [alertEvidence],
      record_refs: [jobRef],
    });
    pushBlocker({
      id: 'job_unresolved_compliance_alerts',
      title: 'Resolve the open compliance alerts',
      detail: 'Review and close the active compliance items so billing and audit review match the actual field record.',
      evidence_ids: [alertEvidence],
      record_refs: [jobRef],
    });
  }

  if (expenses.length) {
    const expenseEvidence = evidence.add({
      record_type: 'job',
      record_id: job.id,
      field: 'expenses',
      label: 'Tracked job costs',
      value: `${expenses.length} linked expense record(s) totaling ${money(expenses.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0))}.`,
    });
    pushFinding({
      id: 'job_cost_records_present',
      severity: 'info',
      category: 'costing',
      title: 'Job costs are linked to this work record',
      detail: 'This job already has linked cost records, which helps the billing review stay grounded in actual labor, materials, or vendor spend.',
      evidence_ids: [expenseEvidence],
      record_refs: [jobRef, orderRef],
    });
  }

  if (payments.length) {
    const latestPayment = [...payments].sort((a, b) => new Date(b.received_at || b.paid_at || b.created_at || 0).getTime() - new Date(a.received_at || a.paid_at || a.created_at || 0).getTime())[0];
    const paymentEvidence = evidence.add({
      record_type: 'payment',
      record_id: latestPayment.id,
      field: 'status',
      label: 'Latest payment',
      value: `${latestPayment.status || 'unknown'} | ${money(latestPayment.amount_total || latestPayment.amount_subtotal || 0)} | ${fmtDate(latestPayment.received_at || latestPayment.paid_at || latestPayment.created_at)}`,
    });
    pushFinding({
      id: 'payment_records_present',
      severity: 'info',
      category: 'billing',
      title: 'Payment history is attached',
      detail: 'At least one payment record is linked to this job or its order, which helps the office reconcile what is still due.',
      evidence_ids: [paymentEvidence],
      record_refs: [orderRef].filter(Boolean),
    });
  }

  if (blockers.some((item) => ['job_missing_after_photo', 'job_missing_signature', 'job_missing_closeout_note'].includes(item.id))) {
    pushAction({
      id: 'capture_closeout_proof',
      title: 'Capture the missing closeout proof before invoicing',
      detail: 'Finish the photo, signature, and note package so the billed record can stand up on its own without extra explanation later.',
      priority: 'high',
      suggested_ui_action: 'job_closeout',
      evidence_ids: [proofEvidenceId],
      record_refs: [jobRef],
    });
  }

  if (order?.id && Number(order.amount_due_cents || 0) > 0 && invoices.length) {
    pushAction({
      id: 'review_invoice_send_status',
      title: 'Review the invoice send and follow-up status',
      detail: 'The balance is still open and an invoice record exists. Confirm whether it should be sent, reminded, or kept in draft pending review.',
      priority: 'medium',
      suggested_ui_action: 'open_order',
      evidence_ids: [orderMoneyEvidenceId].filter(Boolean),
      record_refs: [orderRef],
    });
  }

  if (!blockers.length) {
    pushFinding({
      id: 'job_billing_ready',
      severity: 'info',
      category: 'billing',
      title: 'No billing blockers were found in this audit',
      detail: 'The linked records, proof package, and money state do not show a structural blocker right now. The office can move to invoice review or payment follow-through.',
      evidence_ids: [statusEvidenceId, proofEvidenceId].filter(Boolean),
      record_refs: [jobRef, orderRef].filter(Boolean),
    });
  }

  const readinessScore = Math.max(0, Math.round(((10 - Math.min(10, blockers.length)) / 10) * 100));
  const readinessStatus = blockers.length ? 'blocked' : (missingData.length ? 'review_needed' : 'ready');
  const confidenceScore = calculateConfidence(context, blockers.length, missingData.length);
  const summary = blockers.length
    ? `${job.title || 'This job'} is not billing ready yet. ${blockers.length} blocker${blockers.length === 1 ? '' : 's'} still need attention before the office should treat the closeout as invoice-ready.`
    : `${job.title || 'This job'} looks ${readinessStatus === 'ready' ? 'billing ready' : 'close to billing ready'}. The audit found no structural blocker, but the office should still review the linked proof and money state before sending anything customer-facing.`;

  return {
    agent_key: 'job_record_auditor',
    agent_label: 'Job Record Auditor',
    summary,
    summary_status: readinessStatus,
    findings,
    blockers,
    evidence: evidence.list(),
    assumptions,
    missing_data: missingData,
    confidence: {
      score: confidenceScore,
      rationale: 'Confidence rises when the job, linked order, proof photos, payments, expenses, invoices, and time records are all available in the audit context.',
    },
    recommended_actions: recommendedActions,
    data_used: context.data_used || [],
    scope: {
      job_id: job.id || '',
      order_id: order?.id || '',
      customer_id: customer?.id || job.customer_id || order?.customer_id || '',
      tenant_id: context.tenant_id || '',
    },
    billing_readiness: {
      ready: readinessStatus === 'ready',
      status: readinessStatus,
      score: readinessScore,
      rationale: blockers.length
        ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} are still open on the closeout package or linked billing records.`
        : 'The linked closeout and billing records do not show a structural blocker right now.',
    },
    generated_at: new Date().toISOString(),
  };
}

async function runJobRecordAuditor({ supabase, tenantId, input }) {
  const jobId = String(input?.job_id || '').trim();
  if (!jobId) {
    const err = new Error('job_id is required for job_record_auditor');
    err.statusCode = 400;
    throw err;
  }

  const context = await getJobRecordAuditContext(supabase, tenantId, jobId);
  return {
    report: analyzeJobRecordAudit(context),
    tools_used: ['get_job_record_audit_context'],
    context_summary: {
      job_id: jobId,
      order_id: context.order?.id || '',
      photos: Array.isArray(context.photos) ? context.photos.length : 0,
      payments: Array.isArray(context.payments) ? context.payments.length : 0,
      invoices: Array.isArray(context.invoices) ? context.invoices.length : 0,
    },
  };
}

module.exports = {
  analyzeJobRecordAudit,
  runJobRecordAuditor,
};
