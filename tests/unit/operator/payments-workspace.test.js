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
    markWorkspaceClean: vi.fn(),
    fetchPayments: vi.fn(() => Promise.resolve()),
    fetchCustomers: vi.fn(() => Promise.resolve()),
    fetchCrmOrders: vi.fn(() => Promise.resolve()),
    fetchJobs: vi.fn(() => Promise.resolve()),
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
    });

    const message = context.window.buildPaymentSavedMessage({
      customerId: "customer_1",
      orderId: "order_1",
      jobId: "job_1",
      blueprint: { business: { key: "plumbing" } },
    });

    expect(message).toContain("Payment saved for Harbor Suites.");
    expect(message).toContain("Drywall repair still needs scheduling");
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
      "Open customer",
    ]);
  });
});
