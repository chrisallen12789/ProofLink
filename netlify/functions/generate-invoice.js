// netlify/functions/generate-invoice.js
// Generic invoice generator for any vertical (not hydrovac-specific).
// POST { order_id, notes?, due_date?, send_email? }
// Requires operator auth via requireOperatorContext.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId, operatorId, supabase } = ctx;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { order_id, notes, due_date, send_email } = body;
  if (!order_id) return respond(400, { error: 'order_id is required' });

  // 1. Fetch the order with customer details
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*, customers(*)')
    .eq('id', order_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderError) {
    console.error('[generate-invoice] order fetch error:', orderError.message);
    return respond(500, { error: orderError.message });
  }
  if (!order) return respond(404, { error: 'Order not found' });

  // 2. Fetch expenses / line items — handle null gracefully
  const { data: expenses } = await supabase
    .from('expenses')
    .select('*')
    .eq('order_id', order_id)
    .eq('tenant_id', tenantId);

  const expenseRows = Array.isArray(expenses) ? expenses : [];

  // 3. Fetch time entries — handle null gracefully
  const { data: timeEntries } = await supabase
    .from('time_entries')
    .select('*')
    .eq('order_id', order_id)
    .eq('tenant_id', tenantId);

  const timeEntryRows = Array.isArray(timeEntries) ? timeEntries : [];

  // 4. Fetch tenant name
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  // 5. Build invoice record
  const invoice = {
    tenant_id: tenantId,
    operator_id: operatorId,
    order_id: order_id,
    customer_id: order.customer_id || null,
    customer_name: order.customers?.name || order.customer_name || '',
    customer_email: order.customers?.email || order.customer_email || '',
    business_name: tenant?.name || 'Your Business',
    line_items: [...expenseRows, ...timeEntryRows].map((item) => ({
      description: item.description || item.name || 'Service',
      quantity: item.quantity || item.hours || 1,
      unit: item.unit || (item.hours ? 'hr' : 'ea'),
      unit_price_cents: item.unit_price_cents || item.amount_cents || item.cost_cents || 0,
      total_cents: item.total_cents || item.amount_cents || 0,
    })),
    subtotal_cents: order.amount_cents || order.total_cents || 0,
    total_cents: order.amount_cents || order.total_cents || 0,
    notes: notes || null,
    due_date: due_date || null,
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 6. Insert to invoices table — handle missing table gracefully
  let savedInvoice = invoice;
  const { data: insertedInvoice, error: insertError } = await supabase
    .from('invoices')
    .insert(invoice)
    .select()
    .maybeSingle();

  if (insertError) {
    const msg = insertError.message || '';
    if (
      msg.includes('relation') ||
      msg.includes('does not exist') ||
      msg.includes('table not found')
    ) {
      console.warn('[generate-invoice] invoices table not found — returning invoice object without persisting');
    } else {
      console.error('[generate-invoice] insert error:', msg);
      return respond(500, { error: msg });
    }
  } else if (insertedInvoice) {
    savedInvoice = insertedInvoice;
  }

  // 7. Send invoice email if requested and customer email exists
  if (send_email && savedInvoice.customer_email) {
    try {
      await sendEmail(templates.invoiceEmail({
        customer_name: savedInvoice.customer_name,
        customer_email: savedInvoice.customer_email,
        business_name: savedInvoice.business_name,
        order_id: savedInvoice.order_id,
        order_title: order.title || order.description || 'Invoice',
        total_cents: savedInvoice.total_cents,
        due_date: savedInvoice.due_date,
        created_at: savedInvoice.created_at,
        line_items: savedInvoice.line_items,
      })).catch((e) => console.warn('[generate-invoice] email send failed:', e.message));
    } catch (e) {
      console.warn('[generate-invoice] email setup failed:', e.message);
    }
  }

  // 8. Return result
  return respond(200, { ok: true, invoice: savedInvoice });
};
