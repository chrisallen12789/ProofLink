// netlify/functions/send-bid-email.js
// Operator-authenticated POST — emails a bid/proposal to the customer.
// POST { bid_id }
// Reads the bid from the bids table, looks up the customer, sends a professional
// proposal email using the bidProposal template.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const bid_id = String(body.bid_id || '').trim();
  if (!bid_id) return respond(400, { error: 'bid_id is required' });

  // Fetch the bid
  const { data: bid, error: bidErr } = await supabase
    .from('bids')
    .select('id, tenant_id, title, project_summary, scope_of_work, total_cents, valid_until, cover_note, status, customer_id')
    .eq('id', bid_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (bidErr) { console.error('[send-bid-email] bid fetch:', bidErr); return respond(500, { error: 'Failed to load bid' }); }
  if (!bid) return respond(404, { error: 'Bid not found' });

  // Fetch customer
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('id, name, email')
    .eq('id', bid.customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (custErr) { console.error('[send-bid-email] customer fetch:', custErr); return respond(500, { error: 'Failed to load customer' }); }
  if (!customer) return respond(404, { error: 'Customer not found for this bid' });
  if (!customer.email) return respond(400, { error: 'Customer has no email address on file' });

  // Fetch business name
  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  const businessName = tenant?.name || 'Your service provider';

  const delivery = await sendEmail(templates.bidProposal({
    customer_name  : customer.name || 'Customer',
    customer_email : customer.email,
    business_name  : businessName,
    title          : bid.title || 'Proposal',
    project_summary: bid.project_summary || null,
    scope_of_work  : bid.scope_of_work || null,
    total_cents    : bid.total_cents != null ? bid.total_cents : null,
    valid_until    : bid.valid_until || null,
    cover_note     : bid.cover_note || null,
  }));

  if (delivery?.error) {
    console.warn('[send-bid-email] email failed:', delivery.error);
    return respond(502, { error: 'Bid created but email delivery failed. Check your email config.' });
  }

  // Mark bid as sent
  await supabase
    .from('bids')
    .update({ status: bid.status === 'draft' ? 'sent' : bid.status, updated_at: new Date().toISOString() })
    .eq('id', bid_id)
    .eq('tenant_id', tenantId);

  return respond(200, { ok: true, sent_to: customer.email });
};
