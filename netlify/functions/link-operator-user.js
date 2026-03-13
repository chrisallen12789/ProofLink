// netlify/functions/link-operator-user.js
//
// Called by the operator client after first login when the user_id
// in operator_members has not yet been set, OR when no operator_members
// row exists at all for the authenticated user.
//
// POST  (Authorization: Bearer <supabase-access-token>)
//
// Flow:
//   1. Verify token → get auth user (email, id)
//   2. Look up operator by email (case-insensitive) → create one if missing
//   3. Look up operator_members for this operator → create row if missing
//   4. Set user_id on the operator_members row
//
// This mirrors the provisioning logic in admin-approve-onboarding.js
// and provision-tenant.js so that authenticated users without
// memberships are bootstrapped automatically.

const { getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  const authHeader =
    event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return respond(401, { error: 'Missing authorization token' });

  const supabase = getAdminClient();

  // Verify the token
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return respond(401, { error: 'Invalid or expired token' });
  }

  const email = (user.email || '').toLowerCase();
  console.log(`[link-operator-user] Processing for email=${email}, uid=${user.id}`);

  // ── Step 1: Find or create operator row ────────────────────────────────────
  // Use ilike for case-insensitive email matching
  let { data: operator, error: opErr } = await supabase
    .from('operators')
    .select('id, email, tenant_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();

  if (opErr) {
    console.error('[link-operator-user] operator lookup failed:', opErr.message);
    return respond(500, { error: 'Operator lookup failed' });
  }

  // If no operator row exists, try to resolve a tenant and create the operator
  if (!operator) {
    console.log(`[link-operator-user] No operator found for ${email}, resolving tenant…`);
    const tenantId = await resolveTenantId(supabase, email);

    if (!tenantId) {
      console.warn(`[link-operator-user] No operator and no tenant found for ${email}`);
      return respond(404, {
        error: 'No operator or tenant found for this email',
        detail: `Looked up operators, tenants.owner_email, and onboarding requests for: ${email}`,
      });
    }

    const displayName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      email.split('@')[0];

    const { data: newOp, error: insertOpErr } = await supabase
      .from('operators')
      .upsert([{
        email,
        name     : displayName,
        role     : 'tenant_owner',
        tenant_id: tenantId,
      }], { onConflict: 'email' })
      .select('id, email, tenant_id')
      .single();

    if (insertOpErr || !newOp) {
      console.error('[link-operator-user] operator creation failed:', insertOpErr?.message);
      return respond(500, { error: 'Could not create operator' });
    }

    operator = newOp;
    console.log(`[link-operator-user] Created operator ${operator.id} for ${email}`);
  }

  // ── Step 2: Ensure operator_members row exists ─────────────────────────────
  const { data: existingMember } = await supabase
    .from('operator_members')
    .select('operator_id, tenant_id, user_id')
    .eq('operator_id', operator.id)
    .limit(1)
    .maybeSingle();

  if (existingMember) {
    // Row exists — just link user_id if not already set
    if (!existingMember.user_id || existingMember.user_id !== user.id) {
      const { error: updateErr } = await supabase
        .from('operator_members')
        .update({ user_id: user.id })
        .eq('operator_id', operator.id);

      if (updateErr) {
        console.error('[link-operator-user] user_id update failed:', updateErr.message);
        return respond(500, { error: 'Could not link user to operator' });
      }
    }

    console.log(`[link-operator-user] Linked auth user ${user.id} → operator ${operator.id}`);
    return respond(200, { linked: true, operator_id: operator.id });
  }

  // No operator_members row — bootstrap one
  const tenantId = operator.tenant_id || await resolveTenantId(supabase, email);

  if (!tenantId) {
    console.warn(`[link-operator-user] Cannot bootstrap membership: no tenant for ${email}`);
    return respond(404, {
      error: 'No tenant found to bootstrap membership',
      detail: `Operator ${operator.id} exists but has no tenant_id, and no tenant matched owner_email: ${email}`,
    });
  }

  // Ensure operator.tenant_id is set
  if (!operator.tenant_id) {
    await supabase
      .from('operators')
      .update({ tenant_id: tenantId })
      .eq('id', operator.id);
  }

  const { error: memberErr } = await supabase
    .from('operator_members')
    .upsert([{
      operator_id: operator.id,
      tenant_id  : tenantId,
      role       : 'owner',
      user_id    : user.id,
    }], { onConflict: 'operator_id,tenant_id' });

  if (memberErr) {
    console.error('[link-operator-user] membership bootstrap failed:', memberErr.message);
    return respond(500, { error: 'Could not bootstrap operator membership' });
  }

  console.log(`[link-operator-user] Bootstrapped membership: auth user ${user.id} → operator ${operator.id} → tenant ${tenantId}`);
  return respond(200, { linked: true, operator_id: operator.id, bootstrapped: true });
};

// ── Helper: resolve a tenant_id for a given email ────────────────────────────
// Uses case-insensitive matching (ilike) for all email lookups.
// Checks (in order):
//   1. tenants.owner_email matches (active tenants first, then any)
//   2. A provisioned/approved onboarding request for this email has a linked tenant
async function resolveTenantId(supabase, email) {
  // Try tenants table by owner_email (case-insensitive, active first)
  const { data: activeTenant } = await supabase
    .from('tenants')
    .select('id')
    .ilike('owner_email', email)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (activeTenant?.id) return activeTenant.id;

  // Fallback: try any tenant by owner_email (even inactive)
  const { data: anyTenant } = await supabase
    .from('tenants')
    .select('id')
    .ilike('owner_email', email)
    .limit(1)
    .maybeSingle();

  if (anyTenant?.id) return anyTenant.id;

  // Try onboarding requests → linked tenant (provisioned or approved)
  const { data: onboarding } = await supabase
    .from('tenant_onboarding_requests')
    .select('id, status')
    .ilike('owner_email', email)
    .in('status', ['provisioned', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (onboarding?.id) {
    const { data: linkedTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('onboarding_request_id', onboarding.id)
      .limit(1)
      .maybeSingle();

    if (linkedTenant?.id) return linkedTenant.id;
  }

  console.log(`[link-operator-user] resolveTenantId: no tenant found for ${email}`);
  return null;
}
