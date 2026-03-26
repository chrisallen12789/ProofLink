// netlify/functions/create-recurring-order.js
// Creates a recurring order schedule for an existing order.
// POST { order_id, frequency: 'weekly'|'biweekly'|'monthly', next_date: 'YYYY-MM-DD' }

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

const VALID_FREQUENCIES = ['weekly', 'biweekly', 'monthly'];

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

  const { order_id, frequency, next_date } = body;
  if (!order_id)                               return respond(400, { error: 'Missing order_id' });
  if (!VALID_FREQUENCIES.includes(frequency))  return respond(400, { error: 'frequency must be weekly, biweekly, or monthly' });
  if (!next_date || isNaN(Date.parse(next_date))) return respond(400, { error: 'Invalid next_date (use YYYY-MM-DD)' });

  // Verify order belongs to this operator/tenant
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, title, customer_name, customer_email, total_amount, operator_id, tenant_id')
    .eq('id', order_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr || !order) return respond(404, { error: 'Order not found' });

  // Upsert recurring schedule
  const { data, error } = await supabase
    .from('recurring_orders')
    .upsert({
      source_order_id: order_id,
      operator_id    : operatorId,
      tenant_id      : tenantId,
      frequency,
      next_date,
      active         : true,
      updated_at     : new Date().toISOString(),
    }, { onConflict: 'source_order_id' })
    .select()
    .maybeSingle();

  if (error) {
    console.error('[create-recurring-order]', error);
    return respond(500, { error: 'Failed to create recurring schedule' });
  }
  if (!data) {
    return respond(500, { error: 'Failed to create recurring schedule: no record returned' });
  }

  return respond(201, { ok: true, recurring: data });
};
