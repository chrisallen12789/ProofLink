"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test.describe("portal payment return smoke", () => {
  async function stubPortalRoutes(page, options = {}) {
    const order = Object.assign({
      id: "order_smoke_1",
      title: "Hydrovac daylighting",
      created_at: "2026-03-26T16:00:00.000Z",
      status: "confirmed",
      total_cents: 25000,
      amount_paid_cents: 5000,
      amount_due_cents: 20000,
      payment_state: "partial",
    }, options.order || {});

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
          orders: [order],
          bookings: [],
          quotes: [],
        }),
      });
    });
  }

  test("restores the customer account context after a canceled checkout", async ({ page }) => {
    await stubPortalRoutes(page);

    await page.goto("/portal.html?tenant=tenant_smoke&email=customer@example.com&checkout=cancel&order_id=order_smoke_1");

    await expect(page.getByText("No payment was made for Hydrovac daylighting.")).toBeVisible();
    await expect(page.getByText("Payment summary")).toBeVisible();
    await expect(page.locator('.orders-summary-title')).toHaveText("A balance is still open.");
    await expect(page.getByText("1 order still has a balance due totaling $200.00.")).toBeVisible();
    await expect(page.getByText("Next best step: Review Hydrovac daylighting and pay any amount still due.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay now" })).toBeVisible();
    await expect(page.getByText("A balance is still open. You can pay the rest here any time from this page.")).toBeVisible();
    await expect(page.getByText("Customer account")).toBeVisible();
    await expect(page.locator('.order-row[data-order-id="order_smoke_1"]')).toHaveClass(/order-row--highlight/);
  });

  test("highlights the paid order after a successful checkout return", async ({ page }) => {
    await stubPortalRoutes(page, {
      order: {
        amount_paid_cents: 25000,
        amount_due_cents: 0,
        payment_state: "paid",
      },
    });

    await page.goto("/portal.html?tenant=tenant_smoke&email=customer@example.com&checkout=success&order_id=order_smoke_1");

    await expect(page.getByText("Your payment for Hydrovac daylighting was received.")).toBeVisible();
    await expect(page.getByText("Payment summary")).toBeVisible();
    await expect(page.getByText("You are paid up right now.")).toBeVisible();
    await expect(page.locator('.order-row[data-order-id="order_smoke_1"]')).toHaveClass(/order-row--highlight/);
    await expect(page.locator('.order-row[data-order-id="order_smoke_1"]')).toContainText("Paid in full");
    await expect(page.getByText("Paid in full. You are all set on this order.")).toBeVisible();
  });
});
