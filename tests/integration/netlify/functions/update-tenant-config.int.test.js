"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("update-tenant-config integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/update-tenant-config.js"
  )).handler;

  test("tenant A admin can update allowed keys for tenant A", async () => {
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          tenant_id: tenantA.data.id,
          config: {
            tagline: "pltest updated tagline",
            accent_color: "#123456",
          },
        },
      })
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.config.tagline).toBe("pltest updated tagline");
    expect(body.config.accent_color).toBe("#123456");
  });

  test("tenant A admin gets 403 on tenant B id", async () => {
    const admin = createAdminClient();
    const tenantB = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantB.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          tenant_id: tenantB.data.id,
          config: { tagline: "should fail" },
        },
      })
    );

    expect(res.statusCode).toBe(403);
  });

  test("protected keys are rejected with 400", async () => {
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          tenant_id: tenantA.data.id,
          config: { slug: "not-allowed" },
        },
      })
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("Protected fields");
  });
});
