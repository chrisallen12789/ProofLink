"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");

loadTestEnv();

test.describe("repeat reactivation smoke", () => {
  async function suppressTourAndOnboarding(page) {
    await page.addInitScript(() => {
      window.localStorage.setItem("pl_tour_v1", "1");
      window.localStorage.setItem("pl_onboarding_dismissed", "true");
    });
  }

  async function loginAsTenantA(page) {
    await suppressTourAndOnboarding(page);
    await page.goto("/operator/");
    await page.locator("#loginForm").waitFor();
    await page.locator("#loginEmail").fill(process.env.TEST_TENANT_A_ADMIN_EMAIL);
    await page.locator("#loginPassword").fill(process.env.TEST_TENANT_A_ADMIN_PASSWORD);
    await page.locator("#loginForm button[type='submit']").click();
    await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 20000 });
    await expect(page.locator('[data-panel="dashboard"]:not(.hidden) .panel-head h2').first()).toHaveText("Today", { timeout: 20000 });
    await page.waitForFunction(() => {
      if (window.PROOFLINK_BOOT_READY === true) return true;
      const viewApp = document.getElementById("viewApp");
      const viewLogin = document.getElementById("viewLogin");
      return !!viewApp
        && !viewApp.classList.contains("hidden")
        && (!viewLogin || viewLogin.classList.contains("hidden"));
    }, null, { timeout: 45000 });
  }

  test("Today can reactivate a dormant repeat account into a booking draft", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(() => {
      const blueprint = {
        business: { key: "cleaning", label: "Cleaning" },
        workflowRubric: {
          intake: "Capture what matters first.",
          scheduling: "Schedule with confidence.",
          field: "Field updates stay quick.",
          payment: "Collect on time.",
          repeatWork: "Turn wins into repeat work.",
        },
      };
      currentWorkspaceBlueprint = () => blueprint;
      CUSTOMERS_CACHE = [{
        id: "customer_repeat_1",
        name: "Quiet Cleaning",
        email: "quiet@example.com",
        recurring_notes: "Every other Tuesday lobby touch-up",
        updated_at: "2026-02-01T12:00:00Z",
      }];
      SERVICE_PLANS_CACHE = [];
      CRM_ORDERS_CACHE = [];
      JOBS_CACHE = [];
      LEADS_CACHE = [];
      BIDS_CACHE = [];
      BOOKINGS_CACHE = [];
      PAYMENTS_CACHE = [];
      PRODUCTS_CACHE = [];
      EXPENSES_CACHE = [];
      renderDashboard();
    });

    const reactivationCard = page.locator(".dashboard-focus-card").filter({ hasText: "Reactivation focus" });
    await expect(reactivationCard).toContainText("Quiet Cleaning");
    await reactivationCard.getByRole("button", { name: "Schedule next visit" }).click();

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Quiet Cleaning");
    await expect(page.locator("#bkCustomerEmail")).toHaveValue("quiet@example.com");
    await expect(page.locator("#bkTitle")).toHaveValue("Quiet Cleaning cleaning visit");
    await expect(page.locator("#bkNotes")).toHaveValue(/Every other Tuesday lobby touch-up/);
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("BIWEEKLY");
  });

  test("Money can turn collection follow-through into a reactivation booking draft", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(() => {
      const blueprint = {
        business: { key: "cleaning", label: "Cleaning" },
        workflowRubric: {
          intake: "Capture what matters first.",
          scheduling: "Schedule with confidence.",
          field: "Field updates stay quick.",
          payment: "Collect on time.",
          repeatWork: "Turn wins into repeat work.",
        },
      };
      currentWorkspaceBlueprint = () => blueprint;
      CUSTOMERS_CACHE = [{
        id: "customer_repeat_1",
        name: "Quiet Cleaning",
        email: "quiet@example.com",
        recurring_notes: "Every other Tuesday lobby touch-up",
        updated_at: "2026-02-01T12:00:00Z",
      }];
      CRM_ORDERS_CACHE = [{
        id: "order_repeat_1",
        customer_id: "customer_repeat_1",
        customer_name: "Quiet Cleaning",
        status: "completed",
        total_cents: 12000,
        amount_paid_cents: 4000,
        amount_due_cents: 8000,
        payment_due_date: "2026-03-20",
      }];
      SERVICE_PLANS_CACHE = [];
      JOBS_CACHE = [];
      LEADS_CACHE = [];
      BIDS_CACHE = [];
      BOOKINGS_CACHE = [];
      PAYMENTS_CACHE = [];
      PRODUCTS_CACHE = [];
      EXPENSES_CACHE = [];
      renderMoney();
      switchTab("money", { force: true });
    });

    const collectionCard = page.locator(".money-focus-card");
    await expect(collectionCard).toContainText("After this balance is handled");
    await expect(collectionCard).toContainText("Reactivation move");
    await collectionCard.getByRole("button", { name: "Schedule next visit" }).click();

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Quiet Cleaning");
    await expect(page.locator("#bkCustomerEmail")).toHaveValue("quiet@example.com");
    await expect(page.locator("#bkTitle")).toHaveValue("Quiet Cleaning cleaning visit");
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("BIWEEKLY");
  });

  test("Booked work can reactivate repeat service into a smarter booking draft", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(() => {
      const blueprint = {
        business: { key: "hvac", label: "HVAC" },
        workflowRubric: {
          intake: "Capture what matters first.",
          scheduling: "Schedule with confidence.",
          field: "Field updates stay quick.",
          payment: "Collect on time.",
          repeatWork: "Turn wins into repeat work.",
        },
      };
      currentWorkspaceBlueprint = () => blueprint;
      CUSTOMERS_CACHE = [{
        id: "customer_repeat_hvac",
        name: "Harbor Suites",
        email: "ops@example.com",
        frequency: "Weekly maintenance",
        maintenance_notes: "Spring tune-up is due next visit",
        parts_follow_up: "Bring capacitor approval paperwork",
        equipment_notes: "Carrier rooftop unit RTU-2",
      }];
      CRM_ORDERS_CACHE = [{
        id: "order_repeat_hvac",
        customer_id: "customer_repeat_hvac",
        customer_name: "Harbor Suites",
        customer_email: "ops@example.com",
        status: "paid",
        total_cents: 12000,
        amount_paid_cents: 12000,
        amount_due_cents: 0,
      }];
      JOBS_CACHE = [];
      SERVICE_PLANS_CACHE = [];
      LEADS_CACHE = [];
      BIDS_CACHE = [];
      BOOKINGS_CACHE = [];
      PAYMENTS_CACHE = [];
      PRODUCTS_CACHE = [];
      EXPENSES_CACHE = [];
      ACTIVE_ORDER_ID = "order_repeat_hvac";
      renderOrders();
      switchTab("orders", { force: true });
    });

    const retentionCard = page.locator(".detail-card").filter({ hasText: "After this work is done" });
    await expect(retentionCard).toContainText("Schedule next system visit");
    await retentionCard.getByRole("button", { name: "Schedule next system visit" }).click();

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Harbor Suites");
    await expect(page.locator("#bkTitle")).toHaveValue("Harbor Suites maintenance visit");
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("WEEKLY");
    await expect(page.locator("#bkNotes")).toHaveValue(/Spring tune-up is due next visit/);
    await expect(page.locator("#bkNotes")).toHaveValue(/Bring capacitor approval paperwork/);
  });

  test("Completed jobs can reopen repeat service from closeout guidance", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(() => {
      const blueprint = {
        business: { key: "cleaning", label: "Cleaning" },
        workflowRubric: {
          intake: "Capture what matters first.",
          scheduling: "Schedule with confidence.",
          field: "Field updates stay quick.",
          payment: "Collect on time.",
          repeatWork: "Turn wins into repeat work.",
        },
      };
      currentWorkspaceBlueprint = () => blueprint;
      CUSTOMERS_CACHE = [{
        id: "customer_repeat_job",
        name: "Quiet Cleaning",
        email: "quiet@example.com",
        recurring_notes: "Every other Tuesday lobby touch-up",
        checklist_notes: "Restock soap and wipe entry glass",
      }];
      CRM_ORDERS_CACHE = [{
        id: "order_repeat_job",
        customer_id: "customer_repeat_job",
        customer_name: "Quiet Cleaning",
        customer_email: "quiet@example.com",
        status: "paid",
        total_cents: 12000,
        amount_paid_cents: 12000,
        amount_due_cents: 0,
      }];
      JOBS_CACHE = [{
        id: "job_repeat_job",
        order_id: "order_repeat_job",
        customer_id: "customer_repeat_job",
        title: "Quiet Cleaning visit",
        status: "completed",
        payment_state: "paid",
        scheduled_date: "2026-03-28",
      }];
      SERVICE_PLANS_CACHE = [];
      LEADS_CACHE = [];
      BIDS_CACHE = [];
      BOOKINGS_CACHE = [];
      PAYMENTS_CACHE = [];
      PRODUCTS_CACHE = [];
      EXPENSES_CACHE = [];
      ACTIVE_JOB_ID = "job_repeat_job";
      renderJobs("");
      switchTab("jobs", { force: true });
    });

    const closeoutCard = page.locator(".detail-card").filter({ hasText: "Closeout guidance" });
    await expect(closeoutCard).toContainText("Schedule next cleaning visit");
    await closeoutCard.getByRole("button", { name: "Schedule next cleaning visit" }).click();

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Quiet Cleaning");
    await expect(page.locator("#bkTitle")).toHaveValue("Quiet Cleaning cleaning visit");
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("BIWEEKLY");
    await expect(page.locator("#bkNotes")).toHaveValue(/Restock soap and wipe entry glass/);
  });
});
