"use strict";

const path = require("path");

describe("netlify/functions/utils/business-type", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/utils/business-type.js");

  test("normalizes aliased workspace business types to canonical keys", () => {
    const { normalizeBusinessTypeKey } = require(modulePath);

    expect(normalizeBusinessTypeKey("lawn_care")).toBe("landscaping");
    expect(normalizeBusinessTypeKey("service")).toBe("service_business");
    expect(normalizeBusinessTypeKey("plumbing")).toBe("plumbing");
    expect(normalizeBusinessTypeKey("")).toBe("");
  });
});
