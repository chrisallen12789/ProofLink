// netlify/functions/submit-review.js
// Public endpoint. Accepts a customer review submission.
// POST { order_id, tenant_id, rating, review_text, customer_name }

'use strict';

const { getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { order_id, tenant_id, rating, review_text, customer_name } = body;

  if (!order_id || !tenant_id)        return respond(400, { error: 'Missing order_id or tenant_id' });
  if (!rating || rating < 1 || rating > 5) return respond(400, { error: 'Rating must be 1–5' });

  const supabase = getAdminClient();

  // Verify order exists and belongs to this tenant
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, customer_name, customer_email, tenant_id')
    .eq('id', order_id)
    .eq('tenant_id', tenant_id)
    .single();

  if (orderErr || !order) return respond(404, { error: 'Order not found' });

  // Check for duplicate review
  const { data: existing } = await supabase
    .from('reviews')
    .select('id')
    .eq('order_id', order_id)
    .maybeSingle();

  if (existing) return respond(400, { error: 'Review already submitted for this order' });

  const { error: insertErr } = await supabase
    .from('reviews')
    .insert({
      tenant_id,
      order_id,
      customer_name : customer_name || order.customer_name || 'Anonymous',
      customer_email: order.customer_email || null,
      rating        : Number(rating),
      review_text   : (review_text || '').trim() || null,
    });

  if (insertErr) {
    console.error('[submit-review] insert error:', insertErr);
    return respond(500, { error: 'Failed to save review' });
  }

  return respond(201, { ok: true, message: 'Review submitted — thank you!' });
};
