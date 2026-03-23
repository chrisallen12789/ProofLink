'use strict';

// netlify/functions/quote-decline.js
// Public endpoint — no auth required.
// POST { quote_id, reason? }
// Marks a quote as declined and notifies the operator team.

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

  const { quote_id, reason } = body;

  if (!quote_id) {
    return respond(400, { error: 'quote_id is required' });
  }

  const supabase = getAdminClient();

  // Look up the quote
  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .select('id, title, status, tenant_id')
    .eq('id', quote_id)
    .maybeSingle();

  if (quoteErr) {
    console.error('[quote-decline] Quote lookup error:', quoteErr);
    return respond(500, { error: 'Failed to look up quote' });
  }

  if (!quote) {
    return respond(404, { error: 'Quote not found' });
  }

  if (quote.status !== 'pending' && quote.status !== 'sent') {
    return respond(400, { error: 'Quote is no longer active' });
  }

  // Update quote to declined
  const { error: updateErr } = await supabase
    .from('quotes')
    .update({
      status        : 'declined',
      declined_at   : new Date().toISOString(),
      decline_reason: reason || null,
    })
    .eq('id', quote_id);

  if (updateErr) {
    console.error('[quote-decline] Update error:', updateErr);
    return respond(500, { error: 'Failed to update quote' });
  }

  // Look up tenant
  const { data: _tenant } = await supabase
    .from('tenants')
    .select('name, email')
    .eq('id', quote.tenant_id)
    .maybeSingle();

  // Look up operators for this tenant
  const { data: operators } = await supabase
    .from('operators')
    .select('email')
    .eq('tenant_id', quote.tenant_id);

  // Collect operator emails to notify
  const recipientEmails = [];
  if (Array.isArray(operators)) {
    for (const op of operators) {
      if (op.email) recipientEmails.push(op.email);
    }
  }

  if (recipientEmails.length > 0) {
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const reasonHtml = reason
      ? `<p><strong>Reason:</strong> ${esc(reason)}</p>`
      : '';

    const html = `<p>A customer has declined the quote <strong>${esc(quote.title)}</strong>.</p>${reasonHtml}`;

    for (const to of recipientEmails) {
      await sendEmail({
        to,
        subject: `Quote declined: ${quote.title}`,
        html,
      });
    }
  }

  return respond(200, { ok: true });
};
