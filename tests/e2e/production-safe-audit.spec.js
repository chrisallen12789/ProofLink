"use strict";

const { test, expect } = require("@playwright/test");
const { createBrowserAudit } = require("./browser-audit-helpers");

const publicTenantSlug = String(process.env.TEST_PUBLIC_TENANT_SLUG || "pltest-tenant-a").trim();

test.describe("production-safe audit", () => {
  test("public routes load without obvious browser breakage", async ({ page }) => {
    const audit = createBrowserAudit(page, {
      allowConsole: [/status of 400/i],
      allowPageError: [/Cloudflare Turnstile.*110200/i],
      allowRequest: [/https:\/\/challenges\.cloudflare\.com\//i],
    });

    await page.goto("/");
    await expect(page.locator("body")).toContainText(/ProofLink|Start your account|Request service/i);

    await page.goto("/join");
    await expect(page.locator("body")).toContainText(/business|account|join/i);

    await page.goto("/contact.html");
    await expect(page.locator("form")).toBeVisible();

    await page.goto(`/site-home.html?tenant=${encodeURIComponent(publicTenantSlug)}`);
    await expect(page.locator("body")).not.toContainText(/tenant not found/i);

    await page.goto(`/order.html?tenant=${encodeURIComponent(publicTenantSlug)}`);
    await expect(page.locator("body")).not.toContainText(/tenant not found/i);

    await page.goto(`/portal.html?tenant=${encodeURIComponent(publicTenantSlug)}`);
    await expect(page.locator("#btnPortalLookup")).toBeVisible();

    await audit.expectClean("production-safe public routes");
  });
});
