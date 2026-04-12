"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { createBrowserAudit, loginAsOperator } = require("./browser-audit-helpers");

loadTestEnv();

test.describe("team rollout smoke", () => {
  test.setTimeout(180000);

  test("tenant owner can move through the team profile rollout actions", async ({ page }) => {
    const audit = createBrowserAudit(page);

    await loginAsOperator(page, process.env.TEST_TENANT_B_ADMIN_EMAIL, process.env.TEST_TENANT_B_ADMIN_PASSWORD);

    await page.locator('.sidebar .tab[data-tab="team"]').click();
    await expect(page.locator('[data-panel="team"]:not(.hidden) h2').first()).toHaveText(/Team/i);

    const teamPanel = page.locator("#teamMembersList");
    await expect(teamPanel).toContainText(/Monday rollout/i, { timeout: 30000 });
    await teamPanel.getByRole("button", { name: /profile/i }).first().click();

    const profileModal = page.locator("#teamMemberProfileModal");
    await expect(profileModal).toBeVisible({ timeout: 30000 });
    await expect(profileModal).toContainText(/Readiness gates/i);
    await expect(profileModal).toContainText(/Training evidence/i);
    await expect(profileModal).toContainText(/Timeline/i);
    await expect(profileModal.locator("#btnProfileTraining")).toBeVisible();
    await expect(profileModal.locator("#btnProfileRecords")).toBeVisible();
    await expect(profileModal.locator("#btnProfileTrainingTime")).toBeVisible();

    await profileModal.locator("#btnProfileTraining").evaluate((button) => button.click());
    const trainingModal = page.locator("#teamTrainingModal");
    await expect(trainingModal).toBeVisible({ timeout: 30000 });
    await expect(trainingModal).toContainText(/Training notes/i);
    await expect(trainingModal.locator("#btnTeamTrainingLogTime")).toBeVisible();

    await trainingModal.locator("#btnTeamTrainingLogTime").evaluate((button) => button.click());
    const timeModal = page.locator("#teamTimeModal");
    await expect(timeModal).toBeVisible({ timeout: 30000 });
    await expect(timeModal).toContainText(/Training type|Work type|Save time/i);
    await page.evaluate(() => {
      document.getElementById("teamTimeModal")?.remove();
    });

    await page.evaluate(() => {
      document.getElementById("teamTrainingModal")?.remove();
    });

    await teamPanel.getByRole("button", { name: /profile/i }).first().click();

    const profileModalAgain = page.locator("#teamMemberProfileModal");
    await expect(profileModalAgain).toBeVisible({ timeout: 30000 });
    await profileModalAgain.locator("#btnProfileRecords").evaluate((button) => button.click());

    const recordsModal = page.locator("#teamRecordEvidenceModal");
    await expect(recordsModal).toBeVisible({ timeout: 30000 });
    await expect(recordsModal).toContainText(/core records are on file/i);

    await audit.expectClean("team rollout profile workflow");
  });
});
