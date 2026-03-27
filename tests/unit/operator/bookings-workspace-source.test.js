"use strict";

const fs = require("fs");
const path = require("path");

describe("operator bookings workspace source", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-bookings-workspace.js"),
    "utf8"
  );

  test("uses shared modal classes for booking detail editing", () => {
    expect(source).toContain('overlay.className = "modal-overlay"');
    expect(source).toContain('class="modal-card"');
    expect(source).toContain('class="modal-head"');
    expect(source).toContain('class="modal-grid-3"');
    expect(source).toContain('class="modal-footer"');
    expect(source).toContain('class="field-note-label field-note-label--tight">Assigned to</label>');
    expect(source).toContain('class="modal-status"');
    expect(source).not.toContain('overlay.style.cssText = "position:fixed;inset:0;');
  });
});
