"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test("operator auth gate blocks anonymous access and allows seeded operator login", async ({
  page,
}) => {
  await page.goto("/operator/provisioning.html");

  await expect(page.getByText("Operator login required")).toBeVisible();
  await page.locator("#login-email").fill("wrong@example.com");
  await page.locator("#login-password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#auth-error")).toBeVisible();

  await page.locator("#login-email").fill(process.env.TEST_PLATFORM_ADMIN_EMAIL);
  await page.locator("#login-password").fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.locator("#main-content h1")).toHaveText("Onboarding Queue", { timeout: 15000 });
  await expect(page.locator("#requests-tbody .spinner")).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator("#requests-tbody tr").first()).toBeVisible({ timeout: 15000 });
});
