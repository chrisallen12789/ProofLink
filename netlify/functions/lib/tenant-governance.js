const { getAdminClient } = require('../utils/auth');

const RESOURCE_DEFS = [
  {
    key: 'products',
    usageFields: ['product_count', 'products_used', 'products_count'],
    limitFields: ['max_products', 'products_limit'],
    label: 'Product limit reached',
    recommendPlan: 'growth'
  },
  {
    key: 'customers',
    usageFields: ['customer_count', 'customers_used', 'customers_count'],
    limitFields: ['max_customers', 'customers_limit'],
    label: 'Customer limit reached',
    recommendPlan: 'growth'
  },
  {
    key: 'orders',
    usageFields: ['current_month_order_count', 'orders_used', 'monthly_orders_used', 'order_count'],
    limitFields: ['max_orders_per_month', 'orders_limit', 'monthly_orders_limit'],
    label: 'Order limit reached',
    recommendPlan: 'growth'
  },
  {
    key: 'operator_seats',
    usageFields: ['operator_seat_count', 'seats_used', 'operator_count'],
    limitFields: ['max_operator_seats', 'seats_limit'],
    label: 'Seat limit reached',
    recommendPlan: 'growth'
  },
  {
    key: 'storage_mb',
    usageFields: ['storage_used_mb', 'storage_mb_used'],
    limitFields: ['max_storage_mb', 'storage_mb_limit'],
    label: 'Storage limit reached',
    recommendPlan: 'enterprise'
  }
];

function firstNumber(row, keys, fallback = 0) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function pct(used, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return Math.round((Number(used || 0) / limit) * 10000) / 100;
}

function classifyResource(def, row) {
  const used = firstNumber(row, def.usageFields, 0);
  const limit = firstNumber(row, def.limitFields, 0);
  const percentUsed = pct(used, limit);
  const isWarn = Number.isFinite(percentUsed) && percentUsed >= 80 && percentUsed < 100;
  const isBlocked = Number.isFinite(percentUsed) && percentUsed >= 100;
  return {
    key: def.key,
    label: def.label,
    used,
    limit,
    percentUsed,
    warning: isWarn,
    blocked: isBlocked,
    recommendPlan: def.recommendPlan
  };
}

function normalizeHealthRow(row = {}) {
  const resources = RESOURCE_DEFS.map((def) => classifyResource(def, row));
  const warnings = resources.filter((r) => r.warning);
  const blocked = resources.filter((r) => r.blocked);
  const mostPressured = resources
    .filter((r) => Number.isFinite(r.percentUsed))
    .sort((a, b) => (b.percentUsed || 0) - (a.percentUsed || 0))[0] || null;

  const recommendedPlan = blocked[0]?.recommendPlan || warnings[0]?.recommendPlan || mostPressured?.recommendPlan || null;

  return {
    tenant_id: row.tenant_id || row.id || null,
    tenant_name: row.tenant_name || row.name || row.slug || null,
    slug: row.slug || null,
    prooflink_plan_key: row.prooflink_plan_key || 'starter',
    billing_status: row.billing_status || 'unknown',
    status: row.status || 'active',
    storage_used_mb: firstNumber(row, ['storage_used_mb', 'storage_mb_used'], 0),
    max_storage_mb: firstNumber(row, ['max_storage_mb', 'storage_mb_limit'], 0),
    resources,
    warnings,
    blocked,
    mostPressured,
    recommend_upgrade: Boolean(recommendedPlan),
    recommended_plan_key: recommendedPlan,
    warning_count: warnings.length,
    blocked_count: blocked.length,
    is_warning: warnings.length > 0,
    is_blocked: blocked.length > 0,
    growth_score: firstNumber(row, ['growth_score'], 0),
    source_row: row
  };
}

async function fetchTenantCore(supabase, tenantId) {
  const tries = [
    () => supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
    () => supabase.from('tenants').select('*').eq('tenant_id', tenantId).maybeSingle(),
    () => supabase.from('tenants').select('*').eq('slug', tenantId).maybeSingle(),
  ];
  for (const run of tries) {
    const { data, error } = await run();
    if (!error && data) return data;
  }
  return null;
}

async function fetchTenantLimitHealthRaw(supabase, tenantId) {
  const core = await fetchTenantCore(supabase, tenantId);

  const selectors = [
    () => supabase.from('v_tenant_limit_health').select('*').eq('tenant_id', tenantId).maybeSingle(),
    () => supabase.from('v_tenant_limit_health').select('*').eq('id', tenantId).maybeSingle(),
    () => supabase.from('v_tenant_limit_health').select('*').eq('slug', tenantId).maybeSingle(),
  ];
  for (const run of selectors) {
    const { data, error } = await run();
    if (!error && data) return core ? { ...data, ...core } : data;
  }

  if (!core) return null;
  return core;
}

async function listTenantLimitHealthRaw(supabase, options = {}) {
  const limit = Math.min(Number(options.limit || 200), 500);
  const offset = Math.max(Number(options.offset || 0), 0);
  const search = String(options.search || '').trim();
  const status = String(options.status || '').trim();

  let query = supabase.from('v_tenant_limit_health').select('*').range(offset, offset + limit - 1);
  if (status) query = query.eq('status', status);
  if (search) query = query.or(`tenant_name.ilike.%${search}%,name.ilike.%${search}%,slug.ilike.%${search}%`);

  const { data, error } = await query;
  if (!error && Array.isArray(data)) return data;

  let fallback = supabase.from('tenants').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (status) fallback = fallback.eq('status', status);
  if (search) fallback = fallback.or(`name.ilike.%${search}%,slug.ilike.%${search}%,owner_email.ilike.%${search}%`);
  const { data: fallbackData, error: fallbackError } = await fallback;
  if (fallbackError) throw fallbackError;
  return fallbackData || [];
}

async function fetchTenantLimitHealth(tenantId) {
  const supabase = getAdminClient();
  const raw = await fetchTenantLimitHealthRaw(supabase, tenantId);
  if (!raw) return null;
  return normalizeHealthRow(raw);
}

async function listTenantLimitHealth(options = {}) {
  const supabase = getAdminClient();
  const rawRows = await listTenantLimitHealthRaw(supabase, options);
  return rawRows.map((row) => normalizeHealthRow(row));
}

module.exports = {
  RESOURCE_DEFS,
  normalizeHealthRow,
  fetchTenantLimitHealthRaw,
  fetchTenantLimitHealth,
  listTenantLimitHealth,
  listTenantLimitHealthRaw,
};
