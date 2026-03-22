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
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

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
