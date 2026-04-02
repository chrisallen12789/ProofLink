// netlify/functions/update-tenant-config.js
// Operator-only. Updates editable tenant site configuration.

const { requireOperatorContext, respond } = require('./utils/auth');

const ALLOWED_KEYS = new Set([
  'tagline', 'hero_heading', 'hero_subheading',
  'logo_url', 'hero_image_url', 'public_contact_email', 'public_business_phone',
  'service_area', 'review_platform_label', 'review_link_url', 'referral_message',
  'instagram', 'facebook', 'hours_notes', 'fulfillment_notes',
  'accent_color', 'show_prices', 'allow_custom_requests', 'about', 'onboarding_complete',
  'workspace_business_type', 'booking_page_enabled',
  'site_font_preset', 'site_surface_style', 'site_button_style', 'site_card_style',
  'site_hero_layout', 'site_primary_cta_label', 'site_booking_cta_label',
  'site_publish_status', 'site_published_at',
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

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_PRESETS = new Set(['modern_sans', 'editorial', 'trust_serif', 'compact_ui']);
const SURFACE_STYLES = new Set(['clean', 'warm', 'bold']);
const BUTTON_STYLES = new Set(['rounded', 'solid', 'outline']);
const CARD_STYLES = new Set(['soft', 'lined', 'elevated']);
const HERO_LAYOUTS = new Set(['split', 'stacked', 'statement']);
const PUBLISH_STATUSES = new Set(['draft', 'ready', 'published']);
const TENANT_CONFIG_ADMIN_ROLES = new Set(['owner', 'admin', 'manager', 'platform_admin']);

function normalizeValue(key, value) {
  if (value === null || value === undefined) return '';
  if (key === 'show_prices' || key === 'allow_custom_requests' || key === 'onboarding_complete' || key === 'booking_page_enabled') {
    return !!value;
  }
  if (key === 'accent_color') {
    const color = String(value).trim();
    if (!HEX_COLOR_RE.test(color)) throw Object.assign(new Error('accent_color must be a valid hex color (e.g. #ff6600 or #f60)'), { statusCode: 400 });
    return color;
  }
  if (key === 'site_font_preset') {
    const preset = String(value).trim().toLowerCase() || 'modern_sans';
    if (!FONT_PRESETS.has(preset)) throw Object.assign(new Error('site_font_preset is invalid'), { statusCode: 400 });
    return preset;
  }
  if (key === 'site_surface_style') {
    const style = String(value).trim().toLowerCase() || 'clean';
    if (!SURFACE_STYLES.has(style)) throw Object.assign(new Error('site_surface_style is invalid'), { statusCode: 400 });
    return style;
  }
  if (key === 'site_button_style') {
    const style = String(value).trim().toLowerCase() || 'rounded';
    if (!BUTTON_STYLES.has(style)) throw Object.assign(new Error('site_button_style is invalid'), { statusCode: 400 });
    return style;
  }
  if (key === 'site_card_style') {
    const style = String(value).trim().toLowerCase() || 'soft';
    if (!CARD_STYLES.has(style)) throw Object.assign(new Error('site_card_style is invalid'), { statusCode: 400 });
    return style;
  }
  if (key === 'site_hero_layout') {
    const layout = String(value).trim().toLowerCase() || 'split';
    if (!HERO_LAYOUTS.has(layout)) throw Object.assign(new Error('site_hero_layout is invalid'), { statusCode: 400 });
    return layout;
  }
  if (key === 'site_publish_status') {
    const status = String(value).trim().toLowerCase() || 'draft';
    if (!PUBLISH_STATUSES.has(status)) throw Object.assign(new Error('site_publish_status is invalid'), { statusCode: 400 });
    return status;
  }
  if (key === 'site_published_at') {
    const stamp = String(value).trim();
    if (!stamp) return '';
    if (Number.isNaN(Date.parse(stamp))) throw Object.assign(new Error('site_published_at must be a valid ISO date'), { statusCode: 400 });
    return new Date(stamp).toISOString();
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
    ctx = await requireOperatorContext(event, body.tenant_id || body.tenantId || '');
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, tenantId, role } = ctx;
  if (!tenantId) return respond(403, { error: 'Operator is not linked to a tenant' });
  if (!TENANT_CONFIG_ADMIN_ROLES.has(role)) {
    return respond(403, { error: 'Elevated tenant role required' });
  }

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
  try {
    Object.entries(config).forEach(([k, v]) => {
      if (ALLOWED_KEYS.has(k)) sanitized[k] = normalizeValue(k, v);
    });
  } catch (err) {
    return respond(err.statusCode || 400, { error: err.message });
  }

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
