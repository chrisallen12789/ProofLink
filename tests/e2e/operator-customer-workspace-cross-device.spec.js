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
  await page.waitForFunction(() => window.PROOFLINK_BOOT_READY === true, null, { timeout: 45000 });
}

async function openCustomersTab(page, isMobile) {
  if (isMobile) {
    await page.locator('#mobileBottomNav .mbn-item[data-mbn-tab="customers"]').click();
  } else {
    await page.locator('.sidebar .tab[data-tab="customers"]').click();
  }
  await expect(page.locator('[data-panel="customers"]:not(.hidden) .panel-head h2').first()).toHaveText("Customers");
}

test.describe("operator customer workspace cross-device", () => {
  test.setTimeout(90000);

  test("signed-in operator can open a real seeded customer record across devices", async ({ page, isMobile }) => {
    await loginAsTenantA(page);
    await openCustomersTab(page, isMobile);

    const customerRows = page.locator("#customersList .customer-list-item");
    await expect(customerRows.first()).toBeVisible({ timeout: 20000 });
    await expect(customerRows.first()).toContainText("PL Test Customer A");

    await customerRows.first().click();

    const detailWrap = page.locator("#customerDetailWrap");
    await expect(detailWrap.locator(".customer-command-center")).toBeVisible({ timeout: 20000 });
    await expect(detailWrap).toContainText("PL Test Customer A");
    await expect(detailWrap).toContainText(/Customer record|Customer workbench/i);
    await expectNoOverflow(page);
  });
});
