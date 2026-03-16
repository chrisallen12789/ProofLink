// netlify/functions/get-platform-stats.js
// Admin-only platform dashboard stats.
// Extends existing overview metrics with governance pressure pulled from v_tenant_limit_health.

const { requireAdminContext, respond } = require('./utils/auth');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Number(toNumber(value).toFixed(2));
}

function normalizePressureRow(row) {
  row = row || {};

  const tenantId = row.tenant_id || row.id || null;
  const name = row.name || row.tenant_name || row.business_name || row.slug || 'Unknown tenant';
  const slug = row.slug || row.tenant_slug || null;
  const planKey = row.prooflink_plan_key || row.plan_key || row.plan || 'starter';

  const pressurePercent = Math.max(
    toNumber(row.pressure_percent),
    toNumber(row.max_percent_used),
    toNumber(row.highest_percent_used),
    toNumber(row.percent_used),
    toNumber(row.usage_percent)
  );

  const pressuredResource =
    row.pressured_resource ||
    row.max_resource ||
    row.highest_resource ||
    row.nearest_limit_resource ||
    row.limiting_resource ||
    row.most_pressured_resource ||
    'unknown';

  const recommendedPlanKey =
    row.recommended_plan_key ||
    row.recommended_upgrade_plan_key ||
    row.next_plan_key ||
    null;

  const isBlocked = Boolean(
    row.is_blocked ||
    row.limit_reached ||
    row.any_limit_reached ||
    row.blocked ||
    pressurePercent >= 100
  );

  const isWarning = Boolean(
    row.is_warning ||
    row.nearing_limit ||
    row.warning ||
    (!isBlocked && pressurePercent >= 80)
  );

  const storageUsedMb = toNumber(
    row.storage_used_mb ||
    row.storage_mb_used ||
    row.current_storage_mb ||
    row.storage_used ||
    0
  );

  const storageLimitMb = toNumber(
    row.max_storage_mb ||
    row.storage_limit_mb ||
    row.storage_mb_limit ||
    row.allowed_storage_mb ||
    0
  );

  return {
    tenant_id: tenantId,
    name,
    slug,
    prooflink_plan_key: planKey,
    pressure_percent: pressurePercent,
    pressured_resource: String(pressuredResource || 'unknown').toLowerCase(),
    recommended_plan_key: recommendedPlanKey,
    is_warning: isWarning,
    is_blocked: isBlocked,
    storage_used_mb: round2(storageUsedMb),
    storage_limit_mb: round2(storageLimitMb),
  };
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
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    tenantsResult,
    tenantsWeekResult,
    tenantsMonthResult,
    requestsResult,
    requestsWeekResult,
    ordersResult,
    ordersWeekResult,
    recentRequestsResult,
    recentTenantsResult,
    totalTenantsResult,
    flaggedTenantsResult,
    monthlyRequestsResult,
    ordersMonthResult,
    governanceResult,
  ] = await Promise.allSettled([
    supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    supabase.from('tenant_onboarding_requests').select('status'),
    supabase.from('tenant_onboarding_requests').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('orders').select('id, total_amount', { count: 'exact' }),
    supabase.from('orders').select('total_amount').gte('created_at', weekAgo),
    supabase.from('tenant_onboarding_requests')
      .select('id, business_name, owner_email, status, business_type, city_state, created_at')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase.from('tenants')
      .select('id, name, slug, owner_email, created_at, status')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('tenants').select('id', { count: 'exact', head: true }),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'flagged'),
    supabase.from('tenant_onboarding_requests').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    supabase.from('orders').select('total_amount').gte('created_at', monthAgo),
    supabase.from('v_tenant_limit_health').select('*'),
  ]);

  function val(result) {
    return result.status === 'fulfilled' ? result.value : { data: null, error: null, count: null };
  }
  function safeCount(result) {
    return val(result).count || 0;
  }

  const requestRows = val(requestsResult).data || [];
  const requestsByStatus = {
    submitted: 0,
    approved: 0,
    provisioning: 0,
    provisioned: 0,
    failed: 0,
    rejected: 0,
    needs_review: 0,
  };
  requestRows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(requestsByStatus, row.status)) {
      requestsByStatus[row.status] += 1;
    }
  });

  const allOrders = val(ordersResult).data || [];
  const weekOrders = val(ordersWeekResult).data || [];
  const monthOrders = val(ordersMonthResult).data || [];
  const gmvTotal = allOrders.reduce((sum, order) => sum + toNumber(order.total_amount), 0);
  const gmvWeek = weekOrders.reduce((sum, order) => sum + toNumber(order.total_amount), 0);
  const gmvMonth = monthOrders.reduce((sum, order) => sum + toNumber(order.total_amount), 0);

  let stripeConnected = 0;
  try {
    const { count } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .not('stripe_account_id', 'is', null);
    stripeConnected = count || 0;
  } catch {}

  let suspendedCount = 0;
  try {
    const { count } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'suspended');
    suspendedCount = count || 0;
  } catch {}

  const totalTenantCount = safeCount(totalTenantsResult);
  const activeTenantCount = safeCount(tenantsResult);
  const flaggedCount = safeCount(flaggedTenantsResult);
  const totalOrderCount = safeCount(ordersResult);
  const avgTenantRevenue = activeTenantCount > 0 ? round2(gmvTotal / activeTenantCount) : 0;

  const governanceRows = (val(governanceResult).data || []).map(normalizePressureRow);
  const warningTenants = governanceRows.filter((row) => row.is_warning && !row.is_blocked);
  const blockedTenants = governanceRows.filter((row) => row.is_blocked);
  const storagePressureTenants = governanceRows.filter((row) => row.pressured_resource === 'storage' || row.storage_limit_mb > 0 && ((row.storage_used_mb / row.storage_limit_mb) * 100) >= 80);
  const topCapacityRisks = governanceRows
    .slice()
    .sort((a, b) => b.pressure_percent - a.pressure_percent)
    .slice(0, 8);

  return respond(200, {
    tenants: {
      total: activeTenantCount,
      total_all: totalTenantCount,
      active: activeTenantCount,
      flagged: flaggedCount,
      suspended: suspendedCount,
      new_week: safeCount(tenantsWeekResult),
      new_month: safeCount(tenantsMonthResult),
      stripe_connected: stripeConnected,
    },
    onboarding: {
      total: requestRows.length,
      new_week: safeCount(requestsWeekResult),
      monthly_requests: safeCount(monthlyRequestsResult),
      by_status: requestsByStatus,
    },
    orders: {
      total: totalOrderCount,
      new_week: weekOrders.length,
      gmv_total: round2(gmvTotal),
      gmv_week: round2(gmvWeek),
      gmv_month: round2(gmvMonth),
    },
    platform: {
      total_tenants: totalTenantCount,
      active_tenants: activeTenantCount,
      flagged_tenants: flaggedCount,
      monthly_onboarding: safeCount(monthlyRequestsResult),
      platform_gmv: round2(gmvTotal),
      platform_order_count: totalOrderCount,
      average_tenant_revenue: avgTenantRevenue,
    },
    governance: {
      total_rows: governanceRows.length,
      warning_tenants: warningTenants.length,
      blocked_tenants: blockedTenants.length,
      storage_pressure_tenants: storagePressureTenants.length,
      top_capacity_risks: topCapacityRisks,
    },
    recent_requests: val(recentRequestsResult).data || [],
    recent_tenants: val(recentTenantsResult).data || [],
    generated_at: new Date().toISOString(),
  });
};
