// netlify/functions/get-launch-checklist.js
// Authenticated tenant-scoped launch checklist.
// GET /.netlify/functions/get-launch-checklist?tenant_id=xxx
// Returns the real-time completion state of the 5-step launch checklist.

const { getAdminClient, respond } = require('./utils/auth');
const { clean, requireOperatorContext } = require('./_prooflink_payments');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (error) {
    return respond(error.statusCode || 401, { error: error.message || 'Unauthorized' });
  }

  const params = event.queryStringParameters || {};
  const requestedTenantId = clean(params.tenant_id || '');
  const requestedSlug = clean(params.slug || '');
  const supabase = getAdminClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', ctx.tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return respond(404, { error: 'Tenant not found' });
  }

  if (requestedTenantId && requestedTenantId !== tenant.id) {
    return respond(403, { error: 'Forbidden: tenant mismatch' });
  }

  if (requestedSlug && requestedSlug !== tenant.slug) {
    return respond(403, { error: 'Forbidden: tenant mismatch' });
  }

  // ── Run checklist checks in parallel ──────────────────────────────────────

  const [
    productResult,
    configResult,
    authUserResult,
  ] = await Promise.allSettled([

    // Step 3: Has at least one product
    supabase.from('products')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),

    // Step 5: Config has tagline (signals customization started)
    supabase.from('tenant_config')
      .select('config_value')
      .eq('tenant_id', tenant.id)
      .eq('config_key', 'site_settings')
      .maybeSingle(),

    // Step 2: Auth user last sign-in (password set)
    tenant.owner_email
      ? supabase.auth.admin.listUsers()
      : Promise.resolve({ data: null }),
  ]);

  // Step 1: Always complete (they're here = approved & provisioned)
  const step1 = true;

  // Step 2: Password set = auth user exists and has signed in at least once
  let step2 = false;
  try {
    const users = authUserResult.value?.data?.users || [];
    const user  = users.find((u) => u.email === tenant.owner_email);
    step2 = !!(user && user.last_sign_in_at);
  } catch {}

  // Step 3: Products added
  const productCount = productResult.status === 'fulfilled'
    ? (productResult.value?.count || 0)
    : 0;
  const step3 = productCount > 0;

  // Step 4: Stripe connected
  const step4 = !!(tenant.stripe_account_id && tenant.stripe_charges_enabled);

  // Step 5: Store customized (tagline or logo set)
  let step5 = false;
  try {
    const configRow = configResult.value?.data;
    if (configRow?.config_value) {
      const cfg = JSON.parse(configRow.config_value);
      step5 = !!(cfg.tagline || cfg.logo_url || cfg.onboarding_complete);
    }
  } catch {}

  const steps = [
    {
      id       : 'approved',
      label    : 'Application approved',
      detail   : 'Your ProofLink account has been created.',
      complete : step1,
    },
    {
      id       : 'password',
      label    : 'Set your password',
      detail   : 'Sign in using the link in your welcome email.',
      complete : step2,
    },
    {
      id       : 'products',
      label    : 'Add your first product or service',
      detail   : `${productCount} product${productCount !== 1 ? 's' : ''} added so far.`,
      complete : step3,
      cta      : { label: 'Add products', href: '/operator/products.html' },
    },
    {
      id       : 'stripe',
      label    : 'Connect Stripe for payouts',
      detail   : step4 ? 'Stripe is connected and active.' : 'Link your bank account to receive payments.',
      complete : step4,
      cta      : step4 ? null : { label: 'Connect Stripe', href: '/operator/payments.html' },
    },
    {
      id       : 'customize',
      label    : 'Customize your storefront',
      detail   : 'Set your tagline, logo, and theme.',
      complete : step5,
      cta      : { label: 'Edit store', href: '/operator/settings.html' },
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const allDone        = completedCount === steps.length;

  return respond(200, {
    tenant_id    : tenant.id,
    tenant_name  : tenant.name,
    tenant_slug  : tenant.slug,
    steps,
    completed    : completedCount,
    total        : steps.length,
    percent      : Math.round((completedCount / steps.length) * 100),
    launch_ready : allDone,
  });
};
