// netlify/functions/get-public-tenant-info.js
// Public endpoint for customer-facing storefront pages.
// Resolves tenant by tenant_id, slug, query tenant, or request host and returns
// public branding, contact, and website settings for the storefront shell.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { normalizeBusinessTypeKey } = require('./utils/business-type');
const { resolveApplicationFeeBps } = require('./utils/payment-policy');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function clean(value) {
  return String(value || '').trim();
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function lower(value) {
  return clean(value).toLowerCase();
}

function tenantBusinessName(tenant) {
  return clean(tenant?.business_name || tenant?.name || 'Business') || 'Business';
}

function resolveHostSlug(event, query) {
  const explicit = clean(query.slug || query.tenant || '');
  if (explicit) return lower(explicit);

  const rawHost = clean(event?.headers?.['x-forwarded-host'] || event?.headers?.host || '');
  if (!rawHost) return '';
  const host = lower(rawHost.split(':')[0]);
  if (!host || host === 'prooflink.co' || host === 'www.prooflink.co' || host === '127.0.0.1' || host === 'localhost') {
    return '';
  }
  if (host.endsWith('.prooflink.co')) {
    return host.replace(/\.prooflink\.co$/, '');
  }
  return '';
}

function fontPresetMap(preset) {
  const key = lower(preset) || 'modern_sans';
  const map = {
    modern_sans: {
      display: "'Google Sans', ui-sans-serif, system-ui, sans-serif",
      body: "'Google Sans Text', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    },
    editorial: {
      display: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif",
      body: "Georgia, 'Times New Roman', serif",
    },
    trust_serif: {
      display: "Georgia, 'Times New Roman', serif",
      body: "Georgia, 'Times New Roman', serif",
    },
    compact_ui: {
      display: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      body: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    },
  };
  return map[key] || map.modern_sans;
}

function surfacePalette(style, accent) {
  const key = lower(style) || 'clean';
  if (key === 'warm') {
    return {
      bg: '#f7f0e6',
      surface: '#fffaf4',
      text: '#342c24',
      muted: '#74695e',
      border: 'rgba(52,44,36,.12)',
      headerBg: '#342117',
      accent,
      accentDark: '#8a4123',
      accentLight: 'rgba(168,81,45,.10)',
      card: '#fffdf8',
    };
  }
  if (key === 'bold') {
    return {
      bg: '#eef2f5',
      surface: '#ffffff',
      text: '#0f1720',
      muted: '#475569',
      border: 'rgba(15,23,32,.12)',
      headerBg: '#132631',
      accent,
      accentDark: '#103b49',
      accentLight: 'rgba(22,79,99,.10)',
      card: '#ffffff',
    };
  }
  return {
    bg: '#f8f5f0',
    surface: '#fffdf8',
    text: '#2f2a22',
    muted: '#6a5f55',
    border: 'rgba(47,42,34,.12)',
    headerBg: '#3a2418',
    accent,
    accentDark: '#7a3a1f',
    accentLight: 'rgba(168,81,45,.08)',
    card: '#ffffff',
  };
}

function serviceAwareLabels(businessType) {
  const key = lower(businessType);
  const serviceBusiness = new Set([
    'service_business',
    'pressure_washing',
    'property_maintenance',
    'contractor',
    'handyman',
    'hvac',
    'plumbing',
    'cleaning',
    'lawn_care',
    'hydrovac',
  ]);
  if (serviceBusiness.has(key)) {
    return {
      catalogLabel: 'Services',
      cartLabel: 'Request',
      orderPageTitle: 'Service request',
      orderIntro: 'Tell us what you need, choose a preferred date, and send the request. We will confirm scope, timing, and any pricing details before work is booked.',
      storefrontIntro: 'Review services, request what you need, and let us confirm the next step with you directly.',
      contactIntro: 'Send a message if you need help deciding what to request, want to ask about availability, or need a real person to review the scope first.',
      quoteDisplay: 'Request pricing',
      pickupLabel: 'On-site',
      deliveryLabel: 'Remote / follow-up',
      pickupMessage: 'On-site service selected.',
      pickupOnlyMessage: 'This request needs an on-site visit or a direct scope review before it can be confirmed.',
      zipFeeMessage: 'Travel, disposal, or access fees may be confirmed after scope review.',
      freeMessage: 'Any travel adjustment will be confirmed before work is booked.',
      unavailableMessage: 'Service availability depends on location, access, and current route capacity.',
    };
  }
  return {
    catalogLabel: 'Products',
    cartLabel: 'Cart',
    orderPageTitle: 'Order request',
    orderIntro: 'Add items to your cart, submit the request, and we will confirm the details before final fulfillment.',
    storefrontIntro: 'Browse available products and build a request.',
    contactIntro: 'Send a message if you need help with an order, timing, or anything not listed on the storefront.',
    quoteDisplay: 'Contact for quote',
    pickupLabel: 'Pickup',
    deliveryLabel: 'Delivery',
    pickupMessage: 'Pickup selected.',
    pickupOnlyMessage: 'One or more items in this cart are pickup only.',
    zipFeeMessage: 'Delivery fee is based on your ZIP code.',
    freeMessage: 'Delivery is free on qualifying orders.',
    unavailableMessage: 'Delivery is unavailable for the selected ZIP code.',
  };
}

function toResponse(tenant, cfg) {
  const accent = clean(cfg.accent_color || '#a8512d') || '#a8512d';
  const fontPreset = clean(cfg.site_font_preset || 'modern_sans') || 'modern_sans';
  const fonts = fontPresetMap(fontPreset);
  const palette = surfacePalette(cfg.site_surface_style, accent);
  const resolvedBusinessType = normalizeBusinessTypeKey(cfg.workspace_business_type || tenant.business_type || '');
  const labels = serviceAwareLabels(resolvedBusinessType);
  const businessName = tenantBusinessName(tenant);
  const heroHeading = clean(cfg.hero_heading || '') || businessName;
  const heroSubheading = clean(cfg.hero_subheading || '') || clean(cfg.tagline || '') || labels.storefrontIntro;

  return {
    business_name: businessName,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      businessName,
      platformName: 'ProofLink',
      businessType: resolvedBusinessType,
      storefront: {
        titleSuffix: businessName,
        intro: clean(cfg.tagline || '') || labels.storefrontIntro,
        orderIntro: labels.orderIntro,
        contactIntro: labels.contactIntro,
        quoteDisclaimer: labels.quoteDisplay,
        deliveryDisclaimer: clean(cfg.fulfillment_notes || ''),
        complianceNotice: '',
        allergenNotice: '',
        heroHeading,
        heroSubheading,
        about: clean(cfg.about || ''),
        primaryCtaLabel: clean(cfg.site_primary_cta_label || '') || 'Request service',
        bookingCtaLabel: clean(cfg.site_booking_cta_label || '') || 'Book now',
        reviewPlatformLabel: clean(cfg.review_platform_label || ''),
        reviewLinkUrl: clean(cfg.review_link_url || ''),
        serviceArea: clean(cfg.service_area || ''),
        hoursNotes: clean(cfg.hours_notes || ''),
        catalogLabel: labels.catalogLabel,
        cartLabel: labels.cartLabel,
        orderPageTitle: labels.orderPageTitle,
      },
      branding: {
        tenantLogoUrl: clean(cfg.logo_url || tenant.logo_url || '/assets/logo.png') || '/assets/logo.png',
        platformLogoUrl: '/assets/logo.png',
        faviconPng: '/assets/favicon.png',
        faviconIco: '/favicon.ico',
        accent: palette.accent,
        bg: palette.bg,
        surface: palette.surface,
        card: palette.card,
        text: palette.text,
        muted: palette.muted,
        border: palette.border,
        headerBg: palette.headerBg,
        accentDark: palette.accentDark,
        accentLight: palette.accentLight,
        bg0: palette.bg,
        bg1: palette.surface,
        panel: palette.card,
        fontDisplay: fonts.display,
        fontBody: fonts.body,
      },
      fulfillment: {
        freeThresholdCents: Number.isFinite(+cfg.free_threshold_cents) ? Math.max(0, Math.round(+cfg.free_threshold_cents)) : 0,
        zipFees: cfg.zip_fees || {},
        unavailableMessage: clean(cfg.unavailable_message || '') || labels.unavailableMessage,
        pickupOnlyMessage: clean(cfg.pickup_only_message || '') || labels.pickupOnlyMessage,
        zipFeeMessage: clean(cfg.zip_fee_message || '') || labels.zipFeeMessage,
        freeMessage: clean(cfg.free_message || '') || labels.freeMessage,
        pickupMessage: clean(cfg.pickup_message || '') || labels.pickupMessage,
        pickupLabel: labels.pickupLabel,
        deliveryLabel: labels.deliveryLabel,
      },
      contact: {
        email: clean(cfg.public_contact_email || tenant.owner_email || ''),
        replyToName: clean(tenant.owner_name || businessName),
        cityState: clean(tenant.city_state || ''),
        phone: clean(cfg.public_business_phone || ''),
      },
      domains: {
        prooflinkSubdomain: clean(tenant.slug ? `${tenant.slug}.prooflink.co` : ''),
        customDomain: clean(cfg.custom_domain || ''),
        customDomainStatus: clean(cfg.custom_domain_status || ''),
        dnsTarget: '',
      },
      payments: {
        platformBilling: {
          planKey: clean(tenant.prooflink_plan_key || 'starter') || 'starter',
          planLabel: clean(tenant.prooflink_plan_key || 'starter') || 'starter',
          billingInterval: 'month',
          checkoutPath: '/.netlify/functions/stripe-platform-checkout',
        },
        commerce: {
          connectPath: '/.netlify/functions/stripe-connect-link',
          applicationFeeBps: resolveApplicationFeeBps(tenant.application_fee_bps),
          allowedModes: ['invoice', 'checkout'],
          defaultMode: 'invoice',
        },
        ledger: {
          livemode: false,
          currency: 'usd',
        },
      },
      website: {
        fontPreset,
        surfaceStyle: clean(cfg.site_surface_style || 'clean') || 'clean',
        buttonStyle: clean(cfg.site_button_style || 'rounded') || 'rounded',
        cardStyle: clean(cfg.site_card_style || 'soft') || 'soft',
        heroLayout: clean(cfg.site_hero_layout || 'split') || 'split',
        publishStatus: clean(cfg.site_publish_status || 'draft') || 'draft',
        publishedAt: clean(cfg.site_published_at || ''),
        showPrices: cfg.show_prices !== false,
        allowCustomRequests: cfg.allow_custom_requests !== false,
        bookingPageEnabled: cfg.booking_page_enabled !== false,
      },
    },
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `get-public-tenant-info:${ip}`, maxRequests: 60, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const query = event.queryStringParameters || {};
  const tenantId = clean(query.tenant_id || '');
  const slug = resolveHostSlug(event, query);
  const supabase = getAdminClient();

  let tenantQuery = supabase
    .from('tenants')
    .select('id, business_name, name, slug, owner_email, owner_name, logo_url, business_type, city_state, prooflink_plan_key, application_fee_bps, active')
    .eq('active', true)
    .limit(1);

  if (tenantId) tenantQuery = tenantQuery.eq('id', tenantId);
  else if (slug) tenantQuery = tenantQuery.eq('slug', slug);
  else return respond(400, { error: 'Missing tenant selector' });

  const { data: tenant, error } = await tenantQuery.maybeSingle();
  if (error || !tenant) return respond(404, { error: 'Tenant not found' });

  const { data: cfgRow } = await supabase
    .from('tenant_config')
    .select('config_value')
    .eq('tenant_id', tenant.id)
    .eq('config_key', 'site_settings')
    .maybeSingle();

  const cfg = parseConfig(cfgRow?.config_value);
  return respond(200, toResponse(tenant, cfg));
};
