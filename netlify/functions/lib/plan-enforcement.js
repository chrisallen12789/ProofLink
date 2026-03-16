const { getAdminClient } = require('../utils/auth');
const { fetchTenantLimitHealthRaw, normalizeHealthRow } = require('./tenant-governance');

function getPlanKey(tenant) {
  return (tenant && tenant.prooflink_plan_key) || 'starter';
}

function normalizeResourceKey(resourceKey) {
  const map = {
    products: 'products',
    product: 'products',
    customers: 'customers',
    customer: 'customers',
    orders: 'orders',
    order: 'orders',
    operators: 'operator_seats',
    operator: 'operator_seats',
    operator_seats: 'operator_seats',
    seats: 'operator_seats',
    storage: 'storage_mb',
    storage_mb: 'storage_mb',
  };
  return map[String(resourceKey || '').toLowerCase()] || String(resourceKey || '').toLowerCase();
}

async function getTenantHealth(tenantOrId) {
  const supabase = getAdminClient();
  const tenantId = typeof tenantOrId === 'string'
    ? tenantOrId
    : (tenantOrId?.id || tenantOrId?.tenant_id || tenantOrId?.slug || '');
  const raw = await fetchTenantLimitHealthRaw(supabase, tenantId);
  if (!raw) return null;
  return normalizeHealthRow(raw);
}

function limitFor(resourceKey, tenantHealthOrTenant) {
  const key = normalizeResourceKey(resourceKey);
  const resources = Array.isArray(tenantHealthOrTenant?.resources) ? tenantHealthOrTenant.resources : [];
  const resource = resources.find((item) => item.key === key);
  if (resource) return resource.limit;

  const fallback = {
    products: tenantHealthOrTenant?.max_products,
    customers: tenantHealthOrTenant?.max_customers,
    orders: tenantHealthOrTenant?.max_orders_per_month,
    operator_seats: tenantHealthOrTenant?.max_operator_seats,
    storage_mb: tenantHealthOrTenant?.max_storage_mb,
  };
  return Number(fallback[key] || 0);
}

function currentFor(resourceKey, tenantHealthOrTenant) {
  const key = normalizeResourceKey(resourceKey);
  const resources = Array.isArray(tenantHealthOrTenant?.resources) ? tenantHealthOrTenant.resources : [];
  const resource = resources.find((item) => item.key === key);
  if (resource) return resource.used;

  const fallback = {
    products: tenantHealthOrTenant?.product_count,
    customers: tenantHealthOrTenant?.customer_count,
    orders: tenantHealthOrTenant?.current_month_order_count,
    operator_seats: tenantHealthOrTenant?.operator_seat_count,
    storage_mb: tenantHealthOrTenant?.storage_used_mb,
  };
  return Number(fallback[key] || 0);
}

function enforceLimit(resourceKey, currentCount, tenantHealthOrTenant) {
  const limit = limitFor(resourceKey, tenantHealthOrTenant);
  if (!Number.isFinite(limit) || limit <= 0) return true;
  return Number(currentCount || 0) < limit;
}

function enforcementResponse(resourceKey, currentCount, tenantHealthOrTenant) {
  const key = normalizeResourceKey(resourceKey);
  const limit = limitFor(key, tenantHealthOrTenant);
  const current = Number(currentCount || currentFor(key, tenantHealthOrTenant) || 0);

  return {
    ok: false,
    code: 'plan_limit_reached',
    resourceKey: key,
    tenantPlan: getPlanKey(tenantHealthOrTenant),
    currentCount: current,
    limit,
    message: `${key.replace(/_/g, ' ')} limit reached`,
  };
}

module.exports = {
  getPlanKey,
  getTenantHealth,
  limitFor,
  currentFor,
  enforceLimit,
  enforcementResponse,
};
