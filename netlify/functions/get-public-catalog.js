// netlify/functions/get-public-catalog.js
// Public catalog endpoint with tenant resolution by slug or host.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
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
  if (host.endsWith('.prooflink.co')) return host.replace(/\.prooflink\.co$/, '');
  return '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `get-public-catalog:${ip}`, maxRequests: 60, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const query = event.queryStringParameters || {};
  const slug = resolveHostSlug(event, query);
  if (!slug) return respond(400, { error: 'Missing tenant selector' });

  const includeUnavailable = String(query.include_unavailable || '').trim().toLowerCase() === 'true';
  const supabase = getAdminClient();

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, slug, active')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();

  if (tenantError || !tenant) return respond(404, { error: 'Tenant not found' });

  let productsQuery = supabase
    .from('products')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (!includeUnavailable) {
    productsQuery = productsQuery.eq('is_available', true);
  }

  const { data: products, error } = await productsQuery;
  if (error) return respond(500, { error: 'Failed to load public catalog' });

  return respond(200, {
    tenant_slug: tenant.slug,
    products: products || [],
  });
};
