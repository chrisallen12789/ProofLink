// netlify/functions/get-team-hours.js
// Returns aggregated hours for all team members in the tenant, optionally filtered by date range.
// GET /?start=2026-03-01&end=2026-03-31
// Defaults: start = first day of current month, end = today.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

/**
 * Parse a YYYY-MM-DD string and return a Date set to midnight UTC.
 * Returns null if the string is not a valid date.
 */
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // Verify the date didn't roll over (e.g. Feb 30)
  if (
    d.getUTCFullYear() !== Number(match[1]) ||
    d.getUTCMonth() !== Number(match[2]) - 1 ||
    d.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return d;
}

/** Format a Date as YYYY-MM-DD (UTC). */
function toDateString(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  // --- Date range defaults ---
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const params = event.queryStringParameters || {};

  let startDate = parseDate(String(params.start || '').trim());
  let endDate   = parseDate(String(params.end   || '').trim());

  if (params.start && !startDate) {
    return respond(400, { error: 'Invalid start date — expected YYYY-MM-DD' });
  }
  if (params.end && !endDate) {
    return respond(400, { error: 'Invalid end date — expected YYYY-MM-DD' });
  }

  if (!startDate) startDate = defaultStart;
  if (!endDate)   endDate   = defaultEnd;

  // Build ISO strings for Supabase range queries.
  // start: beginning of start day (00:00:00Z)
  // end:   end of end day (23:59:59.999Z)
  const startIso = startDate.toISOString();                               // e.g. 2026-03-01T00:00:00.000Z
  const endIso   = new Date(endDate.getTime() + 86399999).toISOString();  // +23h 59m 59.999s

  const startLabel = toDateString(startDate);
  const endLabel   = toDateString(endDate);

  // --- 1. Fetch active operator_members ---
  const { data: membersData, error: membersError } = await supabase
    .from('operator_members')
    .select('id, user_id, name, role, hourly_rate_cents, email')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (membersError) {
    console.error('[get-team-hours] members fetch error', membersError);
    return respond(500, { error: 'Failed to fetch team members' });
  }

  const members = membersData || [];

  // --- 2. Fetch time_entries in range ---
  const { data: entriesData, error: entriesError } = await supabase
    .from('time_entries')
    .select('id, operator_id, order_id, customer_id, booking_id, description, duration_minutes, billable, hourly_rate_cents, started_at, ended_at, created_at')
    .eq('tenant_id', tenantId)
    .gte('started_at', startIso)
    .lte('started_at', endIso)
    .order('started_at', { ascending: false });

  if (entriesError) {
    console.error('[get-team-hours] time_entries fetch error', entriesError);
    return respond(500, { error: 'Failed to fetch time entries' });
  }

  const allEntries = entriesData || [];

  // --- 3. Fetch jobs with actual_start_at in range ---
  const { data: jobsData, error: jobsError } = await supabase
    .from('jobs')
    .select('id, title, assigned_operator_id, actual_start_at, actual_end_at, billable_hours, status, customer_name')
    .eq('tenant_id', tenantId)
    .not('actual_start_at', 'is', null)
    .gte('actual_start_at', startIso)
    .lte('actual_start_at', endIso);

  if (jobsError) {
    console.error('[get-team-hours] jobs fetch error', jobsError);
    return respond(500, { error: 'Failed to fetch jobs' });
  }

  const allJobs = jobsData || [];

  // --- 4. Aggregate per member ---
  let totalMinutes     = 0;
  let totalBillable    = 0;
  let totalPayCents    = 0;

  const aggregated = members.map((member) => {
    // Time entries belonging to this member
    const memberEntries = allEntries.filter((e) => e.operator_id === member.user_id);

    let total_minutes       = 0;
    let billable_minutes    = 0;
    let non_billable_minutes = 0;

    for (const entry of memberEntries) {
      const mins = typeof entry.duration_minutes === 'number' ? entry.duration_minutes : 0;
      total_minutes += mins;
      if (entry.billable) {
        billable_minutes += mins;
      } else {
        non_billable_minutes += mins;
      }
    }

    // Jobs assigned to this member (match by either member.id or member.user_id)
    const memberJobs = allJobs.filter(
      (j) => j.assigned_operator_id === member.id || j.assigned_operator_id === member.user_id
    );

    let job_minutes = 0;
    for (const job of memberJobs) {
      if (job.actual_end_at) {
        const diffMs = new Date(job.actual_end_at) - new Date(job.actual_start_at);
        if (diffMs > 0) {
          job_minutes += Math.round(diffMs / 60000);
        }
      }
    }

    const effective_rate_cents  = member.hourly_rate_cents || 0;
    const estimated_pay_cents   = Math.round((total_minutes / 60) * effective_rate_cents);

    totalMinutes  += total_minutes;
    totalBillable += billable_minutes;
    totalPayCents += estimated_pay_cents;

    return {
      id                  : member.id,
      user_id             : member.user_id,
      name                : member.name,
      role                : member.role,
      hourly_rate_cents   : member.hourly_rate_cents || 0,
      email               : member.email,
      total_minutes,
      billable_minutes,
      non_billable_minutes,
      entry_count         : memberEntries.length,
      job_minutes,
      job_count           : memberJobs.length,
      effective_rate_cents,
      estimated_pay_cents,
      entries             : memberEntries,
      jobs                : memberJobs.map((j) => ({
        id              : j.id,
        title           : j.title,
        customer_name   : j.customer_name,
        actual_start_at : j.actual_start_at,
        actual_end_at   : j.actual_end_at,
        billable_hours  : j.billable_hours,
        status          : j.status,
      })),
    };
  });

  return respond(200, {
    ok     : true,
    start  : startLabel,
    end    : endLabel,
    members: aggregated,
    totals : {
      total_minutes       : totalMinutes,
      billable_minutes    : totalBillable,
      estimated_pay_cents : totalPayCents,
      member_count        : members.length,
    },
  });
};
