"use strict";

const fs = require("fs");
const path = require("path");

describe("operator provisioning html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/provisioning.html"),
    "utf8"
  );

  test("keeps the onboarding queue copy plain and clean", () => {
    expect(source).toContain("<title>ProofLink Onboarding Queue</title>");
    expect(source).toContain(">Business hub<");
    expect(source).toContain('placeholder="Password"');
    expect(source).toContain(">Refresh<");
    expect(source).toContain("Decline and notify");
    expect(source).not.toContain("← Business Hub");
    expect(source).not.toContain("••••••••");
    expect(source).not.toContain("Decline & Notify");
    expect(source).not.toContain("↻");
    expect(source).not.toContain("▶");
    expect(source).not.toContain("✓");
  });

  test("uses shared queue and modal classes instead of brittle inline shells", () => {
    expect(source).toContain('class="top-nav-links"');
    expect(source).toContain('class="auth-error"');
    expect(source).toContain('class="table-state"');
    expect(source).toContain('class="modal-overlay"');
    expect(source).toContain('class="modal-card modal-card--detail"');
    expect(source).toContain('class="modal-card modal-card--reject"');
    expect(source).not.toContain(
      'style="margin-left:auto;display:flex;gap:1.25rem;align-items:center;"'
    );
    expect(source).not.toContain(
      'style="color:var(--danger);font-size:0.82rem;margin-bottom:0.75rem;display:none;"'
    );
    expect(source).not.toContain(
      'style="display:none;position:fixed;inset:0;background:rgba(13,13,13,0.5);z-index:1000;align-items:center;justify-content:center;padding:1rem;"'
    );
  });

  test("does not carry visible encoding drift", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
  });
});
