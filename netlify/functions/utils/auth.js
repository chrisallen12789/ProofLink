// netlify/functions/utils/auth.js
// Shared authentication helpers — do not modify existing signatures.

const { createClient } = require('@supabase/supabase-js');

/**
 * Returns an authenticated Supabase admin client using the service role key.
 * This client bypasses RLS and is for use inside trusted Netlify functions only.
 */
function getAdminClient() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * requireOperatorContext(event)
 *
 * Validates the incoming request is from a logged-in operator.
 * Expects:  Authorization: Bearer <supabase-access-token>
 *
 * Returns: { operatorId, email, role, supabase (admin client) }
 * Throws:  Error with { statusCode, message } if not authorised.
 */
async function requireOperatorContext(event) {
  const authHeader = event.headers && (
    event.headers['authorization'] || event.headers['Authorization']
  );

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Unauthorized: missing Bearer token');
    err.statusCode = 401;
    throw err;
  }

  const token    = authHeader.slice(7).trim();
  const supabase = getAdminClient();

  // Verify token with Supabase
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    const err = new Error('Unauthorized: invalid or expired token');
    err.statusCode = 401;
    throw err;
  }

  // Confirm the user exists in the operators table
  const { data: operator, error: opErr } = await supabase
    .from('operators')
    .select('id, email, role, tenant_id')
    .eq('email', user.email)
    .single();

  if (opErr || !operator) {
    const err = new Error('Forbidden: user is not a registered operator');
    err.statusCode = 403;
    throw err;
  }

  return {
    operatorId : operator.id,
    email      : operator.email,
    role       : operator.role,
    tenantId   : operator.tenant_id || null,
    supabase,
  };
}

/**
 * requireAdminContext(event)
 *
 * Same as requireOperatorContext but additionally enforces that the
 * operator role is 'admin' or 'platform_admin'.
 *
 * Use for admin-only endpoints once roles are configured.
 * To grant access: UPDATE operators SET role = 'admin' WHERE email = 'you@example.com';
 *
 * Returns: { operatorId, email, role, supabase }
 * Throws:  Error with statusCode 403 if role is insufficient.
 */
async function requireAdminContext(event) {
  const ctx = await requireOperatorContext(event);

  const adminRoles = new Set(['admin', 'platform_admin']);
  if (!adminRoles.has(ctx.role)) {
    const err = new Error('Forbidden: admin role required');
    err.statusCode = 403;
    throw err;
  }

  return ctx;
}

/**
 * Standard CORS + JSON response helper.
 */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type'                : 'application/json',
      'Access-Control-Allow-Origin' : '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

module.exports = { requireOperatorContext, requireAdminContext, getAdminClient, respond };
