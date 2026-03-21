// netlify/functions/admin-send-password-reset.js
// Admin-only. Sends a password reset email to a tenant's owner via Supabase Auth.
//
// POST { tenant_id }

'use strict';

const { requireAdminContext, respond, getAdminClient } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { tenant_id } = body;
  if (!tenant_id) return respond(400, { error: 'tenant_id is required' });

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, owner_email')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantErr || !tenant) return respond(404, { error: 'Tenant not found' });
  if (!tenant.owner_email)  return respond(400, { error: 'Tenant has no owner email on record' });

  // Use the service-role admin client to send the reset email
  const adminClient = getAdminClient();
  const redirectTo  = process.env.URL ? process.env.URL + '/operator/' : undefined;

  const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(
    tenant.owner_email,
    { redirectTo }
  );

  if (resetErr) {
    return respond(502, { error: 'Failed to send reset email: ' + resetErr.message });
  }

  return respond(200, { ok: true, to: tenant.owner_email });
};
