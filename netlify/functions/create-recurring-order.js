// netlify/functions/create-recurring-order.js
// Legacy compatibility endpoint that now creates or updates a service plan
// for an existing order.
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
    .select('id, title, cart_summary, description, customer_id, customer_name, customer_email, total_amount, total_cents, line_items, service_address, schedule_window, operator_id, tenant_id')
    .eq('id', order_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr || !order) return respond(404, { error: 'Order not found' });
  if (!order.customer_id) {
    return respond(409, { error: 'Recurring plans require a linked customer before they can be saved.' });
  }

  const nowIso = new Date().toISOString();
  const title = order.title || order.cart_summary || `${order.customer_name || "Customer"} recurring service`;
  const amountCents = Number(order.total_cents || order.total_amount || 0) || 0;
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const summary = String(order.description || "").trim() || null;
  const planPayload = {
    tenant_id: tenantId,
    operator_id: operatorId,
    customer_id: order.customer_id,
    source_order_id: order.id,
    status: 'active',
    title,
    cadence: frequency,
    next_run_on: next_date,
    service_address: order.service_address || null,
    schedule_window: order.schedule_window || null,
    summary,
    line_items: lineItems,
    amount_cents: amountCents,
    updated_at: nowIso,
  };

  const { data: existingPlan, error: existingPlanErr } = await supabase
    .from('service_plans')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source_order_id', order_id)
    .maybeSingle();

  if (existingPlanErr) {
    console.error('[create-recurring-order] existing service plan lookup failed:', existingPlanErr);
    return respond(500, { error: 'Failed to load the recurring plan for this order.' });
  }

  const query = existingPlan?.id
    ? supabase
        .from('service_plans')
        .update(planPayload)
        .eq('id', existingPlan.id)
        .eq('tenant_id', tenantId)
    : supabase
        .from('service_plans')
        .insert({ ...planPayload, created_at: nowIso });

  const { data, error } = await query
    .select('id, source_order_id, cadence, next_run_on, status, title, customer_id')
    .maybeSingle();

  if (error) {
    console.error('[create-recurring-order]', error);
    return respond(500, { error: 'Failed to save the recurring plan' });
  }
  if (!data) {
    return respond(500, { error: 'Failed to save the recurring plan: no record returned' });
  }

  return respond(existingPlan?.id ? 200 : 201, {
    ok: true,
    recurring: data,
    service_plan: data,
  });
};
