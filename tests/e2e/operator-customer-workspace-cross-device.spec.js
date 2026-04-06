"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { expectNoOverflow, loginAsOperatorSession } = require("./operator-test-helpers");

loadTestEnv();

async function loginAsTenantA(page) {
  await loginAsOperatorSession(page, process.env.TEST_TENANT_A_ADMIN_EMAIL, process.env.TEST_TENANT_A_ADMIN_PASSWORD);
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
