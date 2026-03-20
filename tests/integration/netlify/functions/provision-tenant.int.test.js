"use strict";

const path = require("path");
const {
  ONBOARDING_FIXTURES,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

describe("provision-tenant integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/provision-tenant.js"
  )).handler;

  async function resetRequest(slug, status) {
    const admin = createAdminClient();
    const request = await admin
      .from("tenant_onboarding_requests")
      .select("id")
      .eq("business_slug", slug)
      .single();
    if (request.error) throw request.error;

    const existingTenant = await admin
      .from("tenants")
      .select("id")
      .eq("onboarding_request_id", request.data.id);

    if (existingTenant.error) throw existingTenant.error;
    const tenantIds = (existingTenant.data || []).map((row) => row.id);

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
        provision_error: null,
      })
      .eq("id", request.data.id);
    if (error) throw error;

    return request.data.id;
  }

  test("submitted request returns 400", async () => {
    const requestId = await resetRequest(ONBOARDING_FIXTURES.submitted.business_slug, "submitted");
    const accessToken = await getAccessToken(USERS.platformAdmin);
    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: requestId },
      })
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("approved or failed");
  });

  test("approved request provisions tenant, operator, and operator member", async () => {
    const requestId = await resetRequest(ONBOARDING_FIXTURES.approved.business_slug, "approved");
    const accessToken = await getAccessToken(USERS.platformAdmin);
    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: requestId },
      })
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.tenant_id).toBeTruthy();
    expect(body.operator_id).toBeTruthy();

    const admin = createAdminClient();
    const tenant = await admin.from("tenants").select("*").eq("id", body.tenant_id).single();
    const operator = await admin.from("operators").select("*").eq("id", body.operator_id).single();
    const member = await admin
      .from("operator_members")
      .select("*")
      .eq("tenant_id", body.tenant_id)
      .eq("operator_id", body.operator_id)
      .single();

    expect(tenant.data.onboarding_request_id).toBe(requestId);
    expect(operator.data.email).toBe(ONBOARDING_FIXTURES.approved.owner_email);
    expect(member.data.role).toBe("owner");
  }, 30000);

  test("rerunning the same request is idempotent", async () => {
    const accessToken = await getAccessToken(USERS.platformAdmin);
    const admin = createAdminClient();
    const request = await admin
      .from("tenant_onboarding_requests")
      .select("id")
      .eq("business_slug", ONBOARDING_FIXTURES.approved.business_slug)
      .single();

    const existingCount = await admin
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .eq("onboarding_request_id", request.data.id);

    const res = await handler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { id: request.data.id },
      })
    );

    const nextCount = await admin
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .eq("onboarding_request_id", request.data.id);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).message).toContain("idempotent");
    expect(nextCount.count).toBe(existingCount.count);
  });
});
