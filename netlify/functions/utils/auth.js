// netlify/functions/utils/auth.js
// Shared authentication helpers — do not modify existing signatures.

const { createClient } = require('@supabase/supabase-js');

const TENANT_ADMIN_ROLES = new Set(['admin', 'owner', 'manager']);

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

function getBearerToken(event) {
  const authHeader = event.headers && (
    event.headers['authorization'] || event.headers['Authorization']
  );

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Unauthorized: missing Bearer token');
    err.statusCode = 401;
    throw err;
  }

  return authHeader.slice(7).trim();
}

async function verifyBearerUser(event, supabase) {
  const token = getBearerToken(event);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    const err = new Error('Unauthorized: invalid or expired token');
    err.statusCode = 401;
    throw err;
  }

  return { token, user };
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
  const requestedTenantId = arguments[1] || '';
  const supabase = getAdminClient();
  const { user } = await verifyBearerUser(event, supabase);

  const { data: operator, error: opErr } = await supabase
    .from('operators')
    .select('id, email, role, tenant_id')
    .eq('email', user.email)
    .maybeSingle();

  if (opErr) {
    const err = new Error('Forbidden: operator lookup failed');
    err.statusCode = 403;
    throw err;
  }

  const platformAdminOperator =
    operator && operator.role === 'platform_admin' ? operator : null;

  const { data: memberships, error: membershipErr } = await supabase
    .from('operator_members')
    .select('operator_id, tenant_id, role, operators!operator_id(id, email, role, tenant_id)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (membershipErr) {
    const err = new Error('Forbidden: unable to resolve operator membership');
    err.statusCode = 403;
    throw err;
  }

  const rows = Array.isArray(memberships) ? memberships : [];
  const requested = String(requestedTenantId || '').trim();
  const membership = requested
    ? rows.find((row) => String(row.tenant_id || '').trim() === requested) || null
    : rows[0] || null;

  if (membership?.operator_id) {
    const operatorRole = membership.operators?.role || '';
    const effectiveRole = operatorRole === 'platform_admin' ? 'platform_admin' : membership.role;

    return {
      operatorId : membership.operator_id,
      email      : membership.operators?.email || user.email || '',
      role       : effectiveRole,
      operatorRole,
      membershipRole: membership.role || '',
      tenantId   : membership.tenant_id || membership.operators?.tenant_id || null,
      memberships: rows,
      supabase,
      user,
    };
  }

  if (platformAdminOperator) {
    return {
      operatorId : platformAdminOperator.id,
      email      : platformAdminOperator.email,
      role       : platformAdminOperator.role,
      operatorRole: platformAdminOperator.role,
      membershipRole: null,
      tenantId   : platformAdminOperator.tenant_id || null,
      memberships: rows,
      supabase,
      user,
    };
  }

  if (rows.length > 0 && requested) {
    const err = new Error('Forbidden: tenant mismatch');
    err.statusCode = 403;
    throw err;
  }

  const err = new Error('Forbidden: user is not a registered operator');
  err.statusCode = 403;
  throw err;
}

function findTenantAdminMembership(memberships, requestedTenantId = '') {
  const requested = String(requestedTenantId || '').trim();
  const rows = Array.isArray(memberships) ? memberships : [];

  return rows.find((row) => {
    if (!TENANT_ADMIN_ROLES.has(String(row?.role || '').trim())) {
      return false;
    }

    if (!requested) return true;
    return String(row?.tenant_id || '').trim() === requested;
  }) || null;
}

function buildTenantAdminContext(membership, ctx) {
  const operatorRole = membership?.operators?.role || '';

  return {
    operatorId: membership?.operator_id || membership?.operators?.id || null,
    email: membership?.operators?.email || ctx.user?.email || '',
    role: operatorRole === 'platform_admin' ? 'platform_admin' : membership?.role || '',
    operatorRole,
    membershipRole: membership?.role || '',
    tenantId: membership?.tenant_id || membership?.operators?.tenant_id || null,
    memberships: ctx.memberships,
    supabase: ctx.supabase,
    user: ctx.user,
  };
}

async function requireTenantAdminContext(event) {
  const requestedTenantId = arguments[1] || '';
  const ctx = await requireOperatorContext(event, requestedTenantId);

  if (ctx.role === 'platform_admin') {
    return ctx;
  }

  const adminMembership = findTenantAdminMembership(ctx.memberships, requestedTenantId);
  if (!adminMembership) {
    const err = new Error('Forbidden: admin role required');
    err.statusCode = 403;
    throw err;
  }

  if (
    ctx.operatorId === adminMembership.operator_id &&
    ctx.tenantId === (adminMembership.tenant_id || adminMembership.operators?.tenant_id || null)
  ) {
    return ctx;
  }

  return buildTenantAdminContext(adminMembership, ctx);
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

  if (ctx.role !== 'platform_admin') {
    const err = new Error('Forbidden: admin role required');
    err.statusCode = 403;
    throw err;
  }

  return ctx;
}

async function requireOnboardingAdminContext(event) {
  return requireTenantAdminContext(event);
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

module.exports = {
  requireOperatorContext,
  requireTenantAdminContext,
  requireAdminContext,
  requireOnboardingAdminContext,
  getAdminClient,
  respond,
};
