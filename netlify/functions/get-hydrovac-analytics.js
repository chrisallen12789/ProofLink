// netlify/functions/get-hydrovac-analytics.js
// GET /.netlify/functions/get-hydrovac-analytics
// Operator authenticated. Returns hydrovac-specific analytics for the tenant.
// Query params: ?days=30 (default 90)

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

function calcHydrovacRevenue(job) {
  const bh   = Math.max(job.billable_hours || 0, job.minimum_hours || 2);
  const mult = job.after_hours_multiplier || 1.0;
  const rate = (job.hourly_truck_rate_cents || 0) + (job.hourly_operator_rate_cents || 0);
  return Math.round(bh * mult * rate)
    + (job.mobilization_fee_cents || 0)
    + (job.disposal_cost_cents    || 0);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId } = ctx;
  const adminSb = getAdminClient();
  const params  = event.queryStringParameters || {};

  // Parse days param — default 90, max 365
  let days = parseInt(params.days, 10);
  if (!Number.isFinite(days) || days <= 0) days = 90;
  if (days > 365) days = 365;

  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // ── Fetch completed hydrovac jobs ─────────────────────────────────────────
  const { data: jobs, error: jobsErr } = await adminSb
    .from('jobs')
    .select([
      'id', 'service_type', 'equipment_id',
      'billable_hours', 'minimum_hours', 'travel_hours',
      'hourly_truck_rate_cents', 'hourly_operator_rate_cents', 'after_hours_multiplier',
      'mobilization_fee_cents', 'disposal_cost_cents',
      'actual_start_at', 'actual_end_at', 'scheduled_date', 'order_id',
    ].join(', '))
    .eq('tenant_id', tenantId)
    .not('service_type', 'is', null)
    .eq('status', 'completed')
    .gte('actual_end_at', sinceDate);

  if (jobsErr) return respond(500, { error: jobsErr.message });

  const jobList = jobs || [];

  // ── Fetch expenses linked to those jobs ───────────────────────────────────
  const jobIds = jobList.map((j) => j.id);
  let expensesByJob = {};

  if (jobIds.length > 0) {
    const { data: expenses, error: expErr } = await adminSb
      .from('expenses')
      .select('job_id, amount_cents')
      .in('job_id', jobIds);

    if (!expErr && expenses) {
      for (const exp of expenses) {
        if (!expensesByJob[exp.job_id]) expensesByJob[exp.job_id] = 0;
        expensesByJob[exp.job_id] += exp.amount_cents || 0;
      }
    }
  }

  // ── Fetch equipment records referenced by jobs ────────────────────────────
  const equipmentIds = [...new Set(jobList.map((j) => j.equipment_id).filter(Boolean))];
  let equipmentMap = {};

  if (equipmentIds.length > 0) {
    const { data: equipRows, error: equipErr } = await adminSb
      .from('equipment')
      .select('id, name, equipment_type')
      .in('id', equipmentIds);

    if (!equipErr && equipRows) {
      for (const eq of equipRows) {
        equipmentMap[eq.id] = eq;
      }
    }
  }

  // ── Compute aggregates ────────────────────────────────────────────────────
  let total_revenue_cents        = 0;
  let total_disposal_cost_cents  = 0;
  let total_mobilization_cents   = 0;
  let sum_billable_hours         = 0;
  let billable_hours_count       = 0;
  let total_cost_cents           = 0;
  let _jobs_with_cost            = 0;

  const by_service_type = {};
  const by_equipment    = {};

  for (const job of jobList) {
    const revenue = calcHydrovacRevenue(job);
    total_revenue_cents       += revenue;
    total_disposal_cost_cents += job.disposal_cost_cents    || 0;
    total_mobilization_cents  += job.mobilization_fee_cents || 0;

    const bh = job.billable_hours;
    if (bh != null && bh >= 0) {
      sum_billable_hours += Number(bh);
      billable_hours_count++;
    }

    // Cost (expenses) tracking for margin
    const cost = expensesByJob[job.id] || 0;
    if (cost > 0) {
      total_cost_cents += cost;
      _jobs_with_cost++;
    }

    // by_service_type
    const stype = job.service_type || 'unknown';
    if (!by_service_type[stype]) {
      by_service_type[stype] = { count: 0, revenue_cents: 0, avg_hours: 0, _hours_sum: 0, _hours_count: 0 };
    }
    by_service_type[stype].count++;
    by_service_type[stype].revenue_cents += revenue;
    if (bh != null && bh >= 0) {
      by_service_type[stype]._hours_sum   += Number(bh);
      by_service_type[stype]._hours_count++;
    }

    // by_equipment
    if (job.equipment_id) {
      if (!by_equipment[job.equipment_id]) {
        const eq = equipmentMap[job.equipment_id] || {};
        by_equipment[job.equipment_id] = {
          name          : eq.name || null,
          equipment_type: eq.equipment_type || null,
          count         : 0,
          revenue_cents : 0,
          avg_hours     : 0,
          _hours_sum    : 0,
          _hours_count  : 0,
        };
      }
      by_equipment[job.equipment_id].count++;
      by_equipment[job.equipment_id].revenue_cents += revenue;
      if (bh != null && bh >= 0) {
        by_equipment[job.equipment_id]._hours_sum   += Number(bh);
        by_equipment[job.equipment_id]._hours_count++;
      }
    }
  }

  // Finalise avg_hours in by_service_type
  for (const key of Object.keys(by_service_type)) {
    const entry = by_service_type[key];
    entry.avg_hours = entry._hours_count > 0
      ? Math.round((entry._hours_sum / entry._hours_count) * 100) / 100
      : 0;
    delete entry._hours_sum;
    delete entry._hours_count;
  }

  // Finalise avg_hours in by_equipment
  for (const key of Object.keys(by_equipment)) {
    const entry = by_equipment[key];
    entry.avg_hours = entry._hours_count > 0
      ? Math.round((entry._hours_sum / entry._hours_count) * 100) / 100
      : 0;
    delete entry._hours_sum;
    delete entry._hours_count;
  }

  const total_jobs           = jobList.length;
  const avg_billable_hours   = billable_hours_count > 0
    ? Math.round((sum_billable_hours / billable_hours_count) * 100) / 100
    : 0;
  const avg_revenue_per_job_cents = total_jobs > 0
    ? Math.round(total_revenue_cents / total_jobs)
    : 0;

  // avg_job_margin: (revenue - cost) / revenue — only when cost data available
  let avg_job_margin = null;
  if (total_cost_cents > 0 && total_revenue_cents > 0) {
    avg_job_margin = Math.round(
      ((total_revenue_cents - total_cost_cents) / total_revenue_cents) * 10000
    ) / 10000; // 4 decimal places (e.g. 0.6523 = 65.23%)
  }

  return respond(200, {
    analytics: {
      total_revenue_cents,
      total_jobs,
      avg_billable_hours,
      avg_revenue_per_job_cents,
      total_disposal_cost_cents,
      total_mobilization_cents,
      by_service_type,
      by_equipment,
      avg_job_margin,
    },
    period_days: days,
  });
};
