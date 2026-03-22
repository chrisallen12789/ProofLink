// netlify/functions/send-invoice-email.js
// Operator-authenticated POST — emails an invoice to the customer for an order.
// POST { order_id }
// Uses the invoiceEmail template in email.js.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');
const { getConfiguredSiteUrl }            = require('./utils/runtime-config');

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

  const order_id = String(body.order_id || '').trim();
  if (!order_id) return respond(400, { error: 'order_id is required' });

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, customer_name, customer_email, title, description, notes, total_amount, total_cents, status, created_at, tenant_id')
    .eq('id', order_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr) { console.error('[send-invoice-email] order fetch:', orderErr); return respond(500, { error: 'Failed to load order' }); }
  if (!order) return respond(404, { error: 'Order not found' });
  if (!order.customer_email) return respond(400, { error: 'Order has no customer email' });

  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  const businessName = tenant?.name || 'Your service provider';
  const siteUrl      = getConfiguredSiteUrl();
  const portalUrl    = `${siteUrl}/portal.html?tenant=${encodeURIComponent(tenantId)}&email=${encodeURIComponent(order.customer_email)}`;

  const delivery = await sendEmail(templates.invoiceEmail({
    customer_name : order.customer_name || 'Customer',
    customer_email: order.customer_email,
    business_name : businessName,
    order_id      : order.id,
    title         : order.title || 'Service',
    description   : order.description || order.notes || null,
    total_amount  : order.total_amount,
    total_cents   : order.total_cents,
    status        : order.status,
    created_at    : order.created_at,
    portal_url    : portalUrl,
  }));

  if (delivery?.error) {
    console.warn('[send-invoice-email] email failed:', delivery.error);
    return respond(502, { error: 'Invoice email delivery failed. Check your email config.' });
  }

  return respond(200, { ok: true, sent_to: order.customer_email });
};
