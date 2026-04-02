"use strict";

const path = require("path");
const {
  USERS,
  buildEvent,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("admin-get-onboarding-requests authorization", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/admin-get-onboarding-requests.js"
  )).handler;

  test("tenant-scoped owners are rejected from platform admin onboarding views", async () => {
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    );

    expect(res.statusCode).toBe(403);
  }, 30000);

  test("platform admins can list onboarding requests", async () => {
    const accessToken = await getAccessToken(USERS.platformAdmin);

    const res = await handler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        requests: expect.any(Array),
      })
    );
  }, 30000);
});
