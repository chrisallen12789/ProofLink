"use strict";

const {
  TENANTS,
  USERS,
  authenticatedClientFor,
  createAdminClient,
} = require("../../setup/test-helpers");

describe("operator_id + tenant_id DB consistency", () => {
  async function loadTenantAndOperator(admin, tenantSlug, operatorEmail) {
    const tenant = await admin.from("tenants").select("id").eq("slug", tenantSlug).single();
    expect(tenant.error).toBeNull();

    const operator = await admin
      .from("operators")
      .select("id")
      .eq("tenant_id", tenant.data.id)
      .eq("email", operatorEmail)
      .single();
    expect(operator.error).toBeNull();

    return { tenantId: tenant.data.id, operatorId: operator.data.id };
  }

  test("valid operator_id + tenant_id pair succeeds for authenticated insert", async () => {
    const admin = createAdminClient();
    const { tenantId, operatorId } = await loadTenantAndOperator(
      admin,
      TENANTS.tenantA.slug,
      process.env.TEST_TENANT_A_ADMIN_EMAIL
    );
    const { client } = await authenticatedClientFor(USERS.tenantAAdmin);
    const slug = `pltest-valid-pair-${Date.now()}`;

    try {
      const inserted = await client
        .from("products")
        .insert({
          tenant_id: tenantId,
          operator_id: operatorId,
          name: slug,
          slug,
          pricing_mode: "quote",
          sell_price_cents: 0,
          starting_price_cents: 0,
          is_active: false,
        })
        .select("id, tenant_id, operator_id, slug")
        .single();

      expect(inserted.error).toBeNull();
      expect(inserted.data.tenant_id).toBe(tenantId);
      expect(inserted.data.operator_id).toBe(operatorId);
      expect(inserted.data.slug).toBe(slug);
    } finally {
      await admin.from("products").delete().eq("slug", slug);
    }
  });

  test("mismatched tenant_id for a valid operator_id is rejected", async () => {
    const admin = createAdminClient();
    const tenantA = await loadTenantAndOperator(
      admin,
      TENANTS.tenantA.slug,
      process.env.TEST_TENANT_A_ADMIN_EMAIL
    );
    const tenantB = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantB.slug).single();
    expect(tenantB.error).toBeNull();

    const { client } = await authenticatedClientFor(USERS.tenantAAdmin);
    const slug = `pltest-mismatched-pair-${Date.now()}`;

    const attempted = await client.from("products").insert({
      tenant_id: tenantB.data.id,
      operator_id: tenantA.operatorId,
      name: slug,
      slug,
      pricing_mode: "quote",
      sell_price_cents: 0,
      starting_price_cents: 0,
      is_active: false,
    });

    expect(attempted.data || null).toBeNull();
    expect(attempted.error).toBeTruthy();
    expect(JSON.stringify(attempted.error).toLowerCase()).toMatch(
      /permission|policy|member|tenant|foreign key|23503|operator_id/
    );

    const notInserted = await admin.from("products").select("id").eq("slug", slug).maybeSingle();
    expect(notInserted.error).toBeNull();
    expect(notInserted.data).toBeNull();
  });

  test("cross-tenant forged updates fail and leave the row unchanged", async () => {
    const admin = createAdminClient();
    const tenantA = await loadTenantAndOperator(
      admin,
      TENANTS.tenantA.slug,
      process.env.TEST_TENANT_A_ADMIN_EMAIL
    );
    const tenantB = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantB.slug).single();
    expect(tenantB.error).toBeNull();

    const seededProduct = await admin
      .from("products")
      .select("id, name, slug, tenant_id, operator_id")
      .eq("tenant_id", tenantA.tenantId)
      .eq("slug", "pltest-a-product")
      .single();
    expect(seededProduct.error).toBeNull();

    const { client } = await authenticatedClientFor(USERS.tenantAAdmin);
    const attempted = await client
      .from("products")
      .update({
        tenant_id: tenantB.data.id,
      })
      .eq("id", seededProduct.data.id)
      .select("id, tenant_id, operator_id")
      .single();

    expect(attempted.data || null).toBeNull();
    expect(attempted.error).toBeTruthy();
    expect(JSON.stringify(attempted.error).toLowerCase()).toMatch(
      /permission|policy|member|tenant|foreign key|23503|operator_id/
    );

    const unchanged = await admin
      .from("products")
      .select("id, tenant_id, operator_id, slug, name")
      .eq("id", seededProduct.data.id)
      .single();

    expect(unchanged.error).toBeNull();
    expect(unchanged.data.tenant_id).toBe(seededProduct.data.tenant_id);
    expect(unchanged.data.operator_id).toBe(seededProduct.data.operator_id);
    expect(unchanged.data.slug).toBe(seededProduct.data.slug);
    expect(unchanged.data.name).toBe(seededProduct.data.name);
  });
});
