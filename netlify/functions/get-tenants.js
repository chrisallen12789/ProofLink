const { requireAdminContext, respond } = require('./utils/auth');
const { listTenantLimitHealth } = require('./lib/tenant-governance');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;
  const params = event.queryStringParameters || {};
  const limit = Math.min(parseInt(params.limit || '50', 10), 200);
  const offset = parseInt(params.offset || '0', 10);
  const statusFilter = params.status || null;
  const search = params.q || null;
  const cityFilter = params.city || null;
  const emailFilter = params.email || null;
  const slugFilter = params.slug || null;

  let query = supabase
    .from('tenants')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) query = query.eq('status', statusFilter);
  if (cityFilter) query = query.ilike('city_state', `%${cityFilter}%`);
  if (emailFilter) query = query.ilike('owner_email', `%${emailFilter}%`);
  if (slugFilter) query = query.eq('slug', slugFilter);
  if (search) query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%,owner_email.ilike.%${search}%`);

  const { data: tenants, error, count } = await query;
  if (error) {
    console.error('get-tenants error:', error);
    return respond(500, { error: 'Failed to load tenants' });
  }
  if (!tenants?.length) return respond(200, { tenants: [], total: 0, limit, offset });

  const tenantIds = tenants.map((t) => t.id || t.tenant_id || t.slug).filter(Boolean);
  const healthRows = await listTenantLimitHealth({ limit: 500, search: search || '', status: statusFilter || '' }).catch(() => []);
  const healthById = new Map();
  healthRows.forEach((row) => {
    if (row.tenant_id) healthById.set(String(row.tenant_id), row);
    if (row.slug) healthById.set(String(row.slug), row);
  });

  let orderCounts = {};
  let gmvByTenant = {};
  try {
    const { data: orders } = await supabase.from('orders').select('tenant_id, total_amount').in('tenant_id', tenantIds);
    (orders || []).forEach((row) => {
      orderCounts[row.tenant_id] = (orderCounts[row.tenant_id] || 0) + 1;
      gmvByTenant[row.tenant_id] = (gmvByTenant[row.tenant_id] || 0) + (parseFloat(row.total_amount) || 0);
    });
  } catch {}

  const enriched = tenants.map((tenant) => {
    const health = healthById.get(String(tenant.id)) || healthById.get(String(tenant.slug)) || null;
    return {
      ...tenant,
      order_count: orderCounts[tenant.id] || 0,
      gmv: Number((gmvByTenant[tenant.id] || 0).toFixed(2)),
      stripe_status: tenant.stripe_account_id ? (tenant.stripe_charges_enabled ? 'active' : 'pending') : 'not_connected',
      limit_health: health,
      health_warning: Boolean(health?.is_warning),
      health_blocked: Boolean(health?.is_blocked),
      health_resource: health?.mostPressured?.key || null,
      health_percent: health?.mostPressured?.percentUsed || null,
      recommended_plan_key: health?.recommended_plan_key || null,
      storage_used_mb: health?.storage_used_mb ?? tenant.storage_used_mb ?? 0,
      max_storage_mb: health?.max_storage_mb ?? tenant.max_storage_mb ?? 0,
    };
  });

  return respond(200, {
    tenants: enriched,
    total: count || enriched.length,
    limit,
    offset,
  });
};
