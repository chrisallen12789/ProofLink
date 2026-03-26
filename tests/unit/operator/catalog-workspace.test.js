"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeButton() {
  return {
    addEventListener: vi.fn(),
  };
}

function loadCatalogWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-catalog-workspace.js"),
    "utf8"
  );

  const elementMap = {
    availabilityLimitToggle: { checked: true, addEventListener: vi.fn() },
    availabilityMaxOrders: { value: "3", disabled: false, addEventListener: vi.fn() },
    availabilityTimezone: { value: "America/New_York", addEventListener: vi.fn() },
    availabilityLeadTime: { value: "24", addEventListener: vi.fn() },
    availabilityNotes: { value: "Weekday scheduling only", addEventListener: vi.fn() },
    availabilitySummaryText: { textContent: "" },
    availabilityBlackoutDatesData: { value: "[]" },
    availabilityBlackoutDatePicker: { value: "" },
    btnAddAvailabilityBlackout: makeButton(),
    btnCopyMondayToWeekdays: makeButton(),
    btnSetWeekdaysStandard: makeButton(),
    btnCopyWeekdaysToWeekend: makeButton(),
    btnClearWeekend: makeButton(),
  };

  const context = {
    console,
    window: {},
    Set,
    document: {
      createElement: vi.fn(() => ({
        className: "",
        innerHTML: "",
        setAttribute: vi.fn(),
        addEventListener: vi.fn(),
        appendChild: vi.fn(),
        classList: { add: vi.fn() },
      })),
      querySelector: vi.fn((selector) => {
        const enabled = selector.match(/\.availability-day-enabled\[data-day="([^"]+)"\]/);
        if (enabled) {
          return { checked: enabled[1] !== "sunday" };
        }
        const start = selector.match(/\.availability-day-start\[data-day="([^"]+)"\]/);
        if (start) {
          return { value: start[1] === "sunday" ? "09:00" : "08:00" };
        }
        const end = selector.match(/\.availability-day-end\[data-day="([^"]+)"\]/);
        if (end) {
          return { value: end[1] === "sunday" ? "17:00" : "17:00" };
        }
        return null;
      }),
    },
    CSS: { escape: (value) => value },
    PRODUCTS_CACHE: [],
    PRICING_CACHE: [],
    AVAILABILITY: null,
    availabilityWrap: {
      innerHTML: "",
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
    },
    productsList: { innerHTML: "", appendChild: vi.fn(), querySelectorAll: vi.fn(() => []) },
    pricingList: { innerHTML: "", appendChild: vi.fn(), querySelectorAll: vi.fn(() => []), querySelector: vi.fn(() => null) },
    productName: { value: "", addEventListener: vi.fn() },
    productId: { value: "" },
    productSlug: { value: "" },
    productSearch: { value: "", addEventListener: vi.fn() },
    servicePresetPack: { addEventListener: vi.fn() },
    btnLoadRecommendedServices: makeButton(),
    btnRefreshProducts: makeButton(),
    btnNewProduct: makeButton(),
    productForm: { addEventListener: vi.fn() },
    btnArchiveProduct: makeButton(),
    productImageFile: null,
    btnUploadProductImage: makeButton(),
    btnRefreshPricing: makeButton(),
    btnRefreshAvailability: makeButton(),
    btnSaveAvailability: makeButton(),
    productMsg: { textContent: "" },
    availabilityMsg: { textContent: "" },
    productCategory: { value: "" },
    productDescription: { value: "" },
    productTags: { value: "" },
    productImageUrl: { value: "" },
    productIsActive: { checked: true },
    productIsAvailable: { checked: true },
    productSort: { value: "0" },
    PICK_PRODUCT_CATEGORIES: [],
    $: (id) => elementMap[id] || null,
    opId: () => "operator_123",
    normalizeAvailability: vi.fn((payload) => ({ ...payload, normalized: true })),
    getAvailabilityBlackoutDatesFromUi: vi.fn(() => []),
    prettifyDay: (value) => value,
    slugify: (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "-"),
    debounce: (fn) => fn,
    renderServicePresetPicker: vi.fn(),
    renderBidCatalogStarters: vi.fn(),
    refreshPicklists: vi.fn(async () => {}),
    renderStartupChecklist: vi.fn(),
    currentBid: vi.fn(() => null),
    notifyOperator: vi.fn(),
    withTenantScope: (value) => value,
    safeFilename: (value) => String(value || ""),
    FETCHING: new Set(),
    scopeQuery: vi.fn((query) => query),
    sb: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: { id: "product_1" }, error: null })),
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
          getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://cdn.example/item.png" } })),
        })),
      },
    },
    money: (value) => (Number(value || 0) / 100).toFixed(2),
    toCents: (value) => Math.round(Number(value || 0) * 100),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    fetchAvailability: vi.fn(async () => ({})),
    markWorkspaceClean: vi.fn(),
    TENANT_COLUMN: "tenant_id",
    OPERATOR_COLUMN: "operator_id",
    TENANT_ID: "tenant_123",
    AVAILABILITY_TIMEZONES: [{ value: "America/New_York", label: "Eastern" }],
    AVAILABILITY_LEAD_TIMES: [{ value: 24, label: "1 day" }],
    availabilitySummaryText: vi.fn(() => "Weekdays 8 to 5"),
    buildAvailabilityCalendarCells: vi.fn(() => []),
    buildPrepOutlook: vi.fn(() => ({ upcoming: [], topItems: [], topIngredients: [], unscheduled: [] })),
    renderBlackoutDateItems: vi.fn(() => ""),
    syncBlackoutDateUi: vi.fn(),
    copyDaySchedule: vi.fn(),
    setAvailabilityDay: vi.fn(),
    formatTime12: (value) => value,
    formatUsd: (value) => `$${value}`,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator catalog workspace", () => {
  test("normalizePricingModeForUi prefers stored cents over raw mode", () => {
    const context = loadCatalogWorkspace();

    expect(context.window.normalizePricingModeForUi({ sell_price_cents: 2500, pricing_mode: "quote" })).toBe("fixed");
    expect(context.window.normalizePricingModeForUi({ starting_price_cents: 900, pricing_mode: "fixed" })).toBe("starts_at");
    expect(context.window.normalizePricingModeForUi({ pricing_mode: "quote" })).toBe("quote");
  });

  test("collectAvailabilityFromForm builds a normalized payload", () => {
    const context = loadCatalogWorkspace();

    const payload = context.window.collectAvailabilityFromForm();

    expect(context.normalizeAvailability).toHaveBeenCalled();
    expect(payload.timezone).toBe("America/New_York");
    expect(payload.max_orders_per_day).toBe(3);
    expect(payload.normalized).toBe(true);
    expect(payload.rules).toHaveLength(7);
  });

  test("collectAvailabilityFromForm rejects inverted day ranges", () => {
    const context = loadCatalogWorkspace({
      document: {
        createElement: vi.fn(),
        querySelector: vi.fn((selector) => {
          const enabled = selector.match(/\.availability-day-enabled\[data-day="([^"]+)"\]/);
          if (enabled) return { checked: enabled[1] === "monday" };
          const start = selector.match(/\.availability-day-start\[data-day="([^"]+)"\]/);
          if (start) return { value: "17:00" };
          const end = selector.match(/\.availability-day-end\[data-day="([^"]+)"\]/);
          if (end) return { value: "08:00" };
          return null;
        }),
      },
    });

    expect(() => context.window.collectAvailabilityFromForm()).toThrow("monday");
  });

  test("initCatalogWorkspaceBindings only wires controls once", () => {
    const context = loadCatalogWorkspace();

    context.window.initCatalogWorkspaceBindings();
    context.window.initCatalogWorkspaceBindings();

    expect(context.productName.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnRefreshProducts.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnRefreshPricing.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnSaveAvailability.addEventListener).toHaveBeenCalledTimes(1);
  });
});
