// netlify/functions/create-booking.js
// Creates a new booking.
// POST { customer_name, customer_email?, title, starts_at, ends_at, notes?, order_id? }
// Also accepts unauthenticated public bookings (no Authorization header) — used by book.html.

'use strict';

const { getAdminClient, requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }  = require('./utils/email');
const { getConfiguredSiteUrl }  = require('./utils/runtime-config');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { customer_name, customer_email, title, starts_at, ends_at, notes, order_id, tenant_id } = body;

  if (!customer_name || !title || !starts_at || !ends_at) {
    return respond(400, { error: 'Missing required fields: customer_name, title, starts_at, ends_at' });
  }
  if (isNaN(Date.parse(starts_at)) || isNaN(Date.parse(ends_at))) {
    return respond(400, { error: 'starts_at and ends_at must be valid ISO datetime strings' });
  }
  if (new Date(ends_at) <= new Date(starts_at)) {
    return respond(400, { error: 'ends_at must be after starts_at' });
  }

  // Determine tenant and operator from auth token OR public body param
  let resolvedTenantId  = tenant_id || null;
  let resolvedOperatorId = null;
  let supabase;

  const authHeader = (event.headers?.authorization || event.headers?.Authorization || '').trim();
  if (authHeader.startsWith('Bearer ')) {
    // Authenticated operator booking
    let ctx;
    try { ctx = await requireOperatorContext(event); }
    catch (err) { return respond(err.statusCode || 401, { error: err.message }); }
    supabase           = ctx.supabase;
    resolvedTenantId   = ctx.tenantId;
    resolvedOperatorId = ctx.operatorId;
  } else {
    // Public self-booking — tenant_id must be in body
    if (!resolvedTenantId) return respond(400, { error: 'tenant_id required for public bookings' });
    supabase = getAdminClient();
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      tenant_id     : resolvedTenantId,
      operator_id   : resolvedOperatorId || null,
      customer_name,
      customer_email: customer_email || null,
      title,
      starts_at,
      ends_at,
      notes         : notes || null,
      order_id      : order_id || null,
      status        : 'confirmed',
      created_at    : new Date().toISOString(),
      updated_at    : new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[create-booking]', error);
    return respond(500, { error: 'Failed to create booking' });
  }

  // Send confirmation email (non-fatal)
  if (customer_email) {
    try {
      const startDate = new Date(starts_at);
      const endDate   = new Date(ends_at);
      const dateStr   = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const timeStr   = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
                        ' – ' + endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const siteUrl   = getConfiguredSiteUrl();

      // Get business name
      const { data: tenant } = await getAdminClient()
        .from('tenants').select('name').eq('id', resolvedTenantId).single();

      const portalUrl = customer_email
        ? `${siteUrl}/portal.html?tenant=${encodeURIComponent(resolvedTenantId)}&email=${encodeURIComponent(customer_email)}`
        : null;

      sendEmail(templates.bookingConfirmation({
        customer_name,
        customer_email,
        business_name: tenant?.name || 'Your service provider',
        title,
        date_str: dateStr,
        time_str: timeStr,
        portal_url: portalUrl,
      })).catch((e) => console.warn('[create-booking] email failed:', e.message));
    } catch (e) {
      console.warn('[create-booking] email setup failed:', e.message);
    }
  }

  return respond(201, { ok: true, booking: data });
};
