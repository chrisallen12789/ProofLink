"use strict";

const fs = require("fs");
const path = require("path");

describe("operator shell html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/index.html"),
    "utf8"
  );

  test("uses the calmer business-home language on the operator shell", () => {
    expect(source).toContain("<h1>Business hub</h1>");
    expect(source).toContain("Business sign-in");
    expect(source).toContain("Secure owner access");
    expect(source).toContain(">More tools<");
    expect(source).toContain('data-tab="dashboard"');
    expect(source).toContain(">Today<");
    expect(source).not.toContain("Operators only");
    expect(source).not.toContain("Email me a sign-in link");
  });

  test("keeps obvious drift markers out of the operator entry surface", () => {
    expect(source).not.toContain("cottagelink-logo");
    expect(source).not.toContain("tenant_id ready");
    expect(source).not.toContain("Operator UI v3");
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
  });
});
