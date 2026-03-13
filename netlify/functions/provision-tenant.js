// netlify/functions/provision-tenant.js
//
// Operator-only endpoint.
// Provisions a tenant from an approved onboarding request.
//
// POST body: { id: "<onboarding_request_uuid>" }
//
// This function is IDEMPOTENT:
//   - If a tenant with the same slug already exists and is linked
//     to this request, the function returns success without re-creating.
//   - Running it twice will not create duplicate tenants.
//
// No polling loops, no recursion, no infinite retries.

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail, templates }            = require('./utils/email');
const { uniqueTenantSlug }               = require('./utils/slugify');
const { seedTemplateForTenant }          = require('./lib/seed-templates');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  // ── Require operator auth ─────────────────────────────────────────────────
  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { operatorId, supabase } = ctx;

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { id } = body;
  if (!id) return respond(400, { error: 'Missing onboarding request id' });

  // ── Fetch the onboarding request ─────────────────────────────────────────
  const { data: req, error: fetchErr } = await supabase
    .from('tenant_onboarding_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !req) {
    return respond(404, { error: 'Onboarding request not found' });
  }

  // ── Guard: must be approved (or failed — allows retry after fix) ─────────
  if (!['approved', 'failed'].includes(req.status)) {
    return respond(400, {
      error          : 'Request must be in approved or failed status to provision',
      current_status : req.status,
    });
  }

  // ── IDEMPOTENCY CHECK: already provisioned? ───────────────────────────────
  // Check if a tenant with this slug already exists and is tied to this request
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('onboarding_request_id', id)
    .maybeSingle();

  if (existingTenant) {
    // Already provisioned — update request status and return success
    await supabase
      .from('tenant_onboarding_requests')
      .update({ status: 'provisioned' })
      .eq('id', id);

    return respond(200, {
      message   : 'Tenant already provisioned (idempotent)',
      tenant_id : existingTenant.id,
      slug      : existingTenant.slug,
    });
  }

  // ── Mark as provisioning ─────────────────────────────────────────────────
  await supabase
    .from('tenant_onboarding_requests')
    .update({ status: 'provisioning', provision_error: null })
    .eq('id', id);

  // ── Helper: mark failed and return error response ────────────────────────
  async function failProvision(message) {
    console.error('provision-tenant failure:', message);
    await supabase
      .from('tenant_onboarding_requests')
      .update({ status: 'failed', provision_error: message })
      .eq('id', id);
    return respond(500, { error: message });
  }

  // ── Generate unique tenant slug ──────────────────────────────────────────
  let tenantSlug;
  try {
    tenantSlug = await uniqueTenantSlug(req.business_slug || req.business_name, supabase);
  } catch (err) {
    return failProvision(`Slug generation failed: ${err.message}`);
  }

  // ── Create tenant row ────────────────────────────────────────────────────
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .insert([{
      name                  : req.business_name,
      slug                  : tenantSlug,
      owner_email           : req.owner_email,
      owner_name            : req.owner_name,
      business_type         : req.business_type || null,
      city_state            : req.city_state    || null,
      logo_url              : req.logo_url      || null,
      onboarding_request_id : id,
      setup_complete        : false,
      active                : true,
    }])
    .select('id, slug, name')
    .single();

  if (tenantErr) {
    return failProvision(`Tenant creation failed: ${tenantErr.message}`);
  }

  const tenantId = tenant.id;

  // ── Create operator row for the business owner ───────────────────────────
  const { data: operator, error: opErr } = await supabase
    .from('operators')
    .upsert([{
      email     : req.owner_email,
      name      : req.owner_name,
      role      : 'tenant_owner',
      tenant_id : tenantId,
    }], { onConflict: 'email' })
    .select('id')
    .single();

  if (opErr) {
    return failProvision(`Operator creation failed: ${opErr.message}`);
  }

  const newOperatorId = operator.id;

  // ── Create operator_members row ──────────────────────────────────────────
  const { error: memberErr } = await supabase
    .from('operator_members')
    .upsert([{
      operator_id : newOperatorId,
      tenant_id   : tenantId,
      role        : 'owner',
      invited_by  : operatorId,
    }], { onConflict: 'operator_id,tenant_id' });

  if (memberErr) {
    return failProvision(`Operator member creation failed: ${memberErr.message}`);
  }

  // ── Seed industry template (products + tenant_config) ────────────────────
  await seedTemplateForTenant(supabase, tenantId, newOperatorId, req.seed_template_key);

  // ── Create Supabase auth user (if not already existing) ───────────────────
  const redirectTo = (process.env.SITE_URL || '') + '/operator/';
  let authUserId = null;

  const { data: newAuthUser, error: createAuthErr } = await supabase.auth.admin.createUser({
    email: req.owner_email,
    email_confirm: true,
  });

  if (createAuthErr) {
    const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const match = (listData?.users || []).find(
      u => u.email?.toLowerCase() === req.owner_email.toLowerCase()
    );
    authUserId = match?.id || null;
    if (!authUserId) {
      console.warn('[provision] Auth user creation non-fatal:', createAuthErr.message);
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
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: req.owner_email,
        options: { redirectTo },
      });
      if (!linkErr && linkData?.properties?.action_link) {
        loginUrl = linkData.properties.action_link;
      }
    } catch (e) {
      console.warn('[provision] generateLink non-fatal:', e.message);
    }
  }

  // ── Mark request as provisioned ─────────────────────────────────────────
  const { error: finalErr } = await supabase
    .from('tenant_onboarding_requests')
    .update({
      status    : 'provisioned',
      provision_error : null,
    })
    .eq('id', id);

  if (finalErr) {
    console.error('provision-tenant: final status update failed:', finalErr.message);
  }

  // ── Email new business owner — non-fatal
  sendEmail(templates.provisioned({
    owner_name   : req.owner_name,
    business_name: req.business_name,
    owner_email  : req.owner_email,
    store_slug   : tenantSlug,
    login_url    : loginUrl,
  })).catch((e) => console.warn('[provision] email failed:', e.message));

  return respond(201, {
    message     : `Tenant "${tenant.name}" provisioned successfully`,
    tenant_id   : tenantId,
    slug        : tenantSlug,
    operator_id : newOperatorId,
  });
};
