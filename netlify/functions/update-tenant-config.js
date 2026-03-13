// netlify/functions/update-tenant-config.js
// Operator-only. Updates a tenant's site configuration.
// POST body: { tenant_id, config: { site_title, tagline, theme, logo_url, ... } }

const { requireOperatorContext, respond } = require('./utils/auth');

const ALLOWED_KEYS = new Set([
  'site_title', 'tagline', 'hero_heading', 'hero_subheading',
  'theme', 'logo_url', 'hero_image_url', 'contact_email', 'city_state', 'license_number', 'instagram',
  'business_type', 'currency', 'order_flow', 'onboarding_complete',
  'accent_color', 'font_family', 'show_prices', 'allow_custom_requests',
]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const { tenant_id, config } = body;
  if (!tenant_id) return respond(400, { error: 'tenant_id is required' });
  if (!config || typeof config !== 'object') return respond(400, { error: 'config object is required' });

  // Whitelist config keys
  const sanitized = {};
  Object.entries(config).forEach(([k, v]) => {
    if (ALLOWED_KEYS.has(k)) sanitized[k] = v;
  });

  if (Object.keys(sanitized).length === 0) {
    return respond(400, { error: 'No valid config keys provided' });
  }

  // Verify tenant exists
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantErr || !tenant) return respond(404, { error: 'Tenant not found' });

  // Upsert site_settings config row
  // Try to merge with existing config
  const { data: existing } = await supabase
    .from('tenant_config')
    .select('config_value')
    .eq('tenant_id', tenant_id)
    .eq('config_key', 'site_settings')
    .maybeSingle();

  let merged = sanitized;
  if (existing?.config_value) {
    try {
      const prev = JSON.parse(existing.config_value);
      merged = { ...prev, ...sanitized };
    } catch {}
  }

  const { error: upsertErr } = await supabase
    .from('tenant_config')
    .upsert(
      {
        tenant_id   : tenant_id,
        config_key  : 'site_settings',
        config_value: JSON.stringify(merged),
      },
      { onConflict: 'tenant_id,config_key' }
    );

  if (upsertErr) {
    console.error('update-tenant-config error:', upsertErr);
    return respond(500, { error: 'Failed to update config' });
  }

  // Also update top-level tenant fields if relevant
  const tenantUpdates = {};
  if (sanitized.logo_url !== undefined) tenantUpdates.logo_url = sanitized.logo_url;
  if (sanitized.site_title !== undefined) tenantUpdates.name   = sanitized.site_title;

  if (Object.keys(tenantUpdates).length > 0) {
    await supabase.from('tenants').update(tenantUpdates).eq('id', tenant_id);
  }

  return respond(200, {
    success  : true,
    tenant_id,
    config   : merged,
  });
};
