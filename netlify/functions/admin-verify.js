// netlify/functions/admin-verify.js
//
// Verifies the caller is a platform admin (role = admin | platform_admin).
// Also handles safe one-time bootstrap: if the authenticated user matches
// the PLATFORM_ADMIN_UID env var and no platform_admin row exists yet in
// the operators table, one is created automatically.
//
// GET  (Authorization: Bearer <supabase-access-token>)
//
// Returns 200 { email, role, name } on success.
// Returns 401 if token is invalid.
// Returns 403 if user is not a platform admin.

const { getAdminClient, respond } = require('./utils/auth');

// Bootstrap is opt-in and requires explicit configuration.
const BOOTSTRAP_ADMIN_UID = String(process.env.PLATFORM_ADMIN_UID || '').trim();
const BOOTSTRAP_ENABLED =
  String(process.env.PLATFORM_ADMIN_BOOTSTRAP_ENABLED || '').trim().toLowerCase() === 'true';

const ADMIN_ROLES = new Set(['admin', 'platform_admin']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')     return respond(405, { error: 'Method not allowed' });

  // ── 1. Extract & verify token ──────────────────────────────────────────────
  const authHeader =
    event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) return respond(401, { error: 'Missing authorization token' });

  const supabase = getAdminClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return respond(401, { error: 'Invalid or expired token' });
  }

  const email = (user.email || '').toLowerCase();

  // ── 2. Look up operator row ────────────────────────────────────────────────
  let { data: operator, error: opErr } = await supabase
    .from('operators')
    .select('id, email, name, role')
    .eq('email', email.toLowerCase())
    .limit(1)
    .maybeSingle();

  if (opErr) {
    console.error('[admin-verify] operator lookup failed:', opErr.message);
    return respond(500, { error: 'Operator lookup failed' });
  }

  // ── 3. Bootstrap: create platform_admin row if this is the designated UID ──
  if (!operator && BOOTSTRAP_ENABLED && BOOTSTRAP_ADMIN_UID && user.id === BOOTSTRAP_ADMIN_UID) {
    console.log(`[admin-verify] Bootstrapping platform_admin for ${email} (uid=${user.id})`);

    const displayName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      email.split('@')[0];

    const { data: newOp, error: insertErr } = await supabase
      .from('operators')
      .upsert([{
        email,
        name     : displayName,
        role     : 'platform_admin',
        tenant_id: null,
      }], { onConflict: 'email' })
      .select('id, email, name, role')
      .maybeSingle();

    if (insertErr || !newOp) {
      console.error('[admin-verify] bootstrap insert failed:', insertErr?.message);
      return respond(500, { error: 'Could not bootstrap admin identity' });
    }

    operator = newOp;
    console.log(`[admin-verify] Platform admin bootstrapped: ${operator.id}`);
  }

  // ── 3b. Upgrade existing row if it has wrong role and matches bootstrap UID
  if (
    operator &&
    !ADMIN_ROLES.has(operator.role) &&
    BOOTSTRAP_ENABLED &&
    BOOTSTRAP_ADMIN_UID &&
    user.id === BOOTSTRAP_ADMIN_UID
  ) {
    console.log(`[admin-verify] Upgrading operator ${operator.id} to platform_admin`);
    const { error: upErr } = await supabase
      .from('operators')
      .update({ role: 'platform_admin', updated_at: new Date().toISOString() })
      .eq('id', operator.id);

    if (!upErr) operator.role = 'platform_admin';
  }

  // ── 4. Deny if not an admin ────────────────────────────────────────────────
  if (!operator || !ADMIN_ROLES.has(operator.role)) {
    return respond(403, { error: 'Forbidden: platform admin role required' });
  }

  return respond(200, {
    email : operator.email,
    name  : operator.name,
    role  : operator.role,
  });
};
