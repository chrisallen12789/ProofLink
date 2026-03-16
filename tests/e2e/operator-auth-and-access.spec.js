"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test("operator auth gate blocks anonymous access and allows seeded operator login", async ({
  page,
}) => {
  await page.goto("/operator/provisioning.html");

  await expect(page.getByText("Operator login required")).toBeVisible();
  await page.getByLabel("Email").fill("wrong@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#auth-error")).toBeVisible();

  await page.getByLabel("Email").fill(process.env.TEST_PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Onboarding Queue" })).toBeVisible();
  await expect(page.locator("#requests-tbody")).toContainText("pltest-");
});
