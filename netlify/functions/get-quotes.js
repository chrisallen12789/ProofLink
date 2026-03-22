// netlify/functions/get-quotes.js
// Returns all quotes for the operator's tenant.
// GET — operator authenticated.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  const status  = event.queryStringParameters?.status || null;
  const limit   = Math.min(parseInt(event.queryStringParameters?.limit || '100', 10), 200);

  let query = supabase
    .from('quotes')
    .select('id, title, description, amount_cents, status, customer_name, customer_email, valid_until, created_at, accepted_at, declined_at, operator_id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data: quotes, error } = await query;

  if (error) {
    console.error('[get-quotes]', error);
    return respond(500, { error: 'Failed to fetch quotes' });
  }

  return respond(200, { quotes: quotes || [] });
};
