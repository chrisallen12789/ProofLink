"use strict";

const path = require("path");

const bootUtils = require(path.resolve(
  process.cwd(),
  "operator/operator-boot-utils.js"
));

describe("operator boot utils", () => {
  test("buildTenantQueryParam skips placeholder tenants", () => {
    expect(bootUtils.buildTenantQueryParam("default")).toBe("");
    expect(bootUtils.buildTenantQueryParam(" tenant_123 ")).toBe(
      "tenant_id=tenant_123"
    );
  });

  test("resolveOperatorTenantId prefers real tenant ids from runtime data", () => {
    expect(
      bootUtils.resolveOperatorTenantId(
        "default",
        "",
        null,
        "tenant_live"
      )
    ).toBe("tenant_live");
    expect(bootUtils.resolveOperatorTenantId("tenant_live", "", null)).toBe(
      "tenant_live"
    );
  });
});
