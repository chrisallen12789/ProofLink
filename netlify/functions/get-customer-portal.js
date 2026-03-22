// netlify/functions/get-customer-portal.js
// Public endpoint — returns a customer's order & booking history for a given tenant.
// POST { email, tenant_id }
// No auth required — customer identifies via email.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { email, tenant_id } = body;
  if (!email || !tenant_id) return respond(400, { error: 'Missing email or tenant_id' });

  const normalizedEmail = String(email).trim().toLowerCase();
  const supabase = getAdminClient();

  // Verify tenant exists (also returns business_name)
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, business_name')
    .eq('id', tenant_id)
    .single();

  if (tenantErr || !tenant) return respond(404, { error: 'Business not found' });

  // Fetch orders for this email+tenant (safe public fields only)
  const { data: orders } = await supabase
    .from('orders')
    .select('id, title, status, total_amount, created_at, updated_at, description, line_items, customer_name')
    .eq('tenant_id', tenant_id)
    .ilike('customer_email', normalizedEmail)
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

  return respond(200, {
    business_name: tenant.business_name,
    orders  : orders   || [],
    bookings: bookings || [],
  });
};
