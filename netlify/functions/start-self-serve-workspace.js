const { getAdminClient, respond } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');
const { slugify } = require('./utils/slugify');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const { supabaseAdmin } = require('./_prooflink_payments');
const {
  isMissingCreateTenantBundleRpcError,
  provisionTenantBundle,
} = require('./lib/provision-tenant-bundle');

function clean(value) {
  return String(value || '').trim();
}

function normalizePlan(value) {
  const normalized = clean(value || 'starter').toLowerCase();
  return ['starter', 'growth'].includes(normalized) ? normalized : '';
}

function normalizePayload(body) {
  return {
    business_name: clean(body.business_name || body.businessName),
    owner_name: clean(body.owner_name || body.ownerName),
    owner_email: clean(body.owner_email || body.ownerEmail).toLowerCase(),
    phone: clean(body.phone),
    business_type: clean(body.business_type || body.businessType).toLowerCase(),
    city_state: clean(body.city_state || body.cityState),
    requested_subdomain: clean(body.requested_subdomain || body.requestedSubdomain),
    selected_plan: normalizePlan(body.selected_plan || body.selectedPlan),
  };
}

function validatePayload(payload) {
  const missing = [];
  if (!payload.business_name) missing.push('business_name');
  if (!payload.owner_name) missing.push('owner_name');
  if (!payload.owner_email) missing.push('owner_email');
  if (!payload.phone) missing.push('phone');
  if (!payload.business_type) missing.push('business_type');
  if (!payload.selected_plan) {
    const err = new Error('Only Starter and Growth can start instantly. Use guided help for Enterprise.');
    err.statusCode = 400;
    throw err;
  }

  if (missing.length) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(payload.owner_email)) {
    const err = new Error('Invalid email address');
    err.statusCode = 400;
    throw err;
  }
}

async function findOrCreateAuthUser(supabase, email) {
  const normalized = clean(email).toLowerCase();
  let page = 1;
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw error;
    const match = (data?.users || []).find((user) => clean(user.email).toLowerCase() === normalized);
    if (match) return match;
    if (!data?.users || data.users.length < 500) break;
    page += 1;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
  });
  if (error) throw error;
  return data?.user || null;
}

async function buildLoginUrl(supabase, email, redirectTo) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });
  if (error) throw error;
  return data?.properties?.action_link || redirectTo;
}

async function recordProvisionedRequest(supabase, payload, tenantSlug) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('tenant_onboarding_requests').insert([{
    status: 'provisioned',
    business_name: payload.business_name,
    business_slug: tenantSlug,
    owner_name: payload.owner_name,
    owner_email: payload.owner_email,
    phone: payload.phone || null,
    business_type: payload.business_type || null,
    city_state: payload.city_state || null,
    requested_subdomain: payload.requested_subdomain || null,
    seed_template_key: payload.business_type || 'default',
    selected_plan: payload.selected_plan,
    approved_at: now,
    reviewed_at: now,
    admin_notes: 'self_serve_auto_provisioned',
    manual_override: false,
  }]);

  if (error) {
    console.warn('[start-self-serve-workspace] onboarding request insert non-fatal:', error.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `selfserve:${ip}`, maxRequests: 5, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  try {
    const payload = normalizePayload(body);
    validatePayload(payload);
    const supabase = getAdminClient();

    const subdomain = payload.requested_subdomain || slugify(payload.business_name);
    const rpcPayload = {
      business_name: payload.business_name,
      owner_name: payload.owner_name,
      email: payload.owner_email,
      phone: payload.phone,
      business_category: payload.business_type,
      selected_plan: payload.selected_plan,
      fulfillment_model: 'service',
      service_area: payload.city_state || '',
      brand_color: '',
      logo_url: '',
      subdomain_preference: subdomain,
      platform_name: 'ProofLink',
      notes: 'Self-serve join flow',
    };
    let result;
    try {
      result = await supabaseAdmin('/rest/v1/rpc/create_tenant_bundle', 'POST', rpcPayload);
    } catch (error) {
      if (!isMissingCreateTenantBundleRpcError(error)) throw error;

      result = await provisionTenantBundle({
        supabase,
        payload: {
          ...payload,
          requested_subdomain: subdomain,
          business_category: payload.business_type,
          service_area: payload.city_state,
          brand_color: '',
          logo_url: '',
          notes: 'Self-serve join flow',
        },
      });
    }

    const tenantId = clean(result?.tenant_id || result?.tenantId);
    const tenantSlug = clean(result?.tenant_slug || result?.tenantSlug || subdomain);
    const operatorId = clean(result?.operator_id || result?.operatorId);
    if (!tenantId || !tenantSlug) {
      throw Object.assign(new Error('Workspace was created but the tenant record did not return correctly.'), {
        statusCode: 500,
      });
    }

    const siteUrl = getConfiguredSiteUrl();
    const onboardingUrl = `${siteUrl}/operator/onboarding.html?tenant=${encodeURIComponent(tenantSlug)}&plan=${encodeURIComponent(payload.selected_plan)}&selfServe=1`;
    const authUser = await findOrCreateAuthUser(supabase, payload.owner_email);

    if (authUser?.id && tenantId && operatorId) {
      const { error: memberError } = await supabase
        .from('operator_members')
        .update({ user_id: authUser.id })
        .eq('tenant_id', tenantId)
        .eq('operator_id', operatorId);
      if (memberError) {
        console.warn('[start-self-serve-workspace] operator_members user link non-fatal:', memberError.message);
      }
    }

    let loginUrl = onboardingUrl;
    try {
      loginUrl = await buildLoginUrl(supabase, payload.owner_email, onboardingUrl);
    } catch (error) {
      console.warn('[start-self-serve-workspace] magic link generation non-fatal:', error.message);
    }

    await recordProvisionedRequest(supabase, payload, tenantSlug);

    sendEmail(templates.provisioned({
      owner_name: payload.owner_name,
      business_name: payload.business_name,
      owner_email: payload.owner_email,
      login_url: loginUrl,
      store_slug: tenantSlug,
      business_type: payload.business_type || null,
    })).catch((error) => console.warn('[start-self-serve-workspace] email failed:', error.message));

    return respond(201, {
      mode: 'self_serve',
      message: 'Workspace created successfully',
      tenant_id: tenantId,
      tenant_slug: tenantSlug,
      operator_id: operatorId || null,
      login_url: loginUrl,
      onboarding_url: onboardingUrl,
      selected_plan: payload.selected_plan,
    });
  } catch (error) {
    return respond(error.statusCode || 500, { error: error.message || 'Unable to create workspace' });
  }
};
