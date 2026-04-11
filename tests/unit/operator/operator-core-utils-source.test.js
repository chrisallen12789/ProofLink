"use strict";

const fs = require("fs");
const path = require("path");

describe("operator core utils source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-core-utils.js"),
    "utf8"
  );

  test("only skips script injection when an existing script is actually present", () => {
    expect(source).toContain("if (existing && (options.globalName ? global[options.globalName] : true)) {");
    expect(source).not.toContain("if (existing && options.globalName ? global[options.globalName] : true) {");
  });
});
