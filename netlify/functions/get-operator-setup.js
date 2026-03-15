// netlify/functions/get-operator-setup.js
// Operator-only. Returns the current tenant plus merged site setup config.

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

  const { tenantId, supabase } = ctx;

  const [{ data: tenant, error: tenantErr }, { data: cfgRow, error: cfgErr }] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, owner_email, owner_name, logo_url, business_type, city_state, active, setup_complete')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('tenant_config')
      .select('config_value')
      .eq('tenant_id', tenantId)
      .eq('config_key', 'site_settings')
      .maybeSingle(),
  ]);

  if (tenantErr || !tenant) return respond(404, { error: 'Tenant not found' });
  if (cfgErr) return respond(500, { error: 'Failed to load tenant config' });

  let config = {};
  if (cfgRow?.config_value) {
    try {
      config = typeof cfgRow.config_value === 'string'
        ? JSON.parse(cfgRow.config_value)
        : cfgRow.config_value;
    } catch {
      config = {};
    }
  }

  config = {
    site_title: config.site_title || tenant.name || '',
    logo_url: config.logo_url || tenant.logo_url || '',
    contact_email: config.contact_email || tenant.owner_email || '',
    business_type: config.business_type || tenant.business_type || '',
    city_state: config.city_state || tenant.city_state || '',
    ...config,
  };

  return respond(200, {
    tenant,
    config,
  });
};
