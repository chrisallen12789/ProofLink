// netlify/functions/get-reviews.js
// Operator-authenticated GET endpoint to fetch reviews for the tenant.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, tenantId } = ctx;

  const { data, error } = await supabase
    .from('reviews')
    .select('id, order_id, customer_name, customer_email, rating, review_text, comment, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[get-reviews]', error);
    return respond(500, { error: 'Failed to fetch reviews' });
  }

  return respond(200, { ok: true, reviews: data || [] });
};
