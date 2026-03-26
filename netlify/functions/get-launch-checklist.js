// netlify/functions/get-launch-checklist.js
// Authenticated tenant-scoped activation checklist.
// GET /.netlify/functions/get-launch-checklist?tenant_id=xxx
// Returns the real-time completion state of the first-win activation checklist.

const { getAdminClient, respond } = require('./utils/auth');
const { clean, requireOperatorContext } = require('./_prooflink_payments');
const { buildLaunchChecklist } = require('./lib/build-launch-checklist');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (error) {
    return respond(error.statusCode || 401, { error: error.message || 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const requestedTenantId = clean(params.tenant_id || '');
  const requestedSlug = clean(params.slug || '');
  const supabase = getAdminClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', ctx.tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return respond(404, { error: 'Tenant not found' });
  }

  if (requestedTenantId && requestedTenantId !== tenant.id) {
    return respond(403, { error: 'Forbidden: tenant mismatch' });
  }

  if (requestedSlug && requestedSlug !== tenant.slug) {
    return respond(403, { error: 'Forbidden: tenant mismatch' });
  }

  const [
    customersResult,
    bidsResult,
    ordersResult,
    paymentsResult,
    productsResult,
    configResult,
  ] = await Promise.allSettled([
    supabase.from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    supabase.from('bids')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    supabase.from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    supabase.from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    supabase.from('products')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    supabase.from('tenant_config')
      .select('config_value')
      .eq('tenant_id', tenant.id)
      .eq('config_key', 'site_settings')
      .maybeSingle(),
  ]);

  const checklist = buildLaunchChecklist({
    tenant,
    customersResult,
    bidsResult,
    ordersResult,
    paymentsResult,
    productsResult,
    configResult,
  });

  return respond(200, {
    tenant_id    : tenant.id,
    tenant_name  : tenant.name,
    tenant_slug  : tenant.slug,
    ...checklist,
  });
};
