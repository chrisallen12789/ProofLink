// netlify/functions/get-quote.js
// Public endpoint — returns bid/proposal details for the customer-facing quote viewer.
// GET /?token=<bid_id>   (token parameter maps to bid id — no separate token column exists)
// No authentication required; this is customer-facing.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');

// Columns safe to expose to customers — never expose internal operator-only fields
const BID_SELECT = [
  'id',
  'tenant_id',
  'title',
  'project_summary',
  'scope_of_work',
  'total_cents',
  'valid_until',
  'cover_note',
  'status',
  'customer_id',
].join(', ');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  // ── POST — customer accepts a proposal ───────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { action, bid_id } = body;
    if (action !== 'accept') return respond(400, { error: 'Invalid action' });
    if (!bid_id) return respond(400, { error: 'bid_id is required' });

    const supabase = getAdminClient();

    // Fetch the bid so we can read tenant_id, title, customer_id
    const { data: bid, error: bidFetchErr } = await supabase
      .from('bids')
      .select('id, tenant_id, title, status, customer_id')
      .eq('id', bid_id)
      .maybeSingle();

    if (bidFetchErr) {
      console.error('[get-quote] POST accept bid fetch:', bidFetchErr);
      return respond(500, { error: 'Failed to load proposal' });
    }
    if (!bid) return respond(404, { error: 'Proposal not found' });
    if (bid.status === 'accepted') return respond(200, { ok: true, message: 'Already accepted' });

    // Mark bid as accepted
    const { error: updateErr } = await supabase
      .from('bids')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', bid_id);

    if (updateErr) {
      console.error('[get-quote] POST accept update:', updateErr);
      return respond(500, { error: 'Failed to accept proposal' });
    }

    // Look up customer name for notification
    let customerName = 'A customer';
    if (bid.customer_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('name')
        .eq('id', bid.customer_id)
        .maybeSingle();
      if (customer?.name) customerName = customer.name;
    }

    // Look up tenant notification email
    const { data: tenant } = await supabase
      .from('tenants')
      .select('email, notification_email')
      .eq('id', bid.tenant_id)
      .maybeSingle();

    const toEmail = tenant?.notification_email || tenant?.email || null;

    // Send operator notification via Resend (non-blocking — failure doesn't break accept)
    if (toEmail && process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method : 'POST',
          headers: {
            'Content-Type' : 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from   : 'ProofLink <noreply@prooflink.app>',
            to     : [toEmail],
            subject: `A customer accepted your proposal: ${bid.title}`,
            text   : `${customerName} accepted your proposal '${bid.title}'. Log in to ProofLink to convert it to an order.`,
          }),
        });
      } catch (resendErr) {
        console.warn('[get-quote] Resend notification failed:', resendErr);
      }
    }

    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  const params = event.queryStringParameters || {};
  // Accept ?token= or ?id= — token is the customer-safe alias for the bid id
  const bidId = String(params.token || params.id || '').trim();
  if (!bidId) return respond(400, { error: 'Missing token (bid id)' });

  const supabase = getAdminClient();

  const { data: bid, error: bidErr } = await supabase
    .from('bids')
    .select(BID_SELECT)
    .eq('id', bidId)
    .maybeSingle();

  if (bidErr) {
    console.error('[get-quote] bid fetch:', bidErr);
    return respond(500, { error: 'Failed to load proposal' });
  }
  if (!bid) return respond(404, { error: 'Proposal not found' });

  // Fetch tenant branding
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, logo_url, primary_color')
    .eq('id', bid.tenant_id)
    .maybeSingle();

  // Fetch customer name for display (email not exposed)
  let customerName = null;
  if (bid.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('name')
      .eq('id', bid.customer_id)
      .maybeSingle();
    customerName = customer?.name || null;
  }

  return respond(200, {
    ok   : true,
    quote: {
      id             : bid.id,
      title          : bid.title,
      project_summary: bid.project_summary,
      scope_of_work  : bid.scope_of_work,
      total_cents    : bid.total_cents,
      valid_until    : bid.valid_until,
      cover_note     : bid.cover_note,
      status         : bid.status,
      customer_name  : customerName,
      business_name  : tenant?.name       || null,
      logo_url       : tenant?.logo_url   || null,
      primary_color  : tenant?.primary_color || null,
    },
  });
};
