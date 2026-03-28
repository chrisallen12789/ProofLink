const { requireOnboardingAdminContext, respond } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');
const { uniqueTenantSlug } = require('./utils/slugify');
const { seedTemplateForTenant } = require('./lib/seed-templates');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');
const { buildPasswordSetupUrl } = require('./utils/auth-links');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOnboardingAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { operatorId, supabase } = ctx;
  let siteUrl;
  try {
    siteUrl = getConfiguredSiteUrl();
  } catch (err) {
    return respond(err.statusCode || 503, {
      error: err.code === 'configuration_error' ? 'configuration_error' : err.message,
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { id } = body;
  if (!id) return respond(400, { error: 'Missing onboarding request id' });

  const { data: req, error: fetchErr } = await supabase
    .from('tenant_onboarding_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !req) {
    return respond(404, { error: 'Onboarding request not found' });
  }

  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('onboarding_request_id', id)
    .maybeSingle();

  if (existingTenant) {
    await supabase
      .from('tenant_onboarding_requests')
      .update({ status: 'provisioned', updated_at: new Date().toISOString() })
      .eq('id', id);

    return respond(200, {
      message: 'Tenant already provisioned (idempotent)',
      tenant_id: existingTenant.id,
      slug: existingTenant.slug,
    });
  }

  if (!['approved', 'failed'].includes(req.status)) {
    return respond(400, {
      error: 'Request must be in approved or failed status to provision',
      current_status: req.status,
    });
  }

  await supabase
    .from('tenant_onboarding_requests')
    .update({ status: 'provisioning', provision_error: null, updated_at: new Date().toISOString() })
    .eq('id', id);

  async function failProvision(message) {
    console.error('provision-tenant failure:', message);
    await supabase
      .from('tenant_onboarding_requests')
      .update({ status: 'failed', provision_error: message, updated_at: new Date().toISOString() })
      .eq('id', id);
    return respond(500, { error: message });
  }

  let tenantSlug;
  try {
    tenantSlug = await uniqueTenantSlug(req.business_slug || req.business_name, supabase);
  } catch (err) {
    return failProvision(`Slug generation failed: ${err.message}`);
  }

  const VALID_COUPON   = 'BUILDWITHME';
  const couponApplied  = req.coupon_code === VALID_COUPON && req.selected_plan === 'growth';
  const exemptUntil    = couponApplied
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const ownerEmail = String(req.owner_email || '').trim().toLowerCase();

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .insert([
      {
        name                 : req.business_name,
        slug                 : tenantSlug,
        owner_email          : ownerEmail,
        owner_name           : req.owner_name,
        business_type        : req.business_type || null,
        city_state           : req.city_state || null,
        logo_url             : req.logo_url || null,
        onboarding_request_id: id,
        setup_complete       : false,
        active               : true,
        billing_exempt       : couponApplied,
        billing_exempt_until : exemptUntil,
      },
    ])
    .select('id, slug, name')
    .maybeSingle();

  if (tenantErr) {
    return failProvision(`Tenant creation failed: ${tenantErr.message}`);
  }
  if (!tenant) {
    return failProvision('Tenant creation failed: no record returned after insert');
  }

  const tenantId = tenant.id;

  const { data: existingOperator, error: operatorLookupErr } = await supabase
    .from('operators')
    .select('id, tenant_id, name, role')
    .ilike('email', ownerEmail)
    .maybeSingle();

  if (operatorLookupErr) {
    return failProvision(`Operator lookup failed: ${operatorLookupErr.message}`);
  }

  let operator = existingOperator;
  if (operator) {
    const operatorPatch = {};
    if (!operator.name && req.owner_name) operatorPatch.name = req.owner_name;
    if (!operator.role) operatorPatch.role = 'tenant_owner';
    if (!operator.tenant_id) operatorPatch.tenant_id = tenantId;

    if (Object.keys(operatorPatch).length) {
      const { data: updatedOperator, error: operatorUpdateErr } = await supabase
        .from('operators')
        .update(operatorPatch)
        .eq('id', operator.id)
        .select('id, tenant_id, name, role')
        .maybeSingle();

      if (operatorUpdateErr) {
        return failProvision(`Operator update failed: ${operatorUpdateErr.message}`);
      }
      if (!updatedOperator) {
        return failProvision('Operator update failed: no record returned after update');
      }
      operator = updatedOperator;
    }
  } else {
    const { data: insertedOperator, error: opErr } = await supabase
      .from('operators')
      .insert([
        {
          email: ownerEmail,
          name: req.owner_name,
          role: 'tenant_owner',
          tenant_id: tenantId,
        },
      ])
      .select('id, tenant_id, name, role')
      .maybeSingle();

    if (opErr) {
      return failProvision(`Operator creation failed: ${opErr.message}`);
    }
    if (!insertedOperator) {
      return failProvision('Operator creation failed: no record returned after insert');
    }
    operator = insertedOperator;
  }

  const newOperatorId = operator.id;

  const { error: memberErr } = await supabase
    .from('operator_members')
    .upsert(
      [
        {
          operator_id: newOperatorId,
          tenant_id: tenantId,
          role: 'owner',
          invited_by: operatorId,
        },
      ],
      { onConflict: 'operator_id,tenant_id' }
    );

  if (memberErr) {
    return failProvision(`Operator member creation failed: ${memberErr.message}`);
  }

  await seedTemplateForTenant(supabase, tenantId, newOperatorId, req.seed_template_key);

  const redirectTo = `${siteUrl}/operator/onboarding.html?tenant=${encodeURIComponent(tenantSlug)}&plan=${encodeURIComponent(req.selected_plan || 'starter')}`;
  let authUserId = null;

  const { data: newAuthUser, error: createAuthErr } = await supabase.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  });

  if (createAuthErr) {
    const { data: listData, error: listUsersErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listUsersErr) {
      return failProvision(`Auth user creation failed: ${createAuthErr.message}`);
    }
    const match = (listData?.users || []).find(
      (user) => user.email?.toLowerCase() === ownerEmail
    );
    authUserId = match?.id || null;
    if (!authUserId) {
      return failProvision(`Auth user creation failed: ${createAuthErr.message}`);
    }
  } else {
    authUserId = newAuthUser?.user?.id || null;
  }

  if (authUserId) {
    const { error: memberUserErr } = await supabase
      .from('operator_members')
      .update({ user_id: authUserId, updated_at: new Date().toISOString() })
      .eq('operator_id', newOperatorId)
      .eq('tenant_id', tenantId);
    if (memberUserErr) {
      return failProvision(`Operator member auth link failed: ${memberUserErr.message}`);
    }
  }

  let loginUrl = redirectTo;
  if (authUserId) {
    try {
      loginUrl = await buildPasswordSetupUrl(supabase, ownerEmail, `${siteUrl}/operator/`);
    } catch (err) {
      console.warn('[provision] password setup link non-fatal:', err.message);
    }
  }

  const { error: finalErr } = await supabase
    .from('tenant_onboarding_requests')
    .update({
      status: 'provisioned',
      provision_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (finalErr) {
    console.error('provision-tenant: final status update failed:', finalErr.message);
  }

  sendEmail(
    templates.provisioned({
      owner_name: req.owner_name,
      business_name: req.business_name,
      owner_email: ownerEmail,
      store_slug: tenantSlug,
      login_url: loginUrl,
      business_type: req.business_type || null,
    })
  ).catch((err) => console.warn('[provision] email failed:', err.message));

  return respond(201, {
    message: `Tenant "${tenant.name}" provisioned successfully`,
    tenant_id: tenantId,
    slug: tenantSlug,
    operator_id: newOperatorId,
  });
};
