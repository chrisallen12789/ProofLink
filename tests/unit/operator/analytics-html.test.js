"use strict";

const fs = require("fs");
const path = require("path");

describe("operator analytics html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/analytics.html"),
    "utf8"
  );

  test("keeps analytics language plain and drift-free", () => {
    expect(source).toContain("<title>ProofLink Platform Analytics</title>");
    expect(source).toContain(">Business hub<");
    expect(source).toContain(">Analytics<");
    expect(source).toContain(">Provisioning<");
    expect(source).toContain('id="refresh-btn">Refresh<');
    expect(source).toContain("No recent activity yet.");
    expect(source).not.toContain("📊");
    expect(source).not.toContain("📈");
    expect(source).not.toContain("🔧");
    expect(source).not.toContain("⚙️");
    expect(source).not.toContain("View all →");
    expect(source).not.toContain("↻");
  });

  test("uses shared shell classes instead of brittle inline wrappers", () => {
    expect(source).toContain('class="op-layout shell-hidden"');
    expect(source).toContain('class="sidebar-footer"');
    expect(source).toContain('class="sidebar-signout"');
    expect(source).toContain('class="panel-link"');
    expect(source).toContain('class="state-message state-message--loading"');
    expect(source).toContain('class="tenant-meta"');
    expect(source).toContain('class="gmv-divider"');
    expect(source).toContain('class="gmv-grid"');
    expect(source).toContain('class="gmv-stat-label"');
    expect(source).toContain('class="gmv-stat-value"');
    expect(source).toContain('class="panel-body panel-body--list"');
    expect(source).not.toContain(
      'style="position:absolute;bottom:1.5rem;left:0;right:0;padding:0 1.5rem"'
    );
    expect(source).not.toContain(
      'style="text-align:center;padding:2rem;color:var(--muted)"'
    );
    expect(source).not.toContain('style="padding:0 1.25rem"');
    expect(source).not.toContain('style="display:grid;grid-template-columns:1fr 1fr;gap:1rem"');
  });

  test("does not carry visible encoding drift", () => {
    expect(source).not.toContain("â");
    expect(source).not.toContain("Ã");
    expect(source).not.toContain("ðŸ");
  });
});
