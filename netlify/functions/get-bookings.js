// netlify/functions/get-bookings.js
// Returns bookings for the authenticated operator's tenant.
// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD  (optional date window, defaults to current month)

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  const params = event.queryStringParameters || {};
  const now    = new Date();
  const start  = params.start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end    = params.end   || new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('starts_at', start)
    .lte('starts_at', end)
    .order('starts_at', { ascending: true });

  if (error) {
    console.error('[get-bookings]', error);
    return respond(500, { error: 'Failed to fetch bookings' });
  }

  return respond(200, { bookings: data || [] });
};
