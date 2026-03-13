// netlify/functions/get-platform-stats.js
// Operator-only. Returns aggregated platform metrics for the analytics dashboard.
// GET /.netlify/functions/get-platform-stats

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;

  const now       = new Date();
  const weekAgo   = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo  = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Run all queries in parallel
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
  ] = await Promise.allSettled([

    // Total active tenants
    supabase.from('tenants').select('id', { count: 'exact', head: true })
      .eq('status', 'active'),

    // New tenants this week
    supabase.from('tenants').select('id', { count: 'exact', head: true })
      .gte('created_at', weekAgo),

    // New tenants this month
    supabase.from('tenants').select('id', { count: 'exact', head: true })
      .gte('created_at', monthAgo),

    // Onboarding requests by status
    supabase.from('tenant_onboarding_requests').select('status'),

    // New requests this week
    supabase.from('tenant_onboarding_requests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekAgo),

    // Total orders
    supabase.from('orders').select('id, total_amount', { count: 'exact' }),

    // Orders this week
    supabase.from('orders').select('total_amount')
      .gte('created_at', weekAgo),

    // Recent 8 onboarding requests
    supabase.from('tenant_onboarding_requests')
      .select('id, business_name, owner_email, status, business_type, city_state, created_at')
      .order('created_at', { ascending: false })
      .limit(8),

    // Recent 5 new tenants
    supabase.from('tenants')
      .select('id, name, slug, owner_email, created_at, status')
      .order('created_at', { ascending: false })
      .limit(5),

    // Total tenants (all statuses)
    supabase.from('tenants').select('id', { count: 'exact', head: true }),

    // Flagged tenants count
    supabase.from('tenants').select('id', { count: 'exact', head: true })
      .eq('status', 'flagged'),

    // Monthly onboarding requests (last 30 days)
    supabase.from('tenant_onboarding_requests')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthAgo),

    // Orders this month (for GMV)
    supabase.from('orders').select('total_amount')
      .gte('created_at', monthAgo),
  ]);

  function val(result)  { return result.status === 'fulfilled' ? result.value : { data: null, error: null, count: null }; }
  function safeCount(r) { return val(r).count || 0; }

  // Tally request statuses
  const requestRows    = val(requestsResult).data || [];
  const requestsByStatus = { submitted: 0, approved: 0, provisioning: 0, provisioned: 0, failed: 0, rejected: 0 };
  requestRows.forEach((r) => { if (requestsByStatus[r.status] !== undefined) requestsByStatus[r.status]++; });
  const totalRequests = requestRows.length;

  // GMV
  const allOrders  = val(ordersResult).data || [];
  const weekOrders = val(ordersWeekResult).data || [];
  const gmvTotal   = allOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
  const gmvWeek    = weekOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

  // Stripe-connected tenant count (best effort)
  let stripeConnected = 0;
  try {
    const { count } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .not('stripe_account_id', 'is', null);
    stripeConnected = count || 0;
  } catch {}

  // Monthly GMV
  const monthOrders = val(ordersMonthResult).data || [];
  const gmvMonth    = monthOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);

  // Suspended tenant count (best effort)
  let suspendedCount = 0;
  try {
    const { count } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'suspended');
    suspendedCount = count || 0;
  } catch {}

  const totalTenantCount  = safeCount(totalTenantsResult);
  const activeTenantCount = safeCount(tenantsResult);
  const flaggedCount      = safeCount(flaggedTenantsResult);
  const totalOrderCount   = safeCount(ordersResult);
  const avgTenantRevenue  = activeTenantCount > 0
    ? parseFloat((gmvTotal / activeTenantCount).toFixed(2))
    : 0;

  return respond(200, {
    tenants: {
      total           : activeTenantCount,
      total_all       : totalTenantCount,
      active          : activeTenantCount,
      flagged         : flaggedCount,
      suspended       : suspendedCount,
      new_week        : safeCount(tenantsWeekResult),
      new_month       : safeCount(tenantsMonthResult),
      stripe_connected: stripeConnected,
    },
    onboarding: {
      total          : totalRequests,
      new_week       : safeCount(requestsWeekResult),
      monthly_requests: safeCount(monthlyRequestsResult),
      by_status      : requestsByStatus,
    },
    orders: {
      total     : totalOrderCount,
      new_week  : weekOrders.length,
      gmv_total : parseFloat(gmvTotal.toFixed(2)),
      gmv_week  : parseFloat(gmvWeek.toFixed(2)),
      gmv_month : parseFloat(gmvMonth.toFixed(2)),
    },
    platform: {
      total_tenants         : totalTenantCount,
      active_tenants        : activeTenantCount,
      flagged_tenants       : flaggedCount,
      monthly_onboarding    : safeCount(monthlyRequestsResult),
      platform_gmv          : parseFloat(gmvTotal.toFixed(2)),
      platform_order_count  : totalOrderCount,
      average_tenant_revenue: avgTenantRevenue,
    },
    recent_requests: val(recentRequestsResult).data || [],
    recent_tenants : val(recentTenantsResult).data  || [],
    generated_at   : new Date().toISOString(),
  });
};
