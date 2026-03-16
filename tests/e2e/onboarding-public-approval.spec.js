"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test("public onboarding request can be approved and provisioned", async ({ page }) => {
  const stamp = Date.now();
  const businessName = `pltest-e2e-${stamp}`;
  const email = `pltest.e2e.${stamp}@example.com`;

  await page.goto("/join");
  await page.locator('.type-chip[data-value="bakery"]').click();
  await page.getByRole("button", { name: /Continue/i }).click();

  await page.locator("#business_name").fill(businessName);
  await page.locator("#city_state").fill("Detroit, MI");
  await page.locator("#requested_subdomain").fill(`pltest-e2e-${stamp}`);
  await page.getByRole("button", { name: /Continue/i }).click();

  await page.locator("#owner_name").fill("PL Test E2E");
  await page.locator("#phone").fill("555-111-2222");
  await page.locator("#owner_email").fill(email);
  await page.getByRole("button", { name: /Review application/i }).click();

  await expect(page.locator("#review-table")).toContainText(businessName);
  await page.getByRole("button", { name: /Submit application/i }).click();

  await expect(page.getByRole("heading", { name: "Application received!" })).toBeVisible();
  await expect(page.locator("#success-email")).toHaveText(email);
  await expect(page.locator("#success-ref")).toContainText("Reference ID:");

  await page.goto("/operator/provisioning.html");
  await page.getByLabel("Email").fill(process.env.TEST_PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const row = page.locator("#requests-tbody tr", { hasText: businessName });
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("#toast")).toContainText("Request approved");

  await row.getByRole("button", { name: /Provision/ }).click();
  await expect(page.locator("#toast")).toContainText("provisioned", { timeout: 20000 });
  await expect(row).toContainText("provisioned");
});
