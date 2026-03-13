// FILE: netlify/functions/_prooflink_payments.js
const crypto = require('crypto');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Stripe-Signature',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function readJson(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
}

function clean(value) {
  return String(value || '').trim();
}

function getEnv(name, fallback = '') {
  return clean(process.env[name] || fallback);
}

function getBaseUrl(event) {
  const explicit = getEnv('URL') || getEnv('DEPLOY_PRIME_URL') || getEnv('SITE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const proto = event?.headers?.['x-forwarded-proto'] || 'https';
  const host = event?.headers?.host || '';
  return host ? `${proto}://${host}` : 'http://localhost:8888';
}

function getAuthToken(event) {
  const header = event?.headers?.authorization || event?.headers?.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function supabaseAdmin(path, method = 'GET', body) {
  const base = getEnv('SUPABASE_URL').replace(/\/+$/, '');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!base || !key) {
    throw Object.assign(new Error('Missing Supabase admin environment variables.'), {
      statusCode: 500
    });
  }

  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation'
    },
    body: body == null ? undefined : JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(text || `Supabase admin request failed (${res.status}).`), {
      statusCode: 500
    });
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function getAuthUser(accessToken) {
  const base = getEnv('SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = getEnv('SUPABASE_ANON_KEY') || getEnv('SUPABASE_PUBLISHABLE_KEY');

  if (!base || !anonKey || !accessToken) {
    throw Object.assign(new Error('Missing authentication context.'), { statusCode: 401 });
  }

  const res = await fetch(`${base}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    throw Object.assign(new Error('Not authenticated.'), { statusCode: 401 });
  }

  return res.json();
}

async function requireOperatorContext(event, requestedTenantId) {
  const accessToken = getAuthToken(event);
  const user = await getAuthUser(accessToken);

  const rows = await supabaseAdmin(
    `/rest/v1/operator_members?select=role,operators!operator_id(id,name,tenant_id)&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
  );

  const row = Array.isArray(rows) ? rows[0] : null;

  if (!row?.operators?.id) {
    throw Object.assign(new Error('No operator membership found.'), { statusCode: 403 });
  }

  const tenantId = clean(row.operators.tenant_id);

  if (requestedTenantId && tenantId && clean(requestedTenantId) !== tenantId) {
    throw Object.assign(new Error('Tenant scope mismatch.'), { statusCode: 403 });
  }

  return {
    accessToken,
    user,
    role: row.role,
    operatorId: row.operators.id,
    operatorName: row.operators.name,
    operatorSlug: "",
    tenantId: tenantId || clean(requestedTenantId),
  };
}

async function stripeRequest(path, method = 'POST', params = {}) {
  const secret = getEnv('STRIPE_SECRET_KEY');

  if (!secret) {
    throw Object.assign(new Error('Missing STRIPE_SECRET_KEY.'), { statusCode: 500 });
  }

  const body = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    body.append(key, String(value));
  });

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: method === 'GET' ? undefined : body.toString()
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data?.error?.message || `Stripe request failed (${res.status}).`;
    throw Object.assign(new Error(message), { statusCode: res.status, stripe: data });
  }

  return data;
}

async function findTenantById(tenantId) {
  const value = clean(tenantId);
  if (!value) return null;

  const bySlug = await supabaseAdmin(
    `/rest/v1/tenants?select=*&slug=eq.${encodeURIComponent(value)}&limit=1`
  ).catch(() => null);
  if (Array.isArray(bySlug) && bySlug[0]) return bySlug[0];

  const byId = await supabaseAdmin(
    `/rest/v1/tenants?select=*&id=eq.${encodeURIComponent(value)}&limit=1`
  ).catch(() => null);
  if (Array.isArray(byId) && byId[0]) return byId[0];

  const byTenantId = await supabaseAdmin(
    `/rest/v1/tenants?select=*&tenant_id=eq.${encodeURIComponent(value)}&limit=1`
  ).catch(() => null);
  return Array.isArray(byTenantId) ? byTenantId[0] || null : null;
}

async function patchTenant(tenantId, patch) {
  const value = clean(tenantId);
  if (!value) return null;

  try {
    return await supabaseAdmin(
      `/rest/v1/tenants?slug=eq.${encodeURIComponent(value)}`,
      'PATCH',
      patch
    );
  } catch {
    try {
      return await supabaseAdmin(
        `/rest/v1/tenants?id=eq.${encodeURIComponent(value)}`,
        'PATCH',
        patch
      );
    } catch {
      return supabaseAdmin(
        `/rest/v1/tenants?tenant_id=eq.${encodeURIComponent(value)}`,
        'PATCH',
        patch
      ).catch(() => null);
    }
  }
}

async function upsertPaymentRecord(payload) {
  return supabaseAdmin('/rest/v1/payments', 'POST', payload);
}

function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;

  const items = String(header)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let timestamp = 0;
  const signatures = [];

  for (const item of items) {
    const idx = item.indexOf('=');
    if (idx === -1) continue;
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    if (key === 't') timestamp = Number(value || 0);
    if (key === 'v1' && value) signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = hmacSha256(secret, `${timestamp}.${rawBody}`);

  return signatures.some((signature) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  });
}

async function findTenantByStripeAccount(accountId) {
  const value = clean(accountId);
  if (!value) return null;

  const byConnect = await supabaseAdmin(
    `/rest/v1/tenants?select=*&stripe_connect_account_id=eq.${encodeURIComponent(value)}&limit=1`
  ).catch(() => null);
  if (Array.isArray(byConnect) && byConnect[0]) return byConnect[0];

  const byLegacy = await supabaseAdmin(
    `/rest/v1/tenants?select=*&stripe_account_id=eq.${encodeURIComponent(value)}&limit=1`
  ).catch(() => null);

  return Array.isArray(byLegacy) ? byLegacy[0] || null : null;
}

async function findTenantByStripeCustomer(customerId) {
  const value = clean(customerId);
  if (!value) return null;

  const rows = await supabaseAdmin(
    `/rest/v1/tenants?select=*&stripe_customer_id=eq.${encodeURIComponent(value)}&limit=1`
  ).catch(() => null);

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function findTenantByStripeSubscription(subscriptionId) {
  const value = clean(subscriptionId);
  if (!value) return null;

  const rows = await supabaseAdmin(
    `/rest/v1/tenants?select=*&stripe_subscription_id=eq.${encodeURIComponent(value)}&limit=1`
  ).catch(() => null);

  return Array.isArray(rows) ? rows[0] || null : null;
}

function normalizeBillingStatus(status) {
  const value = clean(status).toLowerCase();

  if (['active', 'trialing'].includes(value)) return 'active';
  if (['past_due', 'unpaid', 'paused'].includes(value)) return 'past_due';
  if (['canceled', 'cancelled', 'incomplete_expired'].includes(value)) return 'canceled';
  if (['checkout_started'].includes(value)) return 'checkout_started';
  if (
    ['manual_review', 'onboarding', 'incomplete', 'not_started', 'pending'].includes(value) ||
    !value
  ) {
    return 'onboarding';
  }

  return value;
}

function normalizeConnectStatus(status) {
  const value = clean(status).toLowerCase();

  if (['connect_connected', 'connected', 'ready', 'verified'].includes(value)) {
    return 'connect_connected';
  }

  if (['connect_not_started', 'not_started', 'not_connected', ''].includes(value)) {
    return 'connect_not_started';
  }

  return 'connect_incomplete';
}

function isBillingExempt(tenant = {}) {
  if (tenant.billing_exempt !== true) return false;
  if (!tenant.billing_exempt_until) return true;
  return new Date(tenant.billing_exempt_until) > new Date();
}

function buildTenantPaymentState(tenant = {}) {
  const exempt = isBillingExempt(tenant);

  // Exempt tenants are treated as fully active on billing regardless of Stripe state
  const billingStatus = exempt ? 'active' : normalizeBillingStatus(tenant.billing_status);
  const connectStatus = normalizeConnectStatus(tenant.connect_status);

  const stripeConnectAccountId = clean(
    tenant.stripe_connect_account_id || tenant.stripe_account_id
  );

  const paymentsEnabled =
    tenant.payments_enabled === true || tenant.online_payments_enabled === true;

  const onlinePaymentsEligible =
    billingStatus === 'active' &&
    connectStatus === 'connect_connected' &&
    paymentsEnabled;

  const connectAccountReady =
    connectStatus === 'connect_connected' && !!stripeConnectAccountId;

  return {
    tenantId: clean(tenant.tenant_id || tenant.id || tenant.slug),
    tenantSlug: clean(tenant.slug),
    prooflinkPlanKey: clean(tenant.prooflink_plan_key || 'starter') || 'starter',
    billingStatus,
    billingExempt: exempt,
    billingExemptUntil: tenant.billing_exempt_until || null,
    connectStatus,
    stripeCustomerId: clean(tenant.stripe_customer_id),
    stripeSubscriptionId: clean(tenant.stripe_subscription_id),
    stripeAccountId: stripeConnectAccountId,
    paymentsEnabled,
    onlinePaymentsEligible,
    connectAccountReady,
    livemode: tenant.livemode === true,
  };
}

module.exports = {
  buildTenantPaymentState,
  clean,
  findTenantById,
  findTenantByStripeAccount,
  findTenantByStripeCustomer,
  findTenantByStripeSubscription,
  getBaseUrl,
  getEnv,
  json,
  normalizeBillingStatus,
  normalizeConnectStatus,
  patchTenant,
  readJson,
  requireOperatorContext,
  stripeRequest,
  supabaseAdmin,
  upsertPaymentRecord,
  verifyStripeSignature,
};