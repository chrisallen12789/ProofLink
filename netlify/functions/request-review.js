// netlify/functions/request-review.js
// Operator endpoint. Sends a review request email to the customer for a completed order.
// POST { order_id }

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');
const { getConfiguredSiteUrl }            = require('./utils/runtime-config');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, operatorId, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { order_id } = body;
  if (!order_id) return respond(400, { error: 'Missing order_id' });

  // Fetch order + tenant business name
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, customer_name, customer_email, status, review_requested_at, tenant_id')
    .eq('id', order_id)
    .eq('tenant_id', tenantId)
    .single();

  if (orderErr || !order) return respond(404, { error: 'Order not found' });

  if (!order.customer_email) {
    return respond(400, { error: 'No customer email on this order' });
  }

  if (order.review_requested_at) {
    return respond(400, { error: 'Review already requested for this order' });
  }

  // Get business name from tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const businessName = tenant?.name || 'Your service provider';
  const siteUrl      = getConfiguredSiteUrl();
  const reviewUrl    = `${siteUrl}/review.html?order=${encodeURIComponent(order_id)}&tenant=${encodeURIComponent(tenantId)}`;

  // Mark as requested (must succeed before sending email to prevent duplicates)
  const { error: updateErr } = await supabase
    .from('orders')
    .update({ review_requested_at: new Date().toISOString() })
    .eq('id', order_id)
    .eq('tenant_id', tenantId);

  if (updateErr) {
    console.error('[request-review] update failed:', updateErr);
    return respond(500, { error: 'Failed to mark review as requested' });
  }

  // Send email (non-fatal)
  sendEmail(templates.reviewRequest({
    customer_name : order.customer_name || 'there',
    customer_email: order.customer_email,
    business_name : businessName,
    review_url    : reviewUrl,
  })).catch((e) => console.warn('[request-review] email failed:', e.message));

  return respond(200, { ok: true, message: 'Review request sent' });
};
