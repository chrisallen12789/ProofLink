"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  authenticatedClientFor,
  buildEvent,
  createAdminClient,
} = require("../../../setup/test-helpers");

describe("operator privilege escalation protection", () => {
  const updateTenantConfigHandler = require(path.resolve(
    process.cwd(),
    "netlify/functions/update-tenant-config.js"
  )).handler;

  test("tenant A staff cannot modify tenant config, plan tier, or elevate their own role", async () => {
    const admin = createAdminClient();
    const tenantA = await admin.from("tenants").select("*").eq("slug", TENANTS.tenantA.slug).single();
    const configBefore = await admin
      .from("tenant_config")
      .select("*")
      .eq("tenant_id", tenantA.data.id)
      .eq("config_key", "site_settings")
      .maybeSingle();
    const operatorBefore = await admin
      .from("operators")
      .select("*")
      .eq("email", "pltest.tenant.a.staff@example.com")
      .single();
    const membershipBefore = await admin
      .from("operator_members")
      .select("*")
      .eq("operator_id", operatorBefore.data.id)
      .eq("tenant_id", tenantA.data.id)
      .single();

    const { client, session } = await authenticatedClientFor(USERS.tenantAStaff);
    const staffToken = session.session.access_token;

    const configRes = await updateTenantConfigHandler(
      buildEvent({
        method: "POST",
        headers: { Authorization: `Bearer ${staffToken}` },
        body: {
          tenant_id: tenantA.data.id,
          config: {
            tagline: "pltest staff escalation attempt",
            accent_color: "#ff0000",
          },
        },
      })
    );

    const planAttempt = await client
      .from("tenants")
      .update({ prooflink_plan_key: "enterprise" })
      .eq("id", tenantA.data.id)
      .select("id, prooflink_plan_key")
      .single();

    const roleAttempt = await client
      .from("operators")
      .update({ role: "admin" })
      .eq("id", operatorBefore.data.id)
      .select("id, role")
      .single();

    const memberRoleAttempt = await client
      .from("operator_members")
      .update({ role: "admin" })
      .eq("operator_id", operatorBefore.data.id)
      .eq("tenant_id", tenantA.data.id)
      .select("operator_id, role")
      .single();

    const configAfter = await admin
      .from("tenant_config")
      .select("*")
      .eq("tenant_id", tenantA.data.id)
      .eq("config_key", "site_settings")
      .maybeSingle();
    const operatorAfter = await admin
      .from("operators")
      .select("*")
      .eq("id", operatorBefore.data.id)
      .single();
    const membershipAfter = await admin
      .from("operator_members")
      .select("*")
      .eq("operator_id", operatorBefore.data.id)
      .eq("tenant_id", tenantA.data.id)
      .single();
    const tenantAfter = await admin.from("tenants").select("*").eq("id", tenantA.data.id).single();

    expect(configRes.statusCode).toBe(403);
    expect(planAttempt.data || null).toBeNull();
    expect(roleAttempt.data || null).toBeNull();
    expect(memberRoleAttempt.data || null).toBeNull();
    expect(planAttempt.error).toBeTruthy();
    expect(roleAttempt.error).toBeTruthy();
    expect(memberRoleAttempt.error).toBeTruthy();

    expect(operatorAfter.data.role).toBe(operatorBefore.data.role);
    expect(membershipAfter.data.role).toBe(membershipBefore.data.role);
    expect(tenantAfter.data.prooflink_plan_key).toBe(tenantA.data.prooflink_plan_key);
    expect(configAfter.data.config_value).toBe(configBefore.data.config_value);
  }, 30000);
});
