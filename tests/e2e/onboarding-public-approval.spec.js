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
  await page.locator('[data-setup-mode="guided"]').click();
  await page.getByRole("button", { name: /^Review$/i }).click();

  await expect(page.locator("#review-table")).toContainText(businessName);
  await page.locator("#submit-btn").click();

  await expect(page.getByRole("heading", { name: "Workspace request received" })).toBeVisible();
  await expect(page.locator("#success-email")).toHaveText(email);
  await expect(page.locator("#success-ref")).toContainText("Reference ID:");

  await page.goto("/operator/provisioning.html");
  await page.locator("#login-email").fill(process.env.TEST_PLATFORM_ADMIN_EMAIL);
  await page.locator("#login-password").fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Onboarding Queue" })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#requests-tbody .spinner")).toHaveCount(0, { timeout: 15000 });

  const row = page.locator("#requests-tbody tr", { hasText: businessName });
  await expect(row).toBeVisible({ timeout: 15000 });
  const approveButton = row.getByRole("button", { name: /Approve|Re-approve/ });
  if (await approveButton.count()) {
    await approveButton.first().click();
    await expect(page.locator("#toast")).toContainText("Request approved");
  }

  await page.getByRole("button", { name: /Refresh/i }).click();
  const provisionButton = page
    .locator("#requests-tbody tr", { hasText: businessName })
    .getByRole("button", { name: /Provision/ })
    .first();
  await expect(provisionButton).toBeVisible({ timeout: 15000 });
  await provisionButton.click();
  await expect(page.locator("#toast")).toContainText("provisioned", { timeout: 20000 });
  await expect(row).toContainText("provisioned");
});
