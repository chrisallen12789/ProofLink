const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
}

function clean(value) {
  return String(value || '').trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `service-intake:${ip}`, maxRequests: 10, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const body = parseBody(event);
  const tenantId = clean(body.tenant_id || body.tenantId);
  const tenantSlug = clean(body.tenant_slug || body.tenantSlug);
  const customerName = clean(body.customer_name || body.name);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone);
  const summary = clean(body.summary || body.project_summary || body.notes);

  if (!tenantId && !tenantSlug) {
    return respond(400, { error: 'tenant_id or tenant_slug is required' });
  }
  if (!customerName) {
    return respond(400, { error: 'customer_name is required' });
  }
  if (!email && !phone) {
    return respond(400, { error: 'email or phone is required' });
  }
  if (!summary) {
    return respond(400, { error: 'summary is required' });
  }

  let supabase;
  try {
    supabase = getAdminClient();
  } catch (err) {
    return respond(500, { error: err.message || 'Supabase configuration is missing' });
  }

  const payload = {
    tenant_id: tenantId || undefined,
    tenant_slug: tenantSlug || undefined,
    customer_name: customerName,
    email: email || undefined,
    phone: phone || undefined,
    preferred_contact: clean(body.preferred_contact || body.preferredContact) || undefined,
    summary,
    requested_service_type: clean(body.requested_service_type || body.requestedServiceType || body.service_type) || undefined,
    service_address: clean(body.service_address || body.serviceAddress) || undefined,
    source_type: clean(body.source_type || body.sourceType) || 'website_service_intake',
  };

  const { data, error } = await supabase.rpc('submit_service_lead', { payload });
  if (error) {
    console.error('[service-intake] submit_service_lead failed:', error);
    return respond(500, { error: error.message || 'Failed to submit service lead' });
  }

  return respond(201, {
    ok: true,
    lead_id: data?.lead_id || null,
    customer_id: data?.customer_id || null,
    tenant_id: data?.tenant_id || tenantId || null,
  });
};
