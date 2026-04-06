"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { safeClick } = require("./operator-test-helpers");

loadTestEnv();

function horizontalOverflowPx() {
  return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
}

test.describe("operator cross-device smoke", () => {
  test.setTimeout(90000);

  test("login and recovery shell stay usable across browser/device projects", async ({ page, isMobile }) => {
    await page.goto("/operator/", { waitUntil: "domcontentloaded", timeout: 60000 });

    await expect(page.locator("#viewLogin")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#viewLogin")).toContainText("Business sign-in");
    await expect(page.locator("#globalSearch")).toBeHidden();

    const loginOverflow = await page.evaluate(horizontalOverflowPx);
    expect(loginOverflow).toBeLessThanOrEqual(2);

    if (isMobile) {
      await expect(page.locator("#mobileBottomNav")).toBeHidden();
    }

    await safeClick(page.getByRole("button", { name: "Forgot password?" }));
    await expect(page.locator("#viewForgotPassword")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#viewForgotPassword")).toContainText("Reset your password");
    await expect(page.locator("#globalSearch")).toBeHidden();
    await expect(page.locator("#mobileBottomNav")).toBeHidden();

    const forgotOverflow = await page.evaluate(horizontalOverflowPx);
    expect(forgotOverflow).toBeLessThanOrEqual(2);

    await safeClick(page.getByRole("button", { name: "Back to sign in" }));
    await expect(page.locator("#viewLogin")).toBeVisible({ timeout: 20000 });
  });
});
