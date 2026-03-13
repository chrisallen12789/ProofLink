// netlify/functions/get-tenants.js
// Operator-only. Returns all tenants with config, Stripe status, and order count.
// GET /.netlify/functions/get-tenants?status=active&limit=50&offset=0

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
  const params       = event.queryStringParameters || {};
  const limit        = Math.min(parseInt(params.limit || '50', 10), 200);
  const offset       = parseInt(params.offset || '0', 10);
  const statusFilter = params.status || null;
  const search       = params.q || null;
  const cityFilter   = params.city || null;
  const emailFilter  = params.email || null;
  const slugFilter   = params.slug || null;

  // ── Tenants base query
  let query = supabase
    .from('tenants')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) query = query.eq('status', statusFilter);
  if (cityFilter)   query = query.ilike('city_state', `%${cityFilter}%`);
  if (emailFilter)  query = query.ilike('owner_email', `%${emailFilter}%`);
  if (slugFilter)   query = query.eq('slug', slugFilter);
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,slug.ilike.%${search}%,owner_email.ilike.%${search}%`
    );
  }

  const { data: tenants, error, count } = await query;

  if (error) {
    console.error('get-tenants error:', error);
    return respond(500, { error: 'Failed to load tenants' });
  }

  if (!tenants || tenants.length === 0) {
    return respond(200, { tenants: [], total: 0, limit, offset });
  }

  const tenantIds = tenants.map((t) => t.id);

  // ── Fetch order counts and GMV per tenant (best-effort, table may not exist yet)
  let orderCounts = {};
  let gmvByTenant = {};
  try {
    const { data: orders } = await supabase
      .from('orders')
      .select('tenant_id, total_amount')
      .in('tenant_id', tenantIds);

    if (orders) {
      orders.forEach((o) => {
        orderCounts[o.tenant_id] = (orderCounts[o.tenant_id] || 0) + 1;
        gmvByTenant[o.tenant_id] = (gmvByTenant[o.tenant_id] || 0) + (parseFloat(o.total_amount) || 0);
      });
    }
  } catch {}

  // ── Fetch tenant configs (best-effort)
  let configMap = {};
  try {
    const { data: configs } = await supabase
      .from('tenant_config')
      .select('tenant_id, config_key, config_value')
      .in('tenant_id', tenantIds)
      .eq('config_key', 'site_settings');

    if (configs) {
      configs.forEach((c) => {
        try {
          configMap[c.tenant_id] = JSON.parse(c.config_value);
        } catch {
          configMap[c.tenant_id] = {};
        }
      });
    }
  } catch {}

  // ── Fetch product counts per tenant (best-effort)
  let productCounts = {};
  try {
    const { data: products } = await supabase
      .from('products')
      .select('tenant_id')
      .in('tenant_id', tenantIds);

    if (products) {
      products.forEach((p) => {
        productCounts[p.tenant_id] = (productCounts[p.tenant_id] || 0) + 1;
      });
    }
  } catch {}

  // ── Assemble response
  const enriched = tenants.map((t) => ({
    ...t,
    order_count  : orderCounts[t.id] || 0,
    product_count: productCounts[t.id] || 0,
    gmv          : parseFloat((gmvByTenant[t.id] || 0).toFixed(2)),
    config       : configMap[t.id] || {},
    stripe_status: t.stripe_account_id
      ? (t.stripe_charges_enabled ? 'active' : 'pending')
      : 'not_connected',
  }));

  return respond(200, {
    tenants: enriched,
    total  : count,
    limit,
    offset,
  });
};
