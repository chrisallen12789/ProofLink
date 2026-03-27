"use strict";

const fs = require("fs");
const path = require("path");

describe("operator boot html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/index.html"),
    "utf8"
  );

  test("loads boot utilities before the main operator shell", () => {
    const bootIndex = source.indexOf('./operator-boot-utils.js');
    const operatorIndex = source.indexOf('./operator.js');
    const launchIndex = source.indexOf('./operator.launch.js');

    expect(bootIndex).toBeGreaterThan(-1);
    expect(operatorIndex).toBeGreaterThan(bootIndex);
    expect(launchIndex).toBeGreaterThan(operatorIndex);
  });
});
