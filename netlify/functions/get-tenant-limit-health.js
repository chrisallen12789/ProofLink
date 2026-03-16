const { requireOperatorContext, respond } = require('./utils/auth');
const { fetchTenantLimitHealthRaw, normalizeHealthRow } = require('./lib/tenant-governance');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, { ok: true });
  if (event.httpMethod !== 'GET') return respond(405, { ok: false, error: 'Method not allowed' });

  try {
    const ctx = await requireOperatorContext(event);
    const requestedTenantId = String(
      event.queryStringParameters?.tenant_id ||
      event.queryStringParameters?.tenantId ||
      ctx.tenantId || ''
    ).trim();

    if (!requestedTenantId) {
      return respond(400, { ok: false, error: 'Missing tenant_id' });
    }

    if (ctx.role !== 'admin' && ctx.role !== 'platform_admin' && ctx.tenantId && ctx.tenantId !== requestedTenantId) {
      return respond(403, { ok: false, error: 'Forbidden: tenant mismatch' });
    }

    const raw = await fetchTenantLimitHealthRaw(ctx.supabase, requestedTenantId);
    if (!raw) {
      return respond(404, { ok: false, error: 'Tenant limit health not found' });
    }

    const health = normalizeHealthRow(raw);

    return respond(200, {
      ok: true,
      tenant_id: requestedTenantId,
      health,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('get-tenant-limit-health error:', error);
    return respond(error.statusCode || 500, { ok: false, error: error.message || 'Unable to load tenant health' });
  }
};
