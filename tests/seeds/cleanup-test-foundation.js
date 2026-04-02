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
  "proposal_options",
  "proposal_document_versions",
  "proposal_documents",
  "user_document_profiles",
  "tenant_branding_profiles",
  "reusable_exclusions_templates",
  "reusable_terms_templates",
  "document_templates",
  "provision_failures",
  "tenant_conduct_log",
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

function isMissingColumnError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "PGRST204"
    || code === "42703"
    || (message.includes("column") && message.includes("does not exist"))
    || (message.includes("could not find") && message.includes("column"));
}

function isMissingTenantUsageSyncError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "P0002" && message.includes("tenant not found for usage sync");
}

function isMissingAuthUserError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "USER_NOT_FOUND"
    || message.includes("user not found")
    || message.includes("user does not exist");
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

function matchesOptionalPrefixedValue(value, prefix) {
  return value == null || value === "" || String(value).startsWith(prefix);
}

async function selectRowsMaybe(
  { table, selectColumns, fallbackColumns = "", apply = (query) => query },
  supabase = createSupabaseClient()
) {
  let result = await apply(supabase.from(table).select(selectColumns));

  if (result.error && fallbackColumns && isMissingColumnError(result.error)) {
    result = await apply(supabase.from(table).select(fallbackColumns));
  }

  if (result.error) {
    if (isIgnorableCleanupError(result.error)) return [];
    throw new Error(
      `Failed cleanup read from ${table}: ${formatCleanupError(result.error)}`
    );
  }

  return result.data || [];
}

async function cleanupTenantScopedData(tenantIds, supabase = createSupabaseClient()) {
  // Hosted cleanup runs before the workflow-schema preflight in CI, so this
  // pass needs to tolerate older test databases that do not yet have every
  // newer tenant-linked table. Real constraint failures should still surface.
  for (const table of OPTIONAL_TENANT_TABLE_DELETE_ORDER) {
    await deleteRowsMaybe(table, "tenant_id", tenantIds, supabase);
  }

  for (const table of CORE_TENANT_TABLE_DELETE_ORDER) {
    await deleteRowsMaybe(table, "tenant_id", tenantIds, supabase);
  }
}

async function deleteAuthUserMaybe(userId, supabase = createSupabaseClient()) {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (!error || isMissingTenantUsageSyncError(error) || isMissingAuthUserError(error)) return;
  throw new Error(`Failed cleanup auth delete for ${userId}: ${formatCleanupError(error)}`);
}

async function main() {
  assertCleanupFixturesSafe();
  const supabase = createSupabaseClient();

  const tenantRows = await selectRowsMaybe(
    {
      table: "tenants",
      selectColumns: "id, slug, owner_email",
      fallbackColumns: "id, slug",
      apply: (query) => query.like("slug", `${PLTEST_SLUG_PREFIX}%`),
    },
    supabase
  );
  const safeTenantRows = tenantRows.filter(
    (row) =>
      String(row.slug || "").startsWith(PLTEST_SLUG_PREFIX) &&
      matchesOptionalPrefixedValue(row.owner_email, PLTEST_EMAIL_PREFIX)
  );
  const tenantIds = safeTenantRows.map((row) => row.id);

  const operatorRows = await selectRowsMaybe(
    {
      table: "operators",
      selectColumns: "id, email",
      apply: (query) => query.ilike("email", `${PLTEST_EMAIL_PREFIX}%@%`),
    },
    supabase
  );
  const operatorIds = operatorRows
    .filter((row) => String(row.email || "").startsWith(PLTEST_EMAIL_PREFIX))
    .map((row) => row.id);

  await cleanupTenantScopedData(tenantIds, supabase);

  for (const user of Object.values(USERS)) {
    const resolved = resolveUserConfig(user);
    assertPrefixedValue(resolved.email, PLTEST_EMAIL_PREFIX, `Seed user email ${resolved.email}`);
    const authUser = await findAuthUserByEmail(resolved.email, supabase);
    if (authUser) {
      await deleteAuthUserMaybe(authUser.id, supabase);
    }
  }

  const onboardingRows = await selectRowsMaybe(
    {
      table: "tenant_onboarding_requests",
      selectColumns: "id, business_slug, owner_email",
      fallbackColumns: "id, business_slug",
      apply: (query) => query.like("business_slug", `${PLTEST_SLUG_PREFIX}%`),
    },
    supabase
  );
  const onboardingIds = onboardingRows
    .filter(
      (row) =>
        String(row.business_slug || "").startsWith(PLTEST_SLUG_PREFIX) &&
        matchesOptionalPrefixedValue(row.owner_email, PLTEST_EMAIL_PREFIX)
    )
    .map((row) => row.id);
  await deleteRowsMaybe("tenant_onboarding_requests", "id", onboardingIds, supabase);

  await deleteRowsMaybe("operators", "id", operatorIds, supabase);
  await deleteRowsMaybe("tenants", "id", tenantIds, supabase);

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
  deleteAuthUserMaybe,
  findAuthUserByEmail,
  formatCleanupError,
  isIgnorableCleanupError,
  isMissingAuthUserError,
  isMissingColumnError,
  isMissingRelationError,
  isMissingTenantUsageSyncError,
  main,
  matchesOptionalPrefixedValue,
  selectRowsMaybe,
};
