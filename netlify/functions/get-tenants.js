// netlify/functions/get-tenants.js
// Admin-only. Returns tenants enriched with governance pressure from v_tenant_limit_health.
// GET /.netlify/functions/get-tenants?status=active&limit=50&offset=0

const { requireAdminContext, respond } = require('./utils/auth');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNumber(value).toFixed(2));
}

function normalizeHealthRow(row) {
  row = row || {};
  const pressurePercent = Math.max(
    toNumber(row.pressure_percent),
    toNumber(row.max_percent_used),
    toNumber(row.highest_percent_used),
    toNumber(row.percent_used),
    toNumber(row.usage_percent)
  );

  return {
    tenant_id: row.tenant_id || row.id || null,
    health_warning: Boolean(
      row.is_warning ||
      row.nearing_limit ||
      row.warning ||
      pressurePercent >= 80
    ) && !Boolean(row.is_blocked || row.limit_reached || row.any_limit_reached || row.blocked || pressurePercent >= 100),
    health_blocked: Boolean(
      row.is_blocked ||
      row.limit_reached ||
      row.any_limit_reached ||
      row.blocked ||
      pressurePercent >= 100
    ),
    health_resource:
      row.pressured_resource ||
      row.max_resource ||
      row.highest_resource ||
      row.nearest_limit_resource ||
      row.limiting_resource ||
      row.most_pressured_resource ||
      null,
    pressure_percent: pressurePercent,
    recommended_plan_key:
      row.recommended_plan_key ||
      row.recommended_upgrade_plan_key ||
      row.next_plan_key ||
      null,
    storage_used_mb: round2(
      row.storage_used_mb ||
      row.storage_mb_used ||
      row.current_storage_mb ||
      row.storage_used ||
      0
    ),
    storage_limit_mb: round2(
      row.max_storage_mb ||
      row.storage_limit_mb ||
      row.storage_mb_limit ||
      row.allowed_storage_mb ||
      0
    ),
  };
}

function tenantNameOrFallback(tenant = {}) {
  return tenant.business_name || tenant.name || tenant.slug || '';
}

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
  if (search) {
    query = query.or(`business_name.ilike.%${search}%,name.ilike.%${search}%,slug.ilike.%${search}%,owner_email.ilike.%${search}%`);
  }

  const { data: tenants, error, count } = await query;
  if (error) {
    console.error('get-tenants error:', error);
    return respond(500, { error: 'Failed to load tenants' });
  }

  if (!tenants || tenants.length === 0) {
    return respond(200, { tenants: [], total: 0, limit, offset });
  }

  const tenantIds = tenants.map((tenant) => tenant.id);

  let orderCounts = {};
  let gmvByTenant = {};
  try {
    const { data: orders } = await supabase
      .from('orders')
      .select('tenant_id, total_cents')
      .in('tenant_id', tenantIds);

    (orders || []).forEach((order) => {
      orderCounts[order.tenant_id] = (orderCounts[order.tenant_id] || 0) + 1;
      gmvByTenant[order.tenant_id] = (gmvByTenant[order.tenant_id] || 0) + toNumber(order.total_cents) / 100;
    });
  } catch {}

  let configMap = {};
  try {
    const { data: configs } = await supabase
      .from('tenant_config')
      .select('tenant_id, config_key, config_value')
      .in('tenant_id', tenantIds)
      .eq('config_key', 'site_settings');

    (configs || []).forEach((config) => {
      try {
        configMap[config.tenant_id] = JSON.parse(config.config_value);
      } catch {
        configMap[config.tenant_id] = {};
      }
    });
  } catch {}

  let productCounts = {};
  try {
    const { data: products } = await supabase
      .from('products')
      .select('tenant_id')
      .in('tenant_id', tenantIds);

    (products || []).forEach((product) => {
      productCounts[product.tenant_id] = (productCounts[product.tenant_id] || 0) + 1;
    });
  } catch {}

  let healthMap = {};
  try {
    const { data: healthRows } = await supabase
      .from('v_tenant_limit_health')
      .select('*')
      .in('tenant_id', tenantIds);

    (healthRows || []).map(normalizeHealthRow).forEach((row) => {
      if (row.tenant_id) healthMap[row.tenant_id] = row;
    });
  } catch (err) {
    console.warn('get-tenants governance lookup failed:', err && err.message ? err.message : err);
  }

  const enriched = tenants.map((tenant) => {
    const health = healthMap[tenant.id] || {};
    const stripeStatus = tenant.stripe_account_id
      ? (tenant.stripe_charges_enabled ? 'active' : 'pending')
      : 'not_connected';

    return {
      ...tenant,
      business_name: tenantNameOrFallback(tenant),
      order_count: orderCounts[tenant.id] || 0,
      product_count: productCounts[tenant.id] || tenant.product_count || 0,
      gmv: round2(gmvByTenant[tenant.id] || 0),
      config: configMap[tenant.id] || {},
      stripe_status: stripeStatus,
      health_warning: Boolean(health.health_warning),
      health_blocked: Boolean(health.health_blocked),
      health_resource: health.health_resource || null,
      pressure_percent: round2(health.pressure_percent || 0),
      recommended_plan_key: health.recommended_plan_key || null,
      storage_used_mb: round2(health.storage_used_mb || tenant.storage_used_mb || 0),
      storage_limit_mb: round2(health.storage_limit_mb || 0),
    };
  });

  return respond(200, {
    tenants: enriched,
    total: count,
    limit,
    offset,
  });
};
