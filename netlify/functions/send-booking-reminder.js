'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail }                       = require('./utils/email');
const { getConfiguredSiteUrl }            = require('./utils/runtime-config');

// ── Email layout helpers (mirrored from utils/email.js) ───────────────────────
const T = {
  bg:'#F4F1EC', card:'#FFFFFF', border:'#E2DDD6', ink:'#1A1A1A',
  muted:'#6B6560', hint:'#9C9490', red:'#C84B2F',
};

function layout(content, { preheader = '' } = {}) {
  const siteUrl = (() => { try { return getConfiguredSiteUrl(); } catch { return 'https://prooflink.co'; } })();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>ProofLink</title>${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}&nbsp;</div>` : ''}</head><body style="margin:0;padding:0;background:${T.bg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:${T.bg};padding:48px 20px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;"><tr><td style="padding-bottom:32px;"><a href="${siteUrl}" style="text-decoration:none;"><span style="font-size:20px;font-weight:800;color:${T.ink};letter-spacing:-0.04em;">Proof<span style="color:${T.red};">Link</span></span></a></td></tr><tr><td style="background:${T.card};border:1px solid ${T.border};border-radius:10px;overflow:hidden;">${content}</td></tr><tr><td style="padding-top:28px;text-align:center;"><p style="margin:0 0 6px;font-size:12px;color:${T.hint};">ProofLink &nbsp;·&nbsp; <a href="${siteUrl}" style="color:${T.hint};text-decoration:none;">${siteUrl.replace('https://', '')}</a></p><p style="margin:0;font-size:11px;color:${T.hint};">You received this because you have an upcoming appointment.</p></td></tr></table></td></tr></table></body></html>`;
}

function accentBar(color = T.red)  { return `<tr><td style="background:${color};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>`; }
function bodyWrap(c)               { return `<tr><td style="padding:40px 44px;">${c}</td></tr>`; }
function h1(t)                     { return `<h1 style="margin:0 0 6px;font-size:28px;font-weight:800;color:${T.ink};letter-spacing:-0.04em;line-height:1.15;">${t}</h1>`; }
function sub(t)                    { return `<p style="margin:0 0 28px;font-size:15px;color:${T.muted};line-height:1.65;">${t}</p>`; }
function p(t)                      { return `<p style="margin:0 0 16px;font-size:14px;color:${T.muted};line-height:1.75;">${t}</p>`; }
function divider()                 { return `<div style="border-top:1px solid ${T.border};margin:32px 0;"></div>`; }
function cta(text, href, bg = T.red) { return `<a href="${href}" style="display:inline-block;background:${bg};color:#ffffff;padding:14px 32px;border-radius:5px;font-size:15px;font-weight:700;text-decoration:none;">${text}</a>`; }
function infoBox(rows)             { return `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${T.border};border-radius:6px;overflow:hidden;margin:0 0 28px;">${rows.map(([l, v], i) => `<tr><td style="padding:11px 16px;font-size:13px;color:${T.hint};width:120px;background:${i % 2 === 0 ? T.bg : T.card};border-bottom:1px solid ${T.border};white-space:nowrap;">${l}</td><td style="padding:11px 16px;font-size:13px;color:${T.ink};font-weight:500;background:${i % 2 === 0 ? T.bg : T.card};border-bottom:1px solid ${T.border};">${v}</td></tr>`).join('')}</table>`; }
function escHtml(str) { return String(str == null ? '' : str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Date/time formatting helpers ──────────────────────────────────────────────

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
}

// ── Statuses that cannot receive a reminder ───────────────────────────────────
const TERMINAL_STATUSES = new Set(['cancelled', 'completed', 'no_show']);

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return respond(204, {});
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, tenantId } = ctx;

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { booking_id } = body;
  if (!booking_id) {
    return respond(400, { error: 'booking_id is required' });
  }

  // ── Look up booking ─────────────────────────────────────────────────────────
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('id, title, customer_name, customer_email, starts_at, ends_at, status, notes')
    .eq('id', booking_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (bookingErr) {
    console.error('[send-booking-reminder] Booking lookup error:', bookingErr);
    return respond(500, { error: 'Failed to look up booking' });
  }

  if (!booking) {
    return respond(404, { error: 'Booking not found' });
  }

  if (!booking.customer_email) {
    return respond(400, { error: 'Booking has no customer email' });
  }

  if (TERMINAL_STATUSES.has(booking.status)) {
    return respond(400, { error: `Cannot send reminder for a booking with status: ${booking.status}` });
  }

  // ── Look up tenant name ─────────────────────────────────────────────────────
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const businessName = tenant?.name || 'your appointment provider';

  // ── Build date / time strings ───────────────────────────────────────────────
  const dateStr  = formatDate(booking.starts_at);
  const timeStr  = booking.ends_at
    ? `${formatTime(booking.starts_at)} – ${formatTime(booking.ends_at)}`
    : formatTime(booking.starts_at);

  // ── Build portal URL ────────────────────────────────────────────────────────
  let siteUrl;
  try {
    siteUrl = getConfiguredSiteUrl();
  } catch (err) {
    console.error('[send-booking-reminder] Site URL error:', err.message);
    return respond(503, { error: err.message });
  }

  const portalUrl = `${siteUrl}/portal.html?tenant=${encodeURIComponent(tenantId)}&email=${encodeURIComponent(booking.customer_email)}`;

  // ── Clean notes (strip "Preferred time:" prefix if present) ────────────────
  const rawNotes   = String(booking.notes || '').trim();
  const cleanNotes = rawNotes.replace(/^Preferred time:\s*/i, '').trim();

  // ── Build email HTML ────────────────────────────────────────────────────────
  const infoRows = [
    ['Appointment', escHtml(booking.title || 'Appointment')],
    ['Date',        dateStr],
    ['Time',        timeStr],
  ];

  const content = `<table width="100%" cellpadding="0" cellspacing="0">${accentBar()}${bodyWrap(`
    ${h1('Appointment Reminder')}
    ${sub(`Hi ${escHtml(booking.customer_name || 'there')},`)}
    ${p('This is a friendly reminder about your upcoming appointment.')}
    ${infoBox(infoRows)}
    ${cleanNotes ? `${p(`<strong>Notes:</strong> ${escHtml(cleanNotes)}`)}` : ''}
    ${divider()}
    ${p('Need to make changes? You can view or manage your appointment through the link below.')}
    <div style="margin:0 0 32px;">${cta('View My Appointment', portalUrl)}</div>
    ${p(`We look forward to seeing you soon.`)}
    ${p(`Warm regards,<br/><strong>${escHtml(businessName)}</strong>`)}
  `)}
  </table>`;

  const html = layout(content, { preheader: `Reminder: your appointment on ${dateStr}` });

  // ── Send email ──────────────────────────────────────────────────────────────
  const emailResult = await sendEmail({
    to     : booking.customer_email,
    subject: `Reminder: Your appointment with ${businessName} – ${dateStr}`,
    html,
  });

  if (emailResult.error) {
    console.error('[send-booking-reminder] Email send error:', emailResult.error);
    return respond(500, { error: 'Failed to send reminder email' });
  }

  // ── Update reminder_sent_at (best-effort — ignore if column missing) ────────
  try {
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', booking.id)
      .eq('tenant_id', tenantId);

    if (updateErr) {
      console.warn('[send-booking-reminder] Could not update reminder_sent_at:', updateErr.message);
    }
  } catch (updateEx) {
    console.warn('[send-booking-reminder] Exception updating reminder_sent_at:', updateEx.message);
  }

  return respond(200, {
    ok            : true,
    booking_id    : booking.id,
    customer_email: booking.customer_email,
  });
};
