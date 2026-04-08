// netlify/functions/update-booking.js
// Updates or cancels a booking.
// PATCH { id, ...fields }  — only operator can update their tenant's bookings

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');
const { getConfiguredSiteUrl }            = require('./utils/runtime-config');
const {
  isGoogleCalendarConfigured,
  getOperatorCalendarConnection,
  syncBookingsToGoogleCalendar,
} = require('./utils/google-calendar');

const ALLOWED_FIELDS = ['title', 'customer_name', 'customer_email', 'starts_at', 'ends_at', 'notes', 'status', 'preferred_time', 'location', 'assigned_operator_id', 'notes_vehicle', 'service_address', 'location_label'];
const VALID_STATUSES = ['confirmed', 'cancelled', 'completed', 'no_show'];
function businessNameFromTenant(tenant) {
  return String(tenant?.business_name || tenant?.name || '').trim() || 'Your service provider';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'PATCH' && event.httpMethod !== 'POST')
    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId, operatorId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { id, ...rest } = body;
  if (!id) return respond(400, { error: 'Missing booking id' });

  if (rest.status && !VALID_STATUSES.includes(rest.status)) {
    return respond(400, { error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const patch = {};
  ALLOWED_FIELDS.forEach((f) => { if (rest[f] !== undefined) patch[f] = rest[f]; });
  if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
  if (Object.prototype.hasOwnProperty.call(rest, 'assigned_operator_id')) {
    patch.assigned_operator_id = rest.assigned_operator_id || null;
  }
  if (Object.prototype.hasOwnProperty.call(rest, 'notes_vehicle')) {
    patch.notes_vehicle = rest.notes_vehicle || null;
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[update-booking]', error);
    return respond(500, { error: 'Failed to update booking' });
  }
  if (!data) return respond(404, { error: 'Booking not found or access denied' });

  // Email customer when booking is cancelled or rescheduled
  const isCancellation = patch.status === 'cancelled';
  const timeChanged    = !!(patch.starts_at || patch.ends_at);
  if (data.customer_email && (isCancellation || timeChanged)) {
    try {
      const siteUrl    = getConfiguredSiteUrl();
      const tenantIdEnc = encodeURIComponent(data.tenant_id);
      const emailEnc    = encodeURIComponent(data.customer_email);
      const portalUrl  = `${siteUrl}/portal.html?tenant=${tenantIdEnc}&email=${emailEnc}`;
      const rebookUrl  = `${siteUrl}/book.html?tenant=${tenantIdEnc}`;
      const start      = data.starts_at ? new Date(data.starts_at) : null;
      const end        = data.ends_at   ? new Date(data.ends_at)   : null;
      const dateStr    = start ? start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—';
      const timeStr    = start ? start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (end ? ' – ' + end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '') : '—';

      const { data: tenant } = await supabase.from('tenants').select('business_name, name').eq('id', data.tenant_id).maybeSingle();
      const businessName = businessNameFromTenant(tenant);

      if (isCancellation) {
        sendEmail(templates.bookingCancelled({
          customer_name : data.customer_name || 'Customer',
          customer_email: data.customer_email,
          business_name : businessName,
          title         : data.title,
          date_str      : dateStr,
          time_str      : timeStr,
          portal_url    : portalUrl,
          rebook_url    : rebookUrl,
        })).catch((e) => console.warn('[update-booking] cancel email failed:', e.message));
      } else if (timeChanged) {
        // Dedup: skip if a confirmation email was sent within the last 5 minutes
        const lastSent = data.confirmation_sent_at ? new Date(data.confirmation_sent_at) : null;
        const tooRecent = lastSent && (Date.now() - lastSent.getTime()) < 5 * 60 * 1000;
        if (!tooRecent) {
          const newStart   = new Date(data.starts_at);
          const newEnd     = data.ends_at ? new Date(data.ends_at) : null;
          const newDateStr = newStart.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          const newTimeStr = newStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (newEnd ? ' – ' + newEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
          sendEmail(templates.bookingConfirmation({
            customer_name : data.customer_name || 'Customer',
            customer_email: data.customer_email,
            business_name : businessName,
            title         : data.title,
            date_str      : newDateStr,
            time_str      : newTimeStr,
            location      : data.location || null,
            notes         : data.notes || null,
            portal_url    : portalUrl,
          })).catch((e) => console.warn('[update-booking] reschedule email failed:', e.message));
          // Stamp confirmation_sent_at
          supabase.from('bookings')
            .update({ confirmation_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', data.id)
            .eq('tenant_id', tenantId)
            .then(() => {}).catch((e) => console.warn('[update-booking] confirmation_sent_at update failed:', e.message));
        }
      }
    } catch (e) {
      console.warn('[update-booking] email setup failed:', e.message);
    }
  }

  if (operatorId && isGoogleCalendarConfigured()) {
    try {
      const connection = await getOperatorCalendarConnection(supabase, tenantId, operatorId);
      if (connection?.export_bookings === true && String(connection.sync_mode || '').trim().toLowerCase() === 'read_write') {
        await syncBookingsToGoogleCalendar({
          supabase,
          connection,
          bookings: [data],
        });
      }
    } catch (syncError) {
      console.warn('[update-booking] google calendar sync failed:', syncError.message || syncError);
    }
  }

  return respond(200, { ok: true, booking: data });
};
