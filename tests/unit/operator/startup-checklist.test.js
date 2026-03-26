"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadStartupChecklist(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-startup-checklist.js"),
    "utf8"
  );

  const listeners = new Map();
  const startupChecklist = {
    innerHTML: "",
    addEventListener: vi.fn((event, handler) => listeners.set(event, handler)),
  };

  const context = {
    console,
    window: {},
    startupChecklist,
    PRODUCTS_CACHE: [],
    CUSTOMERS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    EXPENSES_CACHE: [],
    PAYMENTS_CACHE: [],
    BIDS_CACHE: [],
    SERVICE_PLANS_CACHE: [],
    SETUP_STATE: { config: {} },
    currentWorkspaceBlueprint: vi.fn(() => ({ business: { key: "landscaping" } })),
    workspaceCatalogSingular: vi.fn(() => "service template"),
    workspaceTabLabel: vi.fn((tab) => `Label ${tab}`),
    workspaceOrderLabelLower: vi.fn(() => "jobs"),
    workspaceUsesServiceCatalog: vi.fn(() => true),
    isServiceWorkspace: vi.fn(() => true),
    isTabVisibleInWorkspace: vi.fn((tab) => tab !== "plans"),
    workspaceBidLabel: vi.fn(() => "Walkthrough Bids"),
    hasPricedBidDraft: vi.fn(() => false),
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    switchTab: vi.fn(),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, startupChecklist, listeners };
}

describe("operator startup checklist", () => {
  test("renderStartupChecklist uses first-win language and import guidance", () => {
    const { context, startupChecklist } = loadStartupChecklist({
      PRODUCTS_CACHE: [{ id: "prod_1", is_active: true, pricing_mode: "fixed", sell_price_cents: 25000 }],
      BIDS_CACHE: [{ id: "bid_1" }],
      CUSTOMERS_CACHE: [{ id: "customer_1" }],
    });

    context.window.renderStartupChecklist();

    expect(startupChecklist.innerHTML).toContain("Bring over customers, open work, or payment history");
    expect(startupChecklist.innerHTML).toContain("Create your first quote draft");
    expect(startupChecklist.innerHTML).toContain("Add your first customer");
  });

  test("initStartupChecklistBindings routes checklist clicks into tab changes", () => {
    const { context, listeners } = loadStartupChecklist();

    context.window.initStartupChecklistBindings();
    const clickHandler = listeners.get("click");
    clickHandler({
      target: {
        closest: () => ({
          getAttribute: () => "customers",
        }),
      },
    });

    expect(context.switchTab).toHaveBeenCalledWith("customers");
  });
});
