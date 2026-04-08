// netlify/functions/send-payment-reminder.js
// Operator-authenticated POST to send a payment reminder to a customer.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
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

function businessNameFromTenant(tenant) {
  return clean(tenant?.business_name || tenant?.name) || 'ProofLink';
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

  const orderId = clean(body.order_id);
  if (!orderId) return respond(400, { error: 'order_id is required' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, tenantId } = ctx;

  try {
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, customer_name, email, cart_summary, total_cents, status, created_at')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (orderError) return respond(500, { error: orderError.message });
    if (!order) return respond(404, { error: 'Order not found' });
    if (!order.email) return respond(422, { error: 'Order has no customer email' });

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('business_name, name')
      .eq('id', tenantId)
      .maybeSingle();

    if (tenantError) return respond(500, { error: tenantError.message });

    const businessName = businessNameFromTenant(tenant);
    const siteUrl = getConfiguredSiteUrl();
    const portalUrl = `${siteUrl}/portal.html?tenant=${tenantId}&email=${encodeURIComponent(order.email)}`;

    const totalCents = Number(order.total_cents || 0);
    const totalAmount = totalCents / 100;

    const delivery = await sendEmail(templates.paymentReminder({
      customer_name : order.customer_name || 'Customer',
      customer_email: order.email,
      business_name : businessName,
      order_title   : order.cart_summary || 'Your order',
      total_amount  : totalAmount,
      total_cents   : totalCents,
      status        : order.status || 'pending',
      created_at    : order.created_at,
      portal_url    : portalUrl,
    }));

    if (delivery?.error) {
      const msg = typeof delivery.error === 'string'
        ? delivery.error
        : (delivery.error?.message || 'Email delivery failed');
      return respond(502, { error: msg });
    }

    return respond(200, { ok: true });
  } catch (err) {
    console.error('[send-payment-reminder]', err.message, err);
    return respond(err.statusCode || 500, { error: err.message || 'Failed to send payment reminder' });
  }
};
