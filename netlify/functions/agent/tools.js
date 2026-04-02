// netlify/functions/agent/tools.js
// Read-only data tools for the ProofLink AI agent.
// These functions query the database and return structured data for the agent.
// All tools are strictly scoped to the operator's tenant.
//
// Tool contract:
// - Each tool takes (supabase, tenantId) plus optional params
// - Each tool returns structured data or throws with a clear message
// - No tool writes to the database
// - No tool returns data from another tenant

'use strict';

function isMissingRelationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('relation') && message.includes('does not exist')
  ) || message.includes('could not find the table') || message.includes('schema cache');
}

async function resolveOptionalRows(queryPromise, assumptions, message, emptyValue = []) {
  const result = await queryPromise;
  if (!result?.error) return result.data || emptyValue;
  if (isMissingRelationError(result.error)) {
    assumptions.push(message);
    return emptyValue;
  }
  throw new Error(result.error.message);
}

// ── Orders ────────────────────────────────────────────────────────────────────

async function getUnpaidOrders(supabase, tenantId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_id, customer_name, customer_email, title, status, total_amount, total_cents, amount_due_cents, payment_state, payment_due_date, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .not('status', 'in', '("paid","cancelled")')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`getUnpaidOrders failed: ${error.message}`);
  return data || [];
}

async function getRecentOrders(supabase, tenantId, limit = 20) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_name, customer_email, title, status, total_amount, total_cents, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentOrders failed: ${error.message}`);
  return data || [];
}

async function getOrderById(supabase, tenantId, orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`getOrderById failed: ${error.message}`);
  return data;
}

// ── Bookings ──────────────────────────────────────────────────────────────────

async function getUpcomingBookings(supabase, tenantId, days = 7) {
  const now = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, title, starts_at, ends_at, status, notes, reminder_sent_at')
    .eq('tenant_id', tenantId)
    .gte('starts_at', now)
    .lte('starts_at', end)
    .not('status', 'in', '("cancelled")')
    .order('starts_at', { ascending: true });
  if (error) throw new Error(`getUpcomingBookings failed: ${error.message}`);
  return data || [];
}

async function getTodayBookings(supabase, tenantId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, title, starts_at, ends_at, status, notes')
    .eq('tenant_id', tenantId)
    .gte('starts_at', today + 'T00:00:00Z')
    .lte('starts_at', today + 'T23:59:59Z')
    .not('status', 'in', '("cancelled")')
    .order('starts_at', { ascending: true });
  if (error) throw new Error(`getTodayBookings failed: ${error.message}`);
  return data || [];
}

// ── Customers ─────────────────────────────────────────────────────────────────

async function getCustomers(supabase, tenantId, limit = 50) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, company_name, email, phone, notes, lifetime_value_cents, order_count, last_contact_at, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getCustomers failed: ${error.message}`);
  return data || [];
}

async function getTopCustomers(supabase, tenantId, limit = 10) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, company_name, email, phone, lifetime_value_cents, order_count, last_contact_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('lifetime_value_cents', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getTopCustomers failed: ${error.message}`);
  return data || [];
}

async function getStaleCustomers(supabase, tenantId, daysSince = 60) {
  const cutoff = new Date(Date.now() - daysSince * 86400000).toISOString();
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, company_name, email, phone, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(20);
  if (error) throw new Error(`getStaleCustomers failed: ${error.message}`);
  return data || [];
}

async function getMultiLocationCustomers(supabase, tenantId, limit = 10) {
  const { data, error } = await supabase
    .from('customer_locations')
    .select('customer_id, site_name, is_primary, customers(id, name, company_name, email, phone)')
    .eq('tenant_id', tenantId)
    .order('is_primary', { ascending: false })
    .limit(200);

  if (error) {
    if (error.message && error.message.includes('relation does not exist')) return [];
    throw new Error(`getMultiLocationCustomers failed: ${error.message}`);
  }

  const grouped = new Map();
  (data || []).forEach((row) => {
    const customer = row.customers || {};
    if (!row.customer_id) return;
    if (!grouped.has(row.customer_id)) {
      grouped.set(row.customer_id, {
        customer_id: row.customer_id,
        name: customer.company_name || customer.name || 'Unknown',
        contact_name: customer.name || '',
        email: customer.email || '',
        phone: customer.phone || '',
        site_count: 0,
        primary_site: '',
      });
    }
    const entry = grouped.get(row.customer_id);
    entry.site_count += 1;
    if (row.is_primary && row.site_name) entry.primary_site = row.site_name;
  });

  return [...grouped.values()]
    .filter((entry) => entry.site_count > 1)
    .sort((a, b) => b.site_count - a.site_count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function normalizeAgentDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function sortUpcomingJobs(rows = []) {
  return [...rows].sort((a, b) => {
    const dateA = String(a?.scheduled_date || '9999-12-31');
    const dateB = String(b?.scheduled_date || '9999-12-31');
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const timeA = String(a?.scheduled_time || '99:99');
    const timeB = String(b?.scheduled_time || '99:99');
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return String(a?.title || '').localeCompare(String(b?.title || ''));
  });
}

async function getUpcomingJobs(supabase, tenantId, days = 7, limit = 20, options = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = normalizeAgentDate(options.startDate) || today;
  const endDate = normalizeAgentDate(options.endDate) || new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const includeUnscheduled = options.includeUnscheduled !== false;
  const jobType = String(options.jobType || '').trim().toLowerCase();
  const selectFields = [
    'id',
    'customer_id',
    'customer_name',
    'title',
    'service_address',
    'status',
    'scheduled_date',
    'scheduled_time',
    'assigned_operator_id',
    'assigned_member_id',
    'job_type',
    'updated_at',
  ].join(', ');

  let scheduledQuery = supabase
    .from('jobs')
    .select(selectFields)
    .eq('tenant_id', tenantId)
    .not('status', 'in', '("completed","cancelled","archived")')
    .gte('scheduled_date', startDate)
    .lte('scheduled_date', endDate)
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
    .limit(limit);
  if (jobType) scheduledQuery = scheduledQuery.eq('job_type', jobType);

  const { data: scheduledRows, error: scheduledError } = await scheduledQuery;
  if (scheduledError) {
    if (scheduledError.message && scheduledError.message.includes('relation does not exist')) return [];
    throw new Error(`getUpcomingJobs failed: ${scheduledError.message}`);
  }

  let unscheduledRows = [];
  if (includeUnscheduled) {
    let unscheduledQuery = supabase
      .from('jobs')
      .select(selectFields)
      .eq('tenant_id', tenantId)
      .not('status', 'in', '("completed","cancelled","archived")')
      .is('scheduled_date', null)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (jobType) unscheduledQuery = unscheduledQuery.eq('job_type', jobType);

    const { data, error } = await unscheduledQuery;
    if (error) {
      if (!error.message || !error.message.includes('relation does not exist')) {
        throw new Error(`getUpcomingJobs failed: ${error.message}`);
      }
    } else {
      unscheduledRows = data || [];
    }
  }

  const deduped = new Map();
  [...(scheduledRows || []), ...unscheduledRows].forEach((row) => {
    if (!row?.id) return;
    deduped.set(row.id, row);
  });

  return sortUpcomingJobs([...deduped.values()]).slice(0, limit);
}

// ── Payments ──────────────────────────────────────────────────────────────────

async function getRecentPayments(supabase, tenantId, limit = 20) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, customer_id, order_id, amount_total, payment_mode, status, paid_at, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentPayments failed: ${error.message}`);
  return data || [];
}

// ── Quotes ────────────────────────────────────────────────────────────────────

async function getPendingQuotes(supabase, tenantId) {
  const { data, error } = await supabase
    .from('quotes')
    .select('id, customer_name, customer_email, title, amount_cents, status, valid_until, created_at')
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'sent'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`getPendingQuotes failed: ${error.message}`);
  return data || [];
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function getUnreadMessages(supabase, tenantId) {
  const { data, error } = await supabase
    .from('customer_messages')
    .select('id, customer_name, customer_email, message, created_at, status')
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'replied')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    if (error.message && error.message.includes('relation does not exist')) return [];
    throw new Error(`getUnreadMessages failed: ${error.message}`);
  }
  return data || [];
}

async function getCollectionsContext(supabase, tenantId) {
  const [unpaidOrders, recentPayments, topCustomers] = await Promise.all([
    getUnpaidOrders(supabase, tenantId).catch(() => []),
    getRecentPayments(supabase, tenantId, 10).catch(() => []),
    getTopCustomers(supabase, tenantId, 8).catch(() => []),
  ]);

  const overdueOrders = unpaidOrders.filter((order) => {
    const daysSince = (Date.now() - new Date(order.created_at).getTime()) / 86400000;
    return daysSince > 14 && !['new', 'confirmed'].includes(order.status);
  });
  const totalUnpaidCents = unpaidOrders.reduce((sum, order) => {
    const cents = order.total_cents ?? Math.round((order.total_amount || 0) * 100);
    return sum + cents;
  }, 0);

  return {
    snapshot_at: new Date().toISOString(),
    specialist: 'collections',
    unpaid_orders: unpaidOrders,
    overdue_orders: overdueOrders,
    total_unpaid_cents: totalUnpaidCents,
    recent_payments: recentPayments,
    top_customers: topCustomers,
  };
}

async function getCrewPrepContext(supabase, tenantId) {
  const [todayBookings, upcomingBookings, upcomingJobs, multiLocationCustomers, topCustomers] = await Promise.all([
    getTodayBookings(supabase, tenantId).catch(() => []),
    getUpcomingBookings(supabase, tenantId, 7).catch(() => []),
    getUpcomingJobs(supabase, tenantId, 7, 16).catch(() => []),
    getMultiLocationCustomers(supabase, tenantId, 8).catch(() => []),
    getTopCustomers(supabase, tenantId, 6).catch(() => []),
  ]);

  return {
    snapshot_at: new Date().toISOString(),
    specialist: 'crew_prep',
    today_bookings: todayBookings,
    upcoming_bookings: upcomingBookings,
    upcoming_jobs: upcomingJobs,
    multi_location_customers: multiLocationCustomers,
    top_customers: topCustomers,
  };
}

async function getQuoteRescueContext(supabase, tenantId) {
  const [pendingQuotes, topCustomers, staleCustomers] = await Promise.all([
    getPendingQuotes(supabase, tenantId).catch(() => []),
    getTopCustomers(supabase, tenantId, 8).catch(() => []),
    getStaleCustomers(supabase, tenantId, 45).catch(() => []),
  ]);

  const expiredQuotes = pendingQuotes.filter((quote) =>
    quote.valid_until && new Date(quote.valid_until) < new Date()
  );

  return {
    snapshot_at: new Date().toISOString(),
    specialist: 'quote_rescue',
    pending_quotes: pendingQuotes,
    expired_quotes: expiredQuotes,
    top_customers: topCustomers,
    stale_customers: staleCustomers,
  };
}

async function getRetentionContext(supabase, tenantId) {
  const [staleCustomers, topCustomers, multiLocationCustomers, upcomingJobs, recentPayments] = await Promise.all([
    getStaleCustomers(supabase, tenantId, 45).catch(() => []),
    getTopCustomers(supabase, tenantId, 8).catch(() => []),
    getMultiLocationCustomers(supabase, tenantId, 8).catch(() => []),
    getUpcomingJobs(supabase, tenantId, 14, 12).catch(() => []),
    getRecentPayments(supabase, tenantId, 8).catch(() => []),
  ]);

  return {
    snapshot_at: new Date().toISOString(),
    specialist: 'retention',
    stale_customers: staleCustomers,
    top_customers: topCustomers,
    multi_location_customers: multiLocationCustomers,
    upcoming_jobs: upcomingJobs,
    recent_payments: recentPayments,
  };
}

// ── Aggregate business context ────────────────────────────────────────────────

/**
 * Builds a structured snapshot of the operator's current business state.
 * This is the primary data bundle passed to the AI for daily briefings and Q&A.
 * Runs queries in parallel for speed.
 */
async function getBusinessContext(supabase, tenantId) {
  const [
    unpaidOrders,
    todayBookings,
    upcomingBookings,
    pendingQuotes,
    recentPayments,
    unreadMessages,
    staleCustomers,
    topCustomers,
    multiLocationCustomers,
    upcomingJobs,
  ] = await Promise.all([
    getUnpaidOrders(supabase, tenantId).catch(() => []),
    getTodayBookings(supabase, tenantId).catch(() => []),
    getUpcomingBookings(supabase, tenantId, 7).catch(() => []),
    getPendingQuotes(supabase, tenantId).catch(() => []),
    getRecentPayments(supabase, tenantId, 10).catch(() => []),
    getUnreadMessages(supabase, tenantId).catch(() => []),
    getStaleCustomers(supabase, tenantId, 45).catch(() => []),
    getTopCustomers(supabase, tenantId, 8).catch(() => []),
    getMultiLocationCustomers(supabase, tenantId, 8).catch(() => []),
    getUpcomingJobs(supabase, tenantId, 7, 12).catch(() => []),
  ]);

  // Compute derived metrics
  const overdueOrders = unpaidOrders.filter((o) => {
    const daysSince = (Date.now() - new Date(o.created_at).getTime()) / 86400000;
    return daysSince > 14 && !['new', 'confirmed'].includes(o.status);
  });

  const expiredQuotes = pendingQuotes.filter((q) =>
    q.valid_until && new Date(q.valid_until) < new Date()
  );

  const totalUnpaidCents = unpaidOrders.reduce((sum, o) => {
    const cents = o.total_cents ?? Math.round((o.total_amount || 0) * 100);
    return sum + cents;
  }, 0);

  const upcomingWithoutReminder = upcomingBookings.filter((b) => {
    const hoursUntil = (new Date(b.starts_at) - Date.now()) / 3600000;
    return hoursUntil < 30 && !b.reminder_sent_at && b.customer_email;
  });

  return {
    snapshot_at       : new Date().toISOString(),
    today_bookings    : todayBookings,
    upcoming_bookings : upcomingBookings,
    unpaid_orders     : unpaidOrders,
    overdue_orders    : overdueOrders,
    total_unpaid_cents: totalUnpaidCents,
    pending_quotes    : pendingQuotes,
    expired_quotes    : expiredQuotes,
    recent_payments   : recentPayments,
    unread_messages   : unreadMessages,
    stale_customers   : staleCustomers,
    reminders_needed  : upcomingWithoutReminder,
    top_customers     : topCustomers,
    multi_location_customers: multiLocationCustomers,
    upcoming_jobs     : upcomingJobs,
  };
}

async function getAiContext(supabase, tenantId, specialist = 'general') {
  const lane = String(specialist || 'general').trim().toLowerCase();
  if (lane === 'collections') return getCollectionsContext(supabase, tenantId);
  if (lane === 'crew_prep') return getCrewPrepContext(supabase, tenantId);
  if (lane === 'quote_rescue') return getQuoteRescueContext(supabase, tenantId);
  if (lane === 'retention') return getRetentionContext(supabase, tenantId);
  return getBusinessContext(supabase, tenantId);
}

async function getJobRecordAuditContext(supabase, tenantId, jobId) {
  const assumptions = [];
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', jobId)
    .maybeSingle();

  if (jobError) throw new Error(`getJobRecordAuditContext failed: ${jobError.message}`);
  if (!job) {
    const err = new Error('Job not found');
    err.statusCode = 404;
    throw err;
  }

  const customerId = job.customer_id || null;
  const orderId = job.order_id || null;
  const locationId = job.customer_location_id || null;

  const [order, customer, customerLocation, photos, payments, expenses, timeSegments, invoices, manifests, alerts] = await Promise.all([
    orderId
      ? supabase.from('orders').select('*').eq('tenant_id', tenantId).eq('id', orderId).maybeSingle()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data || null;
        })
      : Promise.resolve(null),
    customerId
      ? supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data || null;
        })
      : Promise.resolve(null),
    locationId
      ? supabase.from('customer_locations').select('*').eq('tenant_id', tenantId).eq('id', locationId).maybeSingle()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data || null;
        })
      : Promise.resolve(null),
    resolveOptionalRows(
      supabase.from('job_photos').select('*').eq('job_id', jobId).order('created_at', { ascending: true }),
      assumptions,
      'Job photos were unavailable because the job_photos table is not present in this environment.'
    ),
    orderId || job.id
      ? resolveOptionalRows(
          (() => {
            let query = supabase.from('payments').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
            if (orderId && job.id) return query.or(`order_id.eq.${orderId},job_id.eq.${job.id}`);
            if (orderId) return query.eq('order_id', orderId);
            return query.eq('job_id', job.id);
          })(),
          assumptions,
          'Payment records were unavailable because the payments table is not present in this environment.'
        )
      : Promise.resolve([]),
    orderId || job.id
      ? resolveOptionalRows(
          (() => {
            let query = supabase.from('expenses').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
            if (orderId && job.id) return query.or(`order_id.eq.${orderId},job_id.eq.${job.id}`);
            if (orderId) return query.eq('order_id', orderId);
            return query.eq('job_id', job.id);
          })(),
          assumptions,
          'Expense records were unavailable because the expenses table is not present in this environment.'
        )
      : Promise.resolve([]),
    resolveOptionalRows(
      supabase.from('job_time_segments').select('*').eq('tenant_id', tenantId).eq('job_id', job.id).order('started_at', { ascending: true }),
      assumptions,
      'Job time segments were unavailable because the job_time_segments table is not present in this environment.'
    ),
    orderId
      ? resolveOptionalRows(
          supabase.from('invoices').select('*').eq('tenant_id', tenantId).eq('order_id', orderId).order('created_at', { ascending: false }),
          assumptions,
          'Invoice records were unavailable because the invoices table is not present in this environment.'
        )
      : Promise.resolve([]),
    resolveOptionalRows(
      supabase.from('waste_manifests').select('*').eq('tenant_id', tenantId).eq('job_id', job.id).order('created_at', { ascending: false }),
      assumptions,
      'Waste manifests were unavailable because the waste_manifests table is not present in this environment.'
    ),
    resolveOptionalRows(
      supabase.from('compliance_alerts').select('*').eq('tenant_id', tenantId).eq('reference_type', 'job').eq('reference_id', job.id).order('created_at', { ascending: false }),
      assumptions,
      'Compliance alerts were unavailable because the compliance_alerts table is not present in this environment.'
    ),
  ]);

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    job,
    order,
    customer,
    customer_location: customerLocation,
    photos,
    payments,
    expenses,
    time_segments: timeSegments,
    invoices,
    waste_manifests: manifests,
    compliance_alerts: alerts,
    assumptions,
    tables: {
      invoices_available: !assumptions.some((item) => item.includes('invoices table')),
    },
    data_used: [
      { label: 'Job record', count: job ? 1 : 0, detail: 'jobs' },
      { label: 'Linked order', count: order ? 1 : 0, detail: 'orders' },
      { label: 'Customer', count: customer ? 1 : 0, detail: 'customers' },
      { label: 'Photos', count: Array.isArray(photos) ? photos.length : 0, detail: 'job_photos' },
      { label: 'Payments', count: Array.isArray(payments) ? payments.length : 0, detail: 'payments' },
      { label: 'Expenses', count: Array.isArray(expenses) ? expenses.length : 0, detail: 'expenses' },
      { label: 'Time segments', count: Array.isArray(timeSegments) ? timeSegments.length : 0, detail: 'job_time_segments' },
      { label: 'Invoices', count: Array.isArray(invoices) ? invoices.length : 0, detail: 'invoices' },
      { label: 'Compliance alerts', count: Array.isArray(alerts) ? alerts.length : 0, detail: 'compliance_alerts' },
    ],
  };
}

async function getEstimateRecordContext(supabase, tenantId, input = {}) {
  const assumptions = [];
  const leadId = String(input.lead_id || '').trim();
  const orderId = String(input.order_id || '').trim();
  const jobId = String(input.job_id || '').trim();

  const [lead, order, job] = await Promise.all([
    leadId
      ? supabase.from('leads').select('*').eq('tenant_id', tenantId).eq('id', leadId).maybeSingle()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data || null;
        })
      : Promise.resolve(null),
    orderId
      ? supabase.from('orders').select('*').eq('tenant_id', tenantId).eq('id', orderId).maybeSingle()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data || null;
        })
      : Promise.resolve(null),
    jobId
      ? supabase.from('jobs').select('*').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data || null;
        })
      : Promise.resolve(null),
  ]);

  const primaryRecord = lead || order || job || null;
  const primaryRecordType = lead ? 'lead' : order ? 'order' : job ? 'job' : 'record';
  const customerId = primaryRecord?.customer_id || null;
  const customer = customerId
    ? await supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle()
      .then((result) => {
        if (result.error) throw new Error(result.error.message);
        return result.data || null;
      })
    : null;

  const priorSimilarRecords = customerId
    ? await resolveOptionalRows(
        supabase.from('orders').select('id, title, total_cents, created_at, status').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(6),
        assumptions,
        'Prior order history was unavailable because the orders table could not be queried.'
      )
    : [];

  const knownPriceTotal = Number(order?.total_cents || 0) || Number(job?.amount_due_cents || 0) || 0;
  const summaryText = [
    primaryRecord?.summary,
    primaryRecord?.description,
    primaryRecord?.notes,
  ].filter((value) => String(value || '').trim()).join(' ');
  const hasMeasurements = /(\d+(\.\d+)?)\s?(sq|ft|gal|yard|yards|hours|hr|rooms|units|fixtures|zones|systems)/i.test(summaryText)
    || Array.isArray(order?.items) && order.items.some((item) => Number(item?.quantity || 0) > 0);

  const missingData = [];
  if (!primaryRecord) {
    missingData.push({
      id: 'estimate_missing_primary_record',
      label: 'No lead, order, or job record was provided',
      detail: 'The estimating assistant needs a lead_id, order_id, or job_id to produce a grounded estimate review.',
      field: 'lead_id|order_id|job_id',
      required_for: 'analysis',
    });
  }

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    lead,
    order,
    job,
    customer,
    primary_record: primaryRecord,
    primary_record_type: primaryRecordType,
    prior_similar_records: priorSimilarRecords,
    known_price_total_cents: knownPriceTotal,
    has_measurements: hasMeasurements,
    missing_data: missingData,
    assumptions,
    data_used: [
      { label: 'Lead record', count: lead ? 1 : 0, detail: 'leads' },
      { label: 'Order record', count: order ? 1 : 0, detail: 'orders' },
      { label: 'Job record', count: job ? 1 : 0, detail: 'jobs' },
      { label: 'Customer', count: customer ? 1 : 0, detail: 'customers' },
      { label: 'Prior related records', count: priorSimilarRecords.length, detail: 'orders' },
    ],
  };
}

async function getDispatchSchedulingContext(supabase, tenantId, input = {}) {
  const targetDate = normalizeAgentDate(input.target_date || input.targetDate);
  const jobType = String(input.job_type || input.jobType || '').trim().toLowerCase();
  const days = Math.max(1, Math.min(21, Number(input.days || (targetDate ? 3 : 7))));
  const upcomingJobs = await getUpcomingJobs(supabase, tenantId, days, 60, {
    startDate: targetDate || '',
    endDate: targetDate || '',
    jobType,
    includeUnscheduled: true,
  }).catch(() => []);
  const scheduledJobs = upcomingJobs.filter((job) => String(job.scheduled_date || '').trim());
  const focusedJobs = targetDate
    ? scheduledJobs.filter((job) => String(job.scheduled_date || '').trim() === targetDate)
    : scheduledJobs;
  const unscheduledJobs = upcomingJobs.filter((job) => !String(job.scheduled_date || '').trim());

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    target_date: targetDate,
    job_type: jobType,
    upcoming_jobs: upcomingJobs,
    assumptions: [],
    data_used: [
      {
        label: targetDate ? 'Jobs on selected date' : 'Upcoming scheduled jobs',
        count: focusedJobs.length,
        detail: 'jobs',
      },
      { label: 'Unscheduled open jobs', count: unscheduledJobs.length, detail: 'jobs' },
    ],
  };
}

async function getBillingBlockerQueueContext(supabase, tenantId, input = {}) {
  const limit = Math.max(1, Math.min(20, Number(input.limit || 12)));
  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, status, order_id, customer_id, amount_due_cents, payment_state, scheduled_date, updated_at')
    .eq('tenant_id', tenantId)
    .in('status', ['completed', 'in_progress', 'blocked', 'dispatched'])
    .order('updated_at', { ascending: false })
    .limit(limit * 2);

  if (error) throw new Error(`getBillingBlockerQueueContext failed: ${error.message}`);
  const candidateJobs = (data || []).filter((row) => row.order_id || Number(row.amount_due_cents || 0) > 0).slice(0, limit);
  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    candidate_jobs: candidateJobs,
    assumptions: [],
    data_used: [
      { label: 'Candidate jobs', count: candidateJobs.length, detail: 'jobs' },
    ],
  };
}

async function getCollectionsFollowUpContext(supabase, tenantId) {
  const assumptions = [];
  const unpaidOrders = await getUnpaidOrders(supabase, tenantId).catch(() => []);
  const invoices = await resolveOptionalRows(
    supabase.from('invoices').select('id, order_id, due_date, status, total_cents, created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100),
    assumptions,
    'Invoice due dates were unavailable because the invoices table is not present in this environment.'
  );

  const invoiceByOrderId = new Map();
  (invoices || []).forEach((invoice) => {
    if (!invoice?.order_id) return;
    const rows = invoiceByOrderId.get(invoice.order_id) || [];
    rows.push(invoice);
    invoiceByOrderId.set(invoice.order_id, rows);
  });

  const openBalances = unpaidOrders.map((order) => {
    const invoiceRows = invoiceByOrderId.get(order.id) || [];
    const latestInvoice = [...invoiceRows].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0] || null;
    return {
      order_id: order.id,
      customer_id: order.customer_id || '',
      order_title: order.title || '',
      customer_name: order.customer_name || '',
      amount_due_cents: Number(order.amount_due_cents || order.total_cents || Math.round((order.total_amount || 0) * 100) || 0),
      payment_due_date: order.payment_due_date || '',
      invoice_due_date: latestInvoice?.due_date || '',
      invoice_status: latestInvoice?.status || '',
    };
  });

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    open_balances: openBalances,
    assumptions,
    data_used: [
      { label: 'Open balance orders', count: openBalances.length, detail: 'orders' },
      { label: 'Invoices', count: Array.isArray(invoices) ? invoices.length : 0, detail: 'invoices' },
    ],
  };
}

module.exports = {
  getAiContext,
  getBillingBlockerQueueContext,
  getBusinessContext,
  getCollectionsFollowUpContext,
  getCollectionsContext,
  getDispatchSchedulingContext,
  getEstimateRecordContext,
  getCrewPrepContext,
  getJobRecordAuditContext,
  getQuoteRescueContext,
  getRetentionContext,
  getUnpaidOrders,
  getRecentOrders,
  getOrderById,
  getUpcomingBookings,
  getTodayBookings,
  getCustomers,
  getTopCustomers,
  getStaleCustomers,
  getMultiLocationCustomers,
  getUpcomingJobs,
  getRecentPayments,
  getPendingQuotes,
  getUnreadMessages,
};
