"use strict";

const fs = require("fs");
const path = require("path");

describe("operator launch source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator.launch.js"),
    "utf8"
  );

  test("does not override the main operator tab router", () => {
    expect(source).not.toContain("window.switchTab = function switchTabEnhanced");
    expect(source).toContain("if (typeof window.switchTab === 'function')");
    expect(source).toContain("return window.switchTab(tab, opts);");
  });
});
