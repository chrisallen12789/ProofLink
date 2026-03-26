const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');
const { getAdminClient } = require('./utils/auth');
const MIN_SUBMIT_MS = Number(process.env.MIN_SUBMIT_MS || 2500);
const MAX_SUBMIT_MS = Number(process.env.MAX_SUBMIT_MS || 60 * 60 * 1000);
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const PLATFORM_NAME = process.env.PLATFORM_NAME || 'ProofLink';
const REVIEW_EMAIL = process.env.PROOFLINK_ONBOARDING_EMAIL || process.env.ORDER_TO_EMAIL || process.env.CONTACT_TO_EMAIL || '';

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(obj)
  };
}
function parseBody(event) {
  try { return JSON.parse(event.body || '{}'); } catch { return {}; }
}
function clean(value) { return String(value || '').trim(); }
function normalize(input) {
  const payload = input && typeof input === 'object' ? input : {};
  return {
    business_name: clean(payload.businessName),
    owner_name: clean(payload.ownerName),
    email: clean(payload.email).toLowerCase(),
    phone: clean(payload.phone),
    business_category: clean(payload.businessCategory),
    selected_plan: clean(payload.selectedPlan || 'starter') || 'starter',
    fulfillment_model: clean(payload.fulfillmentModel || 'pickup') || 'pickup',
    service_area: clean(payload.serviceArea),
    brand_color: clean(payload.brandColor || '#c9a227') || '#c9a227',
    logo_url: clean(payload.logoUrl),
    subdomain_preference: clean(payload.subdomainPreference),
    domain_preference: clean(payload.domainPreference || 'prooflink_subdomain') || 'prooflink_subdomain',
    notes: clean(payload.notes),
    started_at: Number(payload.startedAt || 0),
    website: clean(payload.website),
  };
}
function validate(payload) {
  if (!payload.business_name) throw Object.assign(new Error('Business name is required.'), { statusCode: 400 });
  if (!payload.owner_name) throw Object.assign(new Error('Owner name is required.'), { statusCode: 400 });
  if (!payload.email) throw Object.assign(new Error('Email is required.'), { statusCode: 400 });
  if (!payload.phone) throw Object.assign(new Error('Phone is required.'), { statusCode: 400 });
  if (!payload.business_category) throw Object.assign(new Error('Business category is required.'), { statusCode: 400 });
}
function spamGate(payload) {
  if (payload.website) throw Object.assign(new Error('Submission rejected.'), { statusCode: 400 });
  if (payload.started_at) {
    const delta = Date.now() - payload.started_at;
    if (delta < MIN_SUBMIT_MS || delta > MAX_SUBMIT_MS) throw Object.assign(new Error('Submission rejected.'), { statusCode: 400 });
  }
}
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: `${PLATFORM_NAME} <onboarding@prooflink.co>`, to: [to], subject, html }),
    signal: AbortSignal.timeout(8000),
  });
}
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}
async function stageInSupabase(payload) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { staged: false, reason: 'missing_supabase_env' };
  }
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from('onboarding_submissions')
    .insert({
      business_name: payload.business_name,
      owner_name: payload.owner_name,
      email: payload.email,
      phone: payload.phone,
      business_category: payload.business_category,
      selected_plan: payload.selected_plan,
      fulfillment_model: payload.fulfillment_model,
      service_area: payload.service_area || null,
      brand_color: payload.brand_color || null,
      logo_url: payload.logo_url || null,
      subdomain_preference: payload.subdomain_preference || null,
      domain_preference: payload.domain_preference,
      notes: payload.notes || null,
      status: 'submitted',
      billing_status: 'onboarding',
      connect_status: 'connect_not_started',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();
  if (error) {
    return { staged: false, reason: `supabase_insert_failed:${error.message}` };
  }
  if (!data) {
    return { staged: false, reason: 'supabase_insert_failed:no_record_returned' };
  }
  return { staged: true, record: data };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  // Rate limit: 5 submissions per 10 minutes per IP
  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `onboard2:${ip}`, maxRequests: 5, windowMs: 600000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const payload = normalize(parseBody(event));
    spamGate(payload);
    validate(payload);
    const stageResult = await stageInSupabase(payload);

    const internalHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">
        <h2>New ProofLink onboarding submission</h2>
        <p><strong>Business</strong> ${escapeHtml(payload.business_name)}</p>
        <p><strong>Owner</strong> ${escapeHtml(payload.owner_name)}</p>
        <p><strong>Email</strong> ${escapeHtml(payload.email)}</p>
        <p><strong>Phone</strong> ${escapeHtml(payload.phone)}</p>
        <p><strong>Category</strong> ${escapeHtml(payload.business_category)}</p>
        <p><strong>Plan</strong> ${escapeHtml(payload.selected_plan)}</p>
        <p><strong>Fulfillment</strong> ${escapeHtml(payload.fulfillment_model)}</p>
        <p><strong>Service area</strong> ${escapeHtml(payload.service_area || '—')}</p>
        <p><strong>Subdomain preference</strong> ${escapeHtml(payload.subdomain_preference || '—')}</p>
        <p><strong>Domain preference</strong> ${escapeHtml(payload.domain_preference)}</p>
        <p><strong>Supabase stage</strong> ${escapeHtml(stageResult.staged ? 'stored' : stageResult.reason || 'not stored')}</p>
        <p><strong>Notes</strong><br>${escapeHtml(payload.notes || '—')}</p>
      </div>`;
    const customerHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">
        <h2 style="font-size:18px;margin-bottom:12px;">Application received — ProofLink</h2>
        <p>Hi ${escapeHtml(payload.owner_name)},</p>
        <p>We received your application for <strong>${escapeHtml(payload.business_name)}</strong>. Our team will review it within 24 hours.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
        <p><strong>This email is not a login link.</strong> Your ProofLink account does not exist yet — it will be created only after we approve your application.</p>
        <p>Once your application is approved you'll receive a separate email with instructions to access your operator dashboard. You don't need to do anything right now.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
        <p style="font-size:12px;color:#888;"><strong>Business</strong> ${escapeHtml(payload.business_name)}<br>
        <strong>Plan</strong> ${escapeHtml(payload.selected_plan)}<br>
        <strong>Submitted</strong> ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        <p style="font-size:12px;color:#888;">Questions? Reply to this email or contact us at support@prooflink.co</p>
      </div>`;

    await Promise.all([
      sendEmail(REVIEW_EMAIL, `${PLATFORM_NAME} onboarding: ${payload.business_name}`, internalHtml),
      sendEmail(payload.email, `${PLATFORM_NAME} received your onboarding request`, customerHtml),
    ]);

    return json(200, { ok: true, staged: stageResult.staged, stage: stageResult.reason || 'stored_or_emailed' });
  } catch (e) {
    return json(Number(e?.statusCode || 500), { ok: false, error: String(e?.message || e) });
  }
};
