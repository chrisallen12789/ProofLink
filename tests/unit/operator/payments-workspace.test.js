"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeElement(overrides = {}) {
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    addEventListener: vi.fn(),
    appendChild: vi.fn(),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    insertAdjacentElement: vi.fn(),
    ...overrides,
  };
}

function loadPaymentsWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-payments-workspace.js"),
    "utf8"
  );

  const context = {
    console,
    window: {},
    CUSTOMERS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    JOBS_CACHE: [],
    PAYMENTS_CACHE: [],
    ACTIVE_ORDER_ID: "",
    ACTIVE_CUSTOMER_ID: "",
    ACTIVE_PAYMENT_ID: null,
    paymentCustomerId: makeElement(),
    paymentOrderId: makeElement(),
    paymentJobId: makeElement(),
    paymentFormTitle: makeElement(),
    paymentId: makeElement(),
    paymentMode: makeElement({ value: "cash" }),
    paymentStatus: makeElement({ value: "paid" }),
    paymentAmount: makeElement(),
    paymentPaidAt: makeElement(),
    paymentReference: makeElement(),
    paymentNote: makeElement(),
    paymentMsg: makeElement(),
    paymentsList: makeElement(),
    btnNewPayment: makeElement(),
    paymentForm: makeElement(),
    sortedCustomers: (rows) => rows,
    sortedPayments: (rows) => rows,
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    money: (value) => String(value),
    formatUsd: (value) => `$${value}`,
    formatDateOnly: (value) => String(value),
    formatPaymentMode: (value) => String(value),
    formatDateTime: (value) => String(value),
    titleCaseWords: (value) => String(value),
    getScheduledDateFromOrder: () => "",
    paymentAmountCents: (payment) => Number(payment.amount_total || payment.amount_subtotal || 0),
    isManualPaymentRecord: () => true,
    setInlineMessage: vi.fn((el, message = "") => {
      if (el) el.textContent = message;
    }),
    currentWorkspaceBlueprint: () => ({ business: { key: "service_business" } }),
    renderMoneyWorkspace: vi.fn(),
    renderOrders: vi.fn(),
    renderJobs: vi.fn(),
    renderCustomersList: vi.fn(),
    renderDashboard: vi.fn(),
    renderMoney: vi.fn(() => Promise.resolve()),
    renderGuidance: vi.fn(),
    renderCustomerDetail: vi.fn(() => Promise.resolve()),
    switchTab: vi.fn(),
    markWorkspaceClean: vi.fn(),
    fetchPayments: vi.fn(() => Promise.resolve()),
    fetchCustomers: vi.fn(() => Promise.resolve()),
    fetchCrmOrders: vi.fn(() => Promise.resolve()),
    fetchJobs: vi.fn(() => Promise.resolve()),
    requestOperatorFunction: vi.fn(() => Promise.resolve()),
    withTenantScope: (payload) => payload,
    opId: () => "operator_1",
    toCents: (value) => Math.round(Number(value || 0) * 100),
    toDateTimeLocalValue: () => "2026-03-27T10:00",
    toIsoDateTime: (value) => value,
    orderAmountDueCents: () => 0,
    formatCurrency: (value) => `$${value}`,
    sb: { from: vi.fn(() => ({ update: vi.fn(), insert: vi.fn() })) },
    OPERATOR_COLUMN: "operator_id",
    TENANT_COLUMN: "tenant_id",
    TENANT_ID: "tenant_1",
    customerSearch: makeElement(),
    jobSearch: makeElement(),
    document: {
      createElement: vi.fn(() => makeElement()),
    },
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator payments workspace", () => {
  test("payment save requests refresh-aware cache reloads for orders, payments, customers, and jobs", () => {
    const paymentsSource = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-payments-workspace.js"),
      "utf8"
    );

    expect(paymentsSource).toContain("fetchPayments({ refresh: true })");
    expect(paymentsSource).toContain("fetchCustomers({ refresh: true })");
    expect(paymentsSource).toContain("fetchCrmOrders({ refresh: true })");
    expect(paymentsSource).toContain("fetchJobs({ refresh: true })");
  });

  test("buildPaymentContextMessage reuses trade memory for the selected customer", () => {
    const context = loadPaymentsWorkspace({
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "Logan's Lawn Care" }],
      CRM_ORDERS_CACHE: [{ id: "order_1", customer_id: "customer_1", customer_name: "Logan's Lawn Care" }],
    });
    context.window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL = {
      customerMemoryChecklist: vi.fn(() => [
        { label: "Access notes", note: "Back gate code 2468", ready: true },
        { label: "Repeat-service memory", note: "Thursday afternoon route", ready: true },
      ]),
    };

    const message = context.window.buildPaymentContextMessage({
      customerId: "customer_1",
      orderId: "order_1",
    });

    expect(message).toContain("Recording payment for Logan's Lawn Care.");
    expect(message).toContain("Access notes: Back gate code 2468");
    expect(message).toContain("Repeat-service memory: Thursday afternoon route");
  });

  test("clearPaymentForm applies the payment context guidance to the form", () => {
    const context = loadPaymentsWorkspace({
      ACTIVE_CUSTOMER_ID: "customer_1",
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "Logan's Lawn Care" }],
      CRM_ORDERS_CACHE: [{ id: "order_1", customer_id: "customer_1", customer_name: "Logan's Lawn Care", payment_due_date: "2026-03-29" }],
    });

    context.window.clearPaymentForm({ customerId: "customer_1", orderId: "order_1" });

    expect(context.paymentMsg.textContent).toContain("Recording payment for Logan's Lawn Care.");
    expect(context.paymentMsg.textContent).toContain("2026-03-29");
  });

  test("buildPaymentFollowThroughMessage turns HVAC collection into the next system step", () => {
    const context = loadPaymentsWorkspace({
      currentWorkspaceBlueprint: () => ({ business: { key: "hvac" } }),
    });

    const message = context.window.buildPaymentFollowThroughMessage({
      customer: {
        maintenance_notes: "Spring maintenance visit due next month",
        parts_follow_up: "Capacitor approval still pending",
      },
      order: null,
      job: { id: "job_1", service_address: "455 Elm St" },
      blueprint: { business: { key: "hvac" } },
    });

    expect(message).toContain("Once this is paid");
    expect(message).toContain("Spring maintenance visit due next month");
  });

  test("buildPaymentSavedMessage turns a finished plumbing payment into the next repair step", () => {
    const context = loadPaymentsWorkspace({
      currentWorkspaceBlueprint: () => ({ business: { key: "plumbing" } }),
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "Harbor Suites", restoration_notes: "Drywall repair still needs scheduling" }],
      CRM_ORDERS_CACHE: [{ id: "order_1", customer_id: "customer_1", customer_name: "Harbor Suites" }],
      JOBS_CACHE: [{ id: "job_1", order_id: "order_1", service_address: "455 Elm St" }],
      orderAmountDueCents: () => 0,
      window: {
        PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE: {
          bookingDraftTimingInsight: vi.fn(() => ({
            reason: "This repair follow-up still has restoration or approval attached, so it should stay within the next few days.",
            bookingDate: "2026-04-02",
          })),
        },
      },
    });

    const message = context.window.buildPaymentSavedMessage({
      customerId: "customer_1",
      orderId: "order_1",
      jobId: "job_1",
      blueprint: { business: { key: "plumbing" } },
    });

    expect(message).toContain("Payment saved for Harbor Suites.");
    expect(message).toContain("Drywall repair still needs scheduling");
    expect(message).toContain("next few days");
    expect(message).toContain("Suggested next visit: 2026-04-02");
  });

  test("buildPaymentSavedMessage keeps a partial payment anchored to the remaining balance", () => {
    const context = loadPaymentsWorkspace({
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "North College" }],
      CRM_ORDERS_CACHE: [{ id: "order_1", customer_id: "customer_1", customer_name: "North College" }],
      orderAmountDueCents: () => 24000,
      window: {
        PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE: {
          bookingDraftTimingInsight: vi.fn(() => ({
            reason: "This should not be used while the balance is still open.",
            bookingDate: "2026-04-18",
          })),
        },
      },
    });

    const message = context.window.buildPaymentSavedMessage({
      customerId: "customer_1",
      orderId: "order_1",
    });

    expect(message).toContain("Payment saved for North College.");
    expect(message).toContain("$24000 still due on this order.");
    expect(message).not.toContain("Suggested next visit");
  });

  test("buildPaymentReactivationActions turns a paid cleaning account into the next visit", () => {
    const context = loadPaymentsWorkspace({
      currentWorkspaceBlueprint: () => ({ business: { key: "cleaning" } }),
      CUSTOMERS_CACHE: [{
        id: "customer_1",
        name: "Brightline Suites",
        recurring_notes: "Weekly lobby clean",
      }],
      CRM_ORDERS_CACHE: [{
        id: "order_1",
        customer_id: "customer_1",
        customer_name: "Brightline Suites",
        status: "paid",
      }],
      JOBS_CACHE: [],
      orderAmountDueCents: () => 0,
    });

    const actions = context.window.buildPaymentReactivationActions({
      customerId: "customer_1",
      orderId: "order_1",
      blueprint: { business: { key: "cleaning" } },
    });

    expect(actions.map((action) => action.label)).toEqual([
      "Schedule next cleaning visit",
      "Create cleaning follow-up request",
      "Open customer",
    ]);
  });

  test("renderPaymentNextActions can reopen repeat service from the payment flow", () => {
    const bookingOpen = vi.fn();
    const host = makeElement({
      querySelectorAll: vi.fn(() => [{
        getAttribute: () => "reactivate-repeat",
        addEventListener: vi.fn((event, handler) => {
          if (event === "click") handler();
        }),
      }]),
    });
    const paymentParent = makeElement({
      querySelector: vi.fn(() => host),
    });
    const context = loadPaymentsWorkspace({
      currentWorkspaceBlueprint: () => ({ business: { key: "hvac" } }),
      paymentMsg: makeElement({ parentElement: paymentParent }),
      CUSTOMERS_CACHE: [{
        id: "customer_1",
        name: "Harbor Suites",
        frequency: "Weekly maintenance",
      }],
      CRM_ORDERS_CACHE: [{
        id: "order_1",
        customer_id: "customer_1",
        customer_name: "Harbor Suites",
        status: "paid",
      }],
      window: {
        PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE: {
          bookingDraftTimingInsight: vi.fn(() => ({
            reason: "The maintenance window is opening for this system, so the next visit should be queued now.",
            bookingDate: "2026-04-15",
          })),
          openBookingDraftForCustomer: bookingOpen,
        },
      },
    });

    context.window.renderPaymentNextActions({
      customerId: "customer_1",
      orderId: "order_1",
      blueprint: { business: { key: "hvac" } },
    });

    expect(bookingOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: "customer_1" }),
      {},
      expect.objectContaining({ business: expect.objectContaining({ key: "hvac" }) })
    );
    expect(host.innerHTML).toContain("Why now: The maintenance window is opening for this system");
  });

  test("renderPaymentNextActions can create a follow-up request from the payment flow", () => {
    const openCustomerRetentionAction = vi.fn();
    const host = makeElement({
      querySelectorAll: vi.fn(() => [{
        getAttribute: () => "create-request",
        addEventListener: vi.fn((event, handler) => {
          if (event === "click") handler();
        }),
      }]),
    });
    const paymentParent = makeElement({
      querySelector: vi.fn(() => host),
    });
    const context = loadPaymentsWorkspace({
      currentWorkspaceBlueprint: () => ({ business: { key: "plumbing" } }),
      paymentMsg: makeElement({ parentElement: paymentParent }),
      CUSTOMERS_CACHE: [{
        id: "customer_1",
        name: "Harbor Suites",
        restoration_notes: "Drywall patch follow-up still needs scheduling",
      }],
      CRM_ORDERS_CACHE: [{
        id: "order_1",
        customer_id: "customer_1",
        customer_name: "Harbor Suites",
        status: "paid",
      }],
      window: {
        PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
          openCustomerRetentionAction,
        },
      },
    });

    context.window.renderPaymentNextActions({
      customerId: "customer_1",
      orderId: "order_1",
      blueprint: { business: { key: "plumbing" } },
    });

    expect(openCustomerRetentionAction).toHaveBeenCalledWith(
      "create-request",
      expect.objectContaining({ id: "customer_1" }),
      expect.objectContaining({ business: expect.objectContaining({ key: "plumbing" }) }),
      expect.objectContaining({
        requestOptions: expect.objectContaining({
          message: "Follow-up request created from the payment flow.",
          successMessage: "Follow-up request created from the payment flow.",
        }),
      })
    );
  });

  test("renderPaymentNextActions keeps partial-payment follow-through on the order balance", () => {
    const renderOrders = vi.fn();
    const switchTab = vi.fn();
    const host = makeElement({
      querySelectorAll: vi.fn(() => [{
        getAttribute: () => "open-outstanding-order",
        addEventListener: vi.fn((event, handler) => {
          if (event === "click") handler();
        }),
      }]),
    });
    const paymentParent = makeElement({
      querySelector: vi.fn(() => host),
    });
    const context = loadPaymentsWorkspace({
      paymentMsg: makeElement({ parentElement: paymentParent }),
      renderOrders,
      switchTab,
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "North College" }],
      CRM_ORDERS_CACHE: [{
        id: "order_1",
        customer_id: "customer_1",
        customer_name: "North College",
        status: "confirmed",
      }],
      orderAmountDueCents: () => 24000,
    });

    context.window.renderPaymentNextActions({
      customerId: "customer_1",
      orderId: "order_1",
    });

    expect(host.innerHTML).toContain("Balance still open: $24000 due on this order.");
    expect(host.innerHTML).toContain("Open order balance");
    expect(renderOrders).toHaveBeenCalled();
    expect(switchTab).toHaveBeenCalledWith("orders");
  });

  test("renderCollectionsFollowUpReport keeps payment, order, and customer actions visible", () => {
    const context = loadPaymentsWorkspace();

    const markup = context.window.renderCollectionsFollowUpReport({
      report: {
        summary: "The collections queue has 2 open balance records.",
        summary_status: "review_needed",
        findings: [{
          title: "North College has an overdue balance",
          detail: "The linked order has a proved due date in the past and still shows $240.00 outstanding.",
          severity: "warning",
          record_refs: [
            { record_type: "order", record_id: "order_1", label: "Campus plumbing" },
            { record_type: "customer", record_id: "customer_1", label: "North College" },
          ],
        }],
        blockers: [{
          title: "At least one overdue balance needs follow-up",
          detail: "The queue includes orders with past due dates and open balances.",
        }],
        recommended_actions: [{
          title: "Review the collections queue without overstating status",
          detail: "Start with orders that have a real due date in the past.",
          priority: "high",
        }],
        missing_data: [{
          id: "collections_missing_due_dates",
          label: "Some balances do not have a proved due date",
        }],
        data_used: [{ label: "Open balance orders", count: 2 }],
        confidence: { label: "medium" },
        generated_at: "2026-04-02T14:00:00Z",
      },
      context_summary: {
        queue_length: 2,
        overdue_count: 1,
        missing_due_dates: 1,
      },
    });

    expect(markup).toContain("Record payment");
    expect(markup).toContain("Open order");
    expect(markup).toContain("Open customer");
    expect(markup).toContain("1 overdue");
    expect(markup).toContain("missing due date");
  });
});
