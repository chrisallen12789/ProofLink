"use strict";

const fs = require("fs");
const path = require("path");

describe("operator import workspace source", () => {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), "operator/index.html"),
    "utf8"
  );
  const js = fs.readFileSync(
    path.resolve(process.cwd(), "operator/import-workspace.js"),
    "utf8"
  );

  test("exposes source-system preset and review-queue containers", () => {
    expect(html).toContain('id="importPresetWrap"');
    expect(html).toContain('id="importReviewQueueWrap"');
    expect(html).toContain("Source system preset");
    expect(html).toContain("Review queue");
  });

  test("wires preset selection and row reconciliation controls in the workspace runtime", () => {
    expect(js).toContain("function setImportPreset");
    expect(js).toContain("function setRowDecision");
    expect(js).toContain("function setRowOverrides");
    expect(js).toContain("buildImportReviewSampleRows");
    expect(js).toContain('data-import-preset-key');
    expect(js).toContain('data-import-row-action');
    expect(js).toContain('data-import-review-form');
    expect(js).toContain('data-import-review-field');
    expect(js).toContain("operator skip");
  });
});
