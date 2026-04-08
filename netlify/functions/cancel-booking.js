// netlify/functions/cancel-booking.js
// Public endpoint — customer cancels their own booking.
// POST { booking_id, email }
// Validates that the booking's customer_email matches the provided email.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { sendEmail, templates }    = require('./utils/email');
const { getConfiguredSiteUrl }    = require('./utils/runtime-config');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function businessNameFromTenant(tenant) {
  return String(tenant?.business_name || tenant?.name || '').trim() || 'Your service provider';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const booking_id = String(body.booking_id || '').trim();
  const email      = String(body.email || '').trim().toLowerCase();

  if (!booking_id) return respond(400, { error: 'booking_id is required' });
  if (!email)      return respond(400, { error: 'email is required' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `cancel-booking:${ip}`, maxRequests: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const supabase = getAdminClient();

  const { data: booking, error: fetchErr } = await supabase
    .from('bookings')
    .select('id, tenant_id, customer_name, customer_email, title, starts_at, ends_at, status')
    .eq('id', booking_id)
    .maybeSingle();

  if (fetchErr) { console.error('[cancel-booking] fetch:', fetchErr); return respond(500, { error: 'Failed to load booking' }); }
  if (!booking) return respond(404, { error: 'Booking not found' });

  // Validate email ownership
  if ((booking.customer_email || '').toLowerCase() !== email) {
    return respond(403, { error: 'Email does not match this booking' });
  }

  if (booking.status === 'cancelled') {
    return respond(409, { error: 'This booking is already cancelled' });
  }

  if (['completed', 'no_show'].includes(booking.status)) {
    return respond(409, { error: 'Cannot cancel a completed or no-show booking' });
  }

  const { error: updateErr } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', booking_id)
    .eq('tenant_id', booking.tenant_id);

  if (updateErr) { console.error('[cancel-booking] update:', updateErr); return respond(500, { error: 'Failed to cancel booking' }); }

  // Email customer confirmation of cancellation
  if (booking.customer_email) {
    try {
      const siteUrl  = getConfiguredSiteUrl();
      const portalUrl = `${siteUrl}/portal.html?tenant=${encodeURIComponent(booking.tenant_id)}&email=${encodeURIComponent(booking.customer_email)}`;
      const start    = booking.starts_at ? new Date(booking.starts_at) : null;
      const end      = booking.ends_at   ? new Date(booking.ends_at)   : null;
      const dateStr  = start ? start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—';
      const timeStr  = start ? start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (end ? ' – ' + end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '') : '—';
      const { data: tenant } = await supabase.from('tenants').select('business_name, name').eq('id', booking.tenant_id).maybeSingle();

      sendEmail(templates.bookingCancelled({
        customer_name : booking.customer_name || 'Customer',
        customer_email: booking.customer_email,
        business_name : businessNameFromTenant(tenant),
        title         : booking.title,
        date_str      : dateStr,
        time_str      : timeStr,
        portal_url    : portalUrl,
      })).catch((e) => console.warn('[cancel-booking] email failed:', e.message));
    } catch (e) {
      console.warn('[cancel-booking] email setup failed:', e.message);
    }
  }

  return respond(200, { ok: true });
};
