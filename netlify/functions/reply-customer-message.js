// netlify/functions/reply-customer-message.js
// Operator-authenticated POST — reply to a customer portal message.
// POST { message_id, reply_text }
// Sends email to customer and marks message as replied.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');
const { getConfiguredSiteUrl }            = require('./utils/runtime-config');

function businessNameFromTenant(tenant) {
  return String(tenant?.business_name || tenant?.name || '').trim() || 'Your service provider';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const message_id = String(body.message_id || '').trim();
  const reply_text = String(body.reply_text || '').trim();

  if (!message_id) return respond(400, { error: 'message_id is required' });
  if (!reply_text) return respond(400, { error: 'reply_text is required' });
  if (reply_text.length > 2000) return respond(400, { error: 'reply_text must be 2000 characters or fewer' });

  const { data: msg, error: fetchErr } = await supabase
    .from('customer_messages')
    .select('id, tenant_id, customer_name, customer_email, message, replied_at')
    .eq('id', message_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (fetchErr) { console.error('[reply-customer-message] fetch:', fetchErr); return respond(500, { error: 'Failed to load message' }); }
  if (!msg) return respond(404, { error: 'Message not found' });

  const nowIso = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from('customer_messages')
    .update({ reply_text, replied_at: nowIso, status: 'replied', updated_at: nowIso })
    .eq('id', message_id);

  if (updateErr) { console.error('[reply-customer-message] update:', updateErr); return respond(500, { error: 'Failed to save reply' }); }

  // Email the customer the reply
  const { data: tenant } = await supabase.from('tenants').select('business_name, name').eq('id', tenantId).maybeSingle();
  const businessName = businessNameFromTenant(tenant);
  const siteUrl      = getConfiguredSiteUrl();
  const portalUrl    = `${siteUrl}/portal.html?tenant=${encodeURIComponent(tenantId)}&email=${encodeURIComponent(msg.customer_email)}`;

  sendEmail(templates.customerMessageReply({
    customer_name   : msg.customer_name || 'Customer',
    customer_email  : msg.customer_email,
    business_name   : businessName,
    original_message: msg.message,
    reply_text,
    portal_url      : portalUrl,
  })).catch((e) => console.warn('[reply-customer-message] email failed:', e.message));

  return respond(200, { ok: true });
};
