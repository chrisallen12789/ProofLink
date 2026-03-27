// netlify/functions/get-quote.js
// Public endpoint — returns bid/proposal details for the customer-facing quote viewer.
// GET /?token=<bid_id>   (token parameter maps to bid id — no separate token column exists)
// No authentication required; this is customer-facing.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

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
  'created_at',
].join(', ');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `get-quote:${ip}`, maxRequests: 30, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  // ── POST — customer accepts a proposal ───────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { action } = body;
    const bid_id = body.bid_id || body.token || body.id;
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
    if (bid.status && !['pending', 'sent', 'approved', 'review'].includes(bid.status)) {
      return respond(409, { error: `Proposal cannot be accepted — current status: ${bid.status}` });
    }

    // Reject if the proposal's validity window has passed
    if (bid.valid_until) {
      const expiry = new Date(bid.valid_until);
      if (!isNaN(expiry.getTime()) && expiry < new Date()) {
        return respond(410, { error: 'This proposal has expired and can no longer be accepted. Please contact us for a revised proposal.' });
      }
    }

    // Mark bid as accepted (atomic: only succeed if still in an acceptable status)
    const { data: updatedRows, error: updateErr } = await supabase
      .from('bids')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', bid_id)
      .not('status', 'eq', 'accepted')
      .select('id');

    if (updateErr) {
      console.error('[get-quote] POST accept update:', updateErr);
      return respond(500, { error: 'Failed to accept proposal' });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return respond(409, { error: 'Proposal has already been accepted or is no longer available' });
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
    .select('name, logo_url, primary_color, email, notification_email, phone')
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
      total_amount   : bid.total_cents != null ? Number(bid.total_cents) / 100 : null,
      valid_until    : bid.valid_until,
      cover_note     : bid.cover_note,
      status         : bid.status,
      created_at     : bid.created_at,
      customer_name  : customerName,
      business_name  : tenant?.name       || null,
      logo_url       : tenant?.logo_url   || null,
      primary_color  : tenant?.primary_color || null,
      business_email : tenant?.notification_email || tenant?.email || null,
      business_phone : tenant?.phone || null,
      notes          : bid.cover_note || null,
      terms          : bid.scope_of_work || null,
      line_items     : [],
    },
    id               : bid.id,
    title            : bid.title,
    total_cents      : bid.total_cents,
    total_amount     : bid.total_cents != null ? Number(bid.total_cents) / 100 : null,
    valid_until      : bid.valid_until,
    cover_note       : bid.cover_note,
    status           : bid.status,
    created_at       : bid.created_at,
    customer_name    : customerName,
    business_name    : tenant?.name || null,
    business_logo_url: tenant?.logo_url || null,
    business_email   : tenant?.notification_email || tenant?.email || null,
    business_phone   : tenant?.phone || null,
    notes            : bid.cover_note || null,
    terms            : bid.scope_of_work || null,
    line_items       : [],
  });
};
