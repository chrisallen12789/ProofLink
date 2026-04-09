"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { loginAsAdmin, loginAsCrew, loginAsOperator, runAccessibilityScan } = require("./browser-audit-helpers");

loadTestEnv();

test.describe("accessibility role smoke", () => {
  test.setTimeout(180000);

  test("public pages pass core accessibility smoke", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /prooflink home|start your account|get growth/i }).first()).toBeVisible();
    await runAccessibilityScan(page, "landing page", {
      disableRules: ["color-contrast"],
    });

    await page.goto("/join");
    await page.locator('.type-chip[data-value="hydrovac"]').click();
    await page.locator("#nextFromStep1").click();
    await expect(page.locator("#business_name")).toBeVisible();
    await runAccessibilityScan(page, "join page", {
      disableRules: ["color-contrast"],
    });
  });

  test("platform admin surface passes core accessibility smoke", async ({ page }) => {
    await loginAsAdmin(page, process.env.TEST_PLATFORM_ADMIN_EMAIL, process.env.TEST_PLATFORM_ADMIN_PASSWORD);
    await runAccessibilityScan(page, "admin overview", {
      disableRules: ["color-contrast"],
    });
  });

  test("operator and crew shells pass core accessibility smoke", async ({ page, browser }) => {
    await loginAsOperator(page, process.env.TEST_TENANT_A_ADMIN_EMAIL, process.env.TEST_TENANT_A_ADMIN_PASSWORD);
    await runAccessibilityScan(page, "operator dashboard", {
      disableRules: ["color-contrast"],
    });

    const crewContext = await browser.newContext();
    const crewPage = await crewContext.newPage();
    await loginAsCrew(crewPage, "pltest.tenant.b.crew@example.com", "ChangeMe123!");
    await runAccessibilityScan(crewPage, "crew home", {
      disableRules: ["color-contrast"],
    });
    await crewPage.close();
    await crewContext.close();
  });
});
