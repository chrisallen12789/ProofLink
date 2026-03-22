// netlify/functions/quote-accept.js
// Public POST endpoint for a customer to accept a quote.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  return JSON.parse(body);
}

function clean(value) {
  return String(value || '').trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = parseJsonBody(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const quoteId   = clean(body.quote_id);
  const signature = clean(body.signature);

  if (!quoteId) return respond(400, { error: 'quote_id is required' });

  const supabase = getAdminClient();

  try {
    // Fetch the quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, tenant_id, operator_id, customer_name, customer_email, title, description, amount_cents, valid_until, notes, status')
      .eq('id', quoteId)
      .maybeSingle();

    if (quoteError) { console.error('[quote-accept] quote lookup:', quoteError); return respond(500, { error: 'Failed to load quote' }); }
    if (!quote)     return respond(404, { error: 'Quote not found' });
    if (quote.status !== 'pending') {
      return respond(409, { error: `Quote cannot be accepted — current status: ${quote.status}` });
    }

    const nowIso = new Date().toISOString();

    // Mark the quote as accepted
    const { error: updateError } = await supabase
      .from('quotes')
      .update({ status: 'accepted', accepted_at: nowIso, updated_at: nowIso })
      .eq('id', quoteId);

    if (updateError) { console.error('[quote-accept] update:', updateError); return respond(500, { error: 'Failed to accept quote' }); }

    // Create an order from the quote
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        tenant_id      : quote.tenant_id,
        operator_id    : quote.operator_id || null,
        customer_name  : quote.customer_name,
        customer_email : quote.customer_email,
        title          : quote.title,
        notes          : quote.description || quote.notes || null,
        total_cents    : quote.amount_cents,
        total_amount   : quote.amount_cents != null ? quote.amount_cents / 100 : null,
        status         : 'confirmed',
        source_type    : 'quote',
        created_at     : nowIso,
        updated_at     : nowIso,
      })
      .select('id')
      .maybeSingle();

    if (orderError) { console.error('[quote-accept] order insert:', orderError); return respond(500, { error: 'Failed to create order from quote' }); }

    // Fetch tenant name for confirmation email
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', quote.tenant_id)
      .maybeSingle();

    const businessName = clean(tenant?.name) || 'ProofLink';
    const siteUrl      = getConfiguredSiteUrl();
    const portalUrl    = quote.customer_email
      ? `${siteUrl}/portal.html?tenant=${quote.tenant_id}&email=${encodeURIComponent(quote.customer_email)}`
      : null;

    if (quote.customer_email) {
      const delivery = await sendEmail(templates.quoteAccepted({
        customer_name  : quote.customer_name || 'Customer',
        customer_email : quote.customer_email,
        business_name  : businessName,
        title          : quote.title,
        amount         : quote.amount_cents / 100,
        amount_cents   : quote.amount_cents,
        order_id       : order?.id || null,
        portal_url     : portalUrl,
        signature      : signature || null,
      }));

      if (delivery?.error) {
        console.warn('[quote-accept] Confirmation email failed:', delivery.error);
      }
    }

    return respond(200, { ok: true, order_id: order?.id || null });
  } catch (err) {
    console.error('[quote-accept]', err);
    return respond(err.statusCode || 500, { error: err.message || 'Failed to accept quote' });
  }
};
