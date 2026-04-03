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

async function resolveOptionalSingle(queryPromise, assumptions, message, emptyValue = null) {
  const result = await queryPromise;
  if (!result?.error) return result.data || emptyValue;
  if (isMissingRelationError(result.error)) {
    assumptions.push(message);
    return emptyValue;
  }
  throw new Error(result.error.message);
}

function safeParseJson(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function compactText(value, max = 240) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, max);
}

function hasText(value) {
  return !!String(value || '').trim();
}

function firstFilledText(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (text) return text;
  }
  return '';
}

function buildAddressText(...values) {
  return values
    .map((value) => compactText(value, 120))
    .filter(Boolean)
    .join(', ');
}

function normalizeReferenceToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 120);
}

function summarizeRecentJob(row = {}) {
  return {
    id: String(row?.id || '').trim(),
    title: compactText(row?.title || row?.customer_name || 'Job', 180),
    status: compactText(row?.status || '', 80),
    scheduled_date: compactText(row?.scheduled_date || '', 40),
    completed_at: compactText(row?.completed_at || '', 60),
    updated_at: compactText(row?.updated_at || '', 60),
    service_address: compactText(row?.service_address || '', 180),
    notes: compactText(row?.notes || row?.completion_note || row?.crew_notes || '', 240),
  };
}

function extractAccountingReferenceEntries(record = {}, labelPrefix = '') {
  if (!record || typeof record !== 'object') return [];
  const entries = [];
  const seen = new Set();
  const prefix = compactText(labelPrefix, 60);
  const push = (field, rawValue) => {
    const value = compactText(rawValue, 180);
    if (!value) return;
    const token = normalizeReferenceToken(value);
    if (!token || seen.has(`${field}:${token}`)) return;
    seen.add(`${field}:${token}`);
    entries.push({
      field,
      label: prefix ? `${prefix} ${field}` : field,
      value,
      normalized: token,
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

  const metadata = safeParseJson(record.metadata, {});
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

function countKnownAccountingReferences(context = {}) {
  const rows = [
    ...(extractAccountingReferenceEntries(context.order, 'order') || []),
    ...(extractAccountingReferenceEntries(context.job, 'job') || []),
    ...((Array.isArray(context.invoices) ? context.invoices : []).flatMap((row) => extractAccountingReferenceEntries(row, 'invoice'))),
    ...((Array.isArray(context.payments) ? context.payments : []).flatMap((row) => extractAccountingReferenceEntries(row, 'payment'))),
  ];
  return rows.length;
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

async function getCustomerRowsByIds(
  supabase,
  tenantId,
  customerIds = [],
  assumptions = [],
  message = 'Linked customer records were unavailable because the customers table could not be queried.'
) {
  const ids = [...new Set((customerIds || []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 80);
  if (!ids.length) return [];
  return resolveOptionalRows(
    supabase
      .from('customers')
      .select([
        'id',
        'name',
        'company_name',
        'email',
        'phone',
        'notes',
        'created_at',
        'updated_at',
        'last_contact_at',
        'last_service_on',
        'service_plan_name',
        'recurring_notes',
        'service_schedule',
        'frequency',
        'follow_up_notes',
        'maintenance_notes',
        'parts_follow_up',
        'warranty_notes',
        'seasonal_notes',
        'service_notes',
        'scope_notes',
        'checklist_notes',
        'equipment_notes',
        'equipment_serial',
        'issue_summary',
        'restoration_notes',
        'preferences',
        'access_notes',
        'entry_notes',
        'gate_notes',
        'alarm_notes',
      ].join(', '))
      .eq('tenant_id', tenantId)
      .in('id', ids),
    assumptions,
    message
  );
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

async function getQuoteRescueManagerContext(supabase, tenantId) {
  const assumptions = [];
  const [quotes, bids, topCustomers, staleCustomers] = await Promise.all([
    resolveOptionalRows(
      supabase
        .from('quotes')
        .select('id, customer_id, customer_name, customer_email, title, description, notes, amount_cents, status, valid_until, order_id, accepted_at, declined_at, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false })
        .limit(80),
      assumptions,
      'Quote history was unavailable because the quotes table could not be queried.'
    ),
    resolveOptionalRows(
      supabase
        .from('bids')
        .select('id, lead_id, customer_id, status, title, valid_until, service_address, project_summary, scope_of_work, cover_note, total_cents, converted_order_id, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false })
        .limit(80),
      assumptions,
      'Proposal history was unavailable because the bids table could not be queried.'
    ),
    getTopCustomers(supabase, tenantId, 8).catch(() => []),
    getStaleCustomers(supabase, tenantId, 45).catch(() => []),
  ]);

  const customerIds = [
    ...(quotes || []).map((row) => row?.customer_id),
    ...(bids || []).map((row) => row?.customer_id),
    ...(staleCustomers || []).map((row) => row?.id),
    ...(topCustomers || []).map((row) => row?.id),
  ];
  const customers = await getCustomerRowsByIds(
    supabase,
    tenantId,
    customerIds,
    assumptions,
    'Linked customer context for quote rescue was unavailable because the customers table could not be queried.'
  );

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    specialist: 'quote_rescue_manager',
    quotes: quotes || [],
    bids: bids || [],
    customers,
    top_customers: topCustomers,
    stale_customers: staleCustomers,
    assumptions,
    data_used: [
      { label: 'CRM quotes', count: Array.isArray(quotes) ? quotes.length : 0, detail: 'quotes' },
      { label: 'Walkthrough bids', count: Array.isArray(bids) ? bids.length : 0, detail: 'bids' },
      { label: 'Linked customers', count: customers.length, detail: 'customers' },
      { label: 'Stale customers', count: Array.isArray(staleCustomers) ? staleCustomers.length : 0, detail: 'customers' },
    ],
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

async function getServicePlanRenewalContext(supabase, tenantId, input = {}) {
  const assumptions = [];
  const focusPlanId = String(input.plan_id || input.planId || '').trim();
  const servicePlans = await resolveOptionalRows(
    supabase
      .from('service_plans')
      .select('id, customer_id, source_order_id, last_generated_order_id, title, status, cadence, custom_interval_days, next_run_on, amount_cents, deposit_required_cents, summary, notes, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(120),
    assumptions,
    'Service-plan renewal context was unavailable because the service_plans table could not be queried.'
  );
  const customers = await getCustomerRowsByIds(
    supabase,
    tenantId,
    (servicePlans || []).map((row) => row?.customer_id),
    assumptions,
    'Linked customer context for service-plan renewal was unavailable because the customers table could not be queried.'
  );
  const orderIds = [
    ...(servicePlans || []).map((row) => row?.source_order_id),
    ...(servicePlans || []).map((row) => row?.last_generated_order_id),
  ];
  const relatedOrders = orderIds.filter(Boolean).length
    ? await resolveOptionalRows(
        supabase
          .from('orders')
          .select('id, customer_id, title, status, total_cents, payment_state, amount_due_cents, scheduled_date, updated_at')
          .eq('tenant_id', tenantId)
          .in('id', [...new Set(orderIds.filter(Boolean))]),
        assumptions,
        'Linked order context for service-plan renewal was unavailable because the orders table could not be queried.'
      )
    : [];

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    specialist: 'service_plan_renewal_manager',
    focus_plan_id: focusPlanId,
    service_plans: servicePlans || [],
    customers,
    related_orders: relatedOrders,
    assumptions,
    data_used: [
      { label: 'Service plans', count: Array.isArray(servicePlans) ? servicePlans.length : 0, detail: 'service_plans' },
      { label: 'Linked customers', count: customers.length, detail: 'customers' },
      { label: 'Linked orders', count: Array.isArray(relatedOrders) ? relatedOrders.length : 0, detail: 'orders' },
    ],
  };
}

async function getRetentionReactivationContext(supabase, tenantId, input = {}) {
  const assumptions = [];
  const focusCustomerId = String(input.customer_id || input.customerId || '').trim();
  const staleCustomers = await getStaleCustomers(supabase, tenantId, 45).catch(() => []);
  const customerIds = [
    ...(staleCustomers || []).map((row) => row?.id),
    focusCustomerId,
  ];
  const customers = await getCustomerRowsByIds(
    supabase,
    tenantId,
    customerIds,
    assumptions,
    'Retention customer context was unavailable because the customers table could not be queried.'
  );
  const customerIdList = [...new Set(customers.map((row) => row?.id).filter(Boolean))];
  const servicePlans = customerIdList.length
    ? await resolveOptionalRows(
        supabase
          .from('service_plans')
          .select('id, customer_id, title, status, next_run_on, updated_at')
          .eq('tenant_id', tenantId)
          .in('customer_id', customerIdList)
          .order('updated_at', { ascending: false })
          .limit(120),
        assumptions,
        'Service-plan context for retention was unavailable because the service_plans table could not be queried.'
      )
    : [];
  const recentOrders = customerIdList.length
    ? await resolveOptionalRows(
        supabase
          .from('orders')
          .select('id, customer_id, title, status, total_cents, scheduled_date, updated_at')
          .eq('tenant_id', tenantId)
          .in('customer_id', customerIdList)
          .order('updated_at', { ascending: false })
          .limit(160),
        assumptions,
        'Recent order context for retention was unavailable because the orders table could not be queried.'
      )
    : [];
  const recentJobs = customerIdList.length
    ? await resolveOptionalRows(
        supabase
          .from('jobs')
          .select('id, customer_id, title, status, scheduled_date, completed_at, updated_at')
          .eq('tenant_id', tenantId)
          .in('customer_id', customerIdList)
          .order('updated_at', { ascending: false })
          .limit(160),
        assumptions,
        'Recent job context for retention was unavailable because the jobs table could not be queried.'
      )
    : [];

  const staleCustomerIdSet = new Set((staleCustomers || []).map((row) => String(row?.id || '').trim()).filter(Boolean));
  const enrichedStaleCustomers = customers
    .filter((row) => staleCustomerIdSet.has(String(row?.id || '').trim()))
    .map((row) => {
      const staleMatch = (staleCustomers || []).find((entry) => entry?.id === row?.id) || {};
      return { ...staleMatch, ...row };
    });

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    specialist: 'retention_reactivation_manager',
    focus_customer_id: focusCustomerId,
    customers,
    stale_customers: enrichedStaleCustomers,
    service_plans: servicePlans,
    recent_orders: recentOrders,
    recent_jobs: recentJobs,
    assumptions,
    data_used: [
      { label: 'Focus customers', count: customers.length, detail: 'customers' },
      { label: 'Stale customers', count: enrichedStaleCustomers.length, detail: 'customers' },
      { label: 'Linked service plans', count: Array.isArray(servicePlans) ? servicePlans.length : 0, detail: 'service_plans' },
      { label: 'Recent orders', count: Array.isArray(recentOrders) ? recentOrders.length : 0, detail: 'orders' },
      { label: 'Recent jobs', count: Array.isArray(recentJobs) ? recentJobs.length : 0, detail: 'jobs' },
    ],
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

async function getTenantSnapshot(supabase, tenantId, assumptions) {
  const tenant = await resolveOptionalSingle(
    supabase
      .from('tenants')
      .select('id, business_name, prooflink_plan_key, online_payments_enabled, connect_status, status, billing_status')
      .eq('id', tenantId)
      .maybeSingle(),
    assumptions,
    'Tenant profile was unavailable because the tenants table is not present in this environment.'
  );

  const hydrovacSettings = await resolveOptionalSingle(
    supabase
      .from('tenant_hydrovac_settings')
      .select('enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    assumptions,
    'Hydrovac settings were unavailable because the tenant_hydrovac_settings table is not present in this environment.'
  );

  return {
    id: tenantId,
    business_name: String(tenant?.business_name || '').trim(),
    plan_key: String(tenant?.prooflink_plan_key || '').trim().toLowerCase(),
    online_payments_enabled: tenant?.online_payments_enabled === true,
    connect_status: String(tenant?.connect_status || '').trim().toLowerCase(),
    status: String(tenant?.status || '').trim().toLowerCase(),
    billing_status: String(tenant?.billing_status || '').trim().toLowerCase(),
    hydrovac_enabled: hydrovacSettings?.enabled === true,
  };
}

async function getServicePlanSummary(supabase, tenantId, assumptions) {
  const plans = await resolveOptionalRows(
    supabase
      .from('service_plans')
      .select('id, customer_id, status, next_run_on')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(120),
    assumptions,
    'Service-plan history was unavailable because the service_plans table is not present in this environment.'
  );

  const activePlans = (plans || []).filter((row) => String(row?.status || '').trim().toLowerCase() === 'active');
  const atRiskPlans = activePlans.filter((row) => {
    const nextRunOn = String(row?.next_run_on || '').trim();
    return !nextRunOn || Number.isNaN(new Date(nextRunOn).getTime());
  });
  const dueSoonPlans = activePlans.filter((row) => {
    const nextRunOn = String(row?.next_run_on || '').trim();
    if (!nextRunOn) return false;
    const nextRunTime = new Date(nextRunOn).getTime();
    if (!Number.isFinite(nextRunTime)) return false;
    return nextRunTime <= Date.now() + (14 * 86400000);
  });

  return {
    active_count: activePlans.length,
    at_risk_count: atRiskPlans.length,
    due_soon_count: dueSoonPlans.length,
    sample_customer_ids: activePlans
      .map((row) => String(row?.customer_id || '').trim())
      .filter(Boolean)
      .slice(0, 6),
  };
}

async function getImportLearningSummary(supabase, tenantId, assumptions) {
  const configRow = await resolveOptionalSingle(
    supabase
      .from('tenant_config')
      .select('config_value')
      .eq('tenant_id', tenantId)
      .eq('config_key', 'import_profiles')
      .maybeSingle(),
    assumptions,
    'Import-learning history was unavailable because the tenant_config table could not be queried.'
  );

  const parsed = safeParseJson(configRow?.config_value, { profiles: [] });
  const profiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
  const sourceSystems = Array.from(new Set(
    profiles
      .map((profile) => String(profile?.source_system || profile?.sourceSystem || '').trim().toLowerCase())
      .filter(Boolean)
  ));
  const correctionCounts = new Map();
  let walkthroughSummaryCount = 0;
  let learningNoteCount = 0;

  profiles.forEach((profile) => {
    const correctionFields = Array.isArray(profile?.correction_fields || profile?.correctionFields)
      ? (profile.correction_fields || profile.correctionFields)
      : [];
    correctionFields
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .forEach((field) => correctionCounts.set(field, Number(correctionCounts.get(field) || 0) + 1));

    if (String(profile?.walkthrough_summary || profile?.walkthroughSummary || '').trim()) walkthroughSummaryCount += 1;
    const learningNotes = Array.isArray(profile?.learning_notes || profile?.learningNotes)
      ? (profile.learning_notes || profile.learningNotes)
      : [];
    learningNoteCount += learningNotes
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .length;
  });

  const correctionFieldHotspots = [...correctionCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([field, count]) => ({ field, count }));

  return {
    profile_count: profiles.length,
    source_systems: sourceSystems,
    correction_field_hotspots: correctionFieldHotspots,
    walkthrough_summary_count: walkthroughSummaryCount,
    learning_note_count: learningNoteCount,
    profile_keys: profiles
      .map((profile) => String(profile?.key || '').trim())
      .filter(Boolean)
      .slice(0, 12),
  };
}

async function getRecentAgentAuditSummary(supabase, tenantId, assumptions, days = 45) {
  const cutoff = new Date(Date.now() - (Math.max(1, days) * 86400000)).toISOString();
  const rows = await resolveOptionalRows(
    supabase
      .from('agent_audit_events')
      .select('mode, error, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(160),
    assumptions,
    'Recent agent audit history was unavailable because the agent_audit_events table is not present in this environment.'
  );

  const usageByMode = {};
  const usageByAgent = {};
  let errorCount = 0;

  (rows || []).forEach((row) => {
    const mode = String(row?.mode || '').trim();
    if (!mode) return;
    usageByMode[mode] = Number(usageByMode[mode] || 0) + 1;
    if (mode.startsWith('agent:')) {
      const agentKey = mode.slice(6);
      if (agentKey) usageByAgent[agentKey] = Number(usageByAgent[agentKey] || 0) + 1;
    }
    if (String(row?.error || '').trim()) errorCount += 1;
  });

  return {
    event_count: Array.isArray(rows) ? rows.length : 0,
    usage_by_mode: usageByMode,
    usage_by_agent: usageByAgent,
    error_count: errorCount,
    last_run_at: String(rows?.[0]?.created_at || '').trim(),
  };
}

async function getAgentWorkforceContext(supabase, tenantId) {
  const assumptions = [];
  const [
    tenant,
    businessContext,
    billingContext,
    collectionsContext,
    dispatchContext,
    servicePlanSummary,
    importLearning,
    agentAudit,
  ] = await Promise.all([
    getTenantSnapshot(supabase, tenantId, assumptions),
    getBusinessContext(supabase, tenantId).catch(() => ({
      snapshot_at: new Date().toISOString(),
      unpaid_orders: [],
      overdue_orders: [],
      pending_quotes: [],
      expired_quotes: [],
      recent_payments: [],
      unread_messages: [],
      stale_customers: [],
      reminders_needed: [],
      top_customers: [],
      multi_location_customers: [],
      upcoming_jobs: [],
      today_bookings: [],
      upcoming_bookings: [],
    })),
    getBillingBlockerQueueContext(supabase, tenantId, { limit: 12 }).catch(() => ({
      candidate_jobs: [],
      assumptions: [],
      data_used: [],
    })),
    getCollectionsFollowUpContext(supabase, tenantId).catch(() => ({
      open_balances: [],
      assumptions: [],
      data_used: [],
    })),
    getDispatchSchedulingContext(supabase, tenantId, { days: 7 }).catch(() => ({
      upcoming_jobs: [],
      assumptions: [],
      data_used: [],
    })),
    getServicePlanSummary(supabase, tenantId, assumptions),
    getImportLearningSummary(supabase, tenantId, assumptions),
    getRecentAgentAuditSummary(supabase, tenantId, assumptions),
  ]);

  const dispatchJobs = Array.isArray(dispatchContext?.upcoming_jobs) ? dispatchContext.upcoming_jobs : [];
  const unscheduledJobCount = dispatchJobs.filter((job) => !String(job?.scheduled_date || '').trim()).length;
  const unassignedJobCount = dispatchJobs.filter((job) => (
    String(job?.scheduled_date || '').trim()
      && !String(job?.assigned_member_id || job?.assigned_operator_id || '').trim()
  )).length;
  const openBalances = Array.isArray(collectionsContext?.open_balances) ? collectionsContext.open_balances : [];
  const missingDueDateCount = openBalances.filter((row) => {
    return !String(row?.invoice_due_date || '').trim() && !String(row?.payment_due_date || '').trim();
  }).length;

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    tenant,
    business_context: businessContext,
    billing_context: billingContext,
    collections_context: collectionsContext,
    dispatch_context: dispatchContext,
    service_plan_summary: servicePlanSummary,
    import_learning: importLearning,
    agent_audit: agentAudit,
    assumptions,
    data_used: [
      { label: 'Tenant profile', count: tenant?.business_name ? 1 : 0, detail: 'tenants' },
      { label: 'Upcoming jobs', count: Array.isArray(businessContext?.upcoming_jobs) ? businessContext.upcoming_jobs.length : 0, detail: 'jobs' },
      { label: 'Multi-location customers', count: Array.isArray(businessContext?.multi_location_customers) ? businessContext.multi_location_customers.length : 0, detail: 'customer_locations' },
      { label: 'Billing queue candidates', count: Array.isArray(billingContext?.candidate_jobs) ? billingContext.candidate_jobs.length : 0, detail: 'jobs' },
      { label: 'Open balance orders', count: openBalances.length, detail: 'orders' },
      { label: 'Import profiles', count: Number(importLearning?.profile_count || 0), detail: 'tenant_config.import_profiles' },
      { label: 'Recent agent runs', count: Number(agentAudit?.event_count || 0), detail: 'agent_audit_events' },
      { label: 'Active service plans', count: Number(servicePlanSummary?.active_count || 0), detail: 'service_plans' },
    ],
    context_summary: {
      multi_location_customers: Array.isArray(businessContext?.multi_location_customers) ? businessContext.multi_location_customers.length : 0,
      upcoming_jobs: Array.isArray(businessContext?.upcoming_jobs) ? businessContext.upcoming_jobs.length : 0,
      billing_candidates: Array.isArray(billingContext?.candidate_jobs) ? billingContext.candidate_jobs.length : 0,
      open_balances: openBalances.length,
      missing_due_dates: missingDueDateCount,
      unscheduled_jobs: unscheduledJobCount,
      unassigned_jobs: unassignedJobCount,
      import_profiles: Number(importLearning?.profile_count || 0),
      correction_hotspots: Array.isArray(importLearning?.correction_field_hotspots) ? importLearning.correction_field_hotspots.length : 0,
      active_service_plans: Number(servicePlanSummary?.active_count || 0),
      at_risk_service_plans: Number(servicePlanSummary?.at_risk_count || 0),
      recent_agent_runs: Number(agentAudit?.event_count || 0),
    },
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

async function getFieldCloseoutContext(supabase, tenantId, jobId) {
  const context = await getJobRecordAuditContext(supabase, tenantId, jobId);
  const assumptions = [...(context.assumptions || [])];
  return {
    ...context,
    assumptions,
    data_used: [
      ...(Array.isArray(context.data_used) ? context.data_used : []),
      { label: 'Closeout-ready proof records', count: Array.isArray(context.photos) ? context.photos.length : 0, detail: 'job_photos' },
    ],
  };
}

async function getSitePacketContext(supabase, tenantId, jobId) {
  const base = await getJobRecordAuditContext(supabase, tenantId, jobId);
  const assumptions = [...(base.assumptions || [])];
  const job = base.job || {};
  const order = base.order || null;
  const customer = base.customer || null;
  const customerLocation = base.customer_location || null;
  const customerId = String(job.customer_id || order?.customer_id || '').trim();
  const locationId = String(job.customer_location_id || '').trim();

  let recentJobs = [];
  if (locationId) {
    recentJobs = await resolveOptionalRows(
      supabase
        .from('jobs')
        .select('id, title, status, scheduled_date, completed_at, updated_at, service_address, notes, customer_id, customer_location_id')
        .eq('tenant_id', tenantId)
        .eq('customer_location_id', locationId)
        .neq('id', jobId)
        .order('updated_at', { ascending: false })
        .limit(6),
      assumptions,
      'Recent site-history jobs were unavailable because the jobs table could not be queried for customer_location_id.'
    );
  } else if (customerId) {
    recentJobs = await resolveOptionalRows(
      supabase
        .from('jobs')
        .select('id, title, status, scheduled_date, completed_at, updated_at, service_address, notes, customer_id, customer_location_id')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .neq('id', jobId)
        .order('updated_at', { ascending: false })
        .limit(6),
      assumptions,
      'Recent customer job history was unavailable because the jobs table could not be queried.'
    );
  }

  const historyJobIds = [jobId, ...recentJobs.map((row) => row?.id).filter(Boolean)];
  const recentSitePhotos = historyJobIds.length
    ? await resolveOptionalRows(
        supabase
          .from('job_photos')
          .select('id, job_id, photo_type, caption, created_at, url')
          .in('job_id', historyJobIds)
          .order('created_at', { ascending: false })
          .limit(24),
        assumptions,
        'Site proof history was unavailable because the job_photos table is not present in this environment.'
      )
    : [];

  const siteAddress = buildAddressText(
    customerLocation?.address_line1,
    [customerLocation?.city, customerLocation?.state, customerLocation?.zip].filter(Boolean).join(' ').trim()
  ) || firstFilledText(
    job.service_address,
    order?.service_address,
    customer?.address_line1,
    buildAddressText([customer?.city, customer?.state, customer?.zip].filter(Boolean).join(' ').trim())
  );

  return {
    ...base,
    assumptions,
    recent_site_jobs: recentJobs.map((row) => summarizeRecentJob(row)),
    recent_site_photos: recentSitePhotos,
    site_summary: {
      site_label: firstFilledText(customerLocation?.site_name, customer?.company_name, customer?.name, order?.customer_name, job.title),
      site_address: siteAddress,
      access_notes: firstFilledText(
        customerLocation?.access_notes,
        customer?.access_notes,
        customer?.entry_notes,
        customer?.alarm_notes,
        customer?.gate_notes
      ),
      site_notes: firstFilledText(
        customerLocation?.site_notes,
        customer?.service_notes,
        customer?.scope_notes,
        order?.notes,
        job.notes
      ),
      contact_name: firstFilledText(customerLocation?.contact_name, customer?.name, order?.customer_name),
      contact_phone: firstFilledText(customerLocation?.contact_phone, customer?.phone, order?.customer_phone),
      contact_email: firstFilledText(customerLocation?.contact_email, customer?.email, order?.customer_email),
    },
    data_used: [
      ...(Array.isArray(base.data_used) ? base.data_used : []),
      { label: 'Recent site-history jobs', count: recentJobs.length, detail: 'jobs' },
      { label: 'Site proof photos', count: recentSitePhotos.length, detail: 'job_photos' },
    ],
  };
}

async function getAccountingContinuityContext(supabase, tenantId, input = {}) {
  const assumptions = [];
  const inputOrderId = String(input.order_id || input.orderId || '').trim();
  const inputJobId = String(input.job_id || input.jobId || '').trim();

  const initialOrder = inputOrderId
    ? await supabase.from('orders').select('*').eq('tenant_id', tenantId).eq('id', inputOrderId).maybeSingle()
      .then((result) => {
        if (result.error) throw new Error(result.error.message);
        return result.data || null;
      })
    : null;
  const initialJob = inputJobId
    ? await supabase.from('jobs').select('*').eq('tenant_id', tenantId).eq('id', inputJobId).maybeSingle()
      .then((result) => {
        if (result.error) throw new Error(result.error.message);
        return result.data || null;
      })
    : null;

  let order = initialOrder;
  let job = initialJob;
  if (!order && job?.order_id) {
    order = await supabase.from('orders').select('*').eq('tenant_id', tenantId).eq('id', job.order_id).maybeSingle()
      .then((result) => {
        if (result.error) throw new Error(result.error.message);
        return result.data || null;
      });
  }
  if (!job && order?.id) {
    job = await resolveOptionalSingle(
      supabase
        .from('jobs')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('order_id', order.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      assumptions,
      'Linked job history was unavailable because the jobs table could not be queried for this order.'
    );
  }

  if (!order && !job) {
    const err = new Error('Order or job record not found');
    err.statusCode = 404;
    throw err;
  }

  const customerId = String(order?.customer_id || job?.customer_id || '').trim();
  const locationId = String(job?.customer_location_id || '').trim();

  const [customer, customerLocation, payments, invoices, importLearning, tenant] = await Promise.all([
    customerId
      ? supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle()
        .then((result) => {
          if (result.error) throw new Error(result.error.message);
          return result.data || null;
        })
      : Promise.resolve(null),
    locationId
      ? resolveOptionalSingle(
          supabase.from('customer_locations').select('*').eq('tenant_id', tenantId).eq('id', locationId).maybeSingle(),
          assumptions,
          'Customer site details were unavailable because the customer_locations table is not present in this environment.'
        )
      : Promise.resolve(null),
    (order?.id || job?.id)
      ? resolveOptionalRows(
          (() => {
            let query = supabase.from('payments').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
            if (order?.id && job?.id) return query.or(`order_id.eq.${order.id},job_id.eq.${job.id}`);
            if (order?.id) return query.eq('order_id', order.id);
            return query.eq('job_id', job.id);
          })(),
          assumptions,
          'Payment continuity history was unavailable because the payments table could not be queried.'
        )
      : Promise.resolve([]),
    order?.id
      ? resolveOptionalRows(
          supabase.from('invoices').select('*').eq('tenant_id', tenantId).eq('order_id', order.id).order('created_at', { ascending: false }),
          assumptions,
          'Invoice continuity history was unavailable because the invoices table is not present in this environment.'
        )
      : Promise.resolve([]),
    getImportLearningSummary(supabase, tenantId, assumptions),
    getTenantSnapshot(supabase, tenantId, assumptions),
  ]);

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    tenant,
    order,
    job,
    customer,
    customer_location: customerLocation,
    payments,
    invoices,
    import_learning: importLearning,
    assumptions,
    data_used: [
      { label: 'Order record', count: order ? 1 : 0, detail: 'orders' },
      { label: 'Linked job', count: job ? 1 : 0, detail: 'jobs' },
      { label: 'Customer', count: customer ? 1 : 0, detail: 'customers' },
      { label: 'Payments', count: Array.isArray(payments) ? payments.length : 0, detail: 'payments' },
      { label: 'Invoices', count: Array.isArray(invoices) ? invoices.length : 0, detail: 'invoices' },
      { label: 'Import profiles', count: Number(importLearning?.profile_count || 0), detail: 'tenant_config.import_profiles' },
      { label: 'Known accounting refs', count: countKnownAccountingReferences({ order, job, invoices, payments }), detail: 'orders|jobs|payments|invoices' },
    ],
  };
}

async function getEstimateRecordContext(supabase, tenantId, input = {}) {
  const assumptions = [];
  const bidId = String(input.bid_id || input.bidId || '').trim();
  const bid = bidId
    ? await resolveOptionalSingle(
        supabase.from('bids').select('*').eq('tenant_id', tenantId).eq('id', bidId).maybeSingle(),
        assumptions,
        'Bid context was unavailable because the bids table could not be queried.'
      )
    : null;
  const leadId = String(input.lead_id || input.leadId || bid?.lead_id || '').trim();
  const orderId = String(input.order_id || input.orderId || bid?.converted_order_id || '').trim();
  const jobId = String(input.job_id || input.jobId || '').trim();

  let [lead, order, job] = await Promise.all([
    leadId
      ? resolveOptionalSingle(
          supabase.from('leads').select('*').eq('tenant_id', tenantId).eq('id', leadId).maybeSingle(),
          assumptions,
          'Lead context was unavailable because the leads table could not be queried.'
        )
      : Promise.resolve(null),
    orderId
      ? resolveOptionalSingle(
          supabase.from('orders').select('*').eq('tenant_id', tenantId).eq('id', orderId).maybeSingle(),
          assumptions,
          'Order context was unavailable because the orders table could not be queried.'
        )
      : Promise.resolve(null),
    jobId
      ? resolveOptionalSingle(
          supabase.from('jobs').select('*').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle(),
          assumptions,
          'Job context was unavailable because the jobs table could not be queried.'
        )
      : Promise.resolve(null),
  ]);

  if (!job && bid?.id) {
    job = await resolveOptionalSingle(
      supabase
        .from('jobs')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('bid_id', bid.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      assumptions,
      'Linked job history was unavailable because the jobs table could not be queried for this bid.'
    );
  }
  if (!order && job?.order_id) {
    order = await resolveOptionalSingle(
      supabase.from('orders').select('*').eq('tenant_id', tenantId).eq('id', job.order_id).maybeSingle(),
      assumptions,
      'Linked order context was unavailable because the orders table could not be queried for this job.'
    );
  }
  if (!lead && bid?.lead_id) {
    lead = await resolveOptionalSingle(
      supabase.from('leads').select('*').eq('tenant_id', tenantId).eq('id', bid.lead_id).maybeSingle(),
      assumptions,
      'Linked lead context was unavailable because the leads table could not be queried for this bid.'
    );
  }

  const primaryRecord = bid || lead || order || job || null;
  const primaryRecordType = bid ? 'bid' : lead ? 'lead' : order ? 'order' : job ? 'job' : 'record';
  const customerId = bid?.customer_id || primaryRecord?.customer_id || order?.customer_id || job?.customer_id || null;
  const customer = customerId
    ? await resolveOptionalSingle(
        supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle(),
        assumptions,
        'Customer context was unavailable because the customers table could not be queried.'
      )
    : null;

  const [priorBidHistory, priorOrderHistory] = customerId
    ? await Promise.all([
        resolveOptionalRows(
          (() => {
            let query = supabase
              .from('bids')
              .select('id, title, total_cents, created_at, updated_at, status, valid_until, service_address')
              .eq('tenant_id', tenantId)
              .eq('customer_id', customerId)
              .order('updated_at', { ascending: false })
              .limit(6);
            if (bid?.id) query = query.neq('id', bid.id);
            return query;
          })(),
          assumptions,
          'Prior proposal history was unavailable because the bids table could not be queried.'
        ),
        resolveOptionalRows(
          (() => {
            let query = supabase
              .from('orders')
              .select('id, title, total_cents, created_at, updated_at, status')
              .eq('tenant_id', tenantId)
              .eq('customer_id', customerId)
              .order('updated_at', { ascending: false })
              .limit(6);
            if (order?.id) query = query.neq('id', order.id);
            return query;
          })(),
          assumptions,
          'Prior order history was unavailable because the orders table could not be queried.'
        ),
      ])
    : [[], []];

  const priorSimilarRecords = [
    ...(priorBidHistory || []).map((row) => ({ ...row, record_type: 'bid' })),
    ...(priorOrderHistory || []).map((row) => ({ ...row, record_type: 'order' })),
  ]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
    .slice(0, 8);

  const knownPriceTotal = Number(bid?.total_cents || 0) || Number(order?.total_cents || 0) || Number(job?.amount_due_cents || 0) || 0;
  const summaryText = [
    bid?.project_summary,
    bid?.scope_of_work,
    bid?.proposed_solution,
    bid?.materials_plan,
    bid?.cover_note,
    bid?.internal_notes,
    primaryRecord?.summary,
    primaryRecord?.description,
    primaryRecord?.notes,
  ].filter((value) => String(value || '').trim()).join(' ');
  const hasMeasurements = /(\d+(\.\d+)?)\s?(sq|ft|gal|yard|yards|hours|hr|rooms|units|fixtures|zones|systems)/i.test(summaryText)
    || Array.isArray(bid?.line_items) && bid.line_items.some((item) => Number(item?.quantity || 0) > 0)
    || Array.isArray(order?.items) && order.items.some((item) => Number(item?.quantity || 0) > 0);

  const missingData = [];
  if (!primaryRecord) {
    missingData.push({
      id: 'estimate_missing_primary_record',
      label: 'No bid, lead, order, or job record was provided',
      detail: 'The estimating assistant needs a bid_id, lead_id, order_id, or job_id to produce a grounded estimate review.',
      field: 'bid_id|lead_id|order_id|job_id',
      required_for: 'analysis',
    });
  }

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    bid,
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
      { label: 'Bid record', count: bid ? 1 : 0, detail: 'bids' },
      { label: 'Lead record', count: lead ? 1 : 0, detail: 'leads' },
      { label: 'Order record', count: order ? 1 : 0, detail: 'orders' },
      { label: 'Job record', count: job ? 1 : 0, detail: 'jobs' },
      { label: 'Customer', count: customer ? 1 : 0, detail: 'customers' },
      { label: 'Prior related records', count: priorSimilarRecords.length, detail: 'bids + orders' },
    ],
  };
}

async function getProposalReadinessContext(supabase, tenantId, input = {}) {
  const assumptions = [];
  const bidId = String(input.bid_id || input.bidId || '').trim();
  const bid = bidId
    ? await resolveOptionalSingle(
        supabase.from('bids').select('*').eq('tenant_id', tenantId).eq('id', bidId).maybeSingle(),
        assumptions,
        'Proposal bid context was unavailable because the bids table could not be queried.'
      )
    : null;

  const customerId = String(bid?.customer_id || '').trim();
  const [customer, brandingProfile, senderProfiles, termsTemplates, exclusionsTemplates] = await Promise.all([
    customerId
      ? resolveOptionalSingle(
          supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle(),
          assumptions,
          'Proposal customer context was unavailable because the customers table could not be queried.'
        )
      : Promise.resolve(null),
    resolveOptionalSingle(
      supabase.from('tenant_branding_profiles').select('*').eq('tenant_id', tenantId).maybeSingle(),
      assumptions,
      'Proposal branding defaults were unavailable because the tenant_branding_profiles table could not be queried.'
    ),
    resolveOptionalRows(
      supabase.from('user_document_profiles').select('*').eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(25),
      assumptions,
      'Signer profiles were unavailable because the user_document_profiles table could not be queried.'
    ),
    resolveOptionalRows(
      supabase.from('reusable_terms_templates').select('*').order('name', { ascending: true }).limit(50),
      assumptions,
      'Reusable terms templates were unavailable because the reusable_terms_templates table could not be queried.'
    ),
    resolveOptionalRows(
      supabase.from('reusable_exclusions_templates').select('*').order('name', { ascending: true }).limit(50),
      assumptions,
      'Reusable exclusions templates were unavailable because the reusable_exclusions_templates table could not be queried.'
    ),
  ]);

  const senderRows = Array.isArray(senderProfiles) ? senderProfiles : [];
  const activeTermsTemplates = (Array.isArray(termsTemplates) ? termsTemplates : []).filter((row) => row?.active !== false);
  const activeExclusionsTemplates = (Array.isArray(exclusionsTemplates) ? exclusionsTemplates : []).filter((row) => row?.active !== false);
  const activeSenderUserId = String(bid?.sender_user_id || brandingProfile?.default_sender_user_id || '').trim();
  const activeSender = senderRows.find((row) => String(row?.user_id || '').trim() === activeSenderUserId) || null;
  const activeTermsTemplateId = String(bid?.terms_template_id || brandingProfile?.default_terms_template_id || '').trim();
  const activeExclusionsTemplateId = String(bid?.exclusions_template_id || brandingProfile?.default_exclusions_template_id || '').trim();
  const totalCents = Number(bid?.total_cents || 0);
  const explicitDeposit = Math.max(0, Number(bid?.deposit_amount_cents || 0));
  const percentDeposit = totalCents > 0 ? Math.round(totalCents * (Math.max(0, Number(bid?.deposit_percent || 0)) / 100)) : 0;
  const depositAmountCents = explicitDeposit > 0 ? explicitDeposit : percentDeposit;
  const status = {
    company_name: hasText(brandingProfile?.company_name),
    logo: hasText(brandingProfile?.logo_image_url),
    default_terms: hasText(brandingProfile?.default_terms_template_id),
    default_exclusions: hasText(brandingProfile?.default_exclusions_template_id),
    default_signer: hasText(brandingProfile?.default_sender_user_id),
    default_signer_signature: hasText(activeSender?.signature_image_url),
    bid_sender: hasText(bid?.sender_user_id || brandingProfile?.default_sender_user_id),
    delivery_note: hasText(firstFilledText(bid?.cover_note, bid?.intro_text, bid?.subject_line)),
    valid_until: hasText(bid?.valid_until),
    terms_applied: hasText(activeTermsTemplateId) || hasText(bid?.terms_override) || hasText(bid?.terms),
    exclusions_applied: hasText(activeExclusionsTemplateId) || hasText(bid?.exclusions_override) || hasText(bid?.exclusions),
    deposit_requested: depositAmountCents > 0,
  };

  const missingData = [];
  if (!bid) {
    missingData.push({
      id: 'proposal_readiness_missing_bid',
      label: 'Saved walkthrough bid is missing',
      detail: 'Proposal readiness requires a saved walkthrough bid so delivery fields and reusable defaults can be inspected together.',
      field: 'bid_id',
      required_for: 'analysis',
    });
  }

  return {
    snapshot_at: new Date().toISOString(),
    tenant_id: tenantId,
    bid,
    customer,
    branding_profile: brandingProfile || null,
    sender_profiles: senderRows,
    active_sender: activeSender,
    terms_templates: activeTermsTemplates,
    exclusions_templates: activeExclusionsTemplates,
    deposit_amount_cents: depositAmountCents,
    status,
    missing_data: missingData,
    assumptions,
    data_used: [
      { label: 'Walkthrough bid', count: bid ? 1 : 0, detail: 'bids' },
      { label: 'Customer', count: customer ? 1 : 0, detail: 'customers' },
      { label: 'Proposal branding defaults', count: brandingProfile ? 1 : 0, detail: 'tenant_branding_profiles' },
      { label: 'Signer profiles', count: senderRows.length, detail: 'user_document_profiles' },
      { label: 'Terms templates', count: activeTermsTemplates.length, detail: 'reusable_terms_templates' },
      { label: 'Exclusions templates', count: activeExclusionsTemplates.length, detail: 'reusable_exclusions_templates' },
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
  getAgentWorkforceContext,
  getAiContext,
  getBillingBlockerQueueContext,
  getBusinessContext,
  getAccountingContinuityContext,
  getCollectionsFollowUpContext,
  getCollectionsContext,
  getDispatchSchedulingContext,
  getEstimateRecordContext,
  getProposalReadinessContext,
  getCrewPrepContext,
  getFieldCloseoutContext,
  getJobRecordAuditContext,
  getQuoteRescueManagerContext,
  getQuoteRescueContext,
  getRetentionContext,
  getRetentionReactivationContext,
  getServicePlanRenewalContext,
  getSitePacketContext,
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
