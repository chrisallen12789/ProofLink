"use strict";

const fs = require("fs");
const path = require("path");

describe("admin tenant display schema contract", () => {
  test("admin and provisioning flows normalize business_name", () => {
    const adminApprove = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/admin-approve-onboarding.js"),
      "utf8"
    );
    const adminTesterExempt = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/admin-set-tester-exempt.js"),
      "utf8"
    );
    const provisionTenant = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/provision-tenant.js"),
      "utf8"
    );

    expect(adminApprove).toContain(".select('id, slug, business_name, name')");
    expect(adminApprove).toContain("function tenantBusinessName(tenant)");
    expect(adminApprove).toContain("tenantBusinessName(tenant)");

    expect(adminTesterExempt).toContain(".select('id, slug, business_name, name, billing_exempt, billing_exempt_until, billing_status')");
    expect(adminTesterExempt).toContain(".select('id, slug, business_name, name, billing_exempt_until')");
    expect(adminTesterExempt).toContain("function tenantBusinessName(tenant)");
    expect(adminTesterExempt).toContain("name: tenantBusinessName(tenant)");

    expect(provisionTenant).toContain(".select('id, slug, business_name, name')");
    expect(provisionTenant).toContain("function tenantBusinessName(tenant)");
    expect(provisionTenant).toContain('business_name        : req.business_name');
    expect(provisionTenant).toContain('message: `Tenant \"${tenantBusinessName(tenant)}\" provisioned successfully`');
  });
});
