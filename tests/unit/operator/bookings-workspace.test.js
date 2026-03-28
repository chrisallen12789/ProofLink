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
    currentWorkspaceBlueprint: vi.fn(() => ({
      business: {
        key: "landscaping",
        label: "Landscaping",
        recordFocus: [{ label: "Property profile", description: "Gate, beds, and side access" }],
      },
    })),
    $: vi.fn((id) => elements[id] || null),
    setTimeout,
    clearTimeout,
    ...overrides,
  };

  if (overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL) {
    context.window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL = overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL;
  }

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements };
}

describe("operator bookings workspace", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-bookings-workspace.js"),
    "utf8"
  );

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

  test("keeps booking detail and empty states free of drift", () => {
    expect(source).toContain('message: "--"');
    expect(source).toContain("No bookings here yet. New appointments will appear here as soon as they are scheduled.");
    expect(source).toContain('saveButton.textContent = "Saving..."');
    expect(source).toContain("Keep the trade details attached to this visit");
    expect(source).toContain("Prep for this visit");
    expect(source).toContain("Give the next stop a cleaner handoff");
    expect(source).toContain("bookingCustomerMemoryItems");
    expect(source).toContain("bookingPrepGuidanceItems");
    expect(source).toContain(">Close</button>");
    expect(source).not.toContain("â€”");
    expect(source).not.toContain("Ã—");
    expect(source).not.toContain("Savingâ€¦");
    expect(source).not.toContain("Â·");
  });
  test("bookingCustomerMemoryItems reuses business-specific customer memory when available", () => {
    const { context } = loadBookingsWorkspace({
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "Logan's Lawn Care", email: "logan@example.com" }],
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerMemoryChecklist: vi.fn(() => ([
          { label: "Property profile", ready: true, note: "Front lawn plus narrow side gate" },
          { label: "Access notes", ready: false, note: "Need the gate code before arrival" },
        ])),
      },
    });

    const items = context.window.bookingCustomerMemoryItems({
      id: "booking_1",
      customer_id: "customer_1",
      customer_name: "Logan's Lawn Care",
      customer_email: "logan@example.com",
    });

    expect(items).toEqual([
      { label: "Property profile", ready: true, note: "Front lawn plus narrow side gate" },
      { label: "Access notes", ready: false, note: "Need the gate code before arrival" },
    ]);
  });

  test("bookingPrepGuidanceItems turns landscaping context into visit prep guidance", () => {
    const { context } = loadBookingsWorkspace({
      CUSTOMERS_CACHE: [{
        id: "customer_1",
        name: "Logan's Lawn Care",
        email: "logan@example.com",
        gate_notes: "Side gate code 4421",
        frequency: "Weekly",
        seasonal_notes: "Front flower beds need spring cleanup",
      }],
    });

    const items = context.window.bookingPrepGuidanceItems({
      id: "booking_1",
      customer_id: "customer_1",
      customer_name: "Logan's Lawn Care",
      customer_email: "logan@example.com",
    });

    expect(items).toEqual([
      { label: "Access ready", ready: true, note: "Side gate code 4421" },
      { label: "Route and cadence", ready: true, note: "Weekly" },
      { label: "Property focus", ready: true, note: "Front flower beds need spring cleanup" },
    ]);
  });
});
