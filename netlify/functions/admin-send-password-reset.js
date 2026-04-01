// netlify/functions/admin-send-password-reset.js
// Admin-only. Sends a password setup or reset email to a tenant's owner.
//
// If the auth user does not exist (was deleted), it creates one and
// re-links operator_members.user_id before sending the reset email.
//
// POST { tenant_id }

'use strict';

const { requireAdminContext, respond, getAdminClient } = require('./utils/auth');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  try { await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { tenant_id } = body;
  if (!tenant_id) return respond(400, { error: 'tenant_id is required' });

  const supabase = getAdminClient();
  const siteUrl = getConfiguredSiteUrl();

  // ── 1. Load the tenant ─────────────────────────────────────────────────────
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, owner_email')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantErr || !tenant) return respond(404, { error: 'Tenant not found' });
  if (!tenant.owner_email)  return respond(400, { error: 'Tenant has no owner email on record' });

  const email      = tenant.owner_email.toLowerCase().trim();
  // Use the bare operator URL — Supabase must recognize this exact origin in
  // the allowed redirect URLs list. The recovery flow is detected via the
  // PASSWORD_RECOVERY auth event, not a URL param, so no type hint is needed.
  const redirectTo = `${siteUrl}/operator/`;

  // ── 2. Ensure the auth user exists ────────────────────────────────────────
  // resetPasswordForEmail fails silently (no email sent) when the user does not
  // exist. Check first; if missing, create and re-link operator_members.
  const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = (listData?.users || []).find(
    (u) => (u.email || '').toLowerCase() === email
  );

  let isNewUser = false;
  let authUserId = existing?.id || null;

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
    authUserId = created.user.id;
  }

  // Re-link operator_members.user_id so the workspace boots correctly.
  const { data: operator } = await supabase
    .from('operators')
    .select('id')
    .ilike('email', email)
    .eq('tenant_id', tenant_id)
    .limit(1)
    .maybeSingle();

  if (operator?.id && authUserId) {
    const { error: linkErr } = await supabase
      .from('operator_members')
      .update({ user_id: authUserId })
      .eq('operator_id', operator.id)
      .eq('tenant_id', tenant_id);

    if (linkErr) {
      return respond(502, { error: 'Failed to link auth user to membership: ' + linkErr.message });
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
