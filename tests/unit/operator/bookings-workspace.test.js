"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeButton() {
  return {
    value: "",
    disabled: false,
    textContent: "",
    focus: vi.fn(),
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
    bkCustomerName: makeButton(),
    bkCustomerEmail: makeButton(),
    bkTitle: makeButton(),
    bkRecurrenceRule: makeButton(),
    bkRecurrenceOptions: { style: {}, classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => false) } },
    bkRecurrenceEnd: makeButton(),
    bkRecurrenceCount: { textContent: "" },
    bkDate: makeButton(),
    bkStart: makeButton(),
    bkNotes: makeButton(),
    bkLocationLabel: makeButton(),
    bkServiceAddress: makeButton(),
    newBookingForm: { classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => false) } },
    newBookingMsg: { textContent: "", className: "" },
    calendarSyncWrap: { innerHTML: "" },
    bookingLinkDisplay: { textContent: "" },
    bookingsNoShowStat: { textContent: "" },
    bookingsCalendar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bkMonthLabel: { textContent: "" },
    bookingsList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bkListLabel: { textContent: "" },
  };

  const context = {
    console,
    window: { location: { origin: "https://app.prooflink.test" } },
    document: { createElement: vi.fn(), body: { appendChild: vi.fn() }, getElementById: vi.fn(() => null), querySelectorAll: vi.fn(() => []) },
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
    orderAmountDueCents: vi.fn((order) => Number(order?.amount_due_cents || 0)),
    formatUsd: vi.fn((value) => `$${Number(value || 0) / 100}`),
    _tabAbortController: null,
    getAccessToken: vi.fn(async () => "token"),
    fetch: vi.fn(),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    formatDateTime: vi.fn(() => "Mar 26"),
    showToast: vi.fn(),
    notifyOperator: vi.fn(),
    setInlineMessage: vi.fn(),
    opId: vi.fn(() => "operator_1"),
    currentWorkspaceBlueprint: vi.fn(() => ({
      business: {
        key: "landscaping",
        label: "Landscaping",
        recordFocus: [{ label: "Property profile", description: "Gate, beds, and side access" }],
      },
    })),
    $: vi.fn((id) => elements[id] || null),
    switchTab: vi.fn(),
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
    expect(source).toContain("Best next scheduling move");
    expect(source).toContain("Turn this booking into a cleaner field handoff");
    expect(source).toContain("Give the next stop a cleaner handoff");
    expect(source).toContain("bookingCustomerMemoryItems");
    expect(source).toContain("bookingPrepGuidanceItems");
    expect(source).toContain("bookingAssignmentGuidanceItems");
    expect(source).toContain("bookingFollowThroughItems");
    expect(source).toContain("renderBookingsOverview");
    expect(source).toContain("Google Calendar sync");
    expect(source).toContain("Duplicate exports are blocked server-side.");
    expect(source).toContain("Connect Google Calendar");
    expect(source).toContain("booking-list-card");
    expect(source).toContain("After this visit");
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

  test("bookingPrepGuidanceItems turns hydrovac context into dispatch-ready visit prep", () => {
    const { context } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hydrovac",
          label: "Hydrovac",
          recordFocus: [],
        },
      })),
      CUSTOMERS_CACHE: [{
        id: "customer_hv_1",
        name: "Harbor Utilities",
        email: "ops@example.com",
        site_access_notes: "Stage truck at east service road pullout",
        locate_notes: "811 ticket expires Thursday",
        disposal_notes: "Dump at South County liquid waste facility",
      }],
    });

    const items = context.window.bookingPrepGuidanceItems({
      id: "booking_hv_1",
      customer_id: "customer_hv_1",
      customer_name: "Harbor Utilities",
      customer_email: "ops@example.com",
      service_address: "North campus gate 3",
    });

    expect(items).toEqual([
      { label: "Truck access ready", ready: true, note: "Stage truck at east service road pullout" },
      { label: "Locate and permit note", ready: true, note: "811 ticket expires Thursday" },
      { label: "Disposal and PO memory", ready: true, note: "Dump at South County liquid waste facility" },
    ]);
  });

  test("bookingExternalEventsForPane filters consolidated Google events by date", () => {
    const { context } = loadBookingsWorkspace();
    context.window.setBookingExternalEvents([
      { id: "event_1", starts_at: "2026-04-08T13:00:00.000Z", summary: "Google event 1" },
      { id: "event_2", starts_at: "2026-04-09T14:00:00.000Z", summary: "Google event 2" },
    ]);

    const items = context.window.bookingExternalEventsForPane("2026-04-08");

    expect(items).toEqual([
      { id: "event_1", starts_at: "2026-04-08T13:00:00.000Z", summary: "Google event 1" },
    ]);
  });

  test("bookingAssignmentGuidanceItems keeps HVAC dispatch context attached to the visit", () => {
    const { context } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
          label: "HVAC",
          recordFocus: [],
        },
      })),
      CUSTOMERS_CACHE: [{
        id: "customer_1",
        name: "Harbor Suites",
        email: "ops@example.com",
        equipment_notes: "Carrier rooftop unit RTU-2",
        tenant_notes: "Meet building engineer at north stairwell",
      }],
    });

    const items = context.window.bookingAssignmentGuidanceItems({
      id: "booking_1",
      customer_id: "customer_1",
      assigned_operator_name: "Chris",
      customer_name: "Harbor Suites",
      customer_email: "ops@example.com",
    });

    expect(items).toEqual([
      { label: "Crew assignment", ready: true, note: "Someone is already attached to this visit, so the handoff can stay specific.", tone: "" },
      { label: "Tech handoff", ready: true, note: "Carrier rooftop unit RTU-2", tone: "" },
      { label: "Customer contact path", ready: true, note: "Meet building engineer at north stairwell", tone: "" },
    ]);
  });

  test("bookingFollowThroughItems keeps plumbing repair follow-through attached after the visit", () => {
    const { context } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "plumbing",
          label: "Plumbing",
          recordFocus: [],
        },
      })),
      CRM_ORDERS_CACHE: [{ id: "order_1", amount_due_cents: 18500 }],
      CUSTOMERS_CACHE: [{
        id: "customer_1",
        name: "Harbor Suites",
        email: "ops@example.com",
        restoration_notes: "Drywall patch crew comes after pipe repair",
        phone: "555-1212",
      }],
    });

    const items = context.window.bookingFollowThroughItems({
      id: "booking_1",
      order_id: "order_1",
      customer_id: "customer_1",
      customer_name: "Harbor Suites",
      customer_email: "ops@example.com",
    });

    expect(items).toEqual([
      { label: "Repair follow-through", ready: true, note: "Drywall patch crew comes after pipe repair", tone: "" },
      { label: "Customer update path", ready: true, note: "555-1212", tone: "" },
      { label: "Money follow-through", ready: false, note: "$185 is still open on the linked booked work. Keep the reminder or collection step attached while this visit is fresh.", tone: "warn" },
    ]);
  });

  test("bookingFollowThroughItems flags HVAC renewal risk when the next maintenance step is missing", () => {
    const { context } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
          label: "HVAC",
          recordFocus: [],
        },
      })),
      CUSTOMERS_CACHE: [{
        id: "customer_1",
        name: "Harbor Suites",
        email: "ops@example.com",
        maintenance_notes: "Quarterly rooftop maintenance still expected",
        tenant_notes: "Facilities lead handles approvals",
      }],
    });

    const items = context.window.bookingFollowThroughItems({
      id: "booking_1",
      customer_id: "customer_1",
      customer_name: "Harbor Suites",
      customer_email: "ops@example.com",
    });

    expect(items).toEqual([
      { label: "Maintenance follow-up", ready: true, note: "Quarterly rooftop maintenance still expected", tone: "" },
      { label: "Customer update path", ready: true, note: "Facilities lead handles approvals", tone: "" },
      { label: "Renewal risk", ready: false, note: "This account has repeat-service signals, but the next visit or follow-up step still needs to be attached before it goes quiet.", tone: "warn" },
      { label: "Money follow-through", ready: true, note: "No booked-work balance is attached to this visit right now.", tone: "" },
    ]);
  });

  test("openBookingDraftForCustomer opens the booking form with follow-up defaults", () => {
    const { context, elements } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "cleaning",
          label: "Cleaning",
          recordFocus: [],
        },
      })),
      todayDateValue: vi.fn(() => "2026-04-02"),
    });

    context.window.openBookingDraftForCustomer({
      name: "Harbor Suites",
      email: "ops@example.com",
      recurring_notes: "Every other Tuesday",
    });

    expect(context.switchTab).toHaveBeenCalledWith("bookings");
    expect(elements.newBookingForm.classList.remove).toHaveBeenCalledWith("hidden");
    expect(elements.bkCustomerName.value).toBe("Harbor Suites");
    expect(elements.bkCustomerEmail.value).toBe("ops@example.com");
    expect(elements.bkTitle.value).toBe("Harbor Suites cleaning visit");
    expect(elements.bkDate.value).toBe("2026-04-02");
    expect(elements.bkNotes.value).toContain("Every other Tuesday");
    expect(context.setInlineMessage).toHaveBeenCalled();
  });

  test("openBookingDraftForCustomer preloads recurrence and trade guidance for repeat HVAC work", () => {
    const { context, elements } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
          label: "HVAC",
          recordFocus: [],
        },
      })),
      todayDateValue: vi.fn((days) => {
        const map = { 7: "2026-04-02", 84: "2026-06-18" };
        return map[days] || "2026-04-02";
      }),
    });

    context.window.openBookingDraftForCustomer({
      name: "Harbor Suites",
      email: "ops@example.com",
      frequency: "Weekly",
      maintenance_notes: "Spring tune-up is due next visit",
      parts_follow_up: "Bring capacitor approval paperwork",
      equipment_notes: "Carrier rooftop unit RTU-2",
    });

    expect(elements.bkTitle.value).toBe("Harbor Suites maintenance visit");
    expect(elements.bkDate.value).toBe("2026-04-02");
    expect(elements.bkRecurrenceRule.value).toBe("WEEKLY");
    expect(elements.bkRecurrenceEnd.value).toBe("2026-06-25");
    expect(elements.bkNotes.value).toContain("Spring tune-up is due next visit");
    expect(elements.bkNotes.value).toContain("Bring capacitor approval paperwork");
    expect(elements.bkNotes.value).toContain("Carrier rooftop unit RTU-2");
    expect(elements.bkRecurrenceOptions.classList.toggle).toHaveBeenCalledWith("u-hidden", false);
  });

  test("bookingDraftDate uses the expected cadence when the account is still on rhythm", () => {
    const { context } = loadBookingsWorkspace({
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerRepeatCadenceInsight: vi.fn(() => ({
          cadenceDays: 14,
          overdueDays: 0,
          message: "This account usually runs about every 14 days.",
        })),
      },
    });

    const date = context.window.bookingDraftDate({
      recurring_notes: "Every other Tuesday",
      last_service_on: "2026-04-10T12:00:00Z",
    }, {}, {
      business: {
        key: "cleaning",
      },
    });

    expect(date).toBe("2026-04-24");
  });

  test("bookingDraftDate pulls overdue repeat work forward instead of using the full cadence", () => {
    const { context } = loadBookingsWorkspace({
      todayDateValue: vi.fn((days) => `offset-${days}`),
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerRepeatCadenceInsight: vi.fn(() => ({
          cadenceDays: 14,
          overdueDays: 12,
          message: "This account usually runs about every 14 days and is roughly 12 days past that rhythm.",
        })),
      },
    });

    const date = context.window.bookingDraftDate({
      recurring_notes: "Every other Tuesday",
      last_service_on: "2026-03-01T12:00:00Z",
    }, {}, {
      business: {
        key: "cleaning",
      },
    });

    expect(date).toBe("offset-3");
  });

  test("bookingDraftTradeTimingInsight keeps HVAC parts follow-up inside the next week", () => {
    const { context } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
        },
      })),
    });

    const insight = context.window.bookingDraftTradeTimingInsight({
      parts_follow_up: "Capacitor approval still pending",
      warranty_notes: "Warranty photo still needed",
    }, {}, {
      business: {
        key: "hvac",
      },
    }, new Date("2026-03-28T00:00:00.000Z"));

    expect(insight.offsetDays).toBe(7);
    expect(insight.message).toContain("next week");
  });

  test("bookingDraftTradeTimingInsight pulls plumbing emergencies into the next day", () => {
    const { context } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "plumbing",
        },
      })),
    });

    const insight = context.window.bookingDraftTradeTimingInsight({
      restoration_notes: "Emergency leak over kitchen ceiling",
    }, {}, {
      business: {
        key: "plumbing",
      },
    }, new Date("2026-03-28T00:00:00.000Z"));

    expect(insight.offsetDays).toBe(1);
    expect(insight.message).toContain("almost immediately");
  });

  test("bookingDraftTradeTimingInsight spots seasonal property timing when spring is opening", () => {
    const { context } = loadBookingsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "landscaping",
        },
      })),
    });

    const insight = context.window.bookingDraftTradeTimingInsight({
      seasonal_notes: "Spring mulch refresh and bed cleanup",
    }, {}, {
      business: {
        key: "landscaping",
      },
    }, new Date("2026-03-28T00:00:00.000Z"));

    expect(insight.offsetDays).toBe(14);
    expect(insight.message).toContain("seasonal window is opening");
  });

  test("openBookingDraftForCustomer explains why the draft timing was chosen", () => {
    const { context } = loadBookingsWorkspace({
      todayDateValue: vi.fn((days) => `offset-${days}`),
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerRepeatCadenceInsight: vi.fn(() => ({
          cadenceDays: 14,
          overdueDays: 9,
          message: "This account usually runs about every 14 days and is roughly 9 days past that rhythm.",
        })),
      },
    });

    context.window.openBookingDraftForCustomer({
      name: "Quiet Cleaning",
      email: "quiet@example.com",
      recurring_notes: "Every other Tuesday",
      last_service_on: "2026-03-01T12:00:00Z",
    }, {}, {
      business: {
        key: "cleaning",
      },
    });

    expect(context.setInlineMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("9 days past that rhythm"),
      "ok"
    );
  });

  test("openBookingDraftForCustomer explains trade timing when there is no cadence signal yet", () => {
    const { context } = loadBookingsWorkspace({
      todayDateValue: vi.fn((days) => `offset-${days}`),
    });

    context.window.openBookingDraftForCustomer({
      name: "Harbor Suites",
      email: "ops@example.com",
      parts_follow_up: "Capacitor approval still pending",
      warranty_notes: "Warranty photo still needed",
    }, {}, {
      business: {
        key: "hvac",
      },
    });

    expect(context.setInlineMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("next week"),
      "ok"
    );
  });

  test("bookingDraftTimingInsight exposes the plain-language reason and suggested date together", () => {
    const { context } = loadBookingsWorkspace({
      todayDateValue: vi.fn((days) => `offset-${days}`),
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerRepeatCadenceInsight: vi.fn(() => ({
          cadenceDays: 14,
          overdueDays: 9,
          message: "This account usually runs about every 14 days and is roughly 9 days past that rhythm.",
        })),
      },
    });

    const insight = context.window.bookingDraftTimingInsight({
      recurring_notes: "Every other Tuesday",
      last_service_on: "2026-03-01T12:00:00Z",
    }, {}, {
      business: {
        key: "cleaning",
      },
    });

    expect(insight.reason).toContain("9 days past that rhythm");
    expect(insight.bookingDate).toBe("offset-3");
  });
});
