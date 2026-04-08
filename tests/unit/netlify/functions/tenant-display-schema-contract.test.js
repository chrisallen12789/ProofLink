"use strict";

const fs = require("fs");
const path = require("path");

describe("tenant display schema contract", () => {
  test("public and operator bootstrap flows normalize business_name", () => {
    const publicTenantInfo = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/get-public-tenant-info.js"),
      "utf8"
    );
    const operatorSetup = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/get-operator-setup.js"),
      "utf8"
    );
    const launchChecklist = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/get-launch-checklist.js"),
      "utf8"
    );
    const buildLaunchChecklist = fs.readFileSync(
      path.resolve(process.cwd(), "netlify/functions/lib/build-launch-checklist.js"),
      "utf8"
    );

    expect(publicTenantInfo).toContain(".select('id, business_name, name, slug");
    expect(publicTenantInfo).toContain("function tenantBusinessName(tenant)");
    expect(operatorSetup).toContain(".select('id, business_name, name, slug");
    expect(operatorSetup).toContain("legal_business_name: businessName");
    expect(launchChecklist).toContain("tenant_name  : tenantBusinessName(tenant)");
    expect(buildLaunchChecklist).toContain("function tenantBusinessName(tenant)");
    expect(buildLaunchChecklist).toContain("tenantBusinessName(tenant)");
  });
});
