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
    const tenant = await admin
      .from("tenants")
      .select("*")
      .eq("slug", TENANTS.storageNearLimit.slug)
      .single();
    expect(tenant.error).toBeNull();
    expect(Number(tenant.data.storage_used_mb)).toBeGreaterThanOrEqual(99);
    expect(Number(tenant.data.max_storage_mb)).toBe(100);

    const accessToken = await getAccessToken(USERS.storageNearLimitAdmin);
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
  }, 30000);

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

  test("db-backed storage rpc objects enforce limits and increment usage", async () => {
    const admin = createAdminClient();
    const growthTenant = await admin
      .from("tenants")
      .select("id, storage_used_mb, max_storage_mb")
      .eq("slug", TENANTS.tenantB.slug)
      .single();
    const storageNearLimit = await admin
      .from("tenants")
      .select("id, storage_used_mb, max_storage_mb")
      .eq("slug", TENANTS.storageNearLimit.slug)
      .single();

    expect(growthTenant.error).toBeNull();
    expect(storageNearLimit.error).toBeNull();

    const healthyRpc = await admin.rpc("check_storage_limit", {
      p_tenant_id: growthTenant.data.id,
      p_bytes: 1024 * 1024,
      p_storage_mb: 1,
    });
    expect(healthyRpc.error).toBeNull();
    expect(healthyRpc.data.ok).toBe(true);
    expect(Number(healthyRpc.data.projected_storage_mb)).toBeGreaterThan(
      Number(growthTenant.data.storage_used_mb)
    );

    const blockedRpc = await admin.rpc("check_storage_limit", {
      p_tenant_id: storageNearLimit.data.id,
      p_bytes: 2 * 1024 * 1024,
      p_storage_mb: 2,
    });
    expect(blockedRpc.error).toBeNull();
    expect(blockedRpc.data.ok).toBe(false);
    expect(blockedRpc.data.code).toBe("storage_limit_reached");

    const beforeUsed = Number(growthTenant.data.storage_used_mb);
    const incrementRpc = await admin.rpc("increment_tenant_storage_usage", {
      p_tenant_id: growthTenant.data.id,
      p_bytes: 1024 * 1024,
      p_storage_mb: 1,
    });
    expect(incrementRpc.error).toBeNull();
    expect(incrementRpc.data.ok).toBe(true);

    const updatedTenant = await admin
      .from("tenants")
      .select("storage_used_mb")
      .eq("id", growthTenant.data.id)
      .single();
    expect(updatedTenant.error).toBeNull();
    expect(Number(updatedTenant.data.storage_used_mb)).toBeCloseTo(beforeUsed + 1, 2);
  });

  test("usage sync rpc and tenant health view reflect tenant counters", async () => {
    const admin = createAdminClient();
    const now = new Date();
    const monthStartIso = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
    ).toISOString();
    const tenant = await admin
      .from("tenants")
      .select("id, slug, prooflink_plan_key")
      .eq("slug", TENANTS.tenantA.slug)
      .single();
    expect(tenant.error).toBeNull();

    const productCount = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.data.id);
    const customerCount = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.data.id);
    const seatCount = await admin
      .from("operator_members")
      .select("operator_id", { count: "exact", head: true })
      .eq("tenant_id", tenant.data.id);
    const orderCount = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.data.id)
      .gte("created_at", monthStartIso);

    expect(productCount.error).toBeNull();
    expect(customerCount.error).toBeNull();
    expect(seatCount.error).toBeNull();
    expect(orderCount.error).toBeNull();

    const syncResult = await admin.rpc("sync_tenant_usage_counters", {
      p_tenant_id: tenant.data.id,
    });
    expect(syncResult.error).toBeNull();
    expect(Array.isArray(syncResult.data)).toBe(true);
    expect(syncResult.data[0]).toMatchObject({
      tenant_id: tenant.data.id,
      product_count: productCount.count,
      customer_count: customerCount.count,
      operator_seat_count: seatCount.count,
      current_month_order_count: orderCount.count,
    });

    const tenantAfterSync = await admin
      .from("tenants")
      .select(
        "product_count, customer_count, operator_seat_count, current_month_order_count, growth_score"
      )
      .eq("id", tenant.data.id)
      .single();
    expect(tenantAfterSync.error).toBeNull();
    expect(tenantAfterSync.data.product_count).toBe(productCount.count);
    expect(tenantAfterSync.data.customer_count).toBe(customerCount.count);
    expect(tenantAfterSync.data.operator_seat_count).toBe(seatCount.count);
    expect(tenantAfterSync.data.current_month_order_count).toBe(orderCount.count);
    expect(Number(tenantAfterSync.data.growth_score)).toBeGreaterThanOrEqual(0);

    const healthRow = await admin
      .from("v_tenant_limit_health")
      .select(
        "tenant_id, slug, prooflink_plan_key, max_percent_used, pressured_resource, is_warning, is_blocked, recommended_plan_key"
      )
      .eq("tenant_id", tenant.data.id)
      .single();
    expect(healthRow.error).toBeNull();
    expect(healthRow.data.tenant_id).toBe(tenant.data.id);
    expect(healthRow.data.slug).toBe(TENANTS.tenantA.slug);
    expect(healthRow.data.prooflink_plan_key).toBe(tenant.data.prooflink_plan_key);
    expect(Number(healthRow.data.max_percent_used)).toBeGreaterThan(0);
    expect(["products", "customers", "operator_seats", "orders", "storage"]).toContain(
      healthRow.data.pressured_resource
    );
    expect(
      healthRow.data.is_warning || healthRow.data.is_blocked || healthRow.data.recommended_plan_key
    ).toBeTruthy();
  });
});
