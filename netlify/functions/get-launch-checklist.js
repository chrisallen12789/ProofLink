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

  // Step 5: Has at least one product
    supabase.from('products')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),

    // Step 2 / 3: Site settings / publish state
    supabase.from('tenant_config')
      .select('config_value')
      .eq('tenant_id', tenant.id)
      .eq('config_key', 'site_settings')
      .maybeSingle(),

    // Keep auth user lookup available for rollout context even if not surfaced directly
    tenant.owner_email
      ? supabase.auth.admin.listUsers()
      : Promise.resolve({ data: null }),
  ]);

  // Step 1: Always complete (they're here = approved & provisioned)
  const step1 = true;

  // Step 5: Products added
  const productCount = productResult.status === 'fulfilled'
    ? (productResult.value?.count || 0)
    : 0;
  const step5 = productCount > 0;

  // Step 4: Stripe connected
  const step4 = !!(tenant.stripe_account_id && tenant.stripe_charges_enabled);

  // Step 2 / 3: Website draft and publish state
  let step2 = false;
  let step3 = false;
  try {
    const configRow = configResult.value?.data;
    if (configRow?.config_value) {
      const cfg = JSON.parse(configRow.config_value);
      step2 = !!(
        (cfg.hero_heading || cfg.tagline) &&
        (cfg.public_contact_email || cfg.public_business_phone) &&
        cfg.site_primary_cta_label
      );
      step3 = cfg.site_publish_status === 'published';
    }
  } catch {}

  let ownerSignedIn = false;
  try {
    const users = authUserResult.value?.data?.users || [];
    const user  = users.find((u) => u.email === tenant.owner_email);
    ownerSignedIn = !!(user && user.last_sign_in_at);
  } catch {}

  const steps = [
    {
      id       : 'approved',
      label    : 'Workspace ready',
      detail   : ownerSignedIn ? 'The business account exists and the owner has already signed in.' : 'The business account exists and is ready to launch.',
      complete : step1,
    },
    {
      id       : 'website_shape',
      label    : 'Shape the website',
      detail   : step2 ? 'Core website details are in place.' : 'Add the hero, contact details, and CTA labels.',
      complete : step2,
      cta      : { label: 'Open website setup', href: '/operator/#setup' },
    },
    {
      id       : 'website_publish',
      label    : 'Preview and publish',
      detail   : step3 ? 'Website is published.' : 'Preview the public pages and publish when they feel ready.',
      complete : step3,
      cta      : { label: 'Open publish controls', href: '/operator/#setup' },
    },
    {
      id       : 'money',
      label    : 'Turn on billing and payouts',
      detail   : step4 ? 'Billing and payouts are ready.' : 'Activate the software plan and connect payouts.',
      complete : step4,
      cta      : step4 ? null : { label: 'Connect Stripe', href: '/operator/payments.html' },
    },
    {
      id       : 'products',
      label    : 'Add the first service and test',
      detail   : `${productCount} service${productCount !== 1 ? 's' : ''} added so far.`,
      complete : step5,
      cta      : { label: 'Add services', href: '/operator/#products' },
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
