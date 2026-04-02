'use strict';

const { buildRecordRef, createEvidenceBuilder } = require('../evidence');
const { getQuoteRescueManagerContext } = require('../tools');

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(value) {
  const date = parseDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function customerMap(rows = []) {
  return new Map((rows || []).map((row) => [String(row?.id || '').trim(), row]));
}

function firstText(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function buildBidRecord(row = {}, customersById) {
  const customer = customersById.get(String(row?.customer_id || '').trim()) || null;
  const status = String(row?.status || '').trim().toLowerCase();
  const candidateStatuses = new Set(['ready_to_send', 'sent', 'approved']);
  const expired = !!(parseDate(row?.valid_until) && parseDate(row?.valid_until).getTime() < Date.now());
  const approvedNotConverted = status === 'approved' && !String(row?.converted_order_id || '').trim();
  if (!candidateStatuses.has(status) && !expired) return null;
  return {
    id: row.id,
    record_type: 'bid',
    customer_id: row.customer_id || '',
    customer_name: customer?.name || customer?.company_name || 'Customer',
    title: row.title || 'Proposal',
    status,
    valid_until: row.valid_until || '',
    amount_cents: Number(row.total_cents || 0),
    age_days: daysSince(row.updated_at || row.created_at),
    expired,
    approved_not_converted: approvedNotConverted,
    has_scope_detail: !!firstText(row.project_summary, row.scope_of_work, row.cover_note, row.service_address),
    has_pricing: Number(row.total_cents || 0) > 0,
    location_label: row.service_address || '',
  };
}

function buildQuoteRecord(row = {}, customersById) {
  const customer = customersById.get(String(row?.customer_id || '').trim()) || null;
  const status = String(row?.status || '').trim().toLowerCase();
  const candidateStatuses = new Set(['pending', 'sent', 'accepted', 'approved', 'expired']);
  const expired = status === 'expired'
    || !!(parseDate(row?.valid_until) && parseDate(row?.valid_until).getTime() < Date.now());
  const approvedNotConverted = new Set(['accepted', 'approved']).has(status) && !String(row?.order_id || '').trim();
  if (!candidateStatuses.has(status)) return null;
  return {
    id: row.id,
    record_type: 'quote',
    customer_id: row.customer_id || '',
    customer_name: customer?.name || customer?.company_name || row.customer_name || 'Customer',
    title: row.title || 'Quote',
    status,
    valid_until: row.valid_until || '',
    amount_cents: Number(row.amount_cents || 0),
    age_days: daysSince(row.updated_at || row.created_at),
    expired,
    approved_not_converted: approvedNotConverted,
    has_scope_detail: !!firstText(row.title, row.description, row.notes),
    has_pricing: Number(row.amount_cents || 0) > 0,
    location_label: '',
  };
}

function bucketRecord(record) {
  if (record.expired || record.age_days >= 21 || (record.approved_not_converted && record.age_days >= 7)) {
    return 'stale_enough_to_rework';
  }
  if (!record.has_scope_detail || !record.has_pricing) {
    return 'missing_estimate_facts';
  }
  if (record.age_days >= 3 || record.approved_not_converted) {
    return 'ready_to_follow_up';
  }
  return 'waiting_on_customer_decision';
}

function severityForBucket(bucket) {
  if (bucket === 'stale_enough_to_rework') return 'warning';
  if (bucket === 'missing_estimate_facts') return 'warning';
  if (bucket === 'ready_to_follow_up') return 'info';
  return 'info';
}

async function runQuoteRescueManager({ supabase, tenantId }) {
  const context = await getQuoteRescueManagerContext(supabase, tenantId);
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const actions = [];
  const customersById = customerMap(context.customers || []);

  const records = [
    ...(context.bids || []).map((row) => buildBidRecord(row, customersById)).filter(Boolean),
    ...(context.quotes || []).map((row) => buildQuoteRecord(row, customersById)).filter(Boolean),
  ].sort((a, b) => b.age_days - a.age_days);

  const buckets = {
    ready_to_follow_up: [],
    missing_estimate_facts: [],
    waiting_on_customer_decision: [],
    stale_enough_to_rework: [],
  };
  records.forEach((record) => {
    buckets[bucketRecord(record)].push(record);
  });

  Object.entries(buckets).forEach(([bucketKey, rows]) => {
    rows.slice(0, 3).forEach((record, index) => {
      const evidenceId = evidence.add({
        record_type: record.record_type,
        record_id: record.id,
        field: 'quote_rescue_status',
        label: `Quote rescue ${bucketKey.replace(/_/g, ' ')}`,
        value: `${record.customer_name} | ${record.title} | ${record.status} | ${record.valid_until ? `valid through ${record.valid_until}` : 'no validity date'} | ${record.amount_cents ? money(record.amount_cents) : 'pricing still missing'}`,
      });
      const recordRefs = [buildRecordRef(record.record_type, record.id, record.title)];
      if (record.customer_id) recordRefs.push(buildRecordRef('customer', record.customer_id, record.customer_name));
      findings.push({
        id: `quote_rescue_${bucketKey}_${index + 1}`,
        severity: severityForBucket(bucketKey),
        category: bucketKey,
        title: `${record.customer_name} needs ${bucketKey === 'ready_to_follow_up'
          ? 'a follow-up'
          : bucketKey === 'missing_estimate_facts'
            ? 'estimate cleanup'
            : bucketKey === 'waiting_on_customer_decision'
              ? 'decision time'
              : 'a proposal refresh'}`,
        detail: bucketKey === 'ready_to_follow_up'
          ? `This ${record.record_type} is still open, has grounded scope and pricing, and has been quiet for ${record.age_days} day(s).`
          : bucketKey === 'missing_estimate_facts'
            ? `This ${record.record_type} is still active, but the stored record is missing either scope detail or priced facts, so follow-up should be paired with estimate cleanup.`
            : bucketKey === 'waiting_on_customer_decision'
              ? `This ${record.record_type} is still within the current decision window, so it should be tracked but does not yet look like a cold follow-up.`
              : `This ${record.record_type} has gone stale enough that the safer move is to rework the proposal before another send.`,
        evidence_ids: [evidenceId],
        record_refs: recordRefs,
      });
    });
  });

  if (buckets.missing_estimate_facts.length) {
    blockers.push({
      id: 'quote_rescue_missing_estimate_facts',
      title: 'Some live quotes still need estimate cleanup first',
      detail: 'The rescue queue includes active proposal records that are missing scope or pricing proof. Tighten those records before the next follow-up goes out.',
      evidence_ids: evidence.list().slice(0, 2).map((item) => item.id),
      record_refs: findings
        .filter((item) => item.category === 'missing_estimate_facts')
        .flatMap((item) => item.record_refs || [])
        .slice(0, 4),
    });
  }

  if (buckets.stale_enough_to_rework.length) {
    blockers.push({
      id: 'quote_rescue_stale_rework_needed',
      title: 'Part of the quote queue is stale enough to rework',
      detail: 'Some proposal records are past their best follow-up window or already expired, so the operator should tighten scope, validity, or pricing before another send.',
      evidence_ids: evidence.list().slice(0, 2).map((item) => item.id),
      record_refs: findings
        .filter((item) => item.category === 'stale_enough_to_rework')
        .flatMap((item) => item.record_refs || [])
        .slice(0, 4),
    });
  }

  actions.push({
    id: 'quote_rescue_follow_up_ready_queue',
    title: 'Work the ready-to-follow-up queue first',
    detail: 'Start with proposal records that already have grounded scope and pricing, then make customer contact while the quote is still current.',
    priority: buckets.ready_to_follow_up.length ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'open_bids',
    evidence_ids: findings
      .filter((item) => item.category === 'ready_to_follow_up')
      .map((item) => item.evidence_ids?.[0])
      .filter(Boolean)
      .slice(0, 3),
    record_refs: findings
      .filter((item) => item.category === 'ready_to_follow_up')
      .flatMap((item) => item.record_refs || [])
      .slice(0, 4),
  });
  actions.push({
    id: 'quote_rescue_fix_estimate_facts',
    title: 'Tighten missing estimate facts before chasing the customer',
    detail: 'When scope or pricing proof is weak, correct the record first so the follow-up does not force the customer to guess what is included.',
    priority: buckets.missing_estimate_facts.length ? 'high' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'open_bids',
    evidence_ids: findings
      .filter((item) => item.category === 'missing_estimate_facts')
      .map((item) => item.evidence_ids?.[0])
      .filter(Boolean)
      .slice(0, 3),
    record_refs: findings
      .filter((item) => item.category === 'missing_estimate_facts')
      .flatMap((item) => item.record_refs || [])
      .slice(0, 4),
  });
  actions.push({
    id: 'quote_rescue_rework_stale_records',
    title: 'Rework stale or expired proposal records before re-sending',
    detail: 'Expired or cold records should come back with a sharper scope, new timing, or updated pricing context before the next outreach.',
    priority: buckets.stale_enough_to_rework.length ? 'medium' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'open_quotes',
    evidence_ids: findings
      .filter((item) => item.category === 'stale_enough_to_rework')
      .map((item) => item.evidence_ids?.[0])
      .filter(Boolean)
      .slice(0, 3),
    record_refs: findings
      .filter((item) => item.category === 'stale_enough_to_rework')
      .flatMap((item) => item.record_refs || [])
      .slice(0, 4),
  });

  return {
    report: {
      agent_key: 'quote_rescue_manager',
      agent_label: 'Quote Rescue Manager',
      summary: records.length
        ? `The quote and proposal queue has ${records.length} active rescue candidate(s). ProofLink separated follow-up-ready records, estimate cleanup work, live decision-window items, and stale records that should be reworked before another send.`
        : 'No quote or proposal records currently match the rescue queue conditions.',
      summary_status: blockers.length ? 'blocked' : (records.length ? 'review_needed' : 'ready'),
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: context.assumptions || [],
      missing_data: [],
      confidence: {
        score: records.length ? 0.76 : 0.69,
        rationale: 'Confidence depends on whether quote, proposal, customer, status, validity, and pricing fields are all present together.',
      },
      recommended_actions: actions,
      data_used: context.data_used || [],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['get_quote_rescue_manager_context'],
    context_summary: {
      total_records: records.length,
      ready_to_follow_up: buckets.ready_to_follow_up.length,
      missing_estimate_facts: buckets.missing_estimate_facts.length,
      waiting_on_customer_decision: buckets.waiting_on_customer_decision.length,
      stale_enough_to_rework: buckets.stale_enough_to_rework.length,
    },
  };
}

module.exports = { runQuoteRescueManager };
