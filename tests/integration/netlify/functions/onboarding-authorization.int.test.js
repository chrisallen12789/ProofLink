"use strict";

const path = require("path");
const {
  ONBOARDING_FIXTURES,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("onboarding workflow authorization", () => {
  const listHandler = require(path.resolve(
    process.cwd(),
    "netlify/functions/list-onboarding-requests.js"
  )).handler;
  const approveHandler = require(path.resolve(
    process.cwd(),
    "netlify/functions/approve-onboarding-request.js"
  )).handler;
  const rejectHandler = require(path.resolve(
    process.cwd(),
    "netlify/functions/reject-onboarding-request.js"
  )).handler;
  const provisionHandler = require(path.resolve(
    process.cwd(),
    "netlify/functions/provision-tenant.js"
  )).handler;

  async function requestIdForSlug(slug) {
    const admin = createAdminClient();
    const request = await admin
      .from("tenant_onboarding_requests")
      .select("id")
      .eq("business_slug", slug)
      .single();
    if (request.error) throw request.error;
    return request.data.id;
  }

  async function resetRequest(slug, status) {
    const admin = createAdminClient();
    const requestId = await requestIdForSlug(slug);

    const tenantRows = await admin
      .from("tenants")
      .select("id")
      .eq("onboarding_request_id", requestId);
    if (tenantRows.error) throw tenantRows.error;

    const tenantIds = (tenantRows.data || []).map((row) => row.id);
    if (tenantIds.length) {
      await admin.from("operator_members").delete().in("tenant_id", tenantIds);
      await admin.from("operators").delete().in("tenant_id", tenantIds);
      await admin.from("tenant_config").delete().in("tenant_id", tenantIds);
      await admin.from("products").delete().in("tenant_id", tenantIds);
      await admin.from("tenants").delete().in("id", tenantIds);
    }

    const { error } = await admin
      .from("tenant_onboarding_requests")
      .update({
        status,
        approved_at: status === "approved" ? new Date().toISOString() : null,
        rejection_reason: null,
        provision_error: null,
      })
      .eq("id", requestId);
    if (error) throw error;

    return requestId;
  }

  test("non-admin operators cannot list onboarding requests", async () => {
    const accessToken = await getAccessToken(USERS.tenantAStaff);
    const res = await listHandler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain("onboarding admin");
  });

  test("non-admin operators cannot approve onboarding requests", async () => {
    const requestId = await resetRequest(ONBOARDING_FIXTURES.submitted.business_slug, "submitted");
    const accessToken = await getAccessToken(USERS.tenantAStaff);

    const res = await approveHandler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: requestId },
      })
    );

    expect(res.statusCode).toBe(403);
  });

  test("non-admin operators cannot reject onboarding requests or provision tenants", async () => {
    const submittedRequestId = await resetRequest(
      ONBOARDING_FIXTURES.submitted.business_slug,
      "submitted"
    );
    const approvedRequestId = await resetRequest(
      ONBOARDING_FIXTURES.approved.business_slug,
      "approved"
    );
    const accessToken = await getAccessToken(USERS.tenantAStaff);

    const rejectRes = await rejectHandler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: submittedRequestId, rejection_reason: "not allowed" },
      })
    );
    const provisionRes = await provisionHandler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: approvedRequestId },
      })
    );

    expect(rejectRes.statusCode).toBe(403);
    expect(provisionRes.statusCode).toBe(403);
  });

  test("authorized admin users can still list and approve onboarding requests", async () => {
    const requestId = await resetRequest(ONBOARDING_FIXTURES.submitted.business_slug, "submitted");
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const listRes = await listHandler(
      buildEvent({
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    );
    const approveRes = await approveHandler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: requestId },
      })
    );

    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.body).requests.length).toBeGreaterThan(0);
    expect(approveRes.statusCode).toBe(200);
    expect(JSON.parse(approveRes.body).request.status).toBe("approved");
  });

  test("authorized admin users can still reject and provision onboarding requests", async () => {
    const submittedRequestId = await resetRequest(
      ONBOARDING_FIXTURES.submitted.business_slug,
      "submitted"
    );
    const approvedRequestId = await resetRequest(
      ONBOARDING_FIXTURES.approved.business_slug,
      "approved"
    );
    const accessToken = await getAccessToken(USERS.tenantAAdmin);

    const rejectRes = await rejectHandler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: submittedRequestId, rejection_reason: "pltest admin review" },
      })
    );
    const provisionRes = await provisionHandler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: approvedRequestId },
      })
    );

    expect(rejectRes.statusCode).toBe(200);
    expect(JSON.parse(rejectRes.body).success).toBe(true);
    expect(provisionRes.statusCode).toBe(201);
    expect(JSON.parse(provisionRes.body).tenant_id).toBeTruthy();
  }, 30000);
});
