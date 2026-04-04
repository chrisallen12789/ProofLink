"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

function horizontalOverflowPx() {
  return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
}

async function suppressTours(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pl_tour_v1", "1");
    window.localStorage.setItem("prooflink_tour_completed_v2", "1");
  });
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(horizontalOverflowPx);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function loginAsTenantA(page) {
  await suppressTours(page);
  await page.goto("/operator/");
  await page.locator("#loginForm").waitFor();
  await page.locator("#loginEmail").fill(process.env.TEST_TENANT_A_ADMIN_EMAIL);
  await page.locator("#loginPassword").fill(process.env.TEST_TENANT_A_ADMIN_PASSWORD);
  await page.locator("#loginForm button[type='submit']").click();
  await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 20000 });
  await expect(page.locator('[data-panel="dashboard"]:not(.hidden) .panel-head h2').first()).toHaveText("Today", { timeout: 20000 });
  await page.waitForFunction(() => window.PROOFLINK_BOOT_READY === true, null, { timeout: 45000 });
}

async function openPrimaryTab(page, tab, headingText, isMobile) {
  const button = isMobile
    ? page.locator(`#mobileBottomNav .mbn-item[data-mbn-tab="${tab}"]`)
    : page.locator(`.sidebar .tab[data-tab="${tab}"]`);
  const heading = page.locator(`[data-panel="${tab}"]:not(.hidden) .panel-head h2`).first();

  if (isMobile) {
    await button.click();
  } else {
    await button.click();
  }

  if (!(await heading.isVisible().catch(() => false))) {
    await button.click({ force: true });
  }

  if (headingText instanceof RegExp) {
    await expect(heading).toHaveText(headingText);
  } else {
    await expect(heading).toHaveText(headingText);
  }
  await expectNoOverflow(page);
}

test.describe("operator authenticated cross-device smoke", () => {
  test.setTimeout(90000);

  test("signed-in operator can move through core sections across devices", async ({ page, isMobile }) => {
    await loginAsTenantA(page);

    await expect(page.locator("#viewApp")).toBeVisible();
    await expect(page.locator("#globalSearch")).toBeVisible();
    await expect(page.locator("#btnSignOut")).toBeVisible();
    await expectNoOverflow(page);

    if (isMobile) {
      await expect(page.locator("#mobileBottomNav")).toBeVisible();
    } else {
      await expect(page.locator("#mobileBottomNav")).toBeHidden();
    }

    await openPrimaryTab(page, "orders", /^(Work|Orders)$/i, isMobile);
    await openPrimaryTab(page, "customers", "Customers", isMobile);
    await openPrimaryTab(page, "bookings", /^(Calendar|Bookings)$/i, isMobile);
    await openPrimaryTab(page, "payments", /^(Money|Payments)$/i, isMobile);
    await openPrimaryTab(page, "dashboard", "Today", isMobile);

    if (isMobile) {
      const sidebar = page.locator(".sidebar");
      await page.locator("#mbnMenuBtn").click();
      await expect(sidebar).toHaveClass(/mobile-open/, { timeout: 5000 });
      await page.locator("#mbnMenuBtn").click();
      await expect(sidebar).not.toHaveClass(/mobile-open/, { timeout: 5000 });
      await expect(page.locator("#mobileBottomNav")).toBeVisible();
      await expectNoOverflow(page);
    }
  });
});
