"use strict";

const { createClient } = require("@supabase/supabase-js");
const { assertRequiredEnv, loadTestEnv } = require("../setup/env.test");
const { TENANTS } = require("../fixtures/tenants");
const { USERS, resolveUserConfig } = require("../fixtures/users");
const { ONBOARDING_FIXTURES } = require("../fixtures/onboarding");

loadTestEnv();
assertRequiredEnv();

const PLTEST_SLUG_PREFIX = "pltest-";
const PLTEST_EMAIL_PREFIX = "pltest.";

const supabase = createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertPrefixedValue(value, prefix, label) {
  if (!String(value || "").startsWith(prefix)) {
    throw new Error(`${label} must start with "${prefix}" for safe hosted test seeding.`);
  }
}

function assertSeedFixturesSafe() {
  Object.values(TENANTS).forEach((tenant) => {
    assertPrefixedValue(tenant.slug, PLTEST_SLUG_PREFIX, `Tenant slug ${tenant.slug}`);
    assertPrefixedValue(tenant.ownerEmail, PLTEST_EMAIL_PREFIX, `Tenant owner email ${tenant.ownerEmail}`);
  });

  Object.values(USERS).forEach((user) => {
    const resolved = resolveUserConfig(user);
    assertPrefixedValue(resolved.email, PLTEST_EMAIL_PREFIX, `Seed user email ${resolved.email}`);
  });

  Object.values(ONBOARDING_FIXTURES).forEach((fixture) => {
    assertPrefixedValue(
      fixture.business_slug,
      PLTEST_SLUG_PREFIX,
      `Onboarding slug ${fixture.business_slug}`
    );
    assertPrefixedValue(
      fixture.owner_email,
      PLTEST_EMAIL_PREFIX,
      `Onboarding owner email ${fixture.owner_email}`
    );
  });
}

async function findAuthUserByEmail(email) {
  let page = 1;
  while (page < 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data.users || []).find(
      (user) => String(user.email || "").toLowerCase() === String(email).toLowerCase()
    );
    if (match) return match;
    if (!data.users || data.users.length < 200) return null;
    page += 1;
  }
  return null;
}

async function ensureAuthUser(userConfig) {
  const resolved = resolveUserConfig(userConfig);
  let authUser = await findAuthUserByEmail(resolved.email);

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: resolved.email,
      password: resolved.password,
      email_confirm: true,
      user_metadata: {
        source: "prooflink-test-foundation",
      },
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: resolved.password,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        source: "prooflink-test-foundation",
      },
    });
    if (error) throw error;
    authUser = data.user;
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: authUser.id,
    role: resolved.profileRole,
  });
  if (profileError) throw profileError;

  return authUser;
}

async function upsertTenant(tenant) {
  const payload = {
    name: tenant.name,
    slug: tenant.slug,
    owner_email: tenant.ownerEmail,
    prooflink_plan_key: tenant.prooflinkPlanKey,
    billing_status: tenant.billingStatus,
    status: tenant.status,
    product_count: tenant.productCount,
    max_products: tenant.maxProducts,
    customer_count: tenant.customerCount,
    max_customers: tenant.maxCustomers,
    operator_seat_count: tenant.operatorSeatCount,
    // Temporarily lift seat capacity during fixture upserts so stale hosted rows
    // do not block the seed pass before we restore the intended near-limit values.
    max_operator_seats: Math.max(Number(tenant.maxOperatorSeats || 0), 25),
    current_month_order_count: tenant.currentMonthOrderCount,
    max_orders_per_month: tenant.maxOrdersPerMonth,
    storage_used_mb: tenant.storageUsedMb,
    max_storage_mb: tenant.maxStorageMb,
    allow_online_checkout: false,
    allow_custom_domain: false,
    allow_advanced_analytics: false,
    allow_automation: false,
    active: true,
  };

  const result = await supabase
    .from("tenants")
    .upsert(payload, { onConflict: "slug" })
    .select("*")
    .single();

  if (result.error) throw result.error;
  return result.data;
}

async function restoreTenantTargetMetrics(tenant) {
  const { error } = await supabase
    .from("tenants")
    .update({
      product_count: tenant.productCount,
      max_products: tenant.maxProducts,
      customer_count: tenant.customerCount,
      max_customers: tenant.maxCustomers,
      operator_seat_count: tenant.operatorSeatCount,
      max_operator_seats: tenant.maxOperatorSeats,
      current_month_order_count: tenant.currentMonthOrderCount,
      max_orders_per_month: tenant.maxOrdersPerMonth,
      storage_used_mb: tenant.storageUsedMb,
      max_storage_mb: tenant.maxStorageMb,
    })
    .eq("slug", tenant.slug);
  if (error) throw error;
}

async function ensureOperator(userConfig, tenantRow, authUser) {
  const resolved = resolveUserConfig(userConfig);
  const membershipRole =
    resolved.membershipRole ||
    (resolved.operatorRole === "admin" ? "owner" : resolved.operatorRole);
  const operatorPayload = {
    email: resolved.email,
    name: resolved.name,
    role: resolved.operatorRole,
    tenant_id: tenantRow ? tenantRow.id : null,
  };

  const { data, error } = await supabase
    .from("operators")
    .upsert(operatorPayload, { onConflict: "email" })
    .select("*")
    .single();
  if (error) throw error;

  if (tenantRow) {
    const { error: memberError } = await supabase.from("operator_members").upsert(
      {
        operator_id: data.id,
        tenant_id: tenantRow.id,
        role: membershipRole,
        user_id: authUser.id,
        invited_by: null,
      },
      { onConflict: "operator_id,tenant_id" }
    );
    if (memberError) throw memberError;
  }

  return data;
}

async function ensureTenantConfig(tenantRow) {
  const { error } = await supabase.from("tenant_config").upsert(
    {
      tenant_id: tenantRow.id,
      config_key: "site_settings",
      config_value: JSON.stringify({
        tagline: `Seed config for ${tenantRow.slug}`,
        accent_color: "#c84b2f",
      }),
    },
    { onConflict: "tenant_id,config_key" }
  );
  if (error) throw error;
}

async function ensureProduct(tenantRow, operatorRow, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const existing = await supabase
    .from("products")
    .select("id")
    .eq("tenant_id", tenantRow.id)
    .eq("slug", slug)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const payload = {
    tenant_id: tenantRow.id,
    operator_id: operatorRow.id,
    name,
    slug,
    pricing_mode: "quote",
    sell_price_cents: 0,
    starting_price_cents: 0,
    is_active: true,
  };

  if (!existing.data) {
    const { error } = await supabase.from("products").insert(payload);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("products").update(payload).eq("id", existing.data.id);
  if (error) throw error;
}

async function ensureOnboarding(fixture, approvedByOperatorId) {
  const payload = {
    status: fixture.status,
    business_name: fixture.business_name,
    business_slug: fixture.business_slug,
    owner_name: fixture.owner_name,
    owner_email: fixture.owner_email,
    business_type: fixture.business_type,
    city_state: fixture.city_state,
    seed_template_key: fixture.seed_template_key,
    approved_at: fixture.status === "approved" ? new Date().toISOString() : null,
    reviewed_by: fixture.status === "approved" ? approvedByOperatorId : null,
  };

  const existing = await supabase
    .from("tenant_onboarding_requests")
    .select("id, status")
    .eq("business_slug", fixture.business_slug)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (!existing.data) {
    const { error } = await supabase.from("tenant_onboarding_requests").insert(payload);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("tenant_onboarding_requests")
    .update(payload)
    .eq("id", existing.data.id);
  if (error) throw error;
}

async function main() {
  assertSeedFixturesSafe();

  const tenantRows = {};
  for (const tenant of Object.values(TENANTS)) {
    tenantRows[tenant.slug] = await upsertTenant(tenant);
    await ensureTenantConfig(tenantRows[tenant.slug]);
  }

  const authUsers = {};
  for (const user of Object.values(USERS)) {
    authUsers[user.key] = await ensureAuthUser(user);
  }

  const operators = {};
  for (const user of Object.values(USERS)) {
    const tenantRow = user.tenantKey ? tenantRows[TENANTS[user.tenantKey].slug] : null;
    operators[user.key] = await ensureOperator(user, tenantRow, authUsers[user.key]);
  }

  await ensureProduct(tenantRows[TENANTS.tenantA.slug], operators.tenantAAdmin, "pltest-a-product");
  await ensureProduct(tenantRows[TENANTS.tenantB.slug], operators.tenantBAdmin, "pltest-b-product");

  await ensureOnboarding(ONBOARDING_FIXTURES.approved, operators.platformAdmin.id);
  await ensureOnboarding(ONBOARDING_FIXTURES.submitted, operators.platformAdmin.id);

  // Hosted DB triggers recompute some counters from real rows during seed setup.
  // Restore the intended near-limit fixture values after all seed writes complete.
  for (const tenant of Object.values(TENANTS)) {
    await restoreTenantTargetMetrics(tenant);
  }

  console.log("Seeded ProofLink test foundation data.");
}

main().catch((error) => {
  console.error("Failed to seed ProofLink test foundation:", error);
  process.exitCode = 1;
});
