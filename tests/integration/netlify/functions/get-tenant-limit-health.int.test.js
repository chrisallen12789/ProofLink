"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("get-tenant-limit-health authorization integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/get-tenant-limit-health.js"
  )).handler;

  test("tenant admin can load health for their own tenant", async () => {
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: { tenant_id: tenantA.data.id },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).tenant_id).toBe(tenantA.data.id);
  });

  test("tenant admin cannot load health for another tenant", async () => {
    const admin = createAdminClient();
    const tenantB = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantB.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: { tenant_id: tenantB.data.id },
      })
    );

    expect(res.statusCode).toBe(403);
  });
});
