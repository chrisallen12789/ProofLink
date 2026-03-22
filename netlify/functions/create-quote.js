// netlify/functions/create-quote.js
// Operator-authenticated POST to create a quote and email the customer a quote link.

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');
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

  const customerName  = clean(body.customer_name);
  const customerEmail = clean(body.customer_email);
  const title         = clean(body.title);
  const description   = clean(body.description);
  const amount        = Number(body.amount);

  if (!customerName)                             return respond(400, { error: 'customer_name is required' });
  if (!customerEmail)                            return respond(400, { error: 'customer_email is required' });
  if (!title)                                    return respond(400, { error: 'title is required' });
  if (title.length > 200)                        return respond(400, { error: 'title must be 200 characters or fewer' });
  if (description.length > 5000)                 return respond(400, { error: 'description must be 5000 characters or fewer' });
  if (!amount || isNaN(amount) || amount <= 0)   return respond(400, { error: 'amount must be a positive number' });
  if (amount > 999999)                           return respond(400, { error: 'amount exceeds maximum allowed value' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, tenantId, operatorId } = ctx;

  try {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle();

    if (tenantError) { console.error('[create-quote] tenant lookup:', tenantError); return respond(500, { error: 'Failed to create quote' }); }

    const businessName = clean(tenant?.name) || 'ProofLink';
    const siteUrl      = getConfiguredSiteUrl();
    const nowIso       = new Date().toISOString();

    const insertPayload = {
      tenant_id      : tenantId,
      operator_id    : operatorId,
      customer_name  : customerName,
      customer_email : customerEmail,
      title,
      description    : description || null,
      amount_cents   : Math.round(amount * 100),
      valid_until    : body.valid_until || null,
      notes          : clean(body.notes) || null,
      status         : 'pending',
      created_at     : nowIso,
      updated_at     : nowIso,
    };

    const { data: quote, error: insertError } = await supabase
      .from('quotes')
      .insert(insertPayload)
      .select()
      .maybeSingle();

    if (insertError) { console.error('[create-quote] insert:', insertError); return respond(500, { error: 'Failed to create quote' }); }
    if (!quote) return respond(500, { error: 'Quote was not created' });

    const quoteUrl = `${siteUrl}/quote.html?id=${quote.id}`;

    const delivery = await sendEmail(templates.quoteReady({
      customer_name  : customerName,
      customer_email : customerEmail,
      business_name  : businessName,
      title,
      description    : description || null,
      amount         : amount,
      amount_cents   : quote.amount_cents,
      valid_until    : quote.valid_until || null,
      quote_url      : quoteUrl,
    }));

    if (delivery?.error) {
      const msg = typeof delivery.error === 'string'
        ? delivery.error
        : (delivery.error?.message || 'Email delivery failed');
      // Quote was created — warn but do not fail the whole request
      console.warn('[create-quote] Email delivery failed:', msg);
    }

    return respond(200, { ok: true, quote });
  } catch (err) {
    console.error('[create-quote]', err);
    return respond(err.statusCode || 500, { error: err.message || 'Failed to create quote' });
  }
};
