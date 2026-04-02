"use strict";

const {
  CORE_TENANT_TABLE_DELETE_ORDER,
  OPTIONAL_TENANT_TABLE_DELETE_ORDER,
  deleteRows,
  deleteRowsMaybe,
  formatCleanupError,
  isIgnorableCleanupError,
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

describe("cleanup test foundation helpers", () => {
  test("cleanup order clears newer child rows before parent workflow tables", () => {
    const fullOrder = [...OPTIONAL_TENANT_TABLE_DELETE_ORDER, ...CORE_TENANT_TABLE_DELETE_ORDER];

    expect(fullOrder.indexOf("service_plans")).toBeGreaterThanOrEqual(0);
    expect(fullOrder.indexOf("service_plans")).toBeLessThan(fullOrder.indexOf("jobs"));
    expect(fullOrder.indexOf("service_plans")).toBeLessThan(fullOrder.indexOf("orders"));
    expect(fullOrder.indexOf("customer_interactions")).toBeLessThan(fullOrder.indexOf("customers"));
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
