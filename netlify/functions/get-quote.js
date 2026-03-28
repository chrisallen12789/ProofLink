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
  'line_items',
].join(', ');

function normalizeLineItem(item) {
  const quantity = Number(item?.quantity ?? item?.qty ?? 1) || 1;
  const unitPriceCents = Number(
    item?.unit_price_cents
    ?? item?.unitPriceCents
    ?? item?.unit_price
    ?? item?.price_cents
    ?? item?.price
    ?? 0
  ) || 0;
  const explicitLineTotalCents = Number(
    item?.line_total_cents
    ?? item?.lineTotalCents
    ?? item?.total_cents
    ?? item?.totalCents
  );
  const lineTotalCents = Number.isFinite(explicitLineTotalCents)
    ? explicitLineTotalCents
    : Math.round(quantity * unitPriceCents);

  return {
    id: item?.id || null,
    name: item?.name || item?.description || 'Item',
    description: item?.description || '',
    note: item?.note || '',
    quantity,
    qty: quantity,
    unit: item?.unit || 'item',
    unit_price_cents: unitPriceCents,
    unit_price: unitPriceCents / 100,
    price: unitPriceCents / 100,
    line_total_cents: lineTotalCents,
    line_total: lineTotalCents / 100,
    total: lineTotalCents / 100,
  };
}

function maskEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return '';
  const parts = normalized.split('@');
  const local = parts[0];
  const domain = parts[1];
  if (!local || !domain) return '';
  if (local.length <= 2) return `${local.charAt(0)}*@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

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
    const submittedCustomerEmail = String(body.customer_email || '').trim().toLowerCase();
    if (action !== 'accept') return respond(400, { error: 'Invalid action' });
    if (!bid_id) return respond(400, { error: 'bid_id is required' });

    const supabase = getAdminClient();

    // Fetch the bid so we can read tenant_id, title, customer_id
    const { data: bid, error: bidFetchErr } = await supabase
      .from('bids')
      .select('id, tenant_id, title, status, customer_id, valid_until')
      .eq('id', bid_id)
      .maybeSingle();

    if (bidFetchErr) {
      console.error('[get-quote] POST accept bid fetch:', bidFetchErr);
      return respond(500, { error: 'Failed to load proposal' });
    }
    if (!bid) return respond(404, { error: 'Proposal not found' });
    if (bid.status === 'approved' || bid.status === 'accepted') return respond(200, { ok: true, message: 'Already accepted' });
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

    // Mark bid as approved so the public accept flow matches the bid lifecycle
    // enforced by the current schema and operator workflow.
    const { data: updatedRows, error: updateErr } = await supabase
      .from('bids')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', bid_id)
      .not('status', 'eq', 'approved')
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
    let customerEmail = '';
    if (bid.customer_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('name, email')
        .eq('id', bid.customer_id)
        .maybeSingle();
      if (customer?.name) customerName = customer.name;
      if (customer?.email) customerEmail = String(customer.email).trim().toLowerCase();
    }

    if (customerEmail && submittedCustomerEmail !== customerEmail) {
      return respond(403, { error: 'Please enter the same email address this estimate was sent to before approving it.' });
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
  const lineItems = Array.isArray(bid.line_items) ? bid.line_items.map(normalizeLineItem) : [];

  // Fetch tenant branding
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, logo_url, primary_color, email, notification_email, phone')
    .eq('id', bid.tenant_id)
    .maybeSingle();

  // Fetch customer name for display (email not exposed)
  let customerName = null;
  let customerEmail = null;
  if (bid.customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('name, email')
      .eq('id', bid.customer_id)
      .maybeSingle();
    customerName = customer?.name || null;
    customerEmail = customer?.email || null;
  }

  const publicStatus = String(bid.status || '').trim().toLowerCase() === 'approved' ? 'accepted' : bid.status;

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
      status         : publicStatus,
      created_at     : bid.created_at,
      customer_name  : customerName,
      business_name  : tenant?.name       || null,
      logo_url       : tenant?.logo_url   || null,
      primary_color  : tenant?.primary_color || null,
      business_email : tenant?.notification_email || tenant?.email || null,
      business_phone : tenant?.phone || null,
      notes          : bid.cover_note || null,
      terms          : bid.scope_of_work || null,
      line_items     : lineItems,
      recipient_email_hint: maskEmail(customerEmail),
    },
    id               : bid.id,
    title            : bid.title,
    total_cents      : bid.total_cents,
    total_amount     : bid.total_cents != null ? Number(bid.total_cents) / 100 : null,
    valid_until      : bid.valid_until,
    cover_note       : bid.cover_note,
    status           : publicStatus,
    created_at       : bid.created_at,
    customer_name    : customerName,
    business_name    : tenant?.name || null,
    business_logo_url: tenant?.logo_url || null,
    business_email   : tenant?.notification_email || tenant?.email || null,
    business_phone   : tenant?.phone || null,
    notes            : bid.cover_note || null,
    terms            : bid.scope_of_work || null,
    line_items       : lineItems,
    recipient_email_hint: maskEmail(customerEmail),
  });
};
