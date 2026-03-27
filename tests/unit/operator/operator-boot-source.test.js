"use strict";

const fs = require("fs");
const path = require("path");

describe("operator boot source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator.js"),
    "utf8"
  );

  test("guards dashboard calls from placeholder tenant ids", () => {
    expect(source).toContain("const tenantQueryParam = buildTenantQueryParam(TENANT_ID);");
    expect(source).toContain("resolveOperatorTenantId(TENANT_ID, data.tenantId, data.tenant_id)");
    expect(source).toContain("resolveOperatorTenantId(TENANT_ID, data.tenant_id, data.operators.tenant_id)");
  });

  test("keeps a safe supabase anon key fallback for operator boot", () => {
    expect(source).toContain("window.PROOFLINK_CONFIG?.supabase?.anonKey");
    expect(source).toContain("window.PROOFLINK_BOOT_READY = true;");
  });
});
