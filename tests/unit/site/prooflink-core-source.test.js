"use strict";

const fs = require("fs");
const path = require("path");

describe("prooflink core source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "prooflink.core.js"),
    "utf8"
  );

  test("skips public catalog fetches when a real tenant slug is not available", () => {
    expect(source).toContain('tenantSlug === "default"');
    expect(source).toContain('tenantSlug === "honest-to-crust"');
    expect(source).toContain("saveCatalogCache(rows);");
    expect(source).toContain("window.HTC_CATALOG = rows;");
    expect(source).toContain("return rows;");
  });
});
