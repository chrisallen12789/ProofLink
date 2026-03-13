// netlify/functions/check-slug.js
// Public endpoint — no auth required.
// GET /.netlify/functions/check-slug?slug=my-bakery
// Returns whether a slug is available for use as a tenant identifier.

const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

// Platform routes that must never be used as tenant slugs
const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'operator', 'dashboard', 'login', 'signup',
  'join', 'help', 'support', 'blog', 'about', 'contact', 'prooflink',
  'static', 'assets', 'public', 'media', 'mail', 'smtp', 'dev', 'test',
  'staging', 'beta', 'demo', 'example', 'null', 'undefined',
  // Additional platform routes
  'checkout', 'payment', 'health', 'status', 'system', 'auth', 'billing',
  'cdn', 'docs', 'logout', 'manage', 'platform', 'register', 'secure',
  'webhooks', 'callback', 'oauth', 'verify', 'confirm', 'invite',
  'start', 'onboarding', 'products', 'orders', 'cart', 'settings',
  'privacy', 'terms', 'refunds', 'cancel', 'success',
]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Method not allowed' });
  }

  // Rate limit: 30 slug checks per minute per IP
  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `slug:${ip}`, maxRequests: 30, windowMs: 60000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const raw  = (event.queryStringParameters || {}).slug || '';
  const slug = slugify(raw);

  if (!slug || slug.length < 2) {
    return respond(400, { error: 'Slug must be at least 2 characters', available: false });
  }

  if (RESERVED.has(slug)) {
    return respond(200, { available: false, reason: 'reserved', slug });
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1) {
    return respond(200, { available: false, reason: 'invalid_format', slug });
  }

  const supabase = getAdminClient();

  // Check tenants table
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (tenant) {
    return respond(200, { available: false, reason: 'taken', slug });
  }

  // Check pending onboarding requests
  const { data: pending } = await supabase
    .from('tenant_onboarding_requests')
    .select('id')
    .eq('business_slug', slug)
    .in('status', ['submitted', 'approved', 'provisioning'])
    .maybeSingle();

  if (pending) {
    return respond(200, { available: false, reason: 'pending', slug });
  }

  return respond(200, { available: true, slug });
};
