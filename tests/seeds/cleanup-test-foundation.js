"use strict";

const { createClient } = require("@supabase/supabase-js");
const { assertRequiredEnv, loadTestEnv } = require("../setup/env.test");
const { TENANTS } = require("../fixtures/tenants");
const { USERS, resolveUserConfig } = require("../fixtures/users");
const { ONBOARDING_FIXTURES } = require("../fixtures/onboarding");

const PLTEST_SLUG_PREFIX = "pltest-";
const PLTEST_EMAIL_PREFIX = "pltest.";

const OPTIONAL_TENANT_TABLE_DELETE_ORDER = [
  "job_time_segments",
  "confined_space_permits",
  "waste_manifests",
  "utility_locate_tickets",
  "compliance_alerts",
  "equipment_maintenance_log",
  "driver_qualifications",
  "equipment",
  "disposal_facilities",
  "infrastructure_assets",
  "tenant_hydrovac_settings",
  "push_subscriptions",
  "sms_messages",
  "reviews",
  "quotes",
  "bookings",
  "recurring_orders",
  "invoices",
  "service_plans",
  "tenant_settings",
];

const CORE_TENANT_TABLE_DELETE_ORDER = [
  "payments",
  "jobs",
  "orders",
  "bids",
  "leads",
  "products",
  "pricing",
  "availability",
  "expenses",
  "customer_interactions",
  "customers",
  "tenant_config",
  "operator_members",
];

function createSupabaseClient() {
  loadTestEnv();
  assertRequiredEnv();
  return createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function assertPrefixedValue(value, prefix, label) {
  if (!String(value || "").startsWith(prefix)) {
    throw new Error(`${label} must start with "${prefix}" for safe hosted cleanup.`);
  }
}

function assertCleanupFixturesSafe() {
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

async function findAuthUserByEmail(email, supabase = createSupabaseClient()) {
  let page = 1;
  while (page < 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error && !isMissingTenantUsageSyncError(error)) throw error;
    const match = (data.users || []).find(
      (user) => String(user.email || "").toLowerCase() === String(email || "").toLowerCase()
    );
    if (match) return match;
    if (!data.users || data.users.length < 200) return null;
    page += 1;
  }
  return null;
}

async function deleteRows(table, column, values, supabase = createSupabaseClient()) {
  const filtered = values.filter(Boolean);
  if (!filtered.length) return;
  const { error } = await supabase.from(table).delete().in(column, filtered);
  if (error) {
    throw new Error(
      `Failed cleanup delete on ${table}.${column} for ${filtered.length} value(s): ${formatCleanupError(error)}`
    );
  }
}

function isMissingRelationError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "PGRST205"
    || code === "42P01"
    || message.includes("could not find the table")
    || message.includes("does not exist");
}

function isMissingTenantUsageSyncError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "P0002" && message.includes("tenant not found for usage sync");
}

function isIgnorableCleanupError(error) {
  return isMissingRelationError(error) || isMissingTenantUsageSyncError(error);
}

async function deleteRowsMaybe(table, column, values, supabase = createSupabaseClient()) {
  const filtered = values.filter(Boolean);
  if (!filtered.length) return;
  const { error } = await supabase.from(table).delete().in(column, filtered);
  if (error && !isIgnorableCleanupError(error)) {
    throw new Error(
      `Failed cleanup delete on ${table}.${column} for ${filtered.length} value(s): ${formatCleanupError(error)}`
    );
  }
}

function formatCleanupError(error) {
  if (!error) return "Unknown cleanup error";
  const own = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    own[key] = error[key];
  }
  const payload = {
    name: error.name ?? null,
    message: error.message ?? null,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    status: error.status ?? null,
    ...own,
  };
  try {
    return JSON.stringify(payload);
  } catch (_jsonError) {
    return String(error?.message || error);
  }
}

async function cleanupTenantScopedData(tenantIds, supabase = createSupabaseClient()) {
  for (const table of OPTIONAL_TENANT_TABLE_DELETE_ORDER) {
    await deleteRowsMaybe(table, "tenant_id", tenantIds, supabase);
  }

  for (const table of CORE_TENANT_TABLE_DELETE_ORDER) {
    await deleteRows(table, "tenant_id", tenantIds, supabase);
  }
}

async function main() {
  assertCleanupFixturesSafe();
  const supabase = createSupabaseClient();

  const tenantRows = await supabase
    .from("tenants")
    .select("id, slug, owner_email")
    .like("slug", `${PLTEST_SLUG_PREFIX}%`);
  if (tenantRows.error) throw tenantRows.error;
  const safeTenantRows = (tenantRows.data || []).filter(
    (row) =>
      String(row.slug || "").startsWith(PLTEST_SLUG_PREFIX) &&
      String(row.owner_email || "").startsWith(PLTEST_EMAIL_PREFIX)
  );
  const tenantIds = safeTenantRows.map((row) => row.id);

  const operatorRows = await supabase
    .from("operators")
    .select("id, email")
    .ilike("email", `${PLTEST_EMAIL_PREFIX}%@%`);
  if (operatorRows.error) throw operatorRows.error;
  const operatorIds = (operatorRows.data || [])
    .filter((row) => String(row.email || "").startsWith(PLTEST_EMAIL_PREFIX))
    .map((row) => row.id);

  await cleanupTenantScopedData(tenantIds, supabase);

  const onboardingRows = await supabase
    .from("tenant_onboarding_requests")
    .select("id, business_slug, owner_email")
    .like("business_slug", `${PLTEST_SLUG_PREFIX}%`);
  if (onboardingRows.error) throw onboardingRows.error;

  const onboardingIds = (onboardingRows.data || [])
    .filter(
      (row) =>
        String(row.business_slug || "").startsWith(PLTEST_SLUG_PREFIX) &&
        String(row.owner_email || "").startsWith(PLTEST_EMAIL_PREFIX)
    )
    .map((row) => row.id);
  await deleteRows("tenant_onboarding_requests", "id", onboardingIds);

  await deleteRows("operators", "id", operatorIds);
  await deleteRows("tenants", "id", tenantIds);

  for (const user of Object.values(USERS)) {
    const resolved = resolveUserConfig(user);
    assertPrefixedValue(resolved.email, PLTEST_EMAIL_PREFIX, `Seed user email ${resolved.email}`);
    const authUser = await findAuthUserByEmail(resolved.email, supabase);
    if (authUser) {
      const { error } = await supabase.auth.admin.deleteUser(authUser.id);
      if (error) throw error;
    }
  }

  console.log("Cleaned ProofLink test foundation data.");
}

if (require.main === module) {
  main().catch((error) => {
    if (isMissingTenantUsageSyncError(error)) {
      console.warn(
        "Skipping cleanup failure for missing tenant usage sync reference:",
        error?.message || String(error)
      );
      return;
    }
    console.error("Failed to cleanup ProofLink test foundation:", formatCleanupError(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CORE_TENANT_TABLE_DELETE_ORDER,
  OPTIONAL_TENANT_TABLE_DELETE_ORDER,
  cleanupTenantScopedData,
  deleteRows,
  deleteRowsMaybe,
  findAuthUserByEmail,
  formatCleanupError,
  isIgnorableCleanupError,
  isMissingRelationError,
  isMissingTenantUsageSyncError,
  main,
};
