"use strict";

const fs = require("fs");
const path = require("path");

describe("admin AI control source", () => {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), "admin/index.html"),
    "utf8"
  );
  const js = fs.readFileSync(
    path.resolve(process.cwd(), "admin/admin.js"),
    "utf8"
  );

  test("adds an admin-only AI control section", () => {
    const normalizedHtml = html.replace(/\s+/g, " ");
    expect(html).toContain('data-section="ai-control"');
    expect(html).toContain('id="section-ai-control"');
    expect(html).toContain("Internal AI Control");
    expect(html).toContain("Run workforce review");
    expect(html).toContain("Run systems review");
    expect(html).toContain("Systems guidance");
    expect(normalizedHtml).toContain("Tenant operators should only see workflow reviews");
  });

  test("wires tenant-targeted workforce review helpers in admin runtime", () => {
    expect(js).toContain("var aiControlState = {");
    expect(js).toContain("function loadAiControl()");
    expect(js).toContain("function loadAiAgentRoster()");
    expect(js).toContain("function runAiWorkforceReview()");
    expect(js).toContain("function runAiSystemsReview()");
    expect(js).toContain("agent_key: 'agent_workforce_architect'");
    expect(js).toContain("agent_key: 'ai_systems_architect'");
    expect(js).toContain("tenant_id: tenantId");
  });
});
