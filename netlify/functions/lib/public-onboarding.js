'use strict';

const { getAdminClient } = require('../utils/auth');
const { slugify } = require('../utils/slugify');
const { sendEmail, templates } = require('../utils/email');
const { getConfiguredSiteUrl } = require('../utils/runtime-config');

const MIN_SUBMIT_MS = Number(process.env.MIN_SUBMIT_MS || 2500);
const MAX_SUBMIT_MS = Number(process.env.MAX_SUBMIT_MS || 60 * 60 * 1000);
const VALID_COUPON = 'BUILDWITHME';
const VALID_PLANS = new Set(['starter', 'growth', 'enterprise']);

function clean(value) {
  return String(value || '').trim();
}

function normalizePlan(value) {
  return clean(value || 'starter').toLowerCase() || 'starter';
}

function normalizeIntakeMode(value) {
  const mode = clean(value).toLowerCase();
  return mode === 'guided' ? 'guided' : 'self_serve';
}

function parseBoolean(value) {
  if (value === true) return true;
  return clean(value).toLowerCase() === 'true';
}

function normalizeLegacyCityState(input = {}) {
  return (
    clean(input.city_state || input.cityState) ||
    clean(input.service_area || input.serviceArea)
  );
}

function normalizeOnboardingPayload(input) {
  const payload = input && typeof input === 'object' ? input : {};
  const selectedPlan = normalizePlan(payload.selected_plan || payload.selectedPlan);
  const intakeMode = normalizeIntakeMode(payload.intake_mode || payload.intakeMode);
  const requestedHelp =
    parseBoolean(payload.requested_help) ||
    intakeMode === 'guided' ||
    selectedPlan === 'enterprise';

  return {
    business_name: clean(payload.business_name || payload.businessName),
    owner_name: clean(payload.owner_name || payload.ownerName),
    owner_email: clean(payload.owner_email || payload.email).toLowerCase(),
    phone: clean(payload.phone),
    business_type: clean(
      payload.business_type ||
        payload.businessType ||
        payload.business_category ||
        payload.businessCategory
    ),
    city_state: normalizeLegacyCityState(payload),
    requested_subdomain: clean(
      payload.requested_subdomain ||
        payload.requestedSubdomain ||
        payload.subdomain_preference ||
        payload.subdomainPreference
    ),
    logo_url: clean(payload.logo_url || payload.logoUrl),
    seed_template_key: clean(payload.seed_template_key),
    selected_plan: selectedPlan,
    coupon_code: clean(payload.coupon_code || payload.couponCode).toUpperCase(),
    requested_help: requestedHelp,
    intake_mode: requestedHelp ? 'guided' : intakeMode,
    website: clean(payload.website),
    started_at: Number(payload.started_at ?? payload.startedAt ?? 0),
  };
}

function validateOnboardingPayload(payload) {
  const missing = [];
  if (!payload.business_name) missing.push('business_name');
  if (!payload.owner_name) missing.push('owner_name');
  if (!payload.owner_email) missing.push('owner_email');

  if (missing.length) {
    const err = new Error('Missing required fields');
    err.statusCode = 400;
    err.fields = missing;
    throw err;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.owner_email)) {
    throw Object.assign(new Error('owner_email is not a valid email address'), { statusCode: 400 });
  }

  if (!VALID_PLANS.has(payload.selected_plan)) {
    throw Object.assign(new Error('Invalid selected_plan'), { statusCode: 400 });
  }
}

function applySpamGate(payload) {
  if (payload.website) {
    throw Object.assign(new Error('Submission rejected.'), { statusCode: 400 });
  }

  if (payload.started_at) {
    const delta = Date.now() - payload.started_at;
    if (delta < MIN_SUBMIT_MS || delta > MAX_SUBMIT_MS) {
      throw Object.assign(new Error('Submission rejected.'), { statusCode: 400 });
    }
  }
}

function buildInsertRecord(payload) {
  const selectedPlan = payload.selected_plan;
  const normalizedCoupon = payload.coupon_code || null;
  const appliedCoupon =
    normalizedCoupon === VALID_COUPON && selectedPlan === 'growth'
      ? VALID_COUPON
      : null;
  const businessSlug = slugify(payload.requested_subdomain || payload.business_name);
  const needsGuidedHelp = payload.requested_help || selectedPlan === 'enterprise';

  return {
    business_name: payload.business_name,
    business_slug: businessSlug,
    owner_name: payload.owner_name,
    owner_email: payload.owner_email,
    phone: payload.phone || null,
    business_type: payload.business_type || null,
    city_state: payload.city_state || null,
    requested_subdomain: payload.requested_subdomain || null,
    logo_url: payload.logo_url || null,
    seed_template_key: payload.seed_template_key || payload.business_type || 'default',
    selected_plan: selectedPlan,
    coupon_code: appliedCoupon,
    intake_mode: needsGuidedHelp ? 'guided' : 'self_serve',
    status: needsGuidedHelp ? 'needs_review' : 'submitted',
    admin_notes: needsGuidedHelp ? 'customer_requested_guided_setup' : null,
  };
}

function isMissingInsertColumn(error, columnName) {
  const code = clean(error?.code).toUpperCase();
  const message = clean(error?.message).toLowerCase();
  return code === 'PGRST204' && message.includes(`'${String(columnName || '').toLowerCase()}' column`);
}

async function insertOnboardingRequest(supabase, insertRecord) {
  const attempt = async (record) => supabase
    .from('tenant_onboarding_requests')
    .insert([record])
    .select('id, business_name, status')
    .maybeSingle();

  let result = await attempt(insertRecord);
  if (result.error && isMissingInsertColumn(result.error, 'intake_mode')) {
    const fallbackRecord = { ...insertRecord };
    delete fallbackRecord.intake_mode;
    result = await attempt(fallbackRecord);
  }
  return result;
}

async function submitOnboardingRequest(input) {
  const payload = normalizeOnboardingPayload(input);
  validateOnboardingPayload(payload);
  applySpamGate(payload);

  const supabase = getAdminClient();
  const insertRecord = buildInsertRecord(payload);

  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id, business_name, status')
    .ilike('owner_email', insertRecord.owner_email)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (existingTenant) {
    const err = new Error('An account already exists for this email address.');
    err.statusCode = 409;
    err.detail =
      'If you need access, use the operator login page. Contact support if you have forgotten your password.';
    throw err;
  }

  const { data: pendingRequest } = await supabase
    .from('tenant_onboarding_requests')
    .select('id, status')
    .ilike('owner_email', insertRecord.owner_email)
    .in('status', ['provisioned', 'approved', 'submitted', 'needs_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingRequest) {
    const err = new Error('A signup request for this email is already in progress.');
    err.statusCode = 409;
    err.detail = `Your existing request has status: ${pendingRequest.status}. Please check your email or contact support.`;
    throw err;
  }

  const { data, error } = await insertOnboardingRequest(supabase, insertRecord);

  if (error) {
    throw Object.assign(new Error('Failed to submit onboarding request'), {
      statusCode: 500,
      cause: error,
    });
  }
  if (!data) {
    throw Object.assign(new Error('Failed to submit onboarding request: no record returned'), {
      statusCode: 500,
    });
  }

  const internalSecret = process.env.INTERNAL_SECRET;
  if (insertRecord.status === 'submitted' && internalSecret) {
    try {
      const siteUrl = getConfiguredSiteUrl();
      fetch(`${siteUrl}/.netlify/functions/evaluate-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-prooflink-internal': internalSecret,
        },
        body: JSON.stringify({ request_id: data.id }),
        signal: AbortSignal.timeout(8000),
      }).catch((err) => console.warn('[submit] evaluate-onboarding fire failed:', err.message));
    } catch (err) {
      console.warn('[submit] could not resolve site URL for auto-evaluation:', err.message);
    }
  } else if (!internalSecret) {
    console.warn('[submit] INTERNAL_SECRET not set — skipping auto-evaluation');
  }

  const emailPayload = {
    owner_name: insertRecord.owner_name,
    business_name: insertRecord.business_name,
    owner_email: insertRecord.owner_email,
    business_slug: insertRecord.business_slug,
    selected_plan: insertRecord.selected_plan,
  };

  sendEmail(templates.submitted(emailPayload)).catch((err) =>
    console.warn('[submit] applicant email failed:', err.message)
  );

  const operatorEmail = process.env.OPERATOR_ALERT_EMAIL;
  if (operatorEmail) {
    sendEmail(
      templates.operatorNewRequest({
        operator_email: operatorEmail,
        owner_name: insertRecord.owner_name,
        business_name: insertRecord.business_name,
        business_type: insertRecord.business_type || null,
        city_state: insertRecord.city_state || null,
        owner_email: insertRecord.owner_email,
        selected_plan: insertRecord.selected_plan,
      })
    ).catch((err) => console.warn('[submit] operator email failed:', err.message));
  }

  return {
    ok: true,
    message: 'Onboarding request submitted successfully',
    request_id: data.id,
    business: data.business_name,
    status: data.status,
    selected_plan: insertRecord.selected_plan,
  };
}

module.exports = {
  normalizeOnboardingPayload,
  submitOnboardingRequest,
};
