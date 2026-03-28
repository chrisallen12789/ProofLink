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

  test("keeps walk-in and booking time-log modals on the shared modal system", () => {
    expect(source).toContain('modal.className = "modal-overlay"');
    expect(source).toContain("Walk-in booking");
    expect(source).toContain('class="modal-grid-2"');
    expect(source).toContain('class="modal-footer"');
    expect(source).toContain('button.textContent = "Creating…"');
    expect(source).toContain('message.className = "msg success u-mb-10"');
    expect(source).not.toContain('modal.style.cssText = "position:fixed;inset:0;');
    expect(source).not.toContain('style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;');
  });

  test("keeps the bookings list on shared list classes instead of inline layout", () => {
    expect(source).toContain('class="muted muted-small"');
    expect(source).toContain('class="list-item list-item--top"');
    expect(source).toContain('class="li-meta li-meta--tight"');
    expect(source).toContain("Prep for this visit");
    expect(source).toContain("Give the next stop a cleaner handoff");
    expect(source).not.toContain('style="font-size:.85rem;"');
    expect(source).not.toContain('style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;"');
    expect(source).not.toContain('style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;"');
  });
});
