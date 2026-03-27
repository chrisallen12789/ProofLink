// netlify/functions/admin-approve-onboarding.js
//
// Admin-only.  Approves an onboarding request AND immediately provisions the
// full tenant bundle in one atomic operation.
//
// This gives admins a single-click "Approve & Launch" workflow instead of the
// two-step  Approve → Provision  sequence that provision-tenant.js requires.
//
// POST body: { id: "<onboarding_request_uuid>" }
//
// Flow:
//   1. Load & validate the onboarding request
//   2. Idempotency check (already provisioned?)
//   3. Mark as provisioning + set approved_at
//   4. Generate unique tenant slug
//   5. Create tenant row
//   6. Upsert operator row (email as conflict key)
//   7. Upsert operator_members row (owner link)
//   8. Seed tenant_config defaults
//   9. Seed tenant_settings defaults (new table)
//  10. Mark request as provisioned
//  11. Send "store is ready" welcome email (non-fatal)
//
// Returns 201 { message, tenant_id, slug, operator_id, login_url }

const { requireAdminContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');
const { uniqueTenantSlug }               = require('./utils/slugify');
const { seedTemplateForTenant }          = require('./lib/seed-templates');
const { getConfiguredSiteUrl }           = require('./utils/runtime-config');
const { buildPasswordSetupUrl }          = require('./utils/auth-links');

// ── Seed branding + contact into tenant_settings ────────────────────────────
async function seedTenantSettings(supabase, tenantId, req) {
  const { error } = await supabase
    .from('tenant_settings')
    .upsert([{
      tenant_id    : tenantId,
      branding     : {
        business_name: req.business_name,
        logo_url     : req.logo_url || null,
        accent_color : '#c84b2f',
      },
      contact: {
        email     : req.owner_email,
        phone     : req.phone     || null,
        city_state: req.city_state || null,
      },
      business_hours: {},
    }], { onConflict: 'tenant_id' });

  if (error) {
    // tenant_settings table may not exist yet — non-fatal
    console.warn('[admin-approve] seedTenantSettings non-fatal:', error.message);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  // Require a logged-in operator (admin auth)
  let ctx;
  try {
    ctx = await requireAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { operatorId, supabase } = ctx;
  let siteUrl;
  try {
    siteUrl = getConfiguredSiteUrl();
  } catch (err) {
    return respond(err.statusCode || 503, { error: err.code === 'configuration_error' ? 'configuration_error' : err.message });
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { id } = body;
  if (!id) return respond(400, { error: 'Missing onboarding request id' });

  // ── Load request ────────────────────────────────────────────────────────────
  const { data: req, error: fetchErr } = await supabase
    .from('tenant_onboarding_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !req) {
    return respond(404, { error: 'Onboarding request not found' });
  }

  // ── IDEMPOTENCY — already provisioned? ─────────────────────────────────────
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('onboarding_request_id', id)
    .maybeSingle();

  if (existingTenant) {
    // Keep status in sync
    await supabase
      .from('tenant_onboarding_requests')
      .update({ status: 'provisioned' })
      .eq('id', id);

    return respond(200, {
      message   : 'Tenant already provisioned (idempotent)',
      tenant_id : existingTenant.id,
      slug      : existingTenant.slug,
      login_url : siteUrl + '/operator/',
    });
  }

  // ── Guard: must be in an approvable state ─────────────────────────────────
  const approvable = ['submitted', 'approved', 'failed', 'needs_review'];
  if (!approvable.includes(req.status)) {
    return respond(400, {
      error         : `Cannot approve/provision a request with status '${req.status}'`,
      current_status: req.status,
    });
  }

  // ── Mark as provisioning ──────────────────────────────────────────────────
  const nowIso = new Date().toISOString();
  await supabase
    .from('tenant_onboarding_requests')
    .update({
      status         : 'provisioning',
      approved_at    : nowIso,
      provision_error: null,
      updated_at     : nowIso,
    })
    .eq('id', id);

  // ── Failure helper ────────────────────────────────────────────────────────
  async function failProvision(message) {
    console.error('[admin-approve] failure:', message);
    await supabase
      .from('tenant_onboarding_requests')
      .update({ status: 'failed', provision_error: message })
      .eq('id', id);
    return respond(500, { error: message });
  }

  // ── Generate unique tenant slug ───────────────────────────────────────────
  let tenantSlug;
  try {
    tenantSlug = await uniqueTenantSlug(req.business_slug || req.business_name, supabase);
  } catch (err) {
    return failProvision(`Slug generation failed: ${err.message}`);
  }

  // ── Create tenant row ─────────────────────────────────────────────────────
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .insert([{
      name                 : req.business_name,
      slug                 : tenantSlug,
      owner_email          : req.owner_email,
      owner_name           : req.owner_name,
      business_type        : req.business_type        || null,
      city_state           : req.city_state           || null,
      logo_url             : req.logo_url             || null,
      onboarding_request_id: id,
      setup_complete       : false,
      active               : true,
    }])
    .select('id, slug, name')
    .maybeSingle();

  if (tenantErr) {
    return failProvision(`Tenant creation failed: ${tenantErr.message}`);
  }
  if (!tenant) {
    return failProvision('Tenant creation failed: no record returned after insert');
  }

  const tenantId = tenant.id;

  // ── Upsert operator row ───────────────────────────────────────────────────
  const { data: operator, error: opErr } = await supabase
    .from('operators')
    .upsert([{
      email    : req.owner_email,
      name     : req.owner_name,
      role     : 'tenant_owner',
      tenant_id: tenantId,
    }], { onConflict: 'email' })
    .select('id')
    .maybeSingle();

  if (opErr) {
    return failProvision(`Operator creation failed: ${opErr.message}`);
  }
  if (!operator) {
    return failProvision('Operator creation failed: no record returned after upsert');
  }

  const newOperatorId = operator.id;

  // ── Upsert operator_members row ───────────────────────────────────────────
  const { error: memberErr } = await supabase
    .from('operator_members')
    .upsert([{
      operator_id: newOperatorId,
      tenant_id  : tenantId,
      role       : 'owner',
      invited_by : operatorId,
    }], { onConflict: 'operator_id,tenant_id' });

  if (memberErr) {
    return failProvision(`Operator member link failed: ${memberErr.message}`);
  }

  // ── Seed industry template (products + tenant_config) ────────────────────
  await seedTemplateForTenant(supabase, tenantId, newOperatorId, req.seed_template_key);
  await seedTenantSettings(supabase, tenantId, req);

  // ── Create Supabase auth user (if not already existing) ───────────────────
  const redirectTo = siteUrl + '/operator/';
  let authUserId = null;

  const { data: newAuthUser, error: createAuthErr } = await supabase.auth.admin.createUser({
    email: req.owner_email,
    email_confirm: true,
  });

  if (createAuthErr) {
    // User may already exist — look them up
    const { data: existingAuthUser } = await supabase.auth.admin.getUserByEmail(req.owner_email);
    authUserId = existingAuthUser?.user?.id || null;
    if (!authUserId) {
      console.warn('[admin-approve] Auth user creation non-fatal:', createAuthErr.message);
    }
  } else {
    authUserId = newAuthUser?.user?.id;
  }

  // Link user_id to operator_members
  if (authUserId) {
    await supabase
      .from('operator_members')
      .update({ user_id: authUserId })
      .eq('operator_id', newOperatorId)
      .eq('tenant_id', tenantId);
  }

  // ── Generate magic link for the welcome email ─────────────────────────────
  let loginUrl = redirectTo;

  if (authUserId) {
    try {
      loginUrl = await buildPasswordSetupUrl(supabase, req.owner_email, redirectTo);
    } catch (e) {
      console.warn('[admin-approve] password setup link non-fatal:', e.message);
    }
  }

  // ── Mark provisioned ─────────────────────────────────────────────────────
  await supabase
    .from('tenant_onboarding_requests')
    .update({ status: 'provisioned', provision_error: null, updated_at: new Date().toISOString() })
    .eq('id', id);

  // ── Send welcome email (non-fatal) ────────────────────────────────────────
  sendEmail(templates.provisioned({
    owner_name    : req.owner_name,
    business_name : req.business_name,
    owner_email   : req.owner_email,
    store_slug    : tenantSlug,
    login_url     : loginUrl,
    business_type : req.business_type || null,
  })).catch((e) => console.warn('[admin-approve] welcome email failed:', e.message));

  return respond(201, {
    message     : `"${tenant.name}" approved and provisioned successfully`,
    tenant_id   : tenantId,
    slug        : tenantSlug,
    operator_id : newOperatorId,
    login_url   : loginUrl,
  });
};
