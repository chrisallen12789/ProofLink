const { requireOnboardingAdminContext, respond } = require('./utils/auth');
const { sendEmail, templates } = require('./utils/email');
const { uniqueTenantSlug } = require('./utils/slugify');
const { seedTemplateForTenant } = require('./lib/seed-templates');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');
const { buildPasswordSetupUrl } = require('./utils/auth-links');
const { getDefaultApplicationFeeBps } = require('./utils/payment-policy');

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

  const ownerEmail = String(req.owner_email || '').trim().toLowerCase();
  let createdTenantId = null;
  let createdOperatorId = null;
  let createdAuthUserId = null;

  async function rollbackProvisionArtifacts() {
    const rollbackIssues = [];

    if (createdAuthUserId) {
      try {
        const { error } = await supabase.auth.admin.deleteUser(createdAuthUserId);
        if (error) rollbackIssues.push(`Auth rollback failed: ${error.message}`);
      } catch (err) {
        rollbackIssues.push(`Auth rollback failed: ${err.message || err}`);
      }
    }

    if (createdTenantId) {
      try {
        const { error } = await supabase
          .from('operator_members')
          .delete()
          .eq('tenant_id', createdTenantId);
        if (error) rollbackIssues.push(`Membership rollback failed: ${error.message}`);
      } catch (err) {
        rollbackIssues.push(`Membership rollback failed: ${err.message || err}`);
      }

      if (createdOperatorId) {
        try {
          const { error } = await supabase
            .from('operators')
            .delete()
            .eq('id', createdOperatorId);
          if (error) rollbackIssues.push(`Operator rollback failed: ${error.message}`);
        } catch (err) {
          rollbackIssues.push(`Operator rollback failed: ${err.message || err}`);
        }
      }

      try {
        const { error } = await supabase
          .from('tenants')
          .delete()
          .eq('id', createdTenantId);
        if (error) rollbackIssues.push(`Tenant rollback failed: ${error.message}`);
      } catch (err) {
        rollbackIssues.push(`Tenant rollback failed: ${err.message || err}`);
      }
    }

    return rollbackIssues;
  }

  async function recordProvisionFailure(message, rollbackIssues = []) {
    if (!rollbackIssues.length) return;
    const payload = {
      onboarding_request_id: id,
      tenant_id: createdTenantId,
      operator_id: createdOperatorId || operatorId || null,
      owner_email: ownerEmail || null,
      failure_stage: 'rollback',
      failure_message: message,
      rollback_issues: rollbackIssues,
      metadata: {
        source: 'provision-tenant',
        request_status: req.status || null,
        selected_plan: req.selected_plan || null,
        created_auth_user_id: createdAuthUserId || null,
      },
    };
    try {
      const { error } = await supabase.from('provision_failures').insert(payload);
      if (error) {
        console.error('provision-tenant rollback failure log failed:', error.message);
      }
    } catch (err) {
      console.error('provision-tenant rollback failure log failed:', err.message || err);
    }
  }

  async function failProvision(message) {
    console.error('provision-tenant failure:', message);
    const rollbackIssues = await rollbackProvisionArtifacts();
    if (rollbackIssues.length) {
      console.error('provision-tenant rollback failure:', rollbackIssues);
    }
    await recordProvisionFailure(message, rollbackIssues);
    await supabase
      .from('tenant_onboarding_requests')
      .update({
        status: 'failed',
        provision_error: rollbackIssues.length ? `${message} | Rollback issues: ${rollbackIssues.join('; ')}` : message,
        updated_at: new Date().toISOString(),
      })
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
        application_fee_bps  : getDefaultApplicationFeeBps(),
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
  createdTenantId = tenantId;

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
    createdOperatorId = insertedOperator.id;
  }

  const newOperatorId = operator.id;

  const redirectTo = `${siteUrl}/operator/onboarding.html?tenant=${encodeURIComponent(tenantSlug)}&plan=${encodeURIComponent(req.selected_plan || 'starter')}`;

  // ── Create (or recover) the auth user BEFORE writing operator_members ────────
  // This guarantees user_id is always set in the membership row.
  // A silent null here (no error but no ID) used to cause user_id=NULL and lock
  // paying customers out of their accounts — we now fail loudly instead.
  let authUserId = null;

  const { data: newAuthUser, error: createAuthErr } = await supabase.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  });

  if (createAuthErr) {
    // User may already exist (re-run / duplicate request that slipped through).
    // Recover the existing auth user ID rather than failing.
    const { data: listData, error: listUsersErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listUsersErr) {
      return failProvision(`Auth user creation failed: ${createAuthErr.message}`);
    }
    const match = (listData?.users || []).find(
      (u) => u.email?.toLowerCase() === ownerEmail
    );
    authUserId = match?.id || null;
    if (!authUserId) {
      return failProvision(`Auth user creation failed: ${createAuthErr.message}`);
    }
  } else {
    authUserId = newAuthUser?.user?.id || null;
    createdAuthUserId = authUserId;
  }

  // Hard stop — do not create a membership without a valid user ID.
  if (!authUserId) {
    return failProvision(
      'Auth user was created but returned no user ID — aborting to prevent unlinked membership'
    );
  }

  // ── Upsert operator_members with user_id already populated ───────────────────
  const { error: memberErr } = await supabase
    .from('operator_members')
    .upsert(
      [
        {
          operator_id: newOperatorId,
          tenant_id  : tenantId,
          role       : 'owner',
          invited_by : operatorId,
          user_id    : authUserId,
        },
      ],
      { onConflict: 'operator_id,tenant_id', ignoreDuplicates: false }
    );

  if (memberErr) {
    return failProvision(`Operator member creation failed: ${memberErr.message}`);
  }

  try {
    await seedTemplateForTenant(supabase, tenantId, newOperatorId, req.seed_template_key);
  } catch (err) {
    return failProvision(`Template seeding failed: ${err.message}`);
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
