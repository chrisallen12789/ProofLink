"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test.describe("portal payment return smoke", () => {
  test("restores the customer account context after a canceled checkout", async ({ page }) => {
    await page.route("**/.netlify/functions/get-public-tenant-info?tenant_id=tenant_smoke", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          business_name: "Benkari Vacs",
        }),
      });
    });

    await page.route("**/.netlify/functions/get-customer-portal", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          business_name: "Benkari Vacs",
          orders: [{
            id: "order_smoke_1",
            title: "Hydrovac daylighting",
            created_at: "2026-03-26T16:00:00.000Z",
            status: "confirmed",
            total_cents: 25000,
            amount_paid_cents: 5000,
            amount_due_cents: 20000,
            payment_state: "partial",
          }],
          bookings: [],
          quotes: [],
        }),
      });
    });

    await page.goto("/portal.html?tenant=tenant_smoke&email=customer@example.com&checkout=cancel&order_id=order_smoke_1");

    await expect(page.getByText("No payment was made for Hydrovac daylighting.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay now" })).toBeVisible();
    await expect(page.getByText("Customer account")).toBeVisible();
  });
});
