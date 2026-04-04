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

  test("loads operator setup before the shell is considered boot-ready", () => {
    expect(source).toContain("await fetchOperatorSetup().catch(console.warn);");
    expect(source).toContain("if (isHydrovacWorkspace()) {");
    expect(source).toContain("fetchHydrovacFacilities()");
    expect(source).toContain("fetchHydrovacManifests()");
    expect(source).toContain("fetchHydrovacLocateTickets()");
  });

  test("primes hydrovac command centers before async refresh finishes", () => {
    expect(source).toContain('renderHydrovacFacilities();');
    expect(source).toContain('renderHydrovacManifests();');
    expect(source).toContain('renderHydrovacLocateWorkspace();');
    expect(source).toContain('renderHydrovacCompliance();');
  });

  test("keeps sidebar tool drawer state and visibility in sync", () => {
    expect(source).toContain('&& !more.classList.contains("collapsed")');
    expect(source).toContain('more.classList.toggle("collapsed", !isOpen);');
    expect(source).toContain('more.classList.toggle("expanded", !!isOpen);');
  });

  test("defines a shared daysUntil helper for hydrovac countdown views", () => {
    expect(source).toContain("function daysUntil(value) {");
    expect(source).toContain("const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());");
    expect(source).toContain("const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());");
  });

  test("prioritizes hydrovac tools at the top of the sidebar for hydrovac tenants", () => {
    expect(source).toContain('? ["hydrovac", "workflow", "reports", "operations", "website", "guidance"]');
  });
});
