"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("upload-tenant-asset integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/upload-tenant-asset.js"
  )).handler;

  test("tenant A admin can prepare an upload for tenant A", async () => {
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          tenant_id: tenantA.data.id,
          filename: "proof.png",
          content_type: "image/png",
          bytes: 1024,
          folder: "branding",
        },
      })
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.objectPath).toContain(tenantA.data.id);
  });

  test("tenant A admin gets 403 for tenant mismatch", async () => {
    const admin = createAdminClient();
    const tenantB = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantB.slug).single();
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          tenant_id: tenantB.data.id,
          filename: "proof.png",
          content_type: "image/png",
          bytes: 1024,
        },
      })
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain("tenant mismatch");
  });

  test("near-limit tenant gets 409 with storage_limit_reached", async () => {
    const admin = createAdminClient();
    const tenant = await admin
      .from("tenants")
      .select("id")
      .eq("slug", TENANTS.storageNearLimit.slug)
      .single();
    const accessToken = await getAccessToken(USERS.platformAdmin);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          tenant_id: tenant.data.id,
          filename: "proof.png",
          content_type: "image/png",
          bytes: 2 * 1024 * 1024,
        },
      })
    );

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("storage_limit_reached");
  });
});
