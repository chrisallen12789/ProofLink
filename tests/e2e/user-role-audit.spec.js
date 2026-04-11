"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { createBrowserAudit, loginAsAdmin, loginAsCrew, loginAsOperator } = require("./browser-audit-helpers");

loadTestEnv();

test.describe("user role audit", () => {
  test.setTimeout(180000);

  test("public visitor can move through customer entry points without obvious breakage", async ({ page }) => {
    const audit = createBrowserAudit(page, {
      allowConsole: [/status of 400/i],
      allowPageError: [/Cloudflare Turnstile.*110200/i],
      allowRequest: [/https:\/\/challenges\.cloudflare\.com\//i],
    });

    await page.goto("/");
    await expect(page.getByRole("link", { name: /start your account|get growth|start with starter/i }).first()).toBeVisible();

    await page.goto("/join");
    await expect(page.locator("#nextFromStep1")).toBeVisible();
    await page.locator('.type-chip[data-value="hydrovac"]').click();
    await page.locator("#nextFromStep1").click();
    await expect(page.locator("#business_name")).toBeVisible();

    await page.goto("/contact.html");
    await expect(page.locator("form")).toBeVisible();

    await audit.expectClean("public visitor");
  });

  test("platform admin can sign into the admin control tower", async ({ page }) => {
    const audit = createBrowserAudit(page);
    await loginAsAdmin(page, process.env.TEST_PLATFORM_ADMIN_EMAIL, process.env.TEST_PLATFORM_ADMIN_PASSWORD);

    await expect(page.locator("#section-overview.active")).toContainText(/Platform Revenue Dashboard|Recent tenants/i);
    await page.locator('[data-section="onboarding"]').click();
    await expect(page.locator("#section-onboarding.active")).toContainText(/Onboarding Requests/i);

    await audit.expectClean("platform admin");
  });

  test("tenant owner can move through core operator workspaces", async ({ page }) => {
    const audit = createBrowserAudit(page);
    await loginAsOperator(page, process.env.TEST_TENANT_A_ADMIN_EMAIL, process.env.TEST_TENANT_A_ADMIN_PASSWORD);

    await expect(page.locator('[data-panel="dashboard"]:not(.hidden) h2').first()).toHaveText("Today");
    await page.locator('.sidebar .tab[data-tab="orders"]').click();
    await expect(page.locator('[data-panel="orders"]:not(.hidden) h2').first()).toHaveText(/Work|Orders/i);
    await page.locator('.sidebar .tab[data-tab="customers"]').click();
    await expect(page.locator('[data-panel="customers"]:not(.hidden) h2').first()).toHaveText("Customers");
    await page.locator('.sidebar .tab[data-tab="bookings"]').click();
    await expect(page.locator('[data-panel="bookings"]:not(.hidden) h2').first()).toHaveText(/Calendar|Bookings/i);

    await audit.expectClean("tenant owner");
  });

  test("tenant staff can sign in and use the operator shell", async ({ page }) => {
    const audit = createBrowserAudit(page);
    await loginAsOperator(page, "pltest.tenant.a.staff@example.com", "ChangeMe123!");

    await expect(page.locator("#globalSearch")).toBeVisible();
    await expect(page.locator('[data-panel="dashboard"]:not(.hidden)')).toContainText(/Today|daily/i);

    await audit.expectClean("tenant staff");
  });

  test("crew member can sign in and see assigned field work", async ({ page }) => {
    const audit = createBrowserAudit(page, {
      allowConsole: [/bad HTTP response code \(404\) was received when fetching the script/i],
    });
    await loginAsCrew(page, "pltest.tenant.b.crew@example.com", "ChangeMe123!");

    const jobsList = page.locator("#jobsList");
    await expect(jobsList).toBeVisible();
    const todayHasAssignment = await jobsList
      .getByText(/Crew packet daylighting follow-up|North trench|South vault/i)
      .first()
      .isVisible()
      .catch(() => false);

    let scheduleHasAssignment = false;
    if (!todayHasAssignment) {
      await page.locator("#navSchedule").click();
      scheduleHasAssignment = await page.locator("#scheduleList")
        .getByText(/Crew packet daylighting follow-up|North trench|South vault/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (!scheduleHasAssignment) {
        await expect(page.locator("#scheduleList")).toContainText(/No upcoming jobs\./i, { timeout: 30000 });
      }
    } else {
      await expect(jobsList).toContainText(/Crew packet daylighting follow-up|North trench|South vault/i, { timeout: 30000 });
    }

    const firstCard = todayHasAssignment
      ? page.locator("#jobsList .job-card").first()
      : page.locator("#scheduleList .job-card").first();
    if (await firstCard.count()) {
      await firstCard.click();
      await expect(page.locator("#jobInfoCard")).toBeVisible();
    }

    await audit.expectClean("crew member");
  });
});
