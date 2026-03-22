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

// ── Orders ────────────────────────────────────────────────────────────────────

async function getUnpaidOrders(supabase, tenantId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_name, customer_email, title, status, total_amount, total_cents, created_at, updated_at')
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
    .select('id, name, email, phone, notes, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getCustomers failed: ${error.message}`);
  return data || [];
}

async function getStaleCustomers(supabase, tenantId, daysSince = 60) {
  const cutoff = new Date(Date.now() - daysSince * 86400000).toISOString();
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, email, phone, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(20);
  if (error) throw new Error(`getStaleCustomers failed: ${error.message}`);
  return data || [];
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
  ] = await Promise.all([
    getUnpaidOrders(supabase, tenantId).catch(() => []),
    getTodayBookings(supabase, tenantId).catch(() => []),
    getUpcomingBookings(supabase, tenantId, 7).catch(() => []),
    getPendingQuotes(supabase, tenantId).catch(() => []),
    getRecentPayments(supabase, tenantId, 10).catch(() => []),
    getUnreadMessages(supabase, tenantId).catch(() => []),
    getStaleCustomers(supabase, tenantId, 45).catch(() => []),
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
  };
}

module.exports = {
  getBusinessContext,
  getUnpaidOrders,
  getRecentOrders,
  getOrderById,
  getUpcomingBookings,
  getTodayBookings,
  getCustomers,
  getStaleCustomers,
  getRecentPayments,
  getPendingQuotes,
  getUnreadMessages,
};
