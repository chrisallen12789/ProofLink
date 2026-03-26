"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadOrderTools(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-orders-tools.js"),
    "utf8"
  );

  const elements = {
    bulkStatusBar: { style: {} },
    bulkSelectedCount: { textContent: "" },
    btnNewOrderManual: { addEventListener: vi.fn() },
    btnExportOrdersCsv: { addEventListener: vi.fn() },
    btnBulkStatusApply: { addEventListener: vi.fn() },
    btnBulkClear: { addEventListener: vi.fn() },
    bulkStatusSelect: { value: "" },
    bulkMsg: { textContent: "", className: "" },
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    Blob,
    Date,
    Set,
    URL: {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    },
    document: {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => ({
        style: {},
        remove: vi.fn(),
        click: vi.fn(),
        set href(value) { this._href = value; },
        set download(value) { this._download = value; },
      })),
      getElementById: vi.fn(() => null),
    },
    window: {},
    $: (id) => elements[id] || null,
    CRM_ORDERS_CACHE: [],
    BULK_SELECTED_ORDER_IDS: new Set(),
    TABS_LOADED: new Set(),
    FETCH_OFFSETS: { orders: 0 },
    TENANT_ID: "tenant_123",
    TENANT_COLUMN: "tenant_id",
    OPERATOR_COLUMN: "operator_id",
    opId: () => "operator_123",
    sb: { from: vi.fn() },
    withTenantScope: (value) => value,
    renderOrders: vi.fn(),
    renderDashboard: vi.fn(),
    renderGuidance: vi.fn(),
    renderJobs: vi.fn(),
    renderPlans: vi.fn(),
    fetchCrmOrders: vi.fn(),
    fetchJobs: vi.fn(),
    fetchServicePlans: vi.fn(),
    notifyOperator: vi.fn(),
    showConfirmModal: vi.fn(async () => true),
    setInlineMessage: vi.fn(),
    showToast: vi.fn(),
    downloadCsv: vi.fn(),
    jobSearch: { value: "" },
    planSearch: { value: "" },
    btnRefreshOrders: { addEventListener: vi.fn() },
    btnRefreshGuidance: { addEventListener: vi.fn() },
    btnExportOrders: { addEventListener: vi.fn() },
    btnImportBridgeOrders: { hidden: false, disabled: false },
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements };
}

describe("operator order tools", () => {
  test("updateBulkBar reflects current selection count", () => {
    const { context, elements } = loadOrderTools();

    context.BULK_SELECTED_ORDER_IDS.add("a");
    context.BULK_SELECTED_ORDER_IDS.add("b");
    context.window.updateBulkBar();

    expect(elements.bulkStatusBar.style.display).toBe("flex");
    expect(elements.bulkSelectedCount.textContent).toBe("2 selected");

    context.BULK_SELECTED_ORDER_IDS.clear();
    context.window.updateBulkBar();

    expect(elements.bulkStatusBar.style.display).toBe("none");
    expect(elements.bulkSelectedCount.textContent).toBe("0 selected");
  });

  test("bridge import button is hidden when the module loads", () => {
    const { context } = loadOrderTools();

    expect(context.btnImportBridgeOrders.hidden).toBe(true);
    expect(context.btnImportBridgeOrders.disabled).toBe(true);
  });
});
