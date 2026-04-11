"use strict";

const { test, expect } = require("@playwright/test");
const { createBrowserAudit } = require("./browser-audit-helpers");

const PUBLIC_ROUTES = [
  { path: "/", text: /ProofLink|Start your account|Request service/i },
  { path: "/about.html", text: /about|prooflink/i },
  { path: "/how-it-works.html", text: /how it works|operator|customer/i },
  { path: "/join", text: /business|account|join/i },
  { path: "/contact.html", text: /contact|message|email/i },
  { path: "/book.html", text: /book|schedule|appointment/i },
  { path: "/order.html?tenant=pltest-tenant-a", text: /request service|order|cart/i },
  { path: "/portal.html?tenant=pltest-tenant-a", text: /portal|lookup|order/i },
  { path: "/quote.html", text: /quote|proposal|estimate/i },
  { path: "/privacy.html", text: /privacy/i },
  { path: "/terms.html", text: /terms/i },
  { path: "/refunds.html", text: /refund|cancellation|policy/i },
  { path: "/review.html", text: /review|feedback/i },
  { path: "/site-home.html?tenant=pltest-tenant-a", text: /request service|view products|service area/i },
  { path: "/start.html", text: /workspace|launch|business/i },
];

test.describe("site entrypoint audit", () => {
  test.setTimeout(180000);

  test("public routes load and primary CTAs resolve without obvious browser breakage", async ({ page }) => {
    const audit = createBrowserAudit(page, {
      allowConsole: [/status of 400/i],
      allowPageError: [/Cloudflare Turnstile.*110200/i],
      allowRequest: [/https:\/\/challenges\.cloudflare\.com\//i],
    });

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toContainText(route.text);
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const startAccountLink = page.getByRole("link", { name: /start your account|get growth|start with starter/i }).first();
    await expect(startAccountLink).toBeVisible();
    await expect(startAccountLink).toHaveAttribute("href", /join|operator\/launch|start/i);

    const requestServiceLink = page.getByRole("link", { name: /request service/i }).first();
    if (await requestServiceLink.count()) {
      await expect(requestServiceLink).toHaveAttribute("href", /book|order|site-home|#|tenant/i);
    }

    await audit.expectClean("site entrypoint audit");
  });

  test("operator, admin, and crew shells render their login entry points", async ({ page }) => {
    const audit = createBrowserAudit(page);

    await page.goto("/operator/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#viewLogin")).toBeVisible();
    await expect(page.locator("#loginEmail")).toBeVisible();

    await page.goto("/admin/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in to admin/i })).toBeVisible();

    await page.goto("/crew/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#screenLogin")).toBeVisible();
    await expect(page.locator("#loginEmail")).toBeVisible();

    await audit.expectClean("app shell entrypoints");
  });
});
