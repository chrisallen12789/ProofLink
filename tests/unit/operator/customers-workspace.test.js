"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeField() {
  return {
    value: "",
    textContent: "",
    addEventListener: vi.fn(),
    requestSubmit: vi.fn(),
    focus: vi.fn(),
  };
}

function loadCustomersWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-customers-workspace.js"),
    "utf8"
  );

  const createdElements = [];
  const context = {
    console,
    window: {},
    document: {
      createElement: vi.fn(() => {
        const element = { addEventListener: vi.fn(), appendChild: vi.fn(), style: {} };
        createdElements.push(element);
        return element;
      }),
      getElementById: vi.fn(() => null),
    },
    FETCHING: new Set(),
    TABS_LOADED: new Set(),
    FETCH_OFFSETS: { customers: 0 },
    PAGE_SIZE: 50,
    CUSTOMERS_CACHE: [],
    CUSTOMERS_TOTAL_COUNT: 0,
    LEADS_CACHE: [],
    BIDS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    JOBS_CACHE: [],
    PAYMENTS_CACHE: [],
    CUSTOMER_CREATING: false,
    CUSTOMER_SAVE_ADD_ANOTHER: false,
    ACTIVE_CUSTOMER_ID: "",
    customerFormTitle: { textContent: "" },
    customerId: makeField(),
    customerCompanyName: makeField(),
    customerName: makeField(),
    customerEmail: makeField(),
    customerPhone: makeField(),
    customerPreferredContact: makeField(),
    customerNotes: makeField(),
    customerAddress1: makeField(),
    customerCity: makeField(),
    customerState: makeField(),
    customerZip: makeField(),
    btnClearCustomerForm: makeField(),
    customerMsg: {},
    customerDetailWrap: {},
    customersList: { innerHTML: "", appendChild: vi.fn() },
    customerSearch: makeField(),
    btnRefreshCustomers: makeField(),
    customerForm: makeField(),
    btnNewCustomer: makeField(),
    btnSaveAndAddCustomer: makeField(),
    sb: { from: vi.fn() },
    scopeQuery: vi.fn((query) => query),
    withTenantScope: (value) => value,
    opId: vi.fn(() => "operator_1"),
    OPERATOR_COLUMN: "operator_id",
    TENANT_COLUMN: "tenant_id",
    TENANT_ID: "tenant_123",
    renderCustomerDetailWorkspace: vi.fn(),
    renderPayments: vi.fn(),
    renderDashboard: vi.fn(),
    renderMoney: vi.fn(() => Promise.resolve()),
    sortedCustomers: vi.fn((rows) => rows),
    customerLifetimeValueCents: vi.fn(() => 0),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    formatUsd: vi.fn((value) => `$${value}`),
    formatDateTime: vi.fn(() => "Mar 24"),
    setInlineMessage: vi.fn(),
    markWorkspaceClean: vi.fn(),
    debounce: (fn) => fn,
    fetchCrmOrders: vi.fn(),
    fetchPayments: vi.fn(),
    notifyOperator: vi.fn(),
    paymentRevenueContributionCents: vi.fn(() => 0),
    __createdElements: createdElements,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator customers workspace", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-customers-workspace.js"),
    "utf8"
  );

  test("customerInputPayload normalizes casing and blanks", () => {
    const context = loadCustomersWorkspace();

    const payload = context.window.customerInputPayload({
      name: "",
      email: "logan@example.com",
      state: "tx",
      city: "Dallas",
      zip: "75201",
    });

    expect(payload.name).toBe("logan@example.com");
    expect(payload.state).toBe("TX");
    expect(payload.city).toBe("Dallas");
  });

  test("customerInteractionLabel falls back to title case", () => {
    const context = loadCustomersWorkspace();

    expect(context.window.customerInteractionLabel("follow_up")).toBe("Follow-up");
    expect(context.window.customerInteractionLabel("custom_note")).toBe("Custom Note");
  });

  test("initCustomersWorkspaceBindings only wires listeners once", () => {
    const context = loadCustomersWorkspace();

    context.window.initCustomersWorkspaceBindings();
    context.window.initCustomersWorkspaceBindings();

    expect(context.customerSearch.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.customerForm.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnNewCustomer.addEventListener).toHaveBeenCalledTimes(1);
  });

  test("keeps the empty customer state focused on the next useful step", () => {
    expect(source).toContain("No customers yet. Create one to start linking work and payments.");
    expect(source).not.toContain("No customer records available.");
  });

  test("uses compact customer view chips instead of a full stat-card strip", () => {
    expect(source).toContain("customer-filter-chip");
    expect(source).toContain("customer-workbench-toolbar__focus");
    expect(source).not.toContain("customer-stat-card__note");
  });

  test("renderCustomersList keeps each row focused on one signal and a short summary", () => {
    const context = loadCustomersWorkspace({
      CUSTOMERS_CACHE: [
        {
          id: "customer_1",
          company_name: "Pastor Scott",
          name: "Pastor Scott",
          email: "nmct6136@gmail.com",
          phone: "313-363-6613",
          order_count: 1,
          last_contact_at: "2026-03-24T16:04:00.000Z",
        },
      ],
      CUSTOMERS_TOTAL_COUNT: 1,
      LEADS_CACHE: [{ customer_id: "customer_1", status: "new", service_address: "" }],
      CRM_ORDERS_CACHE: [{ customer_id: "customer_1", status: "confirmed", total_cents: 227500, is_deleted: false }],
      PAYMENTS_CACHE: [{ customer_id: "customer_1", amount_cents: 0 }],
      customerLifetimeValueCents: vi.fn(() => 227500),
    });

    context.window.renderCustomersList("");

    const row = context.customersList.appendChild.mock.calls[0][0];
    expect(row.innerHTML).toContain("customer-list-item__signal");
    expect(row.innerHTML).toContain("customer-list-item__summary");
    expect(row.innerHTML).toContain("1 pipeline item");
    expect(row.innerHTML).not.toContain("customer-list-item__badges");
    expect(row.innerHTML).not.toContain("customer-list-item__submetrics");
  });
});
