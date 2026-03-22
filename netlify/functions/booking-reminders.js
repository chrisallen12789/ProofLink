// netlify/functions/booking-reminders.js
// Scheduled function — runs every hour, sends 24h reminder emails for upcoming bookings.
// In netlify.toml: schedule = "0 * * * *"

'use strict';

const { getAdminClient } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');

exports.handler = async () => {
  const supabase = getAdminClient();
  const now      = new Date();

  // Find bookings starting in the next 23–25 hour window (±1h from exactly 24h out)
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, tenant_id, customer_name, customer_email, title, starts_at, ends_at, status, reminder_sent_at')
    .gte('starts_at', windowStart)
    .lte('starts_at', windowEnd)
    .is('reminder_sent_at', null)
    .not('customer_email', 'is', null)
    .in('status', ['confirmed']);

  if (error) {
    console.error('[booking-reminders] query failed:', error);
    return { statusCode: 500, body: 'query failed' };
  }

  if (!bookings || bookings.length === 0) {
    console.log('[booking-reminders] no reminders to send');
    return { statusCode: 200, body: 'ok' };
  }

  const siteUrl = getConfiguredSiteUrl();
  let sent = 0;

  for (const bk of bookings) {
    try {
      const start    = new Date(bk.starts_at);
      const end      = bk.ends_at ? new Date(bk.ends_at) : null;
      const dateStr  = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const timeStr  = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
                       (end ? ' – ' + end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

      const { data: tenant } = await supabase.from('tenants').select('name').eq('id', bk.tenant_id).maybeSingle();
      const businessName = tenant?.name || 'Your service provider';
      const portalUrl    = `${siteUrl}/portal.html?tenant=${encodeURIComponent(bk.tenant_id)}&email=${encodeURIComponent(bk.customer_email)}`;

      const result = await sendEmail(templates.bookingReminder({
        customer_name : bk.customer_name || 'Customer',
        customer_email: bk.customer_email,
        business_name : businessName,
        title         : bk.title,
        date_str      : dateStr,
        time_str      : timeStr,
        portal_url    : portalUrl,
      }));

      if (!result?.error) {
        await supabase.from('bookings').update({ reminder_sent_at: now.toISOString() }).eq('id', bk.id);
        sent++;
      }
    } catch (e) {
      console.warn('[booking-reminders] failed for', bk.id, ':', e.message);
    }
  }

  console.log(`[booking-reminders] sent ${sent}/${bookings.length} reminders`);
  return { statusCode: 200, body: `sent ${sent}` };
};
