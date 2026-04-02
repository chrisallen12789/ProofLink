'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getCollectionsFollowUpContext } = require('../tools');

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPastDate(value) {
  const date = parseDate(value);
  return date ? date.getTime() < Date.now() : false;
}

function overdueAgeDays(value) {
  const date = parseDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

async function runCollectionsFollowUpAssistant({ supabase, tenantId, input }) {
  const context = await getCollectionsFollowUpContext(supabase, tenantId, input || {});
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];
  const missingData = [];

  const queue = (context.open_balances || []).map((item) => {
    const dueAt = item.invoice_due_date || item.payment_due_date || '';
    const overdue = isPastDate(dueAt);
    return {
      ...item,
      due_at: dueAt,
      overdue,
      overdue_days: overdue ? overdueAgeDays(dueAt) : 0,
    };
  }).sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return Number(b.amount_due_cents || 0) - Number(a.amount_due_cents || 0);
  });
  const undatedQueueItems = queue.filter((item) => !item.due_at);

  queue.slice(0, 8).forEach((item, index) => {
    const queueEvidence = evidence.add({
      record_type: 'order',
      record_id: item.order_id,
      field: 'amount_due_cents',
      label: `Collections queue item ${index + 1}`,
      value: `${item.customer_name || 'Customer'} | ${money(item.amount_due_cents || 0)} due | ${item.overdue ? `overdue ${item.overdue_days} day(s)` : item.due_at ? 'open balance with due date' : 'open balance without a proved due date'}`,
    });
    const recordRefs = [buildRecordRef('order', item.order_id, item.order_title || item.customer_name || 'Order')];
    if (item.customer_id) {
      recordRefs.push(buildRecordRef('customer', item.customer_id, item.customer_name || 'Customer'));
    }
    findings.push({
      id: `collections_item_${index + 1}`,
      severity: item.overdue && item.overdue_days >= 30 ? 'critical' : item.overdue ? 'warning' : 'info',
      category: 'collections',
      title: `${item.customer_name || 'Customer'} has ${item.overdue ? 'an overdue balance' : 'an open balance'}`,
      detail: item.overdue
        ? `The linked order has a proved due date in the past and still shows ${money(item.amount_due_cents || 0)} outstanding${item.invoice_status ? ` with invoice status ${item.invoice_status}` : ''}.`
        : item.due_at
          ? `The linked order still shows ${money(item.amount_due_cents || 0)} outstanding and has a due date on file, but it is not yet past due.`
          : `The linked order still shows ${money(item.amount_due_cents || 0)} outstanding. No overdue claim was made because the current records do not prove that yet.`,
      evidence_ids: [queueEvidence],
      record_refs: recordRefs,
    });
  });

  if (queue.some((item) => item.overdue)) {
    blockers.push({
      id: 'collections_overdue_balances',
      title: 'At least one overdue balance needs follow-up',
      detail: 'The queue includes orders with past due dates and open balances, so a grounded follow-up pass should happen soon.',
      evidence_ids: evidence.list().slice(0, 1).map((item) => item.id),
      record_refs: queue.filter((item) => item.overdue).slice(0, 3).map((item) => buildRecordRef('order', item.order_id, item.order_title || item.customer_name || 'Order')),
    });
  }

  if (undatedQueueItems.length) {
    missingData.push({
      id: 'collections_missing_due_dates',
      label: 'Some balances do not have a proved due date',
      detail: `${undatedQueueItems.length} queue item(s) are still open without an invoice due date or payment due date on file.`,
      field: 'invoice_due_date',
      required_for: 'overdue_followup',
    });
  }

  actions.push({
    id: 'collections_review_queue',
    title: 'Review the collections queue without overstating status',
    detail: 'Start with orders that have a real due date in the past. For open balances without a proved overdue date, use softer payment follow-up language and avoid claiming the invoice is overdue.',
    priority: queue.some((item) => item.overdue) ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'open_payments',
    evidence_ids: evidence.list().slice(0, 3).map((item) => item.id),
    record_refs: queue.slice(0, 4).map((item) => buildRecordRef('order', item.order_id, item.order_title || item.customer_name || 'Order')),
  });
  actions.push({
    id: 'collections_attach_due_dates',
    title: 'Attach missing due dates before escalating the language',
    detail: 'When an open balance does not have a due date in the record, fix the invoice or order timing first so the follow-up can stay factual.',
    priority: undatedQueueItems.length ? 'medium' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'open_orders',
    evidence_ids: evidence.list().slice(0, 2).map((item) => item.id),
    record_refs: undatedQueueItems.slice(0, 3).map((item) => buildRecordRef('order', item.order_id, item.order_title || item.customer_name || 'Order')),
  });

  return {
    report: {
      agent_key: 'collections_followup_assistant',
      agent_label: 'Collections / Follow-up Assistant',
      summary: queue.length
        ? `The collections queue has ${queue.length} open balance record(s). The assistant separated genuinely overdue balances from general open balances so follow-up language stays accurate.`
        : 'No open balance records were returned for the current collections context.',
      summary_status: queue.some((item) => item.overdue) ? 'review_needed' : 'ready',
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: missingData,
      confidence: {
        score: undatedQueueItems.length ? 0.68 : 0.79,
        rationale: 'Confidence depends on whether due dates, invoice records, payment records, and current balances are all present in the collections context.',
      },
      recommended_actions: actions,
      data_used: context.data_used || [],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_collections_followup_context'],
    context_summary: {
      queue_length: queue.length,
      overdue_count: queue.filter((item) => item.overdue).length,
      missing_due_dates: undatedQueueItems.length,
    },
  };
}

module.exports = { runCollectionsFollowUpAssistant };
