"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

function horizontalOverflowPx() {
  return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(horizontalOverflowPx);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function waitForScheduleToSettle(page) {
  await page.waitForFunction(() => {
    const list = document.getElementById('scheduleList');
    if (!list) return false;
    if (list.querySelector('.job-card:not(.skeleton)')) return true;
    if (list.querySelector('.empty-state')) return true;
    return false;
  }, null, { timeout: 45000 });
}

async function loginToCrew(page, email, password) {
  await page.goto("/crew/");
  await page.locator("#loginEmail").waitFor();
  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#btnSignIn").click();
  await page.waitForFunction(() => {
    if (window.PROOFLINK_CREW_BOOT_READY === true) return true;
    const login = document.getElementById("screenLogin");
    const home = document.getElementById("screenHome");
    return !!home
      && getComputedStyle(home).display !== "none"
      && !!login
      && getComputedStyle(login).display === "none";
  }, null, { timeout: 45000 });
  await expect(page.locator("#jobsList")).toBeVisible();
  await page.waitForTimeout(3000);
  if ((await page.locator("#jobsList .job-card:not(.skeleton)").count()) === 0) {
    await page.evaluate(() => {
      if (typeof loadJobs === "function") {
        return loadJobs(window.CURRENT_DATE || new Date().toISOString().slice(0, 10));
      }
      return null;
    });
  }
}

test.describe("crew hydrovac handoff cross-device", () => {
  test.setTimeout(120000);

  test("crew sees the hydrovac field packet and recent site memory on phone and desktop", async ({ page }) => {
    await loginToCrew(page, process.env.TEST_TENANT_B_ADMIN_EMAIL, process.env.TEST_TENANT_B_ADMIN_PASSWORD);

    await expect(page.locator("#jobsList")).toContainText(/North trench daylighting|Riverfront Milling/i, { timeout: 30000 });
    await expect(page.locator("#jobsList")).toContainText(/Live load|locate active|permit open/i, { timeout: 30000 });
    await expectNoOverflow(page);

    await page.locator("#jobsList .job-card").first().click();
    await expect(page.locator("#jobActions .field-command-card")).toBeVisible();
    await expect(page.locator("#jobActions .field-handoff-card")).toBeVisible();
    await expect(page.locator("#jobActions")).toContainText(/Field packet|Site packet/i);
    await expect(page.locator("#jobActions")).toContainText(/Access|Recent site work/i);
    await expectNoOverflow(page);

    await page.locator('#navSchedule').click();
    await expect(page.locator("#screenSchedule")).toBeVisible();
    await waitForScheduleToSettle(page);
    await expect(page.locator("#scheduleList")).toContainText(/South vault cleanout|North trench daylighting|No upcoming jobs/i, { timeout: 30000 });
    await expectNoOverflow(page);
  });

  test("crew hydrovac completion screen keeps the structured closeout visible before submit", async ({ page }) => {
    await loginToCrew(page, process.env.TEST_TENANT_B_ADMIN_EMAIL, process.env.TEST_TENANT_B_ADMIN_PASSWORD);

    await expect(page.locator("#jobsList")).toContainText(/North trench daylighting|Riverfront Milling/i, { timeout: 30000 });
    await page.locator("#jobsList .job-card").first().click();
    await expect(page.locator("#jobActions")).toBeVisible();

    const clockInButton = page.locator('#jobActions [data-action="clock-in"]').first();
    if (await clockInButton.count()) {
      await clockInButton.click();
      const confirmModal = page.locator('#confirmModal.open');
      await Promise.race([
        confirmModal.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
        page.locator('#jobActions [data-action="complete-job"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
      ]);
      if (await confirmModal.isVisible().catch(() => false)) {
        await page.evaluate(() => window.App?.confirmOk?.());
        await confirmModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null);
      }
    }

    const completeButton = page.locator('#jobActions [data-action="complete-job"]').first();
    const completeVisible = await completeButton.isVisible().catch(() => false);
    if (completeVisible) {
      await completeButton.click();
    } else {
      await page.evaluate(() => {
        if (typeof showCompletionScreen === "function") {
          showCompletionScreen();
          return;
        }
        if (window.App?.jobAction) {
          window.App.jobAction("complete");
          return;
        }
        window.App?.showScreen?.("screenCompletion");
      });
    }

    await expect(page.locator("#screenCompletion")).toBeVisible();
    await expect(page.locator("#completionHydrovacOverview")).toContainText(/Hydrovac command|Field packet/i);
    await expect(page.locator("#completionHydrovacFields")).toContainText(/Load and disposal|Locate and permit|Office handoff/i);
    await expect(page.locator("#completionPreviewCard")).toContainText(/What the office will read next|Still missing|Closeout ready/i);
    await expectNoOverflow(page);
  });
});
