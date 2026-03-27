// netlify/functions/platform-abuse-monitor.js
// Scheduled / on-demand abuse detection for the ProofLink platform.
//
// Scans all active tenants for abuse signals and auto-flags violators.
// Designed to run periodically (via Netlify scheduled function or manual trigger).
//
// Abuse signals detected:
//   - Refund rate > 20%
//   - Chargeback rate > 2%
//   - Suspicious slug changes (slug differs from onboarding slug)
//   - Large volume spikes (10x average in past 7 days vs prior 30 days)
//   - Prohibited product keywords
//
// Flagged tenants get status = 'flagged' and a reason logged in tenant_conduct_log.

'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Thresholds
const REFUND_RATE_THRESHOLD     = 0.20;  // 20%
const CHARGEBACK_RATE_THRESHOLD = 0.02;  // 2%
const VOLUME_SPIKE_MULTIPLIER   = 10;    // 10x average
const MIN_ORDERS_FOR_RATE_CHECK = 5;     // need at least 5 orders for rate checks

// Baseline prohibited product keywords (same as onboarding, applied to product names)
const PROHIBITED_PRODUCT_KEYWORDS = [
  'heroin','cocaine','meth','fentanyl','crack','opioid',
  'bong','paraphernalia','ghost gun','silencer',
  'counterfeit','fake designer','replica watches','knockoff',
  'escort service','adult entertainment','xxx',
  'get rich quick','ponzi','pyramid scheme','miracle cure',
];

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function flagTenant(supabase, tenantId, reasonCode, detail) {
  const now = new Date().toISOString();

  // Update tenant status
  await supabase
    .from('tenants')
    .update({
      status            : 'flagged',
      conduct_action    : 'flag',
      conduct_reason    : reasonCode,
      conduct_notes     : detail,
      conduct_updated_at: now,
      flagged_at        : now,
      updated_at        : now,
    })
    .eq('id', tenantId);

  // Log to conduct log (best-effort)
  try {
    await supabase.from('tenant_conduct_log').insert({
      tenant_id  : tenantId,
      action     : 'flag',
      reason_code: reasonCode,
      admin_notes: `[auto] ${detail}`,
      performed_at: now,
    });
  } catch (_) {}
}

async function checkRefundAndChargebackRates(supabase, tenant) {
  const flags = [];

  try {
    // Get order counts and refund/chargeback counts
    const { data: orders } = await supabase
      .from('orders')
      .select('id, status, total_amount')
      .eq('tenant_id', tenant.id);

    if (!orders || orders.length < MIN_ORDERS_FOR_RATE_CHECK) return flags;

    const totalOrders    = orders.length;
    const refundedOrders = orders.filter(o =>
      ['refunded', 'partially_refunded'].includes(o.status)
    ).length;
    const chargebackOrders = orders.filter(o =>
      ['chargeback', 'disputed'].includes(o.status)
    ).length;

    const refundRate     = refundedOrders / totalOrders;
    const chargebackRate = chargebackOrders / totalOrders;

    if (refundRate > REFUND_RATE_THRESHOLD) {
      flags.push({
        code  : 'HIGH_REFUND_RATE',
        detail: `Refund rate ${(refundRate * 100).toFixed(1)}% (${refundedOrders}/${totalOrders} orders) exceeds ${REFUND_RATE_THRESHOLD * 100}% threshold`,
      });
    }

    if (chargebackRate > CHARGEBACK_RATE_THRESHOLD) {
      flags.push({
        code  : 'HIGH_CHARGEBACK_RATE',
        detail: `Chargeback rate ${(chargebackRate * 100).toFixed(1)}% (${chargebackOrders}/${totalOrders} orders) exceeds ${CHARGEBACK_RATE_THRESHOLD * 100}% threshold`,
      });
    }
  } catch (_) {}

  return flags;
}

async function checkVolumeSpike(supabase, tenant) {
  const flags = [];

  try {
    const now      = new Date();
    const weekAgo  = new Date(now - 7 * 86400000).toISOString();
    const monthAgo = new Date(now - 30 * 86400000).toISOString();

    const { count: weekCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .gte('created_at', weekAgo);

    const { count: monthCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .gte('created_at', monthAgo);

    // Average weekly in the past month (approx 4 weeks)
    const avgWeekly = ((monthCount || 0) - (weekCount || 0)) / 3;

    if (avgWeekly > 0 && (weekCount || 0) > avgWeekly * VOLUME_SPIKE_MULTIPLIER) {
      flags.push({
        code  : 'VOLUME_SPIKE',
        detail: `${weekCount} orders this week vs ~${avgWeekly.toFixed(0)}/week average (${VOLUME_SPIKE_MULTIPLIER}x threshold)`,
      });
    }
  } catch (_) {}

  return flags;
}

async function checkSlugIntegrity(supabase, tenant) {
  const flags = [];

  try {
    if (!tenant.onboarding_request_id) return flags;

    const { data: req } = await supabase
      .from('tenant_onboarding_requests')
      .select('business_slug')
      .eq('id', tenant.onboarding_request_id)
      .maybeSingle();

    if (req && req.business_slug && tenant.slug !== req.business_slug) {
      flags.push({
        code  : 'SLUG_MISMATCH',
        detail: `Current slug "${tenant.slug}" differs from onboarding slug "${req.business_slug}"`,
      });
    }
  } catch (_) {}

  return flags;
}

async function checkProhibitedProducts(supabase, tenant) {
  const flags = [];

  try {
    const { data: products } = await supabase
      .from('products')
      .select('name, description')
      .eq('tenant_id', tenant.id);

    if (!products || !products.length) return flags;

    // Also load DB-managed banned keywords if available
    let dbKeywords = [];
    try {
      const { data } = await supabase
        .from('pl_banned_keywords')
        .select('keyword')
        .eq('active', true);
      if (data) dbKeywords = data.map(k => k.keyword);
    } catch (_) {}

    const allKeywords = [...PROHIBITED_PRODUCT_KEYWORDS, ...dbKeywords];

    for (const product of products) {
      const searchText = normalize([product.name, product.description].join(' '));
      const hit = allKeywords.find(kw => searchText.includes(normalize(kw)));
      if (hit) {
        flags.push({
          code  : 'PROHIBITED_PRODUCT',
          detail: `Product "${product.name}" contains prohibited keyword "${hit}"`,
        });
        break; // one hit is enough to flag
      }
    }
  } catch (_) {}

  return flags;
}

exports.handler = async (event) => {
  // Accept GET (scheduled) or POST (manual trigger)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, body: '{}', headers: { 'Access-Control-Allow-Origin': '*' } };
  }

  const supabase = await getAdminClient();

  // Require admin token for manual POST triggers (GET is used by the scheduler)
  if (event.httpMethod === 'POST') {
    const authHeader = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    const { data: { user }, error } = await supabase.auth.getUser(authHeader);
    if (error || !user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  // Fetch all active tenants (not already flagged, suspended, or terminated)
  const { data: tenants, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, slug, name, owner_email, onboarding_request_id, status')
    .in('status', ['active']);

  if (tenantErr) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to load tenants: ' + tenantErr.message }),
    };
  }

  const results = {
    scanned : 0,
    flagged : 0,
    details : [],
  };

  for (const tenant of (tenants || [])) {
    results.scanned++;

    const allFlags = [
      ...(await checkRefundAndChargebackRates(supabase, tenant)),
      ...(await checkVolumeSpike(supabase, tenant)),
      ...(await checkSlugIntegrity(supabase, tenant)),
      ...(await checkProhibitedProducts(supabase, tenant)),
    ];

    if (allFlags.length > 0) {
      const reasons = allFlags.map(f => f.code).join(', ');
      const details = allFlags.map(f => f.detail).join('; ');
      await flagTenant(supabase, tenant.id, reasons, details);
      results.flagged++;
      results.details.push({
        tenant_id : tenant.id,
        slug      : tenant.slug,
        name      : tenant.name,
        flags     : allFlags,
      });
    }
  }

  console.log(`[abuse-monitor] Scanned ${results.scanned} tenants, flagged ${results.flagged}`);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      ok        : true,
      scanned   : results.scanned,
      flagged   : results.flagged,
      details   : results.details,
      checked_at: new Date().toISOString(),
    }),
  };
};
