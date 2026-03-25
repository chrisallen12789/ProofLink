"use strict";

const { test, expect } = require("@playwright/test");
const { loadTestEnv } = require("../setup/env.test");
const { TENANTS, createAdminClient } = require("../setup/test-helpers");
const {
  assertServiceWorkflowTablesReady,
  getServiceWorkflowFoundationStatus,
  serviceWorkflowStamp,
  waitForOrderPaymentState,
} = require("../setup/service-workflow-helpers");

loadTestEnv();

test.describe.serial("service workflow e2e", () => {
  test.setTimeout(90000);
  const created = {
    payments: new Set(),
    jobs: new Set(),
    orders: new Set(),
    bids: new Set(),
    leads: new Set(),
    customers: new Set(),
  };
  const state = {
    stamp: serviceWorkflowStamp("e2e-service"),
    customerName: "",
    customerEmail: "",
    leadId: null,
    customerId: null,
    bidId: null,
    bidTitle: "",
    orderId: null,
    jobId: null,
    overdueCustomerName: "",
    overdueCustomerId: null,
    overdueOrderId: null,
    overdueJobId: null,
    tenantId: null,
    operatorId: null,
  };

  function remember(table, id) {
    if (id && created[table]) created[table].add(id);
  }

  async function cleanupCreatedRecords() {
    const admin = createAdminClient();
    const deleteIfNeeded = async (table, ids) => {
      const values = [...ids].filter(Boolean);
      if (!values.length) return;
      const { error } = await admin.from(table).delete().in("id", values);
      if (error) throw error;
      ids.clear();
    };

    await deleteIfNeeded("payments", created.payments);
    await deleteIfNeeded("jobs", created.jobs);
    await deleteIfNeeded("orders", created.orders);
    await deleteIfNeeded("bids", created.bids);
    await deleteIfNeeded("leads", created.leads);
    await deleteIfNeeded("customers", created.customers);
  }

  async function suppressTour(page) {
    await page.addInitScript(() => {
      window.localStorage.setItem("pl_tour_v1", "1");
    });
  }

  async function dismissTourIfVisible(page) {
    const tourModal = page.locator("#tourModal");
    const isVisible = await tourModal.isVisible().catch(() => false);
    if (!isVisible) return;
    await page.evaluate(() => {
      window.tourFinish?.();
    });
    await expect(tourModal).toBeHidden();
  }

  async function loginAsTenantA(page) {
    await suppressTour(page);
    await page.goto("/operator/");
    await page.locator("#loginForm").waitFor();
    await page.locator("#loginEmail").fill(process.env.TEST_TENANT_A_ADMIN_EMAIL);
    await page.locator("#loginPassword").fill(process.env.TEST_TENANT_A_ADMIN_PASSWORD);
    await page.locator("#loginForm button[type='submit']").click();
    await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 20000 });
    await expect(page.locator('[data-panel="dashboard"]:not(.hidden) h2')).toHaveText("Today", { timeout: 20000 });
    await dismissTourIfVisible(page);
    await page.waitForFunction(() => {
      if (window.PROOFLINK_BOOT_READY === true) return true;
      const viewApp = document.getElementById("viewApp");
      const viewLogin = document.getElementById("viewLogin");
      return !!viewApp
        && !viewApp.classList.contains("hidden")
        && (!viewLogin || viewLogin.classList.contains("hidden"));
    }, null, { timeout: 45000 });
  }

  async function loginAsTenantB(page) {
    await suppressTour(page);
    await page.goto("/operator/");
    await page.locator("#loginForm").waitFor();
    await page.locator("#loginEmail").fill(process.env.TEST_TENANT_B_ADMIN_EMAIL);
    await page.locator("#loginPassword").fill(process.env.TEST_TENANT_B_ADMIN_PASSWORD);
    await page.locator("#loginForm button[type='submit']").click();
    await expect(page.locator("#viewLogin")).toBeHidden({ timeout: 20000 });
    await expect(page.locator('[data-panel="dashboard"]:not(.hidden) h2')).toHaveText("Today", { timeout: 20000 });
    await dismissTourIfVisible(page);
    await page.waitForFunction(() => {
      if (window.PROOFLINK_BOOT_READY === true) return true;
      const viewApp = document.getElementById("viewApp");
      const viewLogin = document.getElementById("viewLogin");
      return !!viewApp
        && !viewApp.classList.contains("hidden")
        && (!viewLogin || viewLogin.classList.contains("hidden"));
    }, null, { timeout: 45000 });
  }

  async function openTab(page, tabName) {
    await page.locator(`button.tab[data-tab="${tabName}"]`).click();
  }

  async function tenantContext() {
    const admin = createAdminClient();
    const tenant = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    if (tenant.error) throw tenant.error;
    const operator = await admin.from("operators").select("id").eq("email", process.env.TEST_TENANT_A_ADMIN_EMAIL).single();
    if (operator.error) throw operator.error;
    state.tenantId = tenant.data.id;
    state.operatorId = operator.data.id;
    return admin;
  }

  async function waitForSingleRow(admin, table, column, value, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = await admin.from(table).select("*").eq(column, value);
      if (result.error) throw result.error;
      if (Array.isArray(result.data) && result.data.length === 1) return result.data[0];
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${table}.${column}=${value}`);
  }

  async function waitForBidRow(admin, leadId, predicate, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = await admin.from("bids").select("*").eq("lead_id", leadId);
      if (result.error) throw result.error;
      if (Array.isArray(result.data) && result.data.length === 1 && predicate(result.data[0])) {
        return result.data[0];
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for synced bid state for lead ${leadId}`);
  }

  async function waitForOrderRow(admin, orderId, predicate, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = await admin.from("orders").select("*").eq("id", orderId).single();
      if (result.error) throw result.error;
      if (result.data && predicate(result.data)) return result.data;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for synced order state for ${orderId}`);
  }

  async function createOverdueJobCompat(admin, orderId) {
    const rpcResult = await admin.rpc("create_job_from_order", { p_order_id: orderId });
    if (!rpcResult.error) return rpcResult.data;

    const status = await getServiceWorkflowFoundationStatus();
    const rpcMessage = String(rpcResult.error?.message || "").toLowerCase();
    const serviceRoleAccessMismatch = rpcMessage.includes("create_job_from_order: forbidden");
    if (status.functions.create_job_from_order && !serviceRoleAccessMismatch) throw rpcResult.error;

    const orderLookup = await admin.from("orders").select("*").eq("id", orderId).single();
    if (orderLookup.error) throw orderLookup.error;
    const order = orderLookup.data;
    const customerLookup = await admin.from("customers").select("*").eq("id", order.customer_id).single();
    if (customerLookup.error) throw customerLookup.error;
    const customer = customerLookup.data;
    const nowIso = new Date().toISOString();
    const jobInsert = await admin.from("jobs").insert({
      tenant_id: order.tenant_id,
      operator_id: order.operator_id,
      order_id: order.id,
      customer_id: order.customer_id,
      bid_id: order.bid_id || null,
      status: "scheduled",
      title: order.cart_summary || "Service job",
      service_address: customer.service_address || customer.billing_address || null,
      scheduled_date: order.scheduled_date || null,
      scheduled_time: order.scheduled_time || null,
      summary: order.cart_summary || "Tracked service work",
      notes: order.notes || null,
      payment_state: order.payment_state || "unpaid",
      amount_paid_cents: order.amount_paid_cents || 0,
      amount_due_cents: order.amount_due_cents || 0,
      created_at: nowIso,
      updated_at: nowIso,
    }).select("id").single();
    if (jobInsert.error) throw jobInsert.error;

    const orderUpdate = await admin.from("orders").update({
      primary_job_id: jobInsert.data.id,
      booked_at: order.booked_at || nowIso,
      status: ["new", "quoted"].includes(String(order.status || "").toLowerCase()) ? "confirmed" : order.status,
      updated_at: nowIso,
    }).eq("id", order.id).select("id").single();
    if (orderUpdate.error) throw orderUpdate.error;

    return { ok: true, job_id: jobInsert.data.id, existing: false };
  }

  test.beforeAll(async () => {
    await assertServiceWorkflowTablesReady();
    await tenantContext();
    state.customerName = `PL Test E2E ${state.stamp}`;
    state.customerEmail = `${state.stamp}@example.com`;
    state.bidTitle = `Pressure wash proposal ${state.stamp}`;
  });

  test.afterAll(async () => {
    await cleanupCreatedRecords();
  });

  test("submit service request and show the lead in operator", async ({ page }) => {
    const admin = createAdminClient();
    const response = await page.request.post("/.netlify/functions/service-intake", {
      data: {
        tenant_slug: TENANTS.tenantA.slug,
        customer_name: state.customerName,
        email: state.customerEmail,
        phone: "555-777-1111",
        summary: `Exterior cleaning request ${state.stamp}`,
        requested_service_type: "Pressure washing",
        service_address: "808 Wash Way, Detroit, MI",
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    state.leadId = body.lead_id;
    state.customerId = body.customer_id;
    remember("leads", state.leadId);
    remember("customers", state.customerId);

    const lead = await admin.from("leads").select("id,customer_id,tenant_id").eq("id", state.leadId).single();
    expect(lead.error).toBeNull();
    expect(lead.data.customer_id).toBe(state.customerId);
    expect(lead.data.tenant_id).toBe(state.tenantId);

    await loginAsTenantA(page);
    await openTab(page, "leads");
    await expect(page.locator("#leadsList")).toContainText(state.customerName);
  });

  test("convert the lead into a bid and keep DB linkage intact", async ({ page }) => {
    const admin = createAdminClient();

    await loginAsTenantA(page);
    await openTab(page, "leads");
    await page.locator("#leadsList").getByText(state.customerName).click();
    await page.locator("#btnLeadCreateBid").click();

    await expect(page.locator('[data-panel="bids"]')).not.toHaveClass(/hidden/);
    await expect(page.locator("#bidTitle")).toBeVisible();
    await page.locator("#bidTitle").fill(state.bidTitle);
    await page.locator("#bidProjectSummary").fill(`Exterior wash proposal ${state.stamp}`);
    await page.locator("#bidStatus").selectOption("walkthrough_complete");
    await page.locator("#bidForm").getByRole("button", { name: "Save bid" }).click();

    await expect(page.locator("#bidMsg")).toContainText(/saved/i);

    const bidRow = await waitForBidRow(
      admin,
      state.leadId,
      (row) => row.customer_id === state.customerId,
    );
    state.bidId = bidRow.id;
    remember("bids", state.bidId);
    expect(bidRow.customer_id).toBe(state.customerId);
  });

  test("convert the bid into a tracked order without duplication or data loss", async ({ page }) => {
    const admin = createAdminClient();

    await loginAsTenantA(page);
    await openTab(page, "leads");
    await page.locator("#leadSearch").fill(state.stamp);
    await page.locator("#leadsList").getByText(state.customerName).click();
    await page.locator("#btnLeadOpenBid").click();
    await expect(page.locator('[data-panel="bids"]')).not.toHaveClass(/hidden/);
    await page.locator("#bidStatus").selectOption("approved");
    await page.locator("#bidDepositAmount").fill("100.00");
    await page.locator("#bidForm").getByRole("button", { name: "Save bid" }).click();
    await expect(page.locator("#bidMsg")).toContainText(/saved/i);

    await page.locator("#bidLineItemName").fill("House wash");
    await page.locator("#bidLineItemDescription").fill("Soft wash siding and exterior trim");
    await page.locator("#bidLineItemUnitPrice").fill("350.00");
    await page.locator("#bidLineItemForm").getByRole("button", { name: "Save line item" }).click();
    await expect(page.locator("#bidLineItemMsg")).toContainText(/saved/i);

    await page.locator("#btnConvertBidToOrder").click();
    const orderRow = await waitForSingleRow(admin, "orders", "bid_id", state.bidId);
    state.orderId = orderRow.id;
    remember("orders", state.orderId);
    await expect(page.locator('[data-panel="orders"]')).not.toHaveClass(/hidden/);
    await expect(page.locator(`#ordersList button[data-order-id="${state.orderId}"]`)).toBeVisible({ timeout: 15000 });

    expect(orderRow.lead_id).toBe(state.leadId);
    expect(orderRow.customer_id).toBe(state.customerId);
    expect(orderRow.total_cents).toBe(35000);
  });

  test("convert the order into a job and show it in the pipeline", async ({ page }) => {
    const admin = createAdminClient();

    await loginAsTenantA(page);
    await openTab(page, "orders");
    await page.locator(`#ordersList button[data-order-id="${state.orderId}"]`).click();
    await page.locator("#orderDepositOverrideReason").fill("E2E validation override to complete the workflow handoff.");
    await page.locator("#btnSaveOrderDepositSettings").click();
    await waitForOrderRow(
      admin,
      state.orderId,
      (row) => String(row.deposit_override_reason || "").includes("E2E validation override"),
    );
    await page.locator("#btnCreateJobFromOrder").click();

    const jobRow = await waitForSingleRow(admin, "jobs", "order_id", state.orderId);
    state.jobId = jobRow.id;
    remember("jobs", state.jobId);
    await openTab(page, "jobs");
    await expect(page.locator(`#jobsList [data-job-id="${state.jobId}"]`)).toBeVisible();
    expect(jobRow.customer_id).toBe(state.customerId);
  });

  test("record a partial payment and show partially paid state in the UI", async ({ page }) => {
    const admin = createAdminClient();

    await loginAsTenantA(page);
    await openTab(page, "orders");
    await page.locator(`#ordersList button[data-order-id="${state.orderId}"]`).click();
    await page.locator("#btnRecordOrderPayment").click();

    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await page.locator("#paymentAmount").fill("150.00");
    await page.locator("#paymentForm").getByRole("button", { name: "Save payment" }).click();

    const partialState = await waitForOrderPaymentState(admin, state.orderId, "partially_paid");
    expect(partialState.amount_due_cents).toBe(20000);

    const paymentRows = await admin.from("payments").select("id").eq("order_id", state.orderId);
    expect(paymentRows.error).toBeNull();
    paymentRows.data.forEach((row) => remember("payments", row.id));

    await openTab(page, "orders");
    await page.locator(`#ordersList button[data-order-id="${state.orderId}"]`).click();
    await expect(page.locator("#orderDetailWrap")).toContainText("Payment state: Partially paid");
  });

  test("complete payment and show paid state in the UI", async ({ page }) => {
    const admin = createAdminClient();

    await loginAsTenantA(page);
    await openTab(page, "orders");
    await page.locator(`#ordersList button[data-order-id="${state.orderId}"]`).click();
    await page.locator("#btnRecordOrderPayment").click();

    await page.locator("#paymentAmount").fill("200.00");
    await page.locator("#paymentForm").getByRole("button", { name: "Save payment" }).click();

    const paidState = await waitForOrderPaymentState(admin, state.orderId, "paid");
    expect(paidState.amount_due_cents).toBe(0);

    const paymentRows = await admin.from("payments").select("id").eq("order_id", state.orderId);
    expect(paymentRows.error).toBeNull();
    paymentRows.data.forEach((row) => remember("payments", row.id));

    await openTab(page, "orders");
    await page.locator(`#ordersList button[data-order-id="${state.orderId}"]`).click();
    await expect(page.locator("#orderDetailWrap")).toContainText("Payment state: Paid");
  });

  test("simulate overdue and show overdue state in the UI", async ({ page }) => {
    const admin = createAdminClient();
    state.overdueCustomerName = `PL Test Overdue ${state.stamp}`;

    const overdueCustomer = await admin.from("customers").insert({
      tenant_id: state.tenantId,
      operator_id: state.operatorId,
      name: state.overdueCustomerName,
      email: `${state.stamp}.overdue@example.com`,
      phone: "555-888-2222",
      preferred_contact: "email",
      service_address: "909 Overdue Street, Detroit, MI",
      notes: `Overdue fixture ${state.stamp}`,
    }).select("id").single();
    expect(overdueCustomer.error).toBeNull();
    state.overdueCustomerId = overdueCustomer.data.id;
    remember("customers", state.overdueCustomerId);

    const overdueOrder = await admin.from("orders").insert({
      tenant_id: state.tenantId,
      operator_id: state.operatorId,
      customer_id: state.overdueCustomerId,
      status: "confirmed",
      fulfillment: "service",
      items: [{ name: "Overdue wash", quantity: 1, unit: "job" }],
      subtotal_cents: 12500,
      total_cents: 12500,
      estimated_total_cents: 12500,
      item_count: 1,
      unpriced_count: 0,
      cart_summary: `Overdue order ${state.stamp}`,
      customer_name: state.overdueCustomerName,
      email: `${state.stamp}.overdue@example.com`,
      phone: "555-888-2222",
      preferred_contact: "email",
      source_type: "e2e_fixture",
      source_ref: state.stamp,
      payment_due_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    }).select("id").single();
    expect(overdueOrder.error).toBeNull();
    state.overdueOrderId = overdueOrder.data.id;
    remember("orders", state.overdueOrderId);

    const overdueJob = await createOverdueJobCompat(admin, state.overdueOrderId);
    state.overdueJobId = overdueJob.job_id;
    remember("jobs", state.overdueJobId);

    const overdueRecompute = await admin.rpc("recompute_order_payment_state", { p_order_id: state.overdueOrderId });
    expect(overdueRecompute.error).toBeNull();
    await waitForOrderPaymentState(admin, state.overdueOrderId, "overdue");

    await loginAsTenantA(page);
    await openTab(page, "orders");
    await page.locator(`#ordersList button[data-order-id="${state.overdueOrderId}"]`).click();
    await expect(page.locator("#orderDetailWrap")).toContainText("Payment state: Overdue");
  });

  test("switch tenant context and keep tenant A workflow data isolated", async ({ page }) => {
    await loginAsTenantB(page);

    await openTab(page, "leads");
    await page.locator("#leadSearch").fill(state.stamp);
    await expect(page.locator("#leadsList")).not.toContainText(state.customerName);

    await openTab(page, "bids");
    await page.locator("#bidSearch").fill(state.stamp);
    await expect(page.locator("#bidsList")).not.toContainText(state.bidTitle);

    await openTab(page, "jobs");
    await page.locator("#jobSearch").fill(state.stamp);
    await expect(page.locator("#jobsList")).not.toContainText(state.customerName);
    await expect(page.locator("#jobsList")).not.toContainText(state.overdueCustomerName);

    await openTab(page, "orders");
    await expect(page.locator("#ordersList")).not.toContainText(state.customerName);
    await expect(page.locator("#ordersList")).not.toContainText(state.overdueCustomerName);
  });
});
