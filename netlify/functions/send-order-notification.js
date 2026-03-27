// netlify/functions/send-order-notification.js
// Operator-authenticated POST to notify a customer about an order status change.

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
      .select('id, customer_name, customer_email, status, title, description, notes')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (orderError) return respond(500, { error: orderError.message });
    if (!order) return respond(404, { error: 'Order not found' });
    if (!order.customer_email) return respond(422, { error: 'Order has no customer email' });

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle();

    if (tenantError) return respond(500, { error: tenantError.message });

    const businessName = clean(tenant?.name) || 'ProofLink';
    const siteUrl = getConfiguredSiteUrl();
    const portalUrl = `${siteUrl}/portal.html?tenant=${tenantId}&email=${encodeURIComponent(order.customer_email)}`;

    const delivery = await sendEmail(templates.orderStatusUpdate({
      customer_name : order.customer_name || 'Customer',
      customer_email: order.customer_email,
      business_name : businessName,
      order_title   : order.title || order.description || order.notes || 'Your order',
      status        : order.status || 'updated',
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
    console.error('[send-order-notification]', err.message, err);
    return respond(err.statusCode || 500, { error: err.message || 'Failed to send notification' });
  }
};
