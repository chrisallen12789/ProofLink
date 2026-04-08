// FILE: netlify/functions/admin-set-tester-exempt.js
//
// Admin-only endpoint to grant or revoke billing exemption for tester tenants.
//
// POST body:
//   { tenantId: string, exempt: boolean, months?: number }
//
// Examples:
//   Grant 12-month exemption:  { tenantId: "abc", exempt: true, months: 12 }
//   Revoke exemption:          { tenantId: "abc", exempt: false }
//   Check current state:       GET with ?tenantId=abc
//
// Only 3 tester slots are allowed at once (configurable via MAX_TESTER_SLOTS env var).
// Revoking does not count against the slot limit.

'use strict';

const { requireAdminContext, requireTenantAdminContext, respond } = require('./utils/auth');

const MAX_TESTER_SLOTS = Number(process.env.MAX_TESTER_SLOTS || 3);

function clean(val) {
  return String(val || '').trim();
}

function tenantBusinessName(tenant) {
  if (!tenant || typeof tenant !== 'object') return '';
  return tenant.business_name || tenant.name || tenant.slug || '';
}

function resolveExemptionMonths(value) {
  if (value === undefined || value === null || value === '') return 12;
  const months = Number(value);
  if (!Number.isFinite(months) || !Number.isInteger(months)) return null;
  if (months < 1 || months > 24) return null;
  return months;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const requestedTenantId = clean(
    event.httpMethod === 'GET'
      ? event.queryStringParameters?.tenantId
      : (() => {
          try {
            const body = JSON.parse(event.body || '{}');
            return body.tenantId || body.tenant_id;
          } catch {
            return '';
          }
        })()
  );

  let ctx;
  try {
    ctx = event.httpMethod === 'GET'
      ? await requireTenantAdminContext(event, requestedTenantId)
      : await requireAdminContext(event, requestedTenantId);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;

  if (event.httpMethod === 'GET') {
    const tenantId = requestedTenantId;
    if (!tenantId) return respond(400, { error: 'tenantId is required' });

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, slug, business_name, name, billing_exempt, billing_exempt_until, billing_status')
      .eq('id', tenantId)
      .maybeSingle();

    if (error || !tenant) return respond(404, { error: 'Tenant not found' });

    const now = new Date();
    const exemptUntil = tenant.billing_exempt_until ? new Date(tenant.billing_exempt_until) : null;
    const isActive = tenant.billing_exempt === true && (!exemptUntil || exemptUntil > now);

    return respond(200, {
      tenantId: tenant.id,
      slug: tenant.slug,
      name: tenantBusinessName(tenant),
      billingStatus: tenant.billing_status,
      billingExempt: tenant.billing_exempt,
      billingExemptUntil: tenant.billing_exempt_until,
      exemptionActive: isActive,
      daysRemaining: isActive && exemptUntil
        ? Math.ceil((exemptUntil - now) / (1000 * 60 * 60 * 24))
        : null,
    });
  }

  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const tenantId = clean(body.tenantId || body.tenant_id);
  if (!tenantId) return respond(400, { error: 'tenantId is required' });

  const exempt = body.exempt === true || body.exempt === 'true';
  const months = exempt ? resolveExemptionMonths(body.months) : null;
  if (exempt && months === null) {
    return respond(400, { error: 'months must be an integer between 1 and 24' });
  }

  const { data: tenant, error: fetchErr } = await supabase
    .from('tenants')
    .select('id, slug, business_name, name, billing_exempt, billing_exempt_until')
    .eq('id', tenantId)
    .maybeSingle();

  if (fetchErr || !tenant) return respond(404, { error: 'Tenant not found' });

  if (!exempt) {
    const { error: revokeErr } = await supabase
      .from('tenants')
      .update({
        billing_exempt: false,
        billing_exempt_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantId);

    if (revokeErr) return respond(500, { error: revokeErr.message });

    return respond(200, {
      ok: true,
      action: 'revoked',
      tenantId,
      slug: tenant.slug,
      name: tenantBusinessName(tenant),
    });
  }

  const { data: currentExempt, error: countErr } = await supabase
    .from('tenants')
    .select('id, slug, business_name, name, billing_exempt_until')
    .eq('billing_exempt', true)
    .neq('id', tenantId);

  if (countErr) return respond(500, { error: countErr.message });

  const now = new Date();
  const activeExemptions = (currentExempt || []).filter((currentTenant) => {
    if (!currentTenant.billing_exempt_until) return true;
    return new Date(currentTenant.billing_exempt_until) > now;
  });

  if (activeExemptions.length >= MAX_TESTER_SLOTS) {
    return respond(409, {
      error: `Tester slot limit reached (${MAX_TESTER_SLOTS} max). Revoke an existing exemption first.`,
      activeTesters: activeExemptions.map((currentTenant) => ({
        id: currentTenant.id,
        slug: currentTenant.slug,
        name: tenantBusinessName(currentTenant),
        until: currentTenant.billing_exempt_until,
      })),
    });
  }

  const exemptUntil = new Date();
  exemptUntil.setMonth(exemptUntil.getMonth() + months);

  const { error: grantErr } = await supabase
    .from('tenants')
    .update({
      billing_exempt: true,
      billing_exempt_until: exemptUntil.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenantId);

  if (grantErr) return respond(500, { error: grantErr.message });

  return respond(201, {
    ok: true,
    action: 'granted',
    tenantId,
    slug: tenant.slug,
    name: tenantBusinessName(tenant),
    months,
    billingExemptUntil: exemptUntil.toISOString(),
    slotsUsed: activeExemptions.length + 1,
    slotsRemaining: MAX_TESTER_SLOTS - (activeExemptions.length + 1),
  });
};
