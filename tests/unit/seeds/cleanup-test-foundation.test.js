"use strict";

const {
  CORE_TENANT_TABLE_DELETE_ORDER,
  OPTIONAL_TENANT_TABLE_DELETE_ORDER,
  cleanupTenantScopedData,
  deleteAuthUserMaybe,
  deleteRows,
  deleteRowsMaybe,
  formatCleanupError,
  isIgnorableCleanupError,
  matchesOptionalPrefixedValue,
  selectRowsMaybe,
} = require("../../seeds/cleanup-test-foundation");

function createDeleteClient(errorMap = {}) {
  const calls = [];
  const client = {
    from(table) {
      return {
        delete() {
          return {
            async in(column, values) {
              calls.push({ table, column, values });
              const error = Object.prototype.hasOwnProperty.call(errorMap, table) ? errorMap[table] : null;
              return { error };
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
          return {
            async like(column, pattern) {
              calls.push({ table, columns, type: "like", column, pattern });
              return resultMap[key] || resultMap[table] || { data: [], error: null };
            },
            async ilike(column, pattern) {
              calls.push({ table, columns, type: "ilike", column, pattern });
              return resultMap[key] || resultMap[table] || { data: [], error: null };
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
