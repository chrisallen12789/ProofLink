// netlify/functions/admin-send-password-reset.js
// Admin-only. Sends a password setup or reset email to a tenant's owner.
//
// If the auth user does not exist (was deleted), it creates one and
// re-links operator_members.user_id before sending the reset email.
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

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { tenant_id } = body;
  if (!tenant_id) return respond(400, { error: 'tenant_id is required' });

  const supabase = getAdminClient();
  const siteUrl  = process.env.URL || 'https://prooflink.co';

  // ── 1. Load the tenant ─────────────────────────────────────────────────────
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, owner_email')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantErr || !tenant) return respond(404, { error: 'Tenant not found' });
  if (!tenant.owner_email)  return respond(400, { error: 'Tenant has no owner email on record' });

  const email      = tenant.owner_email.toLowerCase().trim();
  // Append ?type=recovery so the operator page can detect the recovery flow
  // regardless of whether Supabase uses PKCE (?code=xxx) or implicit (#access_token=xxx).
  // Supabase appends the code/token to the existing query string, resulting in
  // ?type=recovery&code=xxx — which getAuthCallbackType() already checks for.
  const redirectTo = `${siteUrl}/operator/?type=recovery`;

  // ── 2. Ensure the auth user exists ────────────────────────────────────────
  // resetPasswordForEmail fails silently (no email sent) when the user does not
  // exist. Check first; if missing, create and re-link operator_members.
  const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = (listData?.users || []).find(
    (u) => (u.email || '').toLowerCase() === email
  );

  let isNewUser = false;

  if (!existing) {
    // Auth user was deleted — recreate it.
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
    });

    if (createErr) {
      return respond(502, { error: 'Failed to create auth user: ' + createErr.message });
    }
    if (!created?.user?.id) {
      return respond(502, { error: 'Auth user created but returned no ID' });
    }

    isNewUser = true;
    const newUid = created.user.id;

    // Re-link operator_members.user_id so the workspace boots correctly.
    const { data: operator } = await supabase
      .from('operators')
      .select('id')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();

    if (operator?.id) {
      await supabase
        .from('operator_members')
        .update({ user_id: newUid, updated_at: new Date().toISOString() })
        .eq('operator_id', operator.id)
        .eq('tenant_id', tenant_id);
    }
  }

  // ── 3. Send the reset email (works for both new and existing users) ────────
  const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (resetErr) {
    return respond(502, { error: 'Failed to send reset email: ' + resetErr.message });
  }

  return respond(200, {
    ok: true,
    to: email,
    action: isNewUser ? 'auth_user_recreated_and_reset_sent' : 'reset_sent',
  });
};
