"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../setup/test-helpers");

describe("plan enforcement integration", () => {
  const storageModule = require(path.resolve(
    process.cwd(),
    "netlify/functions/lib/tenant-storage.js"
  ));
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/get-tenant-limit-health.js"
  )).handler;

  test("seeded starter tenant reflects near-limit health", async () => {
    const admin = createAdminClient();
    const tenant = await admin.from("tenants").select("*").eq("slug", TENANTS.tenantA.slug).single();
    expect(tenant.error).toBeNull();
    expect(tenant.data.current_month_order_count).toBeGreaterThanOrEqual(98);
    expect(tenant.data.max_orders_per_month).toBe(100);

    const accessToken = await getAccessToken(USERS.tenantAAdmin);
    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: { tenant_id: tenant.data.id },
      })
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.health.recommend_upgrade).toBe(true);
    expect(body.health.warning_count + body.health.blocked_count).toBeGreaterThan(0);
  });

  test("storage helper reports healthy below threshold and denies above threshold", async () => {
    const admin = createAdminClient();
    const growthTenant = await admin
      .from("tenants")
      .select("id")
      .eq("slug", TENANTS.tenantB.slug)
      .single();
    const storageNearLimit = await admin
      .from("tenants")
      .select("id")
      .eq("slug", TENANTS.storageNearLimit.slug)
      .single();

    const healthy = await storageModule.checkStorageLimit({
      tenantId: growthTenant.data.id,
      incomingBytes: 1024 * 1024,
    });
    expect(healthy.ok).toBe(true);

    const blocked = await storageModule.checkStorageLimit({
      tenantId: storageNearLimit.data.id,
      incomingBytes: 2 * 1024 * 1024,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/Storage limit reached/i);
  });
});
