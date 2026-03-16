"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("get-launch-checklist integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/get-launch-checklist.js"
  )).handler;

  test("unauthorized callers cannot retrieve tenant launch setup state", async () => {
    const admin = createAdminClient();
    const tenantA = await admin
      .from("tenants")
      .select("id, slug")
      .eq("slug", TENANTS.tenantA.slug)
      .single();

    const res = await handler(
      buildEvent({
        method: "GET",
        queryStringParameters: {
          tenant_id: tenantA.data.id,
          slug: tenantA.data.slug,
        },
      })
    );

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/auth|unauthorized|authenticated/i);
  });

  test("authenticated tenant-scoped users cannot retrieve another tenant's checklist", async () => {
    const admin = createAdminClient();
    const tenantB = await admin
      .from("tenants")
      .select("id, slug")
      .eq("slug", TENANTS.tenantB.slug)
      .single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: {
          tenant_id: tenantB.data.id,
          slug: tenantB.data.slug,
        },
      })
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain("tenant mismatch");
  });

  test("authenticated tenant-scoped users can retrieve only their own checklist data", async () => {
    const admin = createAdminClient();
    const tenantA = await admin
      .from("tenants")
      .select("id, slug")
      .eq("slug", TENANTS.tenantA.slug)
      .single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        queryStringParameters: {
          tenant_id: tenantA.data.id,
          slug: tenantA.data.slug,
        },
      })
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.tenant_id).toBe(tenantA.data.id);
    expect(body.tenant_slug).toBe(tenantA.data.slug);
    expect(body.steps).toBeInstanceOf(Array);
    expect(body.steps.length).toBeGreaterThan(0);
  });
});
