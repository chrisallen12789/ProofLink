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

  const context = {
    console,
    window: {},
    document: { createElement: vi.fn(() => ({ addEventListener: vi.fn(), appendChild: vi.fn() })) },
    FETCHING: new Set(),
    TABS_LOADED: new Set(),
    FETCH_OFFSETS: { customers: 0 },
    PAGE_SIZE: 50,
    CUSTOMERS_CACHE: [],
    CUSTOMERS_TOTAL_COUNT: 0,
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
    formatUsd: vi.fn((value) => `$${value}`),
    setInlineMessage: vi.fn(),
    markWorkspaceClean: vi.fn(),
    debounce: (fn) => fn,
    fetchCrmOrders: vi.fn(),
    fetchPayments: vi.fn(),
    notifyOperator: vi.fn(),
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
      company_name: "Dallas Municipal Services",
      email: "logan@example.com",
      state: "tx",
      city: "Dallas",
      zip: "75201",
    });

    expect(payload.company_name).toBe("Dallas Municipal Services");
    expect(payload.name).toBe("Dallas Municipal Services");
    expect(payload.state).toBe("TX");
    expect(payload.city).toBe("Dallas");
  });

  test("customerInputPayload falls back to the account name when there is no contact yet", () => {
    const context = loadCustomersWorkspace();

    const payload = context.window.customerInputPayload({
      company_name: "North Campus Facilities",
      name: "",
      email: "",
      phone: "",
    });

    expect(payload.name).toBe("North Campus Facilities");
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
});
