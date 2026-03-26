// netlify/functions/time-to-invoice.js
// Operator-authenticated POST — converts uninvoiced time entries for an order
// into order_line_items and marks them as invoiced.
//
// POST { order_id, time_entry_ids?: uuid[] }
// Returns { lines_created: N, total_cents: X, line_items: [...] }

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId } = ctx;
  const adminSb = getAdminClient();

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { order_id, time_entry_ids } = body;
  if (!order_id) return respond(400, { error: 'order_id is required' });

  // Verify order belongs to tenant
  const { data: order, error: orderErr } = await adminSb
    .from('orders')
    .select('id, tenant_id')
    .eq('id', order_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr || !order) return respond(404, { error: 'Order not found' });

  // Fetch the time entries to convert
  let q = adminSb
    .from('time_entries')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('order_id', order_id)
    .eq('invoiced', false)
    .eq('billable', true);

  if (time_entry_ids && time_entry_ids.length) {
    q = q.in('id', time_entry_ids);
  }

  const { data: entries, error: entErr } = await q;
  if (entErr) return respond(500, { error: entErr.message });
  if (!entries || !entries.length) return respond(200, { lines_created: 0, total_cents: 0, line_items: [] });

  // Build line items
  const lineItems = entries.map((e) => {
    const durationHours = (e.duration_minutes || 0) / 60;
    const qty = Math.round(durationHours * 100) / 100; // 2 decimal places
    const unitPriceCents = e.hourly_rate_cents || 0;
    return {
      tenant_id       : tenantId,
      order_id,
      description     : e.description || 'Labor',
      quantity        : qty,
      unit_price_cents: unitPriceCents,
      line_type       : 'labor',
      sort_order      : 0,
    };
  });

  // Insert line items
  const { data: inserted, error: insertErr } = await adminSb
    .from('order_line_items')
    .insert(lineItems)
    .select();

  if (insertErr) return respond(500, { error: insertErr.message });

  // Mark time entries as invoiced
  const entryIds = entries.map((e) => e.id);
  await adminSb
    .from('time_entries')
    .update({ invoiced: true })
    .in('id', entryIds)
    .eq('tenant_id', tenantId);

  const totalCents = (inserted || []).reduce((s, li) => {
    return s + Math.round((li.quantity || 0) * (li.unit_price_cents || 0));
  }, 0);

  return respond(200, {
    lines_created: inserted ? inserted.length : 0,
    total_cents  : totalCents,
    line_items   : inserted || [],
  });
};
