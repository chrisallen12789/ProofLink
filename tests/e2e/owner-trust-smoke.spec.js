"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test("owner entry surfaces stay calm and business-first", async ({ page }) => {
  await page.goto("/operator/");

  await expect(page.getByRole("heading", { name: "Business hub" })).toBeVisible();
  await expect(page.getByText("Business sign-in")).toBeVisible();
  await expect(page.getByText("Secure owner access")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send me a sign-in link" })).toBeVisible();
  await expect(page.getByText("Operators only")).toHaveCount(0);

  await page.goto("/operator/launch.html");

  await expect(page.getByRole("link", { name: "Open business hub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#error-msg")).toContainText(/Could not load your next steps|No tenant identifier found/i, { timeout: 10000 });
  await expect(page.getByText("View my website ->")).toHaveCount(0);
});
