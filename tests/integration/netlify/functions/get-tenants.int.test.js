"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("get-tenants integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/get-tenants.js"
  )).handler;

  test("admin tenant list includes billing exemption fields needed by the admin tester flow", async () => {
    const accessToken = await getAccessToken(USERS.platformAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: { q: "pltest-tenant", limit: "25" },
      })
    );

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(Array.isArray(body.tenants)).toBe(true);

    const tenantA = body.tenants.find((row) => row.slug === TENANTS.tenantA.slug);
    expect(tenantA).toBeTruthy();
    expect(tenantA).toHaveProperty("id");
    expect(tenantA).toHaveProperty("name");
    expect(tenantA).toHaveProperty("slug");
    expect(tenantA).toHaveProperty("billing_status");
    expect(tenantA).toHaveProperty("billing_exempt");
    expect(tenantA).toHaveProperty("billing_exempt_until");
  });
});
