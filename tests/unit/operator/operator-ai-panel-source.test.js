"use strict";

const fs = require("fs");
const path = require("path");

describe("operator ai panel source", () => {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), "operator/index.html"),
    "utf8"
  );
  const js = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator.js"),
    "utf8"
  );

  test("exposes specialist prompts for multi-site customers, jobs, and top accounts", () => {
    expect(html).toContain("Which multi-site customers need attention right now?");
    expect(html).toContain("Which jobs this week need crew prep or route attention?");
    expect(html).toContain("Which top customers should I protect this week?");
    expect(html).toContain('data-specialist="collections"');
    expect(html).toContain('data-specialist="crew_prep"');
    expect(html).toContain('data-specialist="retention"');
  });

  test("briefing chips surface jobs, reminders, and multi-site account load", () => {
    expect(js).toContain("cs.upcoming_jobs > 0");
    expect(js).toContain("cs.reminders_needed > 0");
    expect(js).toContain("cs.multi_site_accounts > 0");
    expect(js).toContain('answerEl.textContent = "Thinking..."');
  });
});
