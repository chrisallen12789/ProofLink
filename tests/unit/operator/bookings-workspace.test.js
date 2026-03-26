"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeButton() {
  return {
    value: "",
    disabled: false,
    textContent: "",
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
      contains: vi.fn(() => false),
    },
    addEventListener: vi.fn(),
  };
}

function loadBookingsWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-bookings-workspace.js"),
    "utf8"
  );

  const elements = {
    btnMyBookings: makeButton(),
    btnWalkIn: makeButton(),
    btnNewBooking: makeButton(),
    btnCancelBooking: makeButton(),
    btnLogTime: makeButton(),
    btnRefreshBookings: makeButton(),
    btnBkPrev: makeButton(),
    btnBkNext: makeButton(),
    btnSaveBooking: makeButton(),
    bkRecurrenceRule: makeButton(),
    bkRecurrenceOptions: { style: {} },
    bkRecurrenceEnd: makeButton(),
    bkRecurrenceCount: { textContent: "" },
    bkDate: makeButton(),
    newBookingForm: { classList: { add: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => false) } },
    newBookingMsg: { textContent: "", className: "" },
  };

  const context = {
    console,
    window: { location: { origin: "https://app.prooflink.test" } },
    document: { createElement: vi.fn(), body: { appendChild: vi.fn() }, getElementById: vi.fn(() => null) },
    localStorage: { getItem: vi.fn(() => "false"), setItem: vi.fn() },
    FETCHING: new Set(),
    BOOKINGS_CACHE: [],
    OPERATOR_MEMBERS_CACHE: [],
    BK_VIEW_DATE: new Date("2026-03-01T00:00:00.000Z"),
    CRM_ORDERS_CACHE: [],
    CUSTOMERS_CACHE: [],
    CURRENT_OPERATOR: {},
    OPERATOR_CONFIG: {},
    TENANT_ID: "tenant_123",
    TIME_ENTRIES_CACHE: [],
    _tabAbortController: null,
    getAccessToken: vi.fn(async () => "token"),
    fetch: vi.fn(),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    formatDateTime: vi.fn(() => "Mar 26"),
    showToast: vi.fn(),
    notifyOperator: vi.fn(),
    opId: vi.fn(() => "operator_1"),
    $: vi.fn((id) => elements[id] || null),
    setTimeout,
    clearTimeout,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements };
}

describe("operator bookings workspace", () => {
  test("computeBookingRecurrenceCount returns a readable weekly count", () => {
    const { context } = loadBookingsWorkspace();

    const result = context.window.computeBookingRecurrenceCount("weekly", "2026-04-07", "2026-04-28");

    expect(result.count).toBe(3);
    expect(result.message).toContain("3 recurring instances");
  });

  test("initBookingsWorkspaceBindings only wires listeners once", () => {
    const { context, elements } = loadBookingsWorkspace();

    context.window.initBookingsWorkspaceBindings();
    context.window.initBookingsWorkspaceBindings();

    expect(elements.btnMyBookings.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnWalkIn.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnSaveBooking.addEventListener).toHaveBeenCalledTimes(1);
  });
});
