// netlify/functions/send-invoice-email.js
// Operator-authenticated POST — emails an invoice to the customer for an order.
// POST { order_id }

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');
const { loggedSendEmail, templates }                      = require('./utils/email');
const { getConfiguredSiteUrl }                            = require('./utils/runtime-config');

async function getNextInvoiceNumber(adminSb, tenantId, tenantSlug) {
  const year = new Date().getFullYear();
  // Atomic increment: upsert and return new seq
  const { data, error } = await adminSb.rpc('increment_invoice_counter', {
    p_tenant_id: tenantId,
    p_year     : year,
  });
  if (!error && data != null) {
    const seq = String(data).padStart(3, '0');
    const prefix = (tenantSlug || 'INV').toUpperCase().slice(0, 6);
    return `${prefix}-${year}-${seq}`;
  }
  // Fallback: count existing invoices + 1
  const { count } = await adminSb.from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('invoice_number', 'is', null);
  const seq = String((count || 0) + 1).padStart(3, '0');
  const prefix = (tenantSlug || 'INV').toUpperCase().slice(0, 6);
  return `${prefix}-${year}-${seq}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;
  const adminSb = getAdminClient();

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const order_id = String(body.order_id || '').trim();
  if (!order_id) return respond(400, { error: 'order_id is required' });

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, customer_name, email, title, notes, total_amount, total_cents, status, created_at, tenant_id, invoice_number, payment_due_date')
    .eq('id', order_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr) { console.error('[send-invoice-email] order fetch:', orderErr); return respond(500, { error: 'Failed to load order' }); }
  if (!order)   return respond(404, { error: 'Order not found' });

  const customerEmail = order.email;
  if (!customerEmail) return respond(400, { error: 'Order has no customer email' });

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, slug, logo_url')
    .eq('id', tenantId)
    .maybeSingle();
  const businessName = tenant?.name || 'Your service provider';

  const siteUrl   = getConfiguredSiteUrl();
  const portalUrl = `${siteUrl}/portal.html?tenant=${encodeURIComponent(tenantId)}&email=${encodeURIComponent(customerEmail)}`;

  // Generate or reuse invoice number
  let invoiceNumber = order.invoice_number;
  if (!invoiceNumber) {
    invoiceNumber = await getNextInvoiceNumber(adminSb, tenantId, tenant?.slug || '');
    // Persist it immediately so re-sends use the same number
    await adminSb.from('orders')
      .update({ invoice_number: invoiceNumber, updated_at: new Date().toISOString() })
      .eq('id', order_id);
  }

  const delivery = await loggedSendEmail(templates.invoiceEmail({
    customer_name : order.customer_name || 'Customer',
    customer_email: customerEmail,
    business_name : businessName,
    order_id      : order.id,
    title         : order.title || 'Service',
    description   : order.notes || null,
    total_amount  : order.total_amount,
    total_cents   : order.total_cents,
    status        : order.status,
    created_at    : order.created_at,
    portal_url    : portalUrl,
    invoice_number: invoiceNumber,
    due_date      : order.payment_due_date || null,
  }), { supabase: adminSb, tenantId, template: 'invoiceEmail' });

  if (delivery?.error) {
    console.warn('[send-invoice-email] email failed:', delivery.error);
    return respond(502, { error: 'Invoice email delivery failed. Check your email config.' });
  }

  // Stamp invoice_sent_at
  await adminSb.from('orders')
    .update({ invoice_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', order_id);

  return respond(200, { ok: true, sent_to: customerEmail, invoice_number: invoiceNumber });
};
