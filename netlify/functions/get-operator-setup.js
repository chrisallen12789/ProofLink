// netlify/functions/get-operator-setup.js
// Operator-only. Returns the current tenant plus protected account record and editable setup config.

const { requireOperatorContext, respond } = require('./utils/auth');
const { normalizeBusinessTypeKey } = require('./utils/business-type');

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

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
  if (!tenantId) return respond(403, { error: 'Operator is not linked to a tenant' });

  const [{ data: tenant, error: tenantErr }, { data: cfgRow, error: cfgErr }] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, owner_email, owner_name, logo_url, business_type, city_state, active, setup_complete, prooflink_plan_key')
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

  const rawConfig = parseConfig(cfgRow?.config_value);
  const resolvedBusinessType = normalizeBusinessTypeKey(
    tenant.business_type ||
    rawConfig.workspace_business_type ||
    rawConfig.business_type ||
    ''
  );
  const lockedRecord = {
    legal_business_name: tenant.name || '',
    owner_name: tenant.owner_name || '',
    login_email: tenant.owner_email || '',
    business_type: resolvedBusinessType,
    city_state: tenant.city_state || rawConfig.city_state || '',
    license_number: rawConfig.license_number || '',
    slug: tenant.slug || '',
    active: !!tenant.active,
    setup_complete: !!tenant.setup_complete,
    prooflink_plan_key: tenant.prooflink_plan_key || 'starter',
  };

  const config = {
    ...rawConfig,
    logo_url: rawConfig.logo_url || tenant.logo_url || '',
    show_prices: rawConfig.show_prices !== false,
    allow_custom_requests: rawConfig.allow_custom_requests !== false,
    public_contact_email: rawConfig.public_contact_email || rawConfig.contact_email || '',
    public_business_phone: rawConfig.public_business_phone || rawConfig.business_phone || '',
    review_platform_label: rawConfig.review_platform_label || '',
    review_link_url: rawConfig.review_link_url || '',
    referral_message: rawConfig.referral_message || '',
    workspace_business_type: normalizeBusinessTypeKey(rawConfig.workspace_business_type || tenant.business_type || ''),
    site_font_preset: rawConfig.site_font_preset || 'modern_sans',
    site_surface_style: rawConfig.site_surface_style || 'clean',
    site_button_style: rawConfig.site_button_style || 'rounded',
    site_card_style: rawConfig.site_card_style || 'soft',
    site_hero_layout: rawConfig.site_hero_layout || 'split',
    site_primary_cta_label: rawConfig.site_primary_cta_label || 'Request service',
    site_booking_cta_label: rawConfig.site_booking_cta_label || 'Book now',
    site_publish_status: rawConfig.site_publish_status || 'draft',
    site_published_at: rawConfig.site_published_at || '',
  };

  return respond(200, {
    tenant,
    locked_record: lockedRecord,
    editable_fields: [
      'tagline', 'hero_heading', 'hero_subheading', 'about', 'accent_color',
      'logo_url', 'hero_image_url', 'public_contact_email', 'public_business_phone',
      'service_area', 'review_platform_label', 'review_link_url', 'referral_message',
      'instagram', 'facebook', 'hours_notes', 'fulfillment_notes',
      'workspace_business_type',
      'show_prices', 'allow_custom_requests', 'onboarding_complete',
      'site_font_preset', 'site_surface_style', 'site_button_style', 'site_card_style',
      'site_hero_layout', 'site_primary_cta_label', 'site_booking_cta_label',
      'site_publish_status', 'site_published_at',
    ],
    protected_fields: [
      'site_title', 'contact_email', 'business_type', 'city_state', 'license_number',
      'tenant_id', 'owner_email', 'owner_name', 'slug', 'approval_status',
    ],
    config,
  });
};
