"use strict";

const fs = require("fs");
const path = require("path");

describe("admin communications schema contract", () => {
  test("admin communication and provisioning helpers normalize business_name", () => {
    const adminSendTenantMessage = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/admin-send-tenant-message.js"),
      "utf8"
    );
    const adminSendPasswordReset = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/admin-send-password-reset.js"),
      "utf8"
    );
    const adminDeleteTenants = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/admin-delete-tenants.js"),
      "utf8"
    );
    const sendFollowUp = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/send-follow-up.js"),
      "utf8"
    );
    const provisionTenantBundle = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/lib/provision-tenant-bundle.js"),
      "utf8"
    );

    expect(adminSendTenantMessage).toContain(".select('id, business_name, name, owner_email, owner_name, slug')");
    expect(adminSendTenantMessage).toContain("function tenantBusinessName(tenant)");
    expect(adminSendTenantMessage).toContain("tenantBusinessName(tenant)");

    expect(adminSendPasswordReset).toContain(".select('id, business_name, name, slug, owner_email')");
    expect(adminSendPasswordReset).toContain("tenant_name: tenantBusinessName(tenant)");

    expect(adminDeleteTenants).toContain(".select('id, slug, business_name, name, order_count')");
    expect(adminDeleteTenants).toContain("name: tenantBusinessName(t)");

    expect(sendFollowUp).toContain(".select('id, business_name, name, slug').eq('id', tenantId).maybeSingle()");
    expect(sendFollowUp).toContain("tenantName: tenantBusinessName(tenant) || 'ProofLink'");

    expect(provisionTenantBundle).toContain('business_name: businessName');
    expect(provisionTenantBundle).toContain('.select("id,slug,business_name,name")');
    expect(provisionTenantBundle).toContain('tenant_name: tenantBusinessName(tenant)');
  });
});
