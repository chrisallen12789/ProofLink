"use strict";

const fs = require("fs");
const path = require("path");

describe("operator launch html", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/launch.html"),
    "utf8"
  );

  test("keeps launch copy plain and reassuring", () => {
    expect(source).toContain("Open business hub");
    expect(source).toContain("Open my website");
    expect(source).toContain("Loading your next steps...");
    expect(source).not.toContain("View my website ->");
    expect(source).not.toContain("Open business hub ->");
  });

  test("uses shared launch-state classes instead of inline error styling", () => {
    expect(source).toContain('class="error-state is-hidden"');
    expect(source).toContain('class="btn-refresh error-state__retry"');
    expect(source).toContain('class="progress-fill progress-fill--start"');
    expect(source).toContain('class="is-hidden"');
    expect(source).not.toContain('id="error-state" style=');
    expect(source).not.toContain('id="progress-fill" style=');
    expect(source).not.toContain('id="main-content" style=');
  });
});
