// netlify/functions/get-public-tenant-info.js
// Public endpoint — returns minimal tenant info for customer-facing pages (book.html, review.html).
// GET ?tenant_id=UUID

'use strict';

const { getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

  const { tenant_id } = event.queryStringParameters || {};
  if (!tenant_id) return respond(400, { error: 'Missing tenant_id' });

  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', tenant_id)
    .single();

  if (error || !data) return respond(404, { error: 'Tenant not found' });

  return respond(200, { business_name: data.name });
};
