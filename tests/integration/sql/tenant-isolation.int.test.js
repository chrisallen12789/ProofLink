"use strict";

const { TENANTS, USERS, authenticatedClientFor, createAdminClient } = require("../../setup/test-helpers");

describe("tenant isolation integration", () => {
  test("tenant A admin sees only tenant A scoped products and operator rows", async () => {
    const { client } = await authenticatedClientFor(USERS.tenantAAdmin);

    const products = await client.from("products").select("name,tenant_id");
    expect(products.error).toBeNull();
    expect(products.data.length).toBeGreaterThan(0);

    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    expect(products.data.every((row) => row.tenant_id === tenantA.data.id)).toBe(true);

    const operators = await client.from("operators").select("email,tenant_id");
    expect(operators.error).toBeNull();
    expect(
      operators.data.every((row) => row.tenant_id === tenantA.data.id || row.tenant_id === null)
    ).toBe(true);
  });

  test("tenant B admin cannot read tenant A scoped product data", async () => {
    const { client } = await authenticatedClientFor(USERS.tenantBAdmin);
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();

    const products = await client.from("products").select("name,tenant_id");
    expect(products.error).toBeNull();
    expect(products.data.find((row) => row.tenant_id === tenantA.data.id)).toBeUndefined();
  });
});
