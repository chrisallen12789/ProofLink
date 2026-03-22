// netlify/functions/get-time-entries.js
// Returns time entries for the authenticated operator's tenant.
// GET /?order_id=<uuid>  — filter by order
// GET /?customer_id=<uuid>  — filter by customer
// At least one filter is required.
// Returns entries plus aggregate totals: total_duration_minutes, total_cost_cents.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  const params      = event.queryStringParameters || {};
  const order_id    = String(params.order_id    || '').trim() || null;
  const customer_id = String(params.customer_id || '').trim() || null;

  if (!order_id && !customer_id) {
    return respond(400, { error: 'At least one of order_id or customer_id is required' });
  }

  let query = supabase
    .from('time_entries')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('started_at', { ascending: false });

  if (order_id)    query = query.eq('order_id',    order_id);
  if (customer_id) query = query.eq('customer_id', customer_id);

  const { data, error } = await query;

  if (error) {
    console.error('[get-time-entries]', error);
    return respond(500, { error: 'Failed to fetch time entries' });
  }

  const entries = data || [];

  // Aggregate totals
  let total_duration_minutes = 0;
  let total_cost_cents       = 0;

  for (const e of entries) {
    if (typeof e.duration_minutes === 'number') total_duration_minutes += e.duration_minutes;
    if (typeof e.cost_cents       === 'number') total_cost_cents       += e.cost_cents;
  }

  return respond(200, {
    ok                    : true,
    entries,
    total_duration_minutes,
    total_cost_cents,
  });
};
