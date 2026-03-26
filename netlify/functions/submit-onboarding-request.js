// netlify/functions/submit-onboarding-request.js
//
// Public endpoint.  No auth required.
// Accepts a POST with onboarding form data and writes a
// tenant_onboarding_requests row with status = 'submitted'.

const { getAdminClient, respond } = require('./utils/auth');
const { slugify }                  = require('./utils/slugify');
const { sendEmail, templates }     = require('./utils/email');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const { getConfiguredSiteUrl }     = require('./utils/runtime-config');

exports.handler = async (event) => {
  // CORS pre-flight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  // Rate limit: 5 submissions per 10 minutes per IP
  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `onboard:${ip}`, maxRequests: 5, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  // ── Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const {
    business_name,
    owner_name,
    owner_email,
    phone,
    business_type,
    city_state,
    requested_subdomain,
    logo_url,
    seed_template_key,
    selected_plan,
    coupon_code,
    requested_help,
    intake_mode,
  } = body;

  // ── Validate required fields
  const missing = [];
  if (!business_name || !business_name.trim()) missing.push('business_name');
  if (!owner_name    || !owner_name.trim())    missing.push('owner_name');
  if (!owner_email   || !owner_email.trim())   missing.push('owner_email');

  if (missing.length) {
    return respond(400, { error: 'Missing required fields', fields: missing });
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(owner_email.trim())) {
    return respond(400, { error: 'Invalid email address' });
  }

  const normalizedPlan = String(selected_plan || 'starter').trim().toLowerCase();
  if (!['starter', 'growth', 'enterprise'].includes(normalizedPlan)) {
    return respond(400, { error: 'Invalid selected_plan' });
  }

  const VALID_COUPON     = 'BUILDWITHME';
  const normalizedCoupon = coupon_code ? String(coupon_code).trim().toUpperCase() : null;
  const appliedCoupon    = normalizedCoupon === VALID_COUPON && normalizedPlan === 'growth'
    ? VALID_COUPON
    : null;
  const needsGuidedHelp = requested_help === true
    || String(intake_mode || '').trim().toLowerCase() === 'guided'
    || normalizedPlan === 'enterprise';

  // ── Build slug
  const business_slug = slugify(
    requested_subdomain && requested_subdomain.trim()
      ? requested_subdomain
      : business_name
  );

  // ── Write to database
  let supabase;
  try {
    supabase = getAdminClient();
  } catch (err) {
    console.error('Supabase init error:', err.message);
    return respond(500, { error: 'Server configuration error' });
  }

  const { data, error } = await supabase
    .from('tenant_onboarding_requests')
    .insert([{
      status              : needsGuidedHelp ? 'needs_review' : 'submitted',
      business_name       : business_name.trim(),
      business_slug,
      owner_name          : owner_name.trim(),
      owner_email         : owner_email.trim().toLowerCase(),
      phone               : phone               || null,
      business_type       : business_type       || null,
      city_state          : city_state          || null,
      requested_subdomain : requested_subdomain || null,
      logo_url            : logo_url            || null,
      seed_template_key   : seed_template_key   || 'default',
      selected_plan       : normalizedPlan,
      coupon_code         : appliedCoupon,
      admin_notes         : needsGuidedHelp ? 'customer_requested_guided_setup' : null,
    }])
    .select('id, business_name, status')
    .maybeSingle();

  if (error) {
    console.error('Insert onboarding request error:', error);
    return respond(500, { error: 'Failed to submit onboarding request' });
  }
  if (!data) {
    return respond(500, { error: 'Failed to submit onboarding request: no record returned' });
  }

  // ── Auto-evaluate (fire-and-forget — triggers auto-approval + provisioning)
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!needsGuidedHelp && internalSecret) {
    try {
      const siteUrl = getConfiguredSiteUrl();
      fetch(`${siteUrl}/.netlify/functions/evaluate-onboarding`, {
        method : 'POST',
        headers: {
          'Content-Type'         : 'application/json',
          'x-prooflink-internal' : internalSecret,
        },
        body: JSON.stringify({ request_id: data.id }),
        signal: AbortSignal.timeout(8000),
      }).catch((e) => console.warn('[submit] evaluate-onboarding fire failed:', e.message));
    } catch (e) {
      console.warn('[submit] could not resolve site URL for auto-evaluation:', e.message);
    }
  } else {
    console.warn('[submit] INTERNAL_SECRET not set — skipping auto-evaluation');
  }

  // ── Fire emails (non-fatal)
  const emailPayload = {
    owner_name   : owner_name.trim(),
    business_name: business_name.trim(),
    owner_email  : owner_email.trim().toLowerCase(),
    business_slug,
    selected_plan: normalizedPlan,
  };

  sendEmail(templates.submitted(emailPayload)).catch((e) =>
    console.warn('[submit] applicant email failed:', e.message)
  );

  const operatorEmail = process.env.OPERATOR_ALERT_EMAIL;
  if (operatorEmail) {
    sendEmail(templates.operatorNewRequest({
      operator_email: operatorEmail,
      owner_name    : owner_name.trim(),
      business_name : business_name.trim(),
      business_type : business_type || null,
      city_state    : city_state    || null,
      owner_email   : owner_email.trim().toLowerCase(),
      selected_plan : normalizedPlan,
    })).catch((e) => console.warn('[submit] operator email failed:', e.message));
  }

  return respond(201, {
    message    : 'Onboarding request submitted successfully',
    request_id : data.id,
    business   : data.business_name,
    status     : data.status,
    selected_plan: normalizedPlan,
  });
};
