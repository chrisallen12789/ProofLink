// netlify/functions/get-quote.js
// Public endpoint — returns quote details for the customer-facing quote acceptance page.
// GET ?id=UUID

'use strict';

const { getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

  const { id } = event.queryStringParameters || {};
  if (!id) return respond(400, { error: 'Missing quote id' });

  const supabase = getAdminClient();

  const { data: quote, error } = await supabase
    .from('quotes')
    .select('id, customer_name, customer_email, title, description, amount_cents, valid_until, status, accepted_at, created_at, tenant_id')
    .eq('id', id)
    .maybeSingle();

  if (error) { console.error('[get-quote]', error); return respond(500, { error: 'Failed to load quote' }); }
  if (!quote) return respond(404, { error: 'Quote not found' });

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', quote.tenant_id)
    .maybeSingle();

  return respond(200, {
    ok: true,
    quote: {
      ...quote,
      business_name: tenant.name,
    },
  });
};
