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
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

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
    healthRows,
  ] = await Promise.all([
    supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    supabase.from('tenant_onboarding_requests').select('status'),
    supabase.from('tenant_onboarding_requests').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('orders').select('id, total_amount', { count: 'exact' }),
    supabase.from('orders').select('total_amount').gte('created_at', weekAgo),
    supabase.from('tenant_onboarding_requests').select('id, business_name, owner_email, status, business_type, city_state, created_at').order('created_at', { ascending: false }).limit(8),
    supabase.from('tenants').select('id, name, slug, owner_email, created_at, status').order('created_at', { ascending: false }).limit(5),
    supabase.from('tenants').select('id', { count: 'exact', head: true }),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'flagged'),
    supabase.from('tenant_onboarding_requests').select('id', { count: 'exact', head: true }).gte('created_at', monthAgo),
    supabase.from('orders').select('total_amount').gte('created_at', monthAgo),
    listTenantLimitHealth({ limit: 500 }).catch(() => []),
  ]);

  const requestRows = requestsResult.data || [];
  const requestsByStatus = { submitted: 0, approved: 0, provisioning: 0, provisioned: 0, failed: 0, rejected: 0, needs_review: 0 };
  requestRows.forEach((r) => {
    if (requestsByStatus[r.status] !== undefined) requestsByStatus[r.status] += 1;
  });

  const allOrders = ordersResult.data || [];
  const weekOrders = ordersWeekResult.data || [];
  const monthOrders = ordersMonthResult.data || [];
  const gmvTotal = allOrders.reduce((sum, row) => sum + (parseFloat(row.total_amount) || 0), 0);
  const gmvWeek = weekOrders.reduce((sum, row) => sum + (parseFloat(row.total_amount) || 0), 0);
  const gmvMonth = monthOrders.reduce((sum, row) => sum + (parseFloat(row.total_amount) || 0), 0);

  let stripeConnected = 0;
  let suspendedCount = 0;
  try {
    const [{ count: connected }, { count: suspended }] = await Promise.all([
      supabase.from('tenants').select('id', { count: 'exact', head: true }).not('stripe_account_id', 'is', null),
      supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'suspended')
    ]);
    stripeConnected = connected || 0;
    suspendedCount = suspended || 0;
  } catch {}

  const warningTenants = healthRows.filter((row) => row.is_warning).length;
  const blockedTenants = healthRows.filter((row) => row.is_blocked).length;
  const storagePressureTenants = healthRows.filter((row) => {
    const storage = (row.resources || []).find((item) => item.key === 'storage_mb');
    return storage && (storage.warning || storage.blocked);
  }).length;
  const topCapacityRisks = healthRows
    .filter((row) => row.mostPressured)
    .sort((a, b) => (b.mostPressured?.percentUsed || 0) - (a.mostPressured?.percentUsed || 0))
    .slice(0, 8)
    .map((row) => ({
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      slug: row.slug,
      prooflink_plan_key: row.prooflink_plan_key,
      status: row.status,
      billing_status: row.billing_status,
      pressure_resource: row.mostPressured?.key || null,
      pressure_percent: row.mostPressured?.percentUsed || 0,
      recommended_plan_key: row.recommended_plan_key || null,
      storage_used_mb: row.storage_used_mb,
      max_storage_mb: row.max_storage_mb,
    }));

  const totalTenantCount = totalTenantsResult.count || 0;
  const activeTenantCount = tenantsResult.count || 0;
  const flaggedCount = flaggedTenantsResult.count || 0;
  const totalOrderCount = ordersResult.count || 0;

  return respond(200, {
    tenants: {
      total: activeTenantCount,
      total_all: totalTenantCount,
      active: activeTenantCount,
      flagged: flaggedCount,
      suspended: suspendedCount,
      new_week: tenantsWeekResult.count || 0,
      new_month: tenantsMonthResult.count || 0,
      stripe_connected: stripeConnected,
      warning: warningTenants,
      blocked: blockedTenants,
      storage_pressure: storagePressureTenants,
    },
    onboarding: {
      total: requestRows.length,
      new_week: requestsWeekResult.count || 0,
      monthly_requests: monthlyRequestsResult.count || 0,
      by_status: requestsByStatus,
    },
    orders: {
      total: totalOrderCount,
      new_week: weekOrders.length,
      gmv_total: Number(gmvTotal.toFixed(2)),
      gmv_week: Number(gmvWeek.toFixed(2)),
      gmv_month: Number(gmvMonth.toFixed(2)),
    },
    platform: {
      total_tenants: totalTenantCount,
      active_tenants: activeTenantCount,
      flagged_tenants: flaggedCount,
      monthly_onboarding: monthlyRequestsResult.count || 0,
      platform_gmv: Number(gmvTotal.toFixed(2)),
      platform_order_count: totalOrderCount,
      average_tenant_revenue: activeTenantCount > 0 ? Number((gmvTotal / activeTenantCount).toFixed(2)) : 0,
      warning_tenants: warningTenants,
      blocked_tenants: blockedTenants,
      storage_pressure_tenants: storagePressureTenants,
    },
    governance: {
      total_health_rows: healthRows.length,
      warning_tenants: warningTenants,
      blocked_tenants: blockedTenants,
      storage_pressure_tenants: storagePressureTenants,
      top_capacity_risks: topCapacityRisks,
    },
    recent_requests: recentRequestsResult.data || [],
    recent_tenants: recentTenantsResult.data || [],
    generated_at: new Date().toISOString(),
  });
};
