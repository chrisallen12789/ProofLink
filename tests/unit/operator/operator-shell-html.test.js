"use strict";

const fs = require("fs");
const path = require("path");

describe("operator shell html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/index.html"),
    "utf8"
  );

  test("uses the calmer business-home language on the operator shell", () => {
    expect(source).toContain("<h1>Business hub</h1>");
    expect(source).toContain("Business sign-in");
    expect(source).toContain("Secure owner access");
    expect(source).toContain(">More tools<");
    expect(source).toContain('data-tab="dashboard"');
    expect(source).toContain(">Today<");
    expect(source).toContain("Booked work");
    expect(source).toContain("Select booked work to inspect it.");
    expect(source).not.toContain("Operators only");
    expect(source).not.toContain("Email me a sign-in link");
    expect(source).not.toContain("Quoted / booked");
    expect(source).not.toContain("quoted or booked work");
  });

  test("keeps obvious drift markers out of the operator entry surface", () => {
    expect(source).not.toContain("cottagelink-logo");
    expect(source).not.toContain("tenant_id ready");
    expect(source).not.toContain("Operator UI v3");
    expect(source).not.toContain("ÃƒÂ¢");
    expect(source).not.toContain("ÃƒÆ’");
    expect(source).not.toContain("Show me around ->");
    expect(source).not.toContain("<- Back");
  });

  test("leans on shared shell utility classes instead of repeated inline spacing", () => {
    expect(source).toContain('class="grid two u-mt-14"');
    expect(source).toContain('class="workspace-panel-notice is-soft u-mb-14"');
    expect(source).toContain('class="work-command u-mb-14"');
    expect(source).toContain('class="bulk-status-bar"');
    expect(source).toContain('class="btn btn-primary btn-compact"');
    expect(source).toContain('class="muted u-fs-85"');
    expect(source).not.toContain('style="font-size:.8rem;padding:6px 12px;"');
    expect(source).not.toContain('style="margin-top:14px;"');
    expect(source).not.toContain('style="margin-bottom:14px;"');
  });
});
