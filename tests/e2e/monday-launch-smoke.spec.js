"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { createBrowserAudit, loginAsOperator } = require("./browser-audit-helpers");

loadTestEnv();

test.describe("monday launch smoke", () => {
  test.setTimeout(180000);

  test("tenant owner can open Team and see the Monday launch controls", async ({ page }) => {
    const audit = createBrowserAudit(page);
    await loginAsOperator(page, process.env.TEST_TENANT_A_ADMIN_EMAIL, process.env.TEST_TENANT_A_ADMIN_PASSWORD);

    await page.locator('.sidebar .tab[data-tab="team"]').click();
    await expect(page.locator('[data-panel="team"]:not(.hidden) h2').first()).toHaveText(/Team/i);
    const teamPanel = page.locator("#teamMembersList");
    await expect(teamPanel).toContainText(/Readiness summary/i, { timeout: 30000 });
    await expect(teamPanel).toContainText(/Monday launch checklist/i, { timeout: 30000 });
    await expect(page.getByRole("button", { name: /export monday/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /export launch/i })).toBeVisible();
    await expect(teamPanel).toContainText(/Dispatch clearance|Supervised rollout|Crew portal walkthrough/i);

    await audit.expectClean("monday launch team workspace");
  });
});
