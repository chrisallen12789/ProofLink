"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { expectNoOverflow, loginAsOperatorSession, safeClick } = require("./operator-test-helpers");

loadTestEnv();

async function loginAsTenantA(page) {
  await loginAsOperatorSession(page, process.env.TEST_TENANT_A_ADMIN_EMAIL, process.env.TEST_TENANT_A_ADMIN_PASSWORD);
  await expect(page.locator('[data-panel="dashboard"]:not(.hidden) .panel-head h2').first()).toHaveText("Today", { timeout: 20000 });
}

async function openPrimaryTab(page, tab, headingText, isMobile) {
  const button = isMobile
    ? page.locator(`#mobileBottomNav .mbn-item[data-mbn-tab="${tab}"]`)
    : page.locator(`.sidebar .tab[data-tab="${tab}"]`);
  const heading = page.locator(`[data-panel="${tab}"]:not(.hidden) .panel-head h2`).first();

  await safeClick(button, { timeout: 20000 });

  if (!(await heading.isVisible().catch(() => false))) {
    await safeClick(button, { timeout: 10000 });
  }

  if (headingText instanceof RegExp) {
    await expect(heading).toHaveText(headingText);
  } else {
    await expect(heading).toHaveText(headingText);
  }
  await expectNoOverflow(page);
}

test.describe("operator authenticated cross-device smoke", () => {
  test.setTimeout(180000);

  test("signed-in operator can move through core sections across devices", async ({ page, isMobile }) => {
    await loginAsTenantA(page);

    await expect(page.locator("#viewApp")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#globalSearch")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#btnSignOut")).toBeVisible({ timeout: 30000 });
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
      await safeClick(page.locator("#mbnMenuBtn"), { timeout: 15000 });
      await expect(sidebar).toHaveClass(/mobile-open/, { timeout: 5000 });
      await safeClick(page.locator("#mbnMenuBtn"), { timeout: 15000 });
      await expect(sidebar).not.toHaveClass(/mobile-open/, { timeout: 5000 });
      await expect(page.locator("#mobileBottomNav")).toBeVisible();
      await expectNoOverflow(page);
    }
  });
});
