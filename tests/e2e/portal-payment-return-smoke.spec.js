"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test.describe("portal payment return smoke", () => {
  async function seedCheckoutReturn(page, overrides = {}) {
    await page.addInitScript((value) => {
      window.sessionStorage.setItem("prooflink_portal_checkout", JSON.stringify(value));
    }, {
      order_id: "order_smoke_1",
      tenant_id: "tenant_smoke",
      email: "customer@example.com",
      saved_at: Date.now(),
      ...overrides,
    });
  }

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
    const orders = Array.isArray(options.orders) && options.orders.length ? options.orders : [order];

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
          orders,
          bookings: options.bookings || [],
          quotes: [],
        }),
      });
    });
  }

  test("restores the customer account context after a canceled checkout", async ({ page }) => {
    await stubPortalRoutes(page);
    await seedCheckoutReturn(page);

    await page.goto("/portal.html?tenant=tenant_smoke&email=customer@example.com&checkout=cancel&order_id=order_smoke_1");

    await expect(page.getByText("No payment was made for Hydrovac daylighting.")).toBeVisible();
    await expect(page.getByText("Payment summary")).toBeVisible();
    await expect(page.locator('.orders-summary-title')).toHaveText("A balance is still open.");
    await expect(page.getByText("1 order still has a balance due totaling $200.00.")).toBeVisible();
    await expect(page.getByText("Next best step: Review Hydrovac daylighting and pay any amount still due.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay now" })).toBeVisible();
    await expect(page.getByText("A balance is still open. You can pay the rest here any time from this page.")).toBeVisible();
    await expect(page.getByText("Once the remaining balance is paid, this order will show as fully closed here automatically.")).toBeVisible();
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
    await seedCheckoutReturn(page);

    await page.goto("/portal.html?tenant=tenant_smoke&email=customer@example.com&checkout=success&order_id=order_smoke_1");

    await expect(page.getByText("Your payment for Hydrovac daylighting was received.")).toBeVisible();
    await expect(page.getByText("Payment summary")).toBeVisible();
    await expect(page.getByText("You are paid up right now.")).toBeVisible();
    await expect(page.locator('.order-row[data-order-id="order_smoke_1"]')).toHaveClass(/order-row--highlight/);
    await expect(page.locator('.order-row[data-order-id="order_smoke_1"]')).toContainText("Paid in full");
    await expect(page.getByText("Paid in full. You are all set on this order.")).toBeVisible();
    await expect(page.getByText("The business can now keep your next visit, closeout, or follow-up moving from here.")).toBeVisible();
  });

  test("moves the most urgent balance to the top and marks it as the next payment to finish", async ({ page }) => {
    await stubPortalRoutes(page, {
      orders: [
        {
          id: "order_upcoming",
          title: "Jetting follow-up",
          created_at: "2026-03-20T16:00:00.000Z",
          status: "confirmed",
          total_cents: 15000,
          amount_paid_cents: 0,
          amount_due_cents: 15000,
          payment_state: "unpaid",
        },
        {
          id: "order_overdue",
          title: "Emergency line locate",
          created_at: "2026-03-10T16:00:00.000Z",
          status: "confirmed",
          total_cents: 40000,
          amount_paid_cents: 5000,
          amount_due_cents: 35000,
          payment_state: "overdue",
        },
      ],
    });

    await page.goto("/portal.html?tenant=tenant_smoke&email=customer@example.com");
    await page.getByRole("button", { name: "See my account" }).click();

    await expect(page.locator('.orders-summary-title')).toHaveText("A payment needs attention.");
    await expect(page.getByText("2 orders still have balances due totaling $500.00. 1 is already overdue.")).toBeVisible();
    await expect(page.getByText("Next best step: Review Emergency line locate and pay any amount still due.")).toBeVisible();
    await expect(page.locator('.order-row').first()).toHaveAttribute('data-order-id', 'order_overdue');
    await expect(page.locator('.order-row[data-order-id="order_overdue"]')).toHaveClass(/order-row--focus/);
    await expect(page.getByText("This is the best payment to finish next based on what is still due.")).toBeVisible();
  });

  test("shows appointment summary guidance when a future booking is on the calendar", async ({ page }) => {
    await stubPortalRoutes(page, {
      bookings: [
        {
          id: "booking_upcoming_1",
          title: "Quarterly rooftop maintenance",
          starts_at: "2026-04-08T14:00:00.000Z",
          status: "confirmed",
          notes: "Meet building engineer on site",
        },
      ],
    });

    await page.goto("/portal.html?tenant=tenant_smoke&email=customer@example.com");
    await page.getByRole("button", { name: "See my account" }).click();
    await page.getByRole("button", { name: "Appointments" }).click();

    await expect(page.getByText("Appointment summary")).toBeVisible();
    await expect(page.locator('#bookingsSummary .orders-summary-title')).toHaveText("Your next appointment is on the calendar");
    await expect(page.getByText("You can keep track of the next visit here, and if anything changes the business will keep your updates tied to this account.")).toBeVisible();
    await expect(page.getByText("Next best step: Be ready for")).toBeVisible();
    await expect(page.locator('#bookingsList')).toContainText("Quarterly rooftop maintenance");
    await expect(page.locator('#bookingsList')).toContainText("You are booked. If anything changes, you can cancel here or message the business from this account.");
  });
});
