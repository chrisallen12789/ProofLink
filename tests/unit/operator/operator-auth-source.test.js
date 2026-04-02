"use strict";

const fs = require("fs");
const path = require("path");

describe("operator auth source", () => {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), "operator/index.html"),
    "utf8"
  );
  const js = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator.js"),
    "utf8"
  );

  test("password fields expose show-hide toggles and alert wiring", () => {
    expect(html).toContain('data-password-toggle="loginPassword"');
    expect(html).toContain('data-password-toggle="newPasswordInput"');
    expect(html).toContain('data-password-toggle="confirmPasswordInput"');
    expect(html).toContain('aria-describedby="loginMsg"');
    expect(html).toContain('aria-describedby="passwordStrengthRules passwordSetupMsg"');
    expect(html).toContain('aria-describedby="passwordMatchHint passwordSetupMsg"');
    expect(html).toContain('id="loginMsg" class="msg" role="alert"');
    expect(html).toContain('id="passwordSetupMsg" class="msg auth-msg" role="alert"');
  });

  test("password setup includes inline strength and match guidance", () => {
    expect(html).toContain('id="passwordStrengthRules"');
    expect(html).toContain('id="passwordRuleLength"');
    expect(html).toContain('id="passwordRuleComplexity"');
    expect(html).toContain('id="passwordMatchHint"');
    expect(js).toContain("passwordHasNumberOrSymbol");
    expect(js).toContain('Passwords do not match yet.');
    expect(js).toContain('Password must include at least one number or symbol.');
    expect(js).toContain("passwordToggleButtons.forEach(bindPasswordToggle)");
  });

  test("password sign-in suppresses overlapping auth boot and normalizes lock errors", () => {
    expect(js).toContain("let passwordLoginInFlight = false;");
    expect(js).toContain('if (passwordLoginInFlight && _event === "SIGNED_IN") {');
    expect(js).toContain('normalized.includes("another request stole it")');
    expect(js).toContain("Another sign-in request was already in progress. Please wait a moment and try again.");
  });
});
