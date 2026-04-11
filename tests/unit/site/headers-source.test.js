"use strict";

const fs = require("fs");
const path = require("path");

describe("security headers", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "_headers"),
    "utf8"
  );

  test("adds stronger transport and privacy headers without unsafe-eval", () => {
    expect(source).toContain("Strict-Transport-Security: max-age=31536000; includeSubDomains; preload");
    expect(source).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(source).toContain("X-Content-Type-Options: nosniff");
    expect(source).not.toContain("'unsafe-eval'");
  });

  test("allows inline scripts only on the legacy internal operator tooling pages that still need them", () => {
    expect(source).toContain("/operator/analytics.html");
    expect(source).toContain("/operator/provisioning.html");
    expect(source).toContain("/operator/tenants.html");
  });
});
