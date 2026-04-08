// netlify/functions/quote-accept.js
// Public POST endpoint for a customer to accept a quote.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  return JSON.parse(body);
}

function clean(value) {
  return String(value || '').trim();
}

function buildOrderItemsFromQuote(quote = {}) {
  const title = clean(quote.title) || 'Accepted quote';
  const description = clean(quote.description || quote.notes) || null;
  const amountCents = Number(quote.amount_cents || 0) || 0;

  return [{
    name: title,
    description,
    quantity: 1,
    unit_price_cents: amountCents,
    total_cents: amountCents,
  }];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `quote-accept:${ip}`, maxRequests: 10, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  let body;
  try {
    body = parseJsonBody(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const quoteId = clean(body.quote_id);
  const signature = clean(body.signature);
  const customerEmail = clean(body.customer_email).toLowerCase();

  if (!quoteId) return respond(400, { error: 'quote_id is required' });
  if (!customerEmail) return respond(400, { error: 'customer_email is required' });

  const supabase = getAdminClient();

  try {
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, tenant_id, operator_id, customer_name, customer_email, title, description, amount_cents, valid_until, notes, status')
      .eq('id', quoteId)
      .maybeSingle();

    if (quoteError) {
      console.error('[quote-accept] quote lookup:', quoteError);
      return respond(500, { error: 'Failed to load quote' });
    }
    if (!quote) return respond(404, { error: 'Quote not found' });
    if (quote.status !== 'pending') {
      return respond(409, { error: `Quote cannot be accepted - current status: ${quote.status}` });
    }
    if (clean(quote.customer_email).toLowerCase() !== customerEmail) {
      return respond(403, { error: 'Please enter the same email address this quote was sent to before accepting it.' });
    }

    if (quote.valid_until) {
      const expiry = new Date(quote.valid_until);
      if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
        return respond(410, { error: 'This quote has expired and can no longer be accepted. Please contact us for a revised proposal.' });
      }
    }

    const nowIso = new Date().toISOString();
    const amountCents = Number(quote.amount_cents || 0) || 0;
    const items = buildOrderItemsFromQuote(quote);

    const { data: updatedRows, error: updateError } = await supabase
      .from('quotes')
      .update({ status: 'accepted', accepted_at: nowIso, updated_at: nowIso })
      .eq('id', quoteId)
      .eq('status', 'pending')
      .select('id');

    if (updateError) {
      console.error('[quote-accept] update:', updateError);
      return respond(500, { error: 'Failed to accept quote' });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return respond(409, { error: 'Quote has already been accepted or is no longer available' });
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        tenant_id: quote.tenant_id,
        operator_id: quote.operator_id || null,
        customer_name: quote.customer_name,
        email: quote.customer_email,
        cart_summary: quote.title,
        notes: quote.description || quote.notes || null,
        items,
        subtotal_cents: amountCents,
        total_cents: amountCents,
        estimated_total_cents: amountCents,
        item_count: items.length,
        unpriced_count: 0,
        status: 'confirmed',
        source_type: 'quote',
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .maybeSingle();

    if (orderError) {
      console.error('[quote-accept] order insert:', orderError);
      const rollbackAt = new Date().toISOString();
      const { error: rollbackError } = await supabase
        .from('quotes')
        .update({ status: 'pending', accepted_at: null, updated_at: rollbackAt })
        .eq('id', quoteId)
        .eq('status', 'accepted');
      if (rollbackError) {
        console.error('[quote-accept] rollback failed:', rollbackError);
      }
      return respond(500, { error: 'Failed to create order from quote' });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', quote.tenant_id)
      .maybeSingle();

    const businessName = clean(tenant?.name) || 'ProofLink';
    const siteUrl = getConfiguredSiteUrl();
    const portalUrl = quote.customer_email
      ? `${siteUrl}/portal.html?tenant=${quote.tenant_id}&email=${encodeURIComponent(quote.customer_email)}`
      : null;

    if (quote.customer_email) {
      const delivery = await sendEmail(templates.quoteAccepted({
        customer_name: quote.customer_name || 'Customer',
        customer_email: quote.customer_email,
        business_name: businessName,
        title: quote.title,
        amount: quote.amount_cents / 100,
        amount_cents: quote.amount_cents,
        order_id: order?.id || null,
        portal_url: portalUrl,
        signature: signature || null,
      }));

      if (delivery?.error) {
        console.warn('[quote-accept] Confirmation email failed:', delivery.error);
      }
    }

    return respond(200, { ok: true, order_id: order?.id || null });
  } catch (err) {
    console.error('[quote-accept]', err.message, err);
    return respond(err.statusCode || 500, { error: err.message || 'Failed to accept quote' });
  }
};
