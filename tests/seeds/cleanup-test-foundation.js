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

const OPERATOR_SCOPED_DELETE_TARGETS = [
  { table: "job_time_segments", column: "member_id" },
  { table: "waste_manifests", column: "driver_member_id" },
  { table: "utility_locate_tickets", column: "verified_by_member_id" },
  { table: "utility_locate_tickets", column: "created_by_member_id" },
  { table: "driver_qualifications", column: "member_id" },
  { table: "reviews", column: "operator_id" },
  { table: "quotes", column: "operator_id" },
  { table: "bookings", column: "operator_id" },
  { table: "recurring_orders", column: "operator_id" },
  { table: "invoices", column: "operator_id" },
  { table: "service_plans", column: "operator_id" },
  { table: "push_subscriptions", column: "operator_id" },
  { table: "sms_messages", column: "operator_id" },
  { table: "payments", column: "operator_id" },
  { table: "jobs", column: "assigned_member_id" },
  { table: "jobs", column: "assigned_operator_id" },
  { table: "jobs", column: "operator_id" },
  { table: "orders", column: "operator_id" },
  { table: "bids", column: "operator_id" },
  { table: "leads", column: "operator_id" },
  { table: "products", column: "operator_id" },
  { table: "pricing", column: "operator_id" },
  { table: "availability", column: "operator_id" },
  { table: "expenses", column: "operator_id" },
  { table: "customer_interactions", column: "operator_id" },
  { table: "customers", column: "operator_id" },
  { table: "equipment", column: "operator_id" },
  { table: "provision_failures", column: "operator_id" },
  { table: "operator_members", column: "operator_id" },
];

const CLEANUP_USAGE_SYNC_RETRY_LIMIT = 12;

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

function uniqueValues(values = []) {
  return [...new Set(values.filter((value) => value != null && value !== "").map((value) => String(value).trim()))];
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
  await deleteRowsInternal(table, column, values, supabase, {
    ignoreMissingRelation: false,
    ignoreMissingColumn: false,
  });
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
  await deleteRowsInternal(table, column, values, supabase, {
    ignoreMissingRelation: true,
    ignoreMissingColumn: false,
  });
}

async function deleteRowsMaybeWithColumnFallback(
  table,
  column,
  values,
  supabase = createSupabaseClient()
) {
  await deleteRowsInternal(table, column, values, supabase, {
    ignoreMissingRelation: true,
    ignoreMissingColumn: true,
  });
}

function extractUsageSyncTenantId(error) {
  const message = String(error?.message || "");
  const match = message.match(
    /tenant not found for usage sync:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1].toLowerCase() : null;
}

function buildCleanupTenantPayload(tenantId) {
  const safeTenantId = String(tenantId || "").toLowerCase();
  const compactTenantId = safeTenantId.replace(/[^a-z0-9]/g, "");
  return {
    id: safeTenantId,
    name: `PL Test Cleanup ${safeTenantId.slice(0, 8)}`,
    slug: `${PLTEST_SLUG_PREFIX}cleanup-${compactTenantId}`,
    owner_email: `${PLTEST_EMAIL_PREFIX}cleanup.${compactTenantId}@example.com`,
    owner_name: "ProofLink Test Cleanup",
    prooflink_plan_key: "starter",
    billing_status: "onboarding",
    status: "inactive",
    active: false,
  };
}

async function ensureCleanupTenantExists(tenantId, supabase = createSupabaseClient()) {
  const safeTenantId = String(tenantId || "").trim();
  if (!safeTenantId) return null;

  const { data: existing, error: readError } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", safeTenantId)
    .maybeSingle();
  if (readError && !isMissingRelationError(readError)) {
    throw new Error(`Failed cleanup read from tenants: ${formatCleanupError(readError)}`);
  }
  if (existing?.id) return existing.id;

  const payload = buildCleanupTenantPayload(safeTenantId);
  const { data, error } = await supabase.from("tenants").insert(payload).select("id").single();
  if (error) {
    throw new Error(
      `Failed cleanup placeholder tenant insert for ${safeTenantId}: ${formatCleanupError(error)}`
    );
  }
  return data?.id || safeTenantId;
}

async function deleteRowsInternal(
  table,
  column,
  values,
  supabase = createSupabaseClient(),
  { ignoreMissingRelation = false, ignoreMissingColumn = false } = {}
) {
  const filtered = uniqueValues(values);
  if (!filtered.length) return;

  const recoveredTenantIds = new Set();

  for (let attempt = 0; attempt < CLEANUP_USAGE_SYNC_RETRY_LIMIT; attempt += 1) {
    const { error } = await supabase.from(table).delete().in(column, filtered);
    if (!error) return;

    if (isMissingRelationError(error) && ignoreMissingRelation) return;
    if (isMissingColumnError(error) && ignoreMissingColumn) return;

    const missingTenantId = extractUsageSyncTenantId(error);
    if (missingTenantId && !recoveredTenantIds.has(missingTenantId)) {
      await ensureCleanupTenantExists(missingTenantId, supabase);
      recoveredTenantIds.add(missingTenantId);
      continue;
    }

    throw new Error(
      `Failed cleanup delete on ${table}.${column} for ${filtered.length} value(s): ${formatCleanupError(error)}`
    );
  }

  throw new Error(
    `Failed cleanup delete on ${table}.${column} after ${CLEANUP_USAGE_SYNC_RETRY_LIMIT} recovery attempts.`
  );
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

async function selectRowsByColumnMaybe(
  table,
  selectColumns,
  column,
  values,
  supabase = createSupabaseClient()
) {
  const filtered = uniqueValues(values);
  if (!filtered.length) return [];

  const { data, error } = await supabase.from(table).select(selectColumns).in(column, filtered);
  if (error) {
    if (isIgnorableCleanupError(error) || isMissingColumnError(error)) return [];
    throw new Error(
      `Failed cleanup read from ${table}.${column}: ${formatCleanupError(error)}`
    );
  }

  return data || [];
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

async function recoverTenantIdsFromOperators(operatorIds, supabase = createSupabaseClient()) {
  const tenantIds = new Set();

  for (const { table, column } of OPERATOR_SCOPED_DELETE_TARGETS) {
    const rows = await selectRowsByColumnMaybe(table, "tenant_id", column, operatorIds, supabase);
    rows.forEach((row) => {
      if (row?.tenant_id) tenantIds.add(row.tenant_id);
    });
  }

  return [...tenantIds];
}

async function cleanupOperatorScopedData(operatorIds, supabase = createSupabaseClient()) {
  for (const { table, column } of OPERATOR_SCOPED_DELETE_TARGETS) {
    await deleteRowsMaybeWithColumnFallback(table, column, operatorIds, supabase);
  }
}

async function deleteAuthUserMaybe(userId, supabase = createSupabaseClient()) {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (!error || isMissingTenantUsageSyncError(error) || isMissingAuthUserError(error)) return;
  throw new Error(`Failed cleanup auth delete for ${userId}: ${formatCleanupError(error)}`);
}

async function main() {
  loadTestEnv();
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
      selectColumns: "id, email, tenant_id",
      fallbackColumns: "id, email",
      apply: (query) => query.ilike("email", `${PLTEST_EMAIL_PREFIX}%@%`),
    },
    supabase
  );
  const safeOperatorRows = operatorRows
    .filter((row) => String(row.email || "").startsWith(PLTEST_EMAIL_PREFIX));
  const operatorIds = safeOperatorRows.map((row) => row.id);
  const recoveredTenantIds = await recoverTenantIdsFromOperators(operatorIds, supabase);
  const allTenantIds = uniqueValues([
    ...tenantIds,
    ...safeOperatorRows.map((row) => row.tenant_id),
    ...recoveredTenantIds,
  ]);

  for (const tenantId of allTenantIds) {
    await ensureCleanupTenantExists(tenantId, supabase);
  }

  await cleanupTenantScopedData(allTenantIds, supabase);
  await cleanupOperatorScopedData(operatorIds, supabase);

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
  await deleteRowsMaybe("tenants", "id", allTenantIds, supabase);

  const remainingOperatorRows = await selectRowsByColumnMaybe(
    "operators",
    "id, email",
    "id",
    operatorIds,
    supabase
  );
  if (remainingOperatorRows.length) {
    throw new Error(
      `Hosted cleanup left ${remainingOperatorRows.length} seeded operator row(s) behind: ${remainingOperatorRows
        .map((row) => row.email || row.id)
        .join(", ")}`
    );
  }

  const remainingTenantRows = await selectRowsByColumnMaybe(
    "tenants",
    "id, slug",
    "id",
    allTenantIds,
    supabase
  );
  if (remainingTenantRows.length) {
    throw new Error(
      `Hosted cleanup left ${remainingTenantRows.length} seeded tenant row(s) behind: ${remainingTenantRows
        .map((row) => row.slug || row.id)
        .join(", ")}`
    );
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
  CLEANUP_USAGE_SYNC_RETRY_LIMIT,
  CORE_TENANT_TABLE_DELETE_ORDER,
  OPTIONAL_TENANT_TABLE_DELETE_ORDER,
  OPERATOR_SCOPED_DELETE_TARGETS,
  buildCleanupTenantPayload,
  cleanupOperatorScopedData,
  cleanupTenantScopedData,
  deleteRows,
  deleteRowsMaybe,
  deleteRowsMaybeWithColumnFallback,
  deleteAuthUserMaybe,
  ensureCleanupTenantExists,
  extractUsageSyncTenantId,
  findAuthUserByEmail,
  formatCleanupError,
  isIgnorableCleanupError,
  isMissingAuthUserError,
  isMissingColumnError,
  isMissingRelationError,
  isMissingTenantUsageSyncError,
  main,
  matchesOptionalPrefixedValue,
  recoverTenantIdsFromOperators,
  selectRowsMaybe,
  selectRowsByColumnMaybe,
};
