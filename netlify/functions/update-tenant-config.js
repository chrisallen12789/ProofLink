// netlify/functions/update-tenant-config.js
// Operator-only. Updates editable tenant site configuration.

const { requireAdminContext, respond } = require('./utils/auth');

const ALLOWED_KEYS = new Set([
  'tagline', 'hero_heading', 'hero_subheading',
  'logo_url', 'hero_image_url', 'public_contact_email', 'public_business_phone',
  'service_area', 'instagram', 'facebook', 'hours_notes', 'fulfillment_notes',
  'accent_color', 'show_prices', 'allow_custom_requests', 'about', 'onboarding_complete',
  'workspace_business_type',
]);

const PROTECTED_KEYS = new Set([
  'site_title', 'contact_email', 'business_phone', 'business_type', 'city_state',
  'license_number', 'tenant_id', 'owner_email', 'owner_name', 'slug',
]);

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeValue(key, value) {
  if (value === null || value === undefined) return '';
  if (key === 'show_prices' || key === 'allow_custom_requests' || key === 'onboarding_complete') {
    return !!value;
  }
  return String(value).trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  let ctx;
  try {
    ctx = await requireAdminContext(event, body.tenant_id || body.tenantId || '');
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, tenantId } = ctx;
  if (!tenantId) return respond(403, { error: 'Operator is not linked to a tenant' });

  const { tenant_id, config } = body;
  if (!tenant_id) return respond(400, { error: 'tenant_id is required' });
  if (tenant_id !== tenantId) return respond(403, { error: 'Tenant mismatch' });
  if (!config || typeof config !== 'object') return respond(400, { error: 'config object is required' });

  const attemptedProtected = Object.keys(config).filter((k) => PROTECTED_KEYS.has(k));
  if (attemptedProtected.length) {
    return respond(400, {
      error: `Protected fields cannot be changed from Business Setup: ${attemptedProtected.join(', ')}`,
    });
  }

  const sanitized = {};
  Object.entries(config).forEach(([k, v]) => {
    if (ALLOWED_KEYS.has(k)) sanitized[k] = normalizeValue(k, v);
  });

  if (Object.keys(sanitized).length === 0) {
    return respond(400, { error: 'No valid editable config keys provided' });
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantErr || !tenant) return respond(404, { error: 'Tenant not found' });

  const { data: existing, error: existingErr } = await supabase
    .from('tenant_config')
    .select('config_value')
    .eq('tenant_id', tenant_id)
    .eq('config_key', 'site_settings')
    .maybeSingle();

  if (existingErr) return respond(500, { error: 'Failed to load existing config' });

  const prev = parseConfig(existing?.config_value);
  const merged = { ...prev, ...sanitized };

  const { error: upsertErr } = await supabase
    .from('tenant_config')
    .upsert(
      {
        tenant_id,
        config_key: 'site_settings',
        config_value: JSON.stringify(merged),
      },
      { onConflict: 'tenant_id,config_key' }
    );

  if (upsertErr) {
    console.error('update-tenant-config error:', upsertErr);
    return respond(500, { error: 'Failed to update config' });
  }

  return respond(200, {
    success: true,
    tenant_id,
    protected_fields_rejected: [],
    config: merged,
  });
};
