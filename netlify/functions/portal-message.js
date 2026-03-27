'use strict';

// netlify/functions/portal-message.js
// Public endpoint — no auth required.
// POST { tenant_id, email, name, message }
// Stores a customer message and notifies the operator team.

const { getAdminClient, respond } = require('./utils/auth');
const { sendEmail } = require('./utils/email');

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const { tenant_id, email, name, message } = body;

  if (!tenant_id || !email || !name || !message) {
    return respond(400, { error: 'tenant_id, email, name, and message are required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: 'email is not a valid email address' });
  }

  if (message.length > 2000) {
    return respond(400, { error: 'Message must be 2000 characters or fewer' });
  }

  const supabase = getAdminClient();

  // Verify tenant exists
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, email')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantErr) {
    console.error('[portal-message] Tenant lookup error:', tenantErr);
    return respond(500, { error: 'Failed to look up tenant' });
  }

  if (!tenant) {
    return respond(404, { error: 'Tenant not found' });
  }

  // Store message in customer_messages table (best-effort — table may not exist yet)
  try {
    const { error: insertErr } = await supabase
      .from('customer_messages')
      .insert({
        tenant_id,
        customer_email: email.trim().toLowerCase(),
        customer_name : name.trim(),
        message       : message.trim(),
        created_at    : new Date().toISOString(),
        status        : 'unread',
      });

    if (insertErr) {
      if (insertErr.message && insertErr.message.includes('relation does not exist')) {
        console.warn('[portal-message] customer_messages table does not exist — skipping DB insert');
      } else {
        console.error('[portal-message] Insert error:', insertErr);
      }
    }
  } catch (err) {
    console.error('[portal-message] Unexpected insert error:', err.message);
  }

  // Look up up to 5 operators for this tenant
  const { data: operators } = await supabase
    .from('operators')
    .select('email')
    .eq('tenant_id', tenant_id)
    .limit(5);

  const recipientEmails = Array.isArray(operators)
    ? operators.map((op) => op.email).filter(Boolean)
    : [];

  if (recipientEmails.length > 0) {
    const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const html = [
      '<p>A customer sent a message from the customer portal:</p>',
      `<p><strong>From:</strong> ${esc(name.trim())} (${esc(email.trim())})</p>`,
      '<p><strong>Message:</strong></p>',
      `<blockquote>${esc(message.trim())}</blockquote>`,
    ].join('');

    for (const to of recipientEmails) {
      await sendEmail({
        to,
        subject: `New message from ${name.trim()} via portal`,
        html,
      });
    }
  }

  return respond(200, { ok: true });
};
