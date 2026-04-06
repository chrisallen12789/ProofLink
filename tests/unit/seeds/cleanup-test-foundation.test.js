"use strict";

const {
  CORE_TENANT_TABLE_DELETE_ORDER,
  OPTIONAL_TENANT_TABLE_DELETE_ORDER,
  OPERATOR_SCOPED_DELETE_TARGETS,
  buildCleanupTenantPayload,
  cleanupOperatorScopedData,
  cleanupTenantScopedData,
  deleteAuthUserMaybe,
  deleteRows,
  deleteRowsMaybe,
  deleteRowsMaybeWithColumnFallback,
  ensureCleanupTenantExists,
  extractUsageSyncTenantId,
  formatCleanupError,
  isIgnorableCleanupError,
  matchesOptionalPrefixedValue,
  recoverTenantIdsFromOperators,
  selectRowsMaybe,
  selectRowsByColumnMaybe,
} = require("../../seeds/cleanup-test-foundation");

function createDeleteClient(errorMap = {}) {
  const calls = [];
  const counters = new Map();
  const resolveEntry = (key) => {
    if (!Object.prototype.hasOwnProperty.call(errorMap, key)) return null;
    const entry = errorMap[key];
    if (typeof entry === "function") return entry();
    if (Array.isArray(entry)) {
      const index = counters.get(key) || 0;
      const value = entry[Math.min(index, entry.length - 1)];
      counters.set(key, index + 1);
      return value;
    }
    return entry;
  };
  const client = {
    from(table) {
      return {
        delete() {
          return {
            async in(column, values) {
              calls.push({ table, column, values });
              const key = `${table}:${column}`;
              const resolved = resolveEntry(key) ?? resolveEntry(table);
              const error = resolved && Object.prototype.hasOwnProperty.call(resolved, "error")
                ? resolved.error
                : resolved;
              return { error };
            },
          };
        },
        insert(payload) {
          calls.push({ table, type: "insert", payload });
          return {
            select(columns) {
              calls.push({ table, type: "insert-select", columns });
              return {
                async single() {
                  const key = `${table}:insert`;
                  const resolved = resolveEntry(key) ?? { data: { id: payload.id }, error: null };
                  return {
                    data: Object.prototype.hasOwnProperty.call(resolved, "data") ? resolved.data : resolved,
                    error: resolved.error || null,
                  };
                },
              };
            },
          };
        },
        select(columns) {
          calls.push({ table, type: "select", columns });
          return {
            eq(column, value) {
              calls.push({ table, type: "eq", columns, column, value });
              return {
                async maybeSingle() {
                  const key = `${table}:${columns}:${column}:eq`;
                  const resolved = resolveEntry(key) ?? { data: null, error: null };
                  return {
                    data: Object.prototype.hasOwnProperty.call(resolved, "data") ? resolved.data : resolved,
                    error: resolved.error || null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { calls, client };
}

function createSelectClient(resultMap = {}, deleteUserResult = { error: null }) {
  const calls = [];
  const client = {
    from(table) {
      return {
        select(columns) {
          const key = `${table}:${columns}`;
          const resolveResult = (column) =>
            resultMap[`${key}:${column}`] || resultMap[key] || resultMap[table] || { data: [], error: null };
          return {
            async like(column, pattern) {
              calls.push({ table, columns, type: "like", column, pattern });
              return resolveResult(column);
            },
            async ilike(column, pattern) {
              calls.push({ table, columns, type: "ilike", column, pattern });
              return resolveResult(column);
            },
            async in(column, values) {
              calls.push({ table, columns, type: "in", column, values });
              return resolveResult(column);
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async deleteUser(userId) {
          calls.push({ type: "deleteUser", userId });
          return deleteUserResult;
        },
      },
    },
  };
  return { calls, client };
}

describe("cleanup test foundation helpers", () => {
  test("cleanup order clears newer child rows before parent workflow tables", () => {
    const fullOrder = [...OPTIONAL_TENANT_TABLE_DELETE_ORDER, ...CORE_TENANT_TABLE_DELETE_ORDER];

    expect(fullOrder.indexOf("service_plans")).toBeGreaterThanOrEqual(0);
    expect(fullOrder.indexOf("service_plans")).toBeLessThan(fullOrder.indexOf("jobs"));
    expect(fullOrder.indexOf("service_plans")).toBeLessThan(fullOrder.indexOf("orders"));
    expect(fullOrder.indexOf("customer_interactions")).toBeLessThan(fullOrder.indexOf("customers"));
    expect(fullOrder).toEqual(
      expect.arrayContaining([
        "proposal_options",
        "proposal_document_versions",
        "proposal_documents",
        "tenant_branding_profiles",
        "user_document_profiles",
        "document_templates",
      ])
    );
  });

  test("deleteRowsMaybe ignores missing hosted relations during cleanup expansion", async () => {
    const { client, calls } = createDeleteClient({
      service_plans: {
        code: "42P01",
        message: "relation does not exist",
      },
    });

    await expect(deleteRowsMaybe("service_plans", "tenant_id", ["tenant-1"], client)).resolves.toBeUndefined();
    expect(calls).toEqual([{ table: "service_plans", column: "tenant_id", values: ["tenant-1"] }]);
  });

  test("deleteRowsMaybe repairs missing tenant usage sync references and retries the delete", async () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const { client, calls } = createDeleteClient({
      orders: [
        {
          error: {
            code: "P0002",
            message: `Tenant not found for usage sync: ${tenantId}`,
          },
        },
        { error: null },
      ],
      "tenants:id:id:eq": {
        data: null,
        error: null,
      },
      "tenants:insert": {
        data: { id: tenantId },
        error: null,
      },
    });

    await expect(deleteRowsMaybe("orders", "tenant_id", [tenantId], client)).resolves.toBeUndefined();
    expect(calls).toEqual([
      { table: "orders", column: "tenant_id", values: [tenantId] },
      { table: "tenants", type: "select", columns: "id" },
      { table: "tenants", type: "eq", columns: "id", column: "id", value: tenantId },
      {
        table: "tenants",
        type: "insert",
        payload: buildCleanupTenantPayload(tenantId),
      },
      { table: "tenants", type: "insert-select", columns: "id" },
      { table: "orders", column: "tenant_id", values: [tenantId] },
    ]);
  });

  test("deleteRowsMaybeWithColumnFallback ignores missing hosted columns for operator cleanup", async () => {
    const { client, calls } = createDeleteClient({
      "jobs:assigned_member_id": {
        code: "42703",
        message: "column does not exist",
      },
    });

    await expect(
      deleteRowsMaybeWithColumnFallback("jobs", "assigned_member_id", ["operator-1"], client)
    ).resolves.toBeUndefined();
    expect(calls).toEqual([{ table: "jobs", column: "assigned_member_id", values: ["operator-1"] }]);
  });

  test("cleanupTenantScopedData tolerates missing workflow tables before hosted schema preflight runs", async () => {
    const { client, calls } = createDeleteClient({
      jobs: {
        code: "42P01",
        message: "relation does not exist",
      },
      leads: {
        code: "42P01",
        message: "relation does not exist",
      },
    });

    await expect(cleanupTenantScopedData(["tenant-1"], client)).resolves.toBeUndefined();
    expect(calls.some((call) => call.table === "jobs")).toBe(true);
    expect(calls.some((call) => call.table === "leads")).toBe(true);
    expect(calls.some((call) => call.table === "customers")).toBe(true);
  });

  test("cleanupOperatorScopedData clears operator-linked residue and tolerates older hosted columns", async () => {
    const { client, calls } = createDeleteClient({
      "jobs:assigned_member_id": {
        code: "42703",
        message: "column does not exist",
      },
      "push_subscriptions:operator_id": {
        code: "42P01",
        message: "relation does not exist",
      },
    });

    await expect(cleanupOperatorScopedData(["operator-1", "operator-1"], client)).resolves.toBeUndefined();
    expect(calls).toEqual(
      expect.arrayContaining([
        { table: "payments", column: "operator_id", values: ["operator-1"] },
        { table: "jobs", column: "assigned_member_id", values: ["operator-1"] },
        { table: "operator_members", column: "operator_id", values: ["operator-1"] },
      ])
    );
    expect(OPERATOR_SCOPED_DELETE_TARGETS.some((target) => target.table === "operator_members")).toBe(true);
  });

  test("selectRowsMaybe falls back when hosted schema is missing a newer column", async () => {
    const { client, calls } = createSelectClient({
      "tenants:id, slug, owner_email": {
        data: null,
        error: {
          code: "PGRST204",
          message: "Could not find the 'owner_email' column of 'tenants' in the schema cache",
        },
      },
      "tenants:id, slug": {
        data: [{ id: "tenant-1", slug: "pltest-tenant-a" }],
        error: null,
      },
    });

    const rows = await selectRowsMaybe(
      {
        table: "tenants",
        selectColumns: "id, slug, owner_email",
        fallbackColumns: "id, slug",
        apply: (query) => query.like("slug", "pltest-%"),
      },
      client
    );

    expect(rows).toEqual([{ id: "tenant-1", slug: "pltest-tenant-a" }]);
    expect(calls).toEqual([
      {
        table: "tenants",
        columns: "id, slug, owner_email",
        type: "like",
        column: "slug",
        pattern: "pltest-%",
      },
      {
        table: "tenants",
        columns: "id, slug",
        type: "like",
        column: "slug",
        pattern: "pltest-%",
      },
    ]);
  });

  test("selectRowsByColumnMaybe tolerates missing operator columns during orphan tenant recovery", async () => {
    const { client, calls } = createSelectClient({
      "jobs:tenant_id:assigned_member_id": {
        data: null,
        error: {
          code: "42703",
          message: "column does not exist",
        },
      },
    });

    const rows = await selectRowsByColumnMaybe("jobs", "tenant_id", "assigned_member_id", ["operator-1"], client);

    expect(rows).toEqual([]);
    expect(calls).toEqual([
      {
        table: "jobs",
        columns: "tenant_id",
        type: "in",
        column: "assigned_member_id",
        values: ["operator-1"],
      },
    ]);
  });

  test("recoverTenantIdsFromOperators unions tenant ids recovered from operator-linked residue", async () => {
    const { client, calls } = createSelectClient({
      "operator_members:tenant_id:operator_id": {
        data: [{ tenant_id: "tenant-1" }],
        error: null,
      },
      "payments:tenant_id:operator_id": {
        data: [{ tenant_id: "tenant-2" }, { tenant_id: "tenant-1" }],
        error: null,
      },
      "jobs:tenant_id:assigned_member_id": {
        data: null,
        error: {
          code: "42703",
          message: "column does not exist",
        },
      },
    });

    const tenantIds = await recoverTenantIdsFromOperators(["operator-1"], client);

    expect(tenantIds.sort()).toEqual(["tenant-1", "tenant-2"]);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          table: "operator_members",
          columns: "tenant_id",
          type: "in",
          column: "operator_id",
          values: ["operator-1"],
        },
        {
          table: "payments",
          columns: "tenant_id",
          type: "in",
          column: "operator_id",
          values: ["operator-1"],
        },
      ])
    );
  });

  test("extractUsageSyncTenantId returns the missing tenant id from hosted trigger errors", () => {
    expect(
      extractUsageSyncTenantId({
        code: "P0002",
        message: "Tenant not found for usage sync: 11111111-1111-4111-8111-111111111111",
      })
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(extractUsageSyncTenantId({ message: "different cleanup failure" })).toBeNull();
  });

  test("ensureCleanupTenantExists inserts a safe placeholder only when the tenant row is missing", async () => {
    const tenantId = "22222222-2222-4222-8222-222222222222";
    const { client, calls } = createDeleteClient({
      "tenants:id:id:eq": {
        data: null,
        error: null,
      },
      "tenants:insert": {
        data: { id: tenantId },
        error: null,
      },
    });

    await expect(ensureCleanupTenantExists(tenantId, client)).resolves.toBe(tenantId);
    expect(calls).toEqual([
      { table: "tenants", type: "select", columns: "id" },
      { table: "tenants", type: "eq", columns: "id", column: "id", value: tenantId },
      {
        table: "tenants",
        type: "insert",
        payload: buildCleanupTenantPayload(tenantId),
      },
      { table: "tenants", type: "insert-select", columns: "id" },
    ]);
  });

  test("matchesOptionalPrefixedValue tolerates older rows that do not expose the extra safety column", () => {
    expect(matchesOptionalPrefixedValue(undefined, "pltest.")).toBe(true);
    expect(matchesOptionalPrefixedValue(null, "pltest.")).toBe(true);
    expect(matchesOptionalPrefixedValue("pltest.owner@example.com", "pltest.")).toBe(true);
    expect(matchesOptionalPrefixedValue("owner@example.com", "pltest.")).toBe(false);
  });

  test("deleteAuthUserMaybe swallows missing auth users and usage-sync misses", async () => {
    const { client: missingUserClient } = createSelectClient({}, {
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
    await expect(deleteAuthUserMaybe("user-1", missingUserClient)).resolves.toBeUndefined();

    const { client: usageSyncClient } = createSelectClient({}, {
      error: {
        code: "P0002",
        message: "tenant not found for usage sync",
      },
    });
    await expect(deleteAuthUserMaybe("user-2", usageSyncClient)).resolves.toBeUndefined();
  });

  test("deleteAuthUserMaybe wraps real hosted auth cleanup failures with context", async () => {
    const { client } = createSelectClient({}, {
      error: {
        code: "500",
        message: "upstream auth provider failed",
      },
    });

    await expect(deleteAuthUserMaybe("user-3", client)).rejects.toThrow(/auth delete/i);
  });

  test("deleteRows reports the table and Supabase details when cleanup fails", async () => {
    const { client } = createDeleteClient({
      orders: {
        code: "23503",
        message: "update or delete on table orders violates foreign key constraint",
        details: "Key (id)=(123) is still referenced.",
      },
    });

    await expect(deleteRows("orders", "tenant_id", ["tenant-1"], client)).rejects.toThrow(
      /orders\.tenant_id/
    );
    await expect(deleteRows("orders", "tenant_id", ["tenant-1"], client)).rejects.toThrow(/23503/);
  });

  test("formatCleanupError preserves blank provider fields and extra properties", () => {
    const payload = JSON.parse(
      formatCleanupError({
        code: "",
        details: null,
        hint: null,
        message: "",
        status: 500,
        rawBody: "upstream returned an empty payload",
      })
    );

    expect(payload).toMatchObject({
      code: "",
      message: "",
      details: null,
      hint: null,
      status: 500,
      rawBody: "upstream returned an empty payload",
    });
  });

  test("isIgnorableCleanupError only swallows known safe cleanup misses", () => {
    expect(
      isIgnorableCleanupError({
        code: "P0002",
        message: "tenant not found for usage sync",
      })
    ).toBe(true);
    expect(
      isIgnorableCleanupError({
        code: "23503",
        message: "violates foreign key constraint",
      })
    ).toBe(false);
  });
});
