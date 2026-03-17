"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("admin-set-tester-exempt authorization integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/admin-set-tester-exempt.js"
  )).handler;

  test("tenant admin can read tester exemption state for their own tenant", async () => {
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: { tenantId: tenantA.data.id },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).tenantId).toBe(tenantA.data.id);
  });

  test("tenant admin cannot read tester exemption state for another tenant", async () => {
    const admin = createAdminClient();
    const tenantB = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantB.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: { tenantId: tenantB.data.id },
      })
    );

    expect(res.statusCode).toBe(403);
  });

  test("platform admin can still manage tester exemption for any tenant", async () => {
    const admin = createAdminClient();
    const tenantB = await admin
      .from("tenants")
      .select("id, billing_exempt")
      .eq("slug", TENANTS.tenantB.slug)
      .single();
    const accessToken = await getAccessToken(USERS.platformAdmin);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          tenantId: tenantB.data.id,
          exempt: false,
        },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).tenantId).toBe(tenantB.data.id);
  });
});
