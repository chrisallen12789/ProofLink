"use strict";

const fs = require("fs");
const path = require("path");

describe("crew index html source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "crew/index.html"),
    "utf8"
  );

  test("keeps quick tools attached to the action zone across job states", () => {
    expect(source).toContain("const quickTools = this.renderQuickTools(job);");
    expect(source).toContain("zone.innerHTML = quickTools + html;");
  });

  test("ships trade-specific quick copy tools in the live crew runtime", () => {
    expect(source).toContain("Copy route note");
    expect(source).toContain("Copy access note");
    expect(source).toContain("Copy system note");
    expect(source).toContain("Copy shutoff note");
    expect(source).toContain("Copy BOL / load note");
    expect(source).toContain("async copyCrewQuickValue(type)");
  });
});
