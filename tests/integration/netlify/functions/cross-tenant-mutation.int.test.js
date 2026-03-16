"use strict";

const {
  TENANTS,
  USERS,
  authenticatedClientFor,
  createAdminClient,
} = require("../../../setup/test-helpers");

describe("cross-tenant mutation protection", () => {
  test("tenant A admin cannot update a tenant B product with a forged tenant_id payload", async () => {
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    const tenantB = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantB.slug).single();
    const productB = await admin
      .from("products")
      .select("id, name, slug, tenant_id, operator_id, updated_at")
      .eq("tenant_id", tenantB.data.id)
      .eq("slug", "pltest-b-product")
      .single();

    const original = productB.data;
    const { client } = await authenticatedClientFor(USERS.tenantAAdmin);

    const attempted = await client
      .from("products")
      .update({
        tenant_id: tenantA.data.id,
        name: "pltest-forged-cross-tenant-update",
        updated_at: new Date().toISOString(),
      })
      .eq("id", original.id)
      .select("id, name, tenant_id")
      .single();

    expect(attempted.data || null).toBeNull();
    expect(attempted.error).toBeTruthy();
    expect(JSON.stringify(attempted.error).toLowerCase()).toMatch(
      /permission|policy|forbidden|0 rows|json object requested|row/
    );

    const unchanged = await admin
      .from("products")
      .select("id, name, slug, tenant_id, operator_id, updated_at")
      .eq("id", original.id)
      .single();

    expect(unchanged.data.name).toBe(original.name);
    expect(unchanged.data.slug).toBe(original.slug);
    expect(unchanged.data.tenant_id).toBe(tenantB.data.id);
    expect(unchanged.data.operator_id).toBe(original.operator_id);
  });
});
