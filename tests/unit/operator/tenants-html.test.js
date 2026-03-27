"use strict";

const fs = require("fs");
const path = require("path");

describe("operator tenants html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/tenants.html"),
    "utf8"
  );

  test("keeps tenant directory language plain and drift-free", () => {
    expect(source).toContain("<title>ProofLink Tenant Directory</title>");
    expect(source).toContain(">Business hub<");
    expect(source).toContain(">Analytics<");
    expect(source).toContain(">Provisioning<");
    expect(source).toContain(">Tenants<");
    expect(source).toContain("Search by business, email, or website");
    expect(source).toContain("Loading tenants...");
    expect(source).toContain("Edit details");
    expect(source).not.toContain("📊");
    expect(source).not.toContain("📈");
    expect(source).not.toContain("🔧");
    expect(source).not.toContain("⚙️");
    expect(source).not.toContain("↻");
    expect(source).not.toContain("✏");
    expect(source).not.toContain("✕");
  });

  test("uses sturdier tenant-shell classes instead of brittle inline wrappers", () => {
    expect(source).toContain('class="op-layout shell-hidden"');
    expect(source).toContain('class="sidebar-footer"');
    expect(source).toContain('class="sidebar-signout"');
    expect(source).toContain('class="loading-cell loading-cell--error"');
    expect(source).toContain('class="tenant-count"');
    expect(source).toContain('class="table-muted"');
    expect(source).toContain('class="table-center"');
    expect(source).toContain("table-nowrap");
    expect(source).toContain('class="btn-sm btn-sm--edit"');
    expect(source).toContain('class="modal-divider"');
    expect(source).toContain('class="field config-grid__full"');
    expect(source).not.toContain(
      'style="position:absolute;bottom:1.5rem;left:0;right:0;padding:0 1.5rem"'
    );
    expect(source).not.toContain(
      'style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(245,242,235,0.5);padding:0.5rem;border-radius:4px;cursor:pointer;font-size:0.75rem;font-family:var(--font-body)"'
    );
    expect(source).not.toContain('style="font-size:0.8rem;color:var(--muted)"');
    expect(source).not.toContain('style="grid-column:1/-1"');
    expect(source).not.toContain('style="border:none;border-top:1px solid var(--border);margin:0 0 1.5rem"');
  });

  test("does not carry visible encoding drift", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
    expect(source).not.toContain("ðŸ");
  });
});
