// netlify/functions/get-customer-portal.js
// Public endpoint — returns a customer's order & booking history for a given tenant.
// POST { email, tenant_id }
// No auth required — customer identifies via email.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function normalizeEstimateStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['sent', 'review', 'ready_to_send'].includes(value)) return 'pending';
  if (value === 'approved') return 'accepted';
  return value || 'pending';
}

function normalizeLegacyQuote(quote) {
  return {
    id: quote.id,
    title: quote.title,
    description: quote.description || '',
    amount_cents: quote.amount_cents || 0,
    status: normalizeEstimateStatus(quote.status),
    valid_until: quote.valid_until || null,
    created_at: quote.created_at || null,
    source_type: 'quote',
    review_url: null,
  };
}

function normalizeBidEstimate(bid) {
  return {
    id: bid.id,
    title: bid.title,
    description: bid.project_summary || '',
    amount_cents: bid.total_cents || 0,
    status: normalizeEstimateStatus(bid.status),
    valid_until: bid.valid_until || null,
    created_at: bid.created_at || null,
    source_type: 'bid',
    review_url: `/quote.html?token=${encodeURIComponent(bid.id)}`,
  };
}

function normalizeTenantBusinessName(tenant) {
  return tenant?.business_name || tenant?.name || '';
}

async function fetchPortalTenant(supabase, tenantId) {
  const preferred = await supabase
    .from('tenants')
    .select('id, business_name, name')
    .eq('id', tenantId)
    .maybeSingle();

  if (!preferred.error) return preferred;

  const missingBusinessName = String(preferred.error?.message || '').toLowerCase().includes('business_name');
  if (!missingBusinessName) return preferred;

  return supabase
    .from('tenants')
    .select('id, name')
    .eq('id', tenantId)
    .maybeSingle();
}

function normalizePortalOrder(order) {
  const totalCents = Number(order?.total_cents || 0) || 0;
  return {
    ...order,
    title: order.cart_summary || order.customer_name || 'Order',
    total_amount: totalCents / 100,
  };
}

function sortNewestFirst(rows) {
  return [...rows].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { email, tenant_id } = body;
  if (!email || !tenant_id) return respond(400, { error: 'Missing email or tenant_id' });

  const ip = getClientIP(event);
  const normalizedEmail = String(email).trim().toLowerCase();
  const ipWindow = checkRateLimit({ key: `get-customer-portal:${ip}`, maxRequests: 12, windowMs: 15 * 60 * 1000 });
  if (!ipWindow.allowed) return rateLimitResponse(ipWindow.retryAfterMs);
  const lookupWindow = checkRateLimit({
    key: `get-customer-portal:${tenant_id}:${normalizedEmail}:${ip}`,
    maxRequests: 8,
    windowMs: 15 * 60 * 1000,
  });
  if (!lookupWindow.allowed) return rateLimitResponse(lookupWindow.retryAfterMs);

  const supabase = getAdminClient();

  // Verify tenant exists
  const { data: tenant, error: tenantErr } = await fetchPortalTenant(supabase, tenant_id);

  if (tenantErr || !tenant) return respond(404, { error: 'Business not found' });

  // Fetch orders for this email+tenant — try both email columns since orders can come from
  // different sources (storefront uses `email`, operator-created use `customer_email`)
  const { data: orders } = await supabase
    .from('orders')
    .select('id, cart_summary, status, total_cents, amount_paid_cents, amount_due_cents, payment_state, payment_due_date, created_at, customer_name, order_type, package_sessions_total, package_sessions_used, package_valid_until')
    .eq('tenant_id', tenant_id)
    .ilike('email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch bookings for this email+tenant
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, title, status, starts_at, ends_at, notes')
    .eq('tenant_id', tenant_id)
    .ilike('customer_email', normalizedEmail)
    .order('starts_at', { ascending: false })
    .limit(20);

  // Fetch legacy quotes for this email+tenant.
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, title, description, amount_cents, status, valid_until, created_at')
    .eq('tenant_id', tenant_id)
    .ilike('customer_email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('tenant_id', tenant_id)
    .ilike('email', normalizedEmail)
    .limit(20);

  const { data: leads } = await supabase
    .from('leads')
    .select('id, customer_id, contact_name')
    .eq('tenant_id', tenant_id)
    .ilike('contact_email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(50);

  const customerIds = [
    ...(customers || []).map((row) => row.id),
    ...(leads || []).map((row) => row.customer_id),
  ].filter(Boolean);
  const customerNames = [
    ...(customers || []).map((row) => String(row.name || '').trim()),
    ...(leads || []).map((row) => String(row.contact_name || '').trim()),
  ].filter(Boolean);
  const leadIds = (leads || []).map((row) => row.id).filter(Boolean);
  let linkedOrders = [];
  if (customerIds.length) {
    const { data } = await supabase
      .from('orders')
      .select('id, cart_summary, status, total_cents, amount_paid_cents, amount_due_cents, payment_state, payment_due_date, created_at, customer_name, order_type, package_sessions_total, package_sessions_used, package_valid_until, customer_id')
      .eq('tenant_id', tenant_id)
      .in('customer_id', customerIds)
      .order('created_at', { ascending: false })
      .limit(50);
    linkedOrders = data || [];
  }
  if (customerNames.length) {
    const { data } = await supabase
      .from('orders')
      .select('id, cart_summary, status, total_cents, amount_paid_cents, amount_due_cents, payment_state, payment_due_date, created_at, customer_name, order_type, package_sessions_total, package_sessions_used, package_valid_until, customer_id')
      .eq('tenant_id', tenant_id)
      .in('customer_name', customerNames)
      .order('created_at', { ascending: false })
      .limit(50);
    linkedOrders = [...linkedOrders, ...(data || [])];
  }
  if (leadIds.length) {
    const { data } = await supabase
      .from('orders')
      .select('id, cart_summary, status, total_cents, amount_paid_cents, amount_due_cents, payment_state, payment_due_date, created_at, customer_name, order_type, package_sessions_total, package_sessions_used, package_valid_until, customer_id, lead_id')
      .eq('tenant_id', tenant_id)
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false })
      .limit(50);
    linkedOrders = [...linkedOrders, ...(data || [])];
  }
  const mergedOrders = sortNewestFirst([
    ...new Map([...(orders || []), ...linkedOrders].map((row) => [row.id, normalizePortalOrder(row)])).values(),
  ]);

  let bidEstimates = [];
  if (customerIds.length || leadIds.length) {
    const bidQuery = supabase
      .from('bids')
      .select('id, title, project_summary, total_cents, status, valid_until, created_at, customer_id, lead_id')
      .eq('tenant_id', tenant_id)
      .order('created_at', { ascending: false });
    if (customerIds.length && leadIds.length) {
      bidQuery.or(`customer_id.in.(${customerIds.join(',')}),lead_id.in.(${leadIds.join(',')})`);
    } else if (customerIds.length) {
      bidQuery.in('customer_id', customerIds);
    } else {
      bidQuery.in('lead_id', leadIds);
    }
    const { data: bids } = await bidQuery.limit(10);

    bidEstimates = (bids || [])
      .filter((row) => ['sent', 'review', 'ready_to_send', 'pending', 'approved', 'expired'].includes(String(row.status || '').trim().toLowerCase()))
      .map(normalizeBidEstimate);
  }

  const estimateRows = [
    ...(quotes || []).map(normalizeLegacyQuote),
    ...bidEstimates,
  ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  return respond(200, {
    business_name: normalizeTenantBusinessName(tenant),
    orders  : mergedOrders,
    bookings: bookings || [],
    quotes  : estimateRows,
  });
};
