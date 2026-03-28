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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto("/operator/");
      await page.locator("#loginForm").waitFor();
      await page.locator("#loginEmail").fill(process.env.TEST_TENANT_A_ADMIN_EMAIL);
      await page.locator("#loginPassword").fill(process.env.TEST_TENANT_A_ADMIN_PASSWORD);
      await page.locator("#loginForm button[type='submit']").click();
      try {
        await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 20000 });
        break;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
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

    await page.evaluate(async () => {
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
        last_service_on: "2026-02-15T12:00:00Z",
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
    await expect(reactivationCard).toContainText("14 days");
    await reactivationCard.getByRole("button", { name: "Schedule next cleaning visit" }).click();

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Quiet Cleaning");
    await expect(page.locator("#bkCustomerEmail")).toHaveValue("quiet@example.com");
    await expect(page.locator("#bkTitle")).toHaveValue("Quiet Cleaning cleaning visit");
    await expect(page.locator("#bkNotes")).toHaveValue(/Every other Tuesday lobby touch-up/);
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("BIWEEKLY");
  });

  test("Money can turn collection follow-through into a reactivation booking draft", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(async () => {
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
        last_service_on: "2026-02-15T12:00:00Z",
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
    await collectionCard.getByRole("button", { name: "Schedule next cleaning visit" }).click();

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Quiet Cleaning");
    await expect(page.locator("#bkCustomerEmail")).toHaveValue("quiet@example.com");
    await expect(page.locator("#bkTitle")).toHaveValue("Quiet Cleaning cleaning visit");
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("BIWEEKLY");
  });

  test("Payments follow-through can reopen repeat service into a booking draft", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(async () => {
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
        id: "customer_repeat_payment",
        name: "Harbor Suites",
        email: "ops@example.com",
        frequency: "Weekly maintenance",
        maintenance_notes: "Spring maintenance visit due next month",
        parts_follow_up: "Bring capacitor approval paperwork",
      }];
      CRM_ORDERS_CACHE = [{
        id: "order_repeat_payment",
        customer_id: "customer_repeat_payment",
        customer_name: "Harbor Suites",
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
      clearPaymentForm({ customerId: "customer_repeat_payment", orderId: "order_repeat_payment" });
      renderPaymentNextActions({
        customerId: "customer_repeat_payment",
        orderId: "order_repeat_payment",
        blueprint,
      });
      switchTab("payments", { force: true });
    });

    const paymentsPanel = page.locator('[data-panel="payments"]:not(.hidden)');
    const nextActions = paymentsPanel.locator("#paymentNextActions");
    await expect(nextActions).toContainText("Schedule next system visit");
    await nextActions.getByRole("button", { name: "Schedule next system visit" }).click();

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Harbor Suites");
    await expect(page.locator("#bkTitle")).toHaveValue("Harbor Suites maintenance visit");
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("WEEKLY");
    await expect(page.locator("#bkNotes")).toHaveValue(/Bring capacitor approval paperwork/);
  });

  test("Today can draft a smarter follow-up request for a dormant repeat account", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(async () => {
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
        id: "customer_repeat_request",
        name: "Harbor Suites",
        email: "ops@example.com",
        maintenance_notes: "Spring maintenance visit due next month",
        parts_follow_up: "Bring capacitor approval paperwork",
        equipment_notes: "Carrier rooftop unit RTU-2",
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
    await reactivationCard.getByRole("button", { name: "Draft maintenance follow-up request" }).click();

    await expect(page.locator('[data-panel="leads"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#leadContactName")).toHaveValue("Harbor Suites");
    await expect(page.locator("#leadRequestedService")).toHaveValue("Maintenance follow-up");
    await expect(page.locator("#leadTitle")).toHaveValue("Harbor Suites maintenance follow-up");
    await expect(page.locator("#leadSummary")).toHaveValue(/Bring capacitor approval paperwork/);
    await expect(page.locator("#leadNotes")).toHaveValue(/Carrier rooftop unit RTU-2/);
  });

  test("Customer detail can reactivate a dormant HVAC account into a smarter booking draft", async ({ page }) => {
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
        id: "customer_repeat_detail",
        name: "Harbor Suites",
        email: "ops@example.com",
        maintenance_notes: "Spring maintenance visit due next month",
        parts_follow_up: "Bring capacitor approval paperwork",
        warranty_notes: "Warranty check should stay visible this month",
      }];
      CRM_ORDERS_CACHE = [];
      JOBS_CACHE = [];
      SERVICE_PLANS_CACHE = [];
      LEADS_CACHE = [];
      BIDS_CACHE = [];
      BOOKINGS_CACHE = [];
      PAYMENTS_CACHE = [];
      PRODUCTS_CACHE = [];
      EXPENSES_CACHE = [];
      ACTIVE_CUSTOMER_ID = "customer_repeat_detail";
      fetchCustomerInteractions = async () => [];
      renderCustomerDetail("customer_repeat_detail");
      switchTab("customers", { force: true });
    });

    const nextMoveCard = page.locator(".detail-card").filter({ hasText: "Best next move" });
    await expect(nextMoveCard).toContainText("Schedule next system visit");
    await nextMoveCard.getByRole("button", { name: "Schedule next system visit" }).click({ force: true });

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Harbor Suites");
    await expect(page.locator("#bkTitle")).toHaveValue("Harbor Suites maintenance visit");
    await expect(page.locator("#bkNotes")).toHaveValue(/Bring capacitor approval paperwork/);
    await expect(page.locator("#bkNotes")).toHaveValue(/Warranty check should stay visible this month/);
  });

  test("Recurring plans can recover repeat service into the smarter booking draft", async ({ page }) => {
    await loginAsTenantA(page);

    await page.evaluate(async () => {
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
        id: "customer_repeat_plan",
        name: "Harbor Suites",
        email: "ops@example.com",
        frequency: "Monthly maintenance",
        maintenance_notes: "Quarterly rooftop maintenance",
        parts_follow_up: "Bring filter quote for approval",
      }];
      SERVICE_PLANS_CACHE = [{
        id: "plan_repeat_1",
        customer_id: "customer_repeat_plan",
        title: "Quarterly rooftop maintenance",
        status: "active",
        cadence: "monthly",
        next_run_on: "2026-04-20",
        amount_cents: 12000,
        deposit_required_cents: 0,
        notes: "Coordinate RTU roof access with front desk",
      }];
      CRM_ORDERS_CACHE = [];
      JOBS_CACHE = [];
      LEADS_CACHE = [];
      BIDS_CACHE = [];
      BOOKINGS_CACHE = [];
      PAYMENTS_CACHE = [];
      PRODUCTS_CACHE = [];
      EXPENSES_CACHE = [];
      ACTIVE_PLAN_ID = "plan_repeat_1";
      renderPlans("");
      await renderPlanDetail("plan_repeat_1");
    });

    await page.waitForFunction(() => !!document.querySelector('[data-plan-reactivation-action="schedule-follow-up"]'));
    await page.evaluate(() => {
      document.querySelector('[data-plan-reactivation-action="schedule-follow-up"]')?.click();
    });

    await expect(page.locator('[data-panel="bookings"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bkCustomerName")).toHaveValue("Harbor Suites");
    await expect(page.locator("#bkTitle")).toHaveValue("Harbor Suites maintenance visit");
    await expect(page.locator("#bkDate")).toHaveValue("2026-04-20");
    await expect(page.locator("#bkRecurrenceRule")).toHaveValue("MONTHLY");
    await expect(page.locator("#bkNotes")).toHaveValue(/Quarterly rooftop maintenance/);
    await expect(page.locator("#bkNotes")).toHaveValue(/Bring filter quote for approval/);
    await expect(page.locator("#bkNotes")).toHaveValue(/Coordinate RTU roof access with front desk/);
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
