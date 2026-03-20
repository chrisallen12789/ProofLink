"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  authenticatedClientFor,
  createAdminClient,
} = require("../../../setup/test-helpers");

describe("product limit enforcement", () => {
  const planEnforcement = require(path.resolve(
    process.cwd(),
    "netlify/functions/lib/plan-enforcement.js"
  ));

  test("starter tenant product creation is rejected once the limit is reached", async () => {
    const admin = createAdminClient();
    const tenant = await admin
      .from("tenants")
      .select("*")
      .eq("slug", TENANTS.storageNearLimit.slug)
      .single();

    try {
      await admin
        .from("products")
        .delete()
        .eq("tenant_id", tenant.data.id)
        .like("slug", "pltest-limit-%");

      await admin
        .from("tenants")
        .update({ prooflink_plan_key: "starter" })
        .eq("slug", TENANTS.storageNearLimit.slug);

      const operator = await admin
        .from("operators")
        .select("id")
        .eq("tenant_id", tenant.data.id)
        .eq("email", USERS.storageNearLimitAdmin.email)
        .single();

      const beforeCount = await admin
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.data.id);

      const { client } = await authenticatedClientFor(USERS.storageNearLimitAdmin);
      const limit = planEnforcement.limitFor("products", tenant.data);
      const expected = planEnforcement.enforcementResponse(
        "products",
        beforeCount.count,
        tenant.data
      );

      expect(limit).toBe(10);
      expect(beforeCount.error).toBeNull();

      for (let i = beforeCount.count; i < limit; i += 1) {
        const insertResult = await client.from("products").insert({
          tenant_id: tenant.data.id,
          operator_id: operator.data.id,
          name: `pltest-limit-topoff-${i}`,
          slug: `pltest-limit-topoff-${i}`,
          pricing_mode: "quote",
          sell_price_cents: 0,
          starting_price_cents: 0,
          is_active: false,
        });
        if (insertResult.error) break;
      }

      const createAttempt = await client.from("products").insert({
        tenant_id: tenant.data.id,
        operator_id: operator.data.id,
        name: "pltest-limit-blocked-product",
        slug: "pltest-limit-blocked-product",
        pricing_mode: "quote",
        sell_price_cents: 0,
        starting_price_cents: 0,
        is_active: false,
      });

      const afterCount = await admin
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.data.id);

      expect(createAttempt.error).toBeTruthy();
      expect({
        ok: false,
        code: "plan_limit_reached",
        resourceKey: expected.resourceKey,
        tenantPlan: expected.tenantPlan,
        currentCount: limit,
        limit: expected.limit,
      }).toEqual({
        ok: false,
        code: "plan_limit_reached",
        resourceKey: "products",
        tenantPlan: "starter",
        currentCount: 10,
        limit: 10,
      });
      expect(afterCount.count).toBe(limit);
    } finally {
      await admin
        .from("products")
        .delete()
        .eq("tenant_id", tenant.data.id)
        .like("slug", "pltest-limit-%");
    }
  }, 30000);
});
