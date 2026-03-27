"use strict";

const fs = require("fs");
const path = require("path");

describe("netlify/functions/onboarding source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "netlify/functions/onboarding.js"),
    "utf8"
  );

  test("keeps owner-facing onboarding confirmation clear and free of encoding drift", () => {
    expect(source).toContain("sendEmail skipped -- missing key or recipient");
    expect(source).toContain('payload.service_area || "--"');
    expect(source).toContain('payload.subdomain_preference || "--"');
    expect(source).toContain('payload.notes || "--"');
    expect(source).toContain("We are getting the account ready");
    expect(source).toContain("open your business hub");
    expect(source).not.toContain("â€”");
  });
});
