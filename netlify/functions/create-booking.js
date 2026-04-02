// netlify/functions/create-booking.js
// Creates a new booking.
// POST { customer_name, customer_email?, title, starts_at, ends_at, notes?, order_id?, service_address? }
// Also accepts unauthenticated public bookings (no Authorization header) - used by book.html.

'use strict';

const { getAdminClient, requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }  = require('./utils/email');
const { getConfiguredSiteUrl }  = require('./utils/runtime-config');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function parseConfigValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function formatBookingWindow(startsAt, endsAt, timezone) {
  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);
  const resolvedTimezone = timezone || 'America/New_York';
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: resolvedTimezone,
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: resolvedTimezone,
  });

  return {
    date: dateFormatter.format(startDate),
    time: `${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`,
    timezone: resolvedTimezone,
  };
}

function cleanText(value) {
  return String(value || '').trim();
}

function buildBookingNotes({ notes, serviceAddress, preferredTime, referralSource }) {
  const parts = [];
  const baseNotes = cleanText(notes);
  if (baseNotes) parts.push(baseNotes);

  const extras = [
    serviceAddress ? `Service address: ${cleanText(serviceAddress)}` : '',
    preferredTime ? `Preferred time: ${cleanText(preferredTime)}` : '',
    referralSource ? `Referral source: ${cleanText(referralSource)}` : '',
  ].filter(Boolean);

  return [...parts, ...extras].join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const {
    customer_name,
    customer_email,
    title,
    starts_at,
    ends_at,
    notes,
    order_id,
    tenant_id,
    preferred_time,
    referral_source,
    service_address,
  } = body;

  if (!customer_name || !title || !starts_at || !ends_at) {
    return respond(400, { error: 'Missing required fields: customer_name, title, starts_at, ends_at' });
  }
  if (customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    return respond(400, { error: 'customer_email is not a valid email address' });
  }
  if (isNaN(Date.parse(starts_at)) || isNaN(Date.parse(ends_at))) {
    return respond(400, { error: 'starts_at and ends_at must be valid ISO datetime strings' });
  }
  if (new Date(ends_at) <= new Date(starts_at)) {
    return respond(400, { error: 'ends_at must be after starts_at' });
  }
  if (new Date(starts_at).getTime() < (Date.now() - 60 * 1000)) {
    return respond(400, { error: 'Bookings must be requested for a future time.' });
  }

  const bookingNotes = buildBookingNotes({
    notes,
    serviceAddress: service_address,
    preferredTime: preferred_time,
    referralSource: referral_source,
  });

  let resolvedTenantId = tenant_id || null;
  let resolvedOperatorId = null;
  let supabase;

  const authHeader = (event.headers?.authorization || event.headers?.Authorization || '').trim();
  if (authHeader.startsWith('Bearer ')) {
    let ctx;
    try { ctx = await requireOperatorContext(event); }
    catch (err) { return respond(err.statusCode || 401, { error: err.message }); }
    supabase = ctx.supabase;
    resolvedTenantId = ctx.tenantId;
    resolvedOperatorId = ctx.operatorId;
  } else {
    if (!resolvedTenantId) return respond(400, { error: 'tenant_id required for public bookings' });
    const ip = getClientIP(event);
    const rl = checkRateLimit({ key: `create-booking:${resolvedTenantId}:${ip}`, maxRequests: 10, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
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
      notes         : bookingNotes || null,
      order_id      : order_id || null,
      status        : 'confirmed',
      created_at    : new Date().toISOString(),
      updated_at    : new Date().toISOString(),
    })
    .select()
    .maybeSingle();

  if (error) {
    console.error('[create-booking]', error);
    return respond(500, { error: 'Failed to create booking' });
  }
  if (!data) {
    return respond(500, { error: 'Failed to create booking: no record returned' });
  }

  let tenantContext = null;
  try {
    const [{ data: tenant }, { data: siteSettingsRow }, { data: availabilityRow }] = await Promise.all([
      supabase.from('tenants').select('name').eq('id', resolvedTenantId).maybeSingle(),
      supabase.from('tenant_config').select('config_value').eq('tenant_id', resolvedTenantId).eq('config_key', 'site_settings').maybeSingle(),
      supabase.from('availability').select('timezone').eq('tenant_id', resolvedTenantId).limit(1).maybeSingle(),
    ]);
    const siteSettings = parseConfigValue(siteSettingsRow?.config_value);
    tenantContext = {
      businessName: tenant?.name || 'Your service provider',
      timezone: availabilityRow?.timezone || siteSettings.timezone || siteSettings.site_timezone || 'America/New_York',
    };
  } catch (lookupError) {
    console.warn('[create-booking] tenant context lookup failed:', lookupError.message || lookupError);
  }

  if (customer_email) {
    try {
      const bookingWindow = formatBookingWindow(starts_at, ends_at, tenantContext?.timezone);
      const siteUrl = getConfiguredSiteUrl();
      const portalUrl = `${siteUrl}/portal.html?tenant=${encodeURIComponent(resolvedTenantId)}&email=${encodeURIComponent(customer_email)}`;

      sendEmail(templates.bookingConfirmation({
        customer_name,
        customer_email,
        business_name: tenantContext?.businessName || 'Your service provider',
        title,
        date_str: bookingWindow.date,
        time_str: `${bookingWindow.time} (${bookingWindow.timezone})`,
        portal_url: portalUrl,
      })).catch((e) => console.warn('[create-booking] email failed:', e.message));
    } catch (e) {
      console.warn('[create-booking] email setup failed:', e.message);
    }
  }

  try {
    const siteUrl = getConfiguredSiteUrl();
    let operatorEmail = null;
    let operatorName  = 'there';

    if (resolvedOperatorId) {
      const { data: operatorRow } = await supabase
        .from('operators').select('email, name').eq('id', resolvedOperatorId).maybeSingle();
      operatorEmail = operatorRow?.email || null;
      operatorName  = operatorRow?.name  || 'there';
    } else {
      const { data: operatorRow } = await supabase
        .from('operators').select('email, name').eq('tenant_id', resolvedTenantId).limit(1).maybeSingle();
      operatorEmail = operatorRow?.email || null;
      operatorName  = operatorRow?.name  || 'there';
    }

    if (operatorEmail) {
      sendEmail(templates.newBookingOperator({
        operator_email: operatorEmail,
        operator_name : operatorName,
        business_name : tenantContext?.businessName || 'Your Business',
        customer_name,
        service_title : title,
        starts_at,
        notes         : bookingNotes || null,
        booking_url   : `${siteUrl}/operator/`,
      })).catch((e) => console.warn('[create-booking] operator notification failed:', e.message));
    }
  } catch (e) {
    console.warn('[create-booking] operator notification setup failed:', e.message);
  }

  return respond(201, { ok: true, booking: data });
};
