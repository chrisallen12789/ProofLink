"use strict";

const { expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { loginAsOperatorSession } = require("./operator-test-helpers");

function createBrowserAudit(page, { allowConsole = [], allowRequest = [] } = {}) {
  const state = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text() || "";
    if (allowConsole.some((pattern) => pattern.test(text))) return;
    state.consoleErrors.push(text);
  });

  page.on("pageerror", (error) => {
    state.pageErrors.push(error?.message || String(error));
  });

  page.on("response", async (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (allowRequest.some((pattern) => pattern.test(url))) return;
    state.failedRequests.push(`${status} ${url}`);
  });

  return {
    async expectClean(label) {
      expect.soft(
        state.consoleErrors,
        `${label}: unexpected browser console errors`,
      ).toEqual([]);
      expect.soft(
        state.pageErrors,
        `${label}: unexpected page errors`,
      ).toEqual([]);
      expect.soft(
        state.failedRequests,
        `${label}: unexpected failed requests`,
      ).toEqual([]);
    },
  };
}

async function runAccessibilityScan(page, label, { disableRules = [] } = {}) {
  const builder = new AxeBuilder({ page }).disableRules(disableRules);
  const results = await builder.analyze();
  expect.soft(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    })),
    `${label}: accessibility violations`,
  ).toEqual([]);
}

async function loginAsAdmin(page, email, password) {
  await page.goto("/admin/");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /sign in to admin/i }).click();
  await expect(page.locator("#admin-app")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#section-overview.active .page-title")).toHaveText("Platform Overview");
}

async function loginAsCrew(page, email, password) {
  await page.goto("/crew/");
  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#btnSignIn").click();
  await page.waitForFunction(() => {
    if (window.PROOFLINK_CREW_BOOT_READY === true) return true;
    const home = document.getElementById("screenHome");
    const login = document.getElementById("screenLogin");
    return !!home
      && getComputedStyle(home).display !== "none"
      && !!login
      && getComputedStyle(login).display === "none";
  }, null, { timeout: 45000 });
  await expect(page.locator("#jobsList")).toBeVisible();
}

async function loginAsOperator(page, email, password) {
  await loginAsOperatorSession(page, email, password);
  await expect(page.locator("#viewApp")).toBeVisible({ timeout: 30000 });
}

module.exports = {
  createBrowserAudit,
  loginAsAdmin,
  loginAsCrew,
  loginAsOperator,
  runAccessibilityScan,
};
