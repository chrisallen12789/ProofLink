"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function titleCaseWords(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function loadCustomersWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-customers-workspace.js"),
    "utf8"
  );

  const makeQuery = () => {
    const query = {
      select() { return query; },
      eq() { return query; },
      neq() { return query; },
      order() { return query; },
      range() { return query; },
      abortSignal() { return query; },
      limit() { return query; },
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: null, error: null })),
      insert() { return { select: () => ({ single: async () => ({ data: null, error: null }) }) }; },
      update() { return { eq: () => ({ eq: async () => ({ error: null }) }) }; },
    };
    return query;
  };

  const context = {
    console,
    Date,
    window: null,
    document: {
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn(() => ({})),
    },
    sb: {
      from: vi.fn(() => makeQuery()),
    },
    scopeQuery: (value) => value,
    FETCHING: new Set(),
    FETCH_OFFSETS: { customers: 0 },
    PAGE_SIZE: 50,
    TABS_LOADED: new Set(),
    CUSTOMERS_CACHE: [],
    LEADS_CACHE: [],
    BIDS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    JOBS_CACHE: [],
    PAYMENTS_CACHE: [],
    HYDROVAC_LOCATE_TICKETS_CACHE: [],
    HYDROVAC_PERMITS_CACHE: [],
    HYDROVAC_MANIFESTS_CACHE: [],
    TENANT_ID: "tenant-test",
    TENANT_COLUMN: "tenant_id",
    OPERATOR_COLUMN: "operator_id",
    _tabAbortController: null,
    currentWorkspaceBlueprint: () => ({ business: { key: "hydrovac" } }),
    paymentRevenueContributionCents: (row) => Number(row?.amount_cents || 0),
    customerLifetimeValueCents: (customer) => Number(customer?.lifetime_value_cents || 0),
    hydrovacJobNeedsLocate: (job) => !!job?.requires_locate,
    hydrovacJobNeedsPermit: (job) => !!job?.requires_permit,
    isHydrovacJob: () => true,
    hydrovacManifestIsLive: (manifest) => manifest?.metadata?.load_still_in_truck === true,
    hydrovacManifestReadyBy: (manifest) => String(manifest?.metadata?.disposal_ready_by || "").trim(),
    escapeHtml: (value) => String(value || ""),
    escapeAttr: (value) => String(value || ""),
    formatUsd: (value) => `$${(Number(value || 0) / 100).toFixed(2)}`,
    titleCaseWords,
    customerSearch: null,
    customerDetailWrap: null,
    showToast: vi.fn(),
    notifyOperator: vi.fn(),
    debounce: (fn) => fn,
    setInlineMessage: vi.fn(),
    markWorkspaceClean: vi.fn(),
    withTenantScope: (value) => value,
    opId: () => "operator-test",
    ...overrides,
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function loadCustomerDetail(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-customer-detail.js"),
    "utf8"
  );

  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };

  const context = {
    console,
    Date,
    window: null,
    document: {
      createElement: vi.fn(() => ({
        className: "",
        innerHTML: "",
        appendChild: vi.fn(),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        remove: vi.fn(),
      })),
      body: {
        appendChild: vi.fn(),
      },
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
    },
    localStorage: storage,
    sessionStorage: storage,
    LEADS_CACHE: [],
    BIDS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    JOBS_CACHE: [],
    PAYMENTS_CACHE: [],
    SERVICE_PLANS_CACHE: [],
    CUSTOMER_CREATING: false,
    CUSTOMERS_CACHE: [],
    customerDetailWrap: null,
    customerSearch: null,
    ACTIVE_CUSTOMER_ID: "",
    ACTIVE_PLAN_ID: "",
    TENANT_ID: "tenant-test",
    currentWorkspaceBlueprint: () => ({ business: { key: "hydrovac" } }),
    formatUsd: (value) => `$${(Number(value || 0) / 100).toFixed(2)}`,
    formatDateTime: (value) => String(value || ""),
    escapeHtml: (value) => String(value || ""),
    escapeAttr: (value) => String(value || ""),
    titleCaseWords,
    customerInteractionLabel: (value) => titleCaseWords(value),
    paymentAmountCents: (payment) => Number(payment?.amount_cents || 0),
    switchTab: vi.fn(),
    showToast: vi.fn(),
    notifyOperator: vi.fn(),
    renderCustomersList: vi.fn(),
    renderDashboard: vi.fn(),
    renderMoney: vi.fn(async () => {}),
    fetchCustomerInteractions: vi.fn(async () => []),
    PROOFLINK_OPERATOR_HYDROVAC_OPS_WORKSPACE: {},
    PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE: {},
    ...overrides,
  };
  context.window = context;

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("customer hydrovac workbench", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("blocks hydrovac jobs when locate or permit dates are malformed and keeps live-load pressure visible", () => {
    const context = loadCustomersWorkspace({
      CRM_ORDERS_CACHE: [
        { id: "order-1", customer_id: "cust-1", status: "completed", total_cents: 300000, is_deleted: false },
      ],
      PAYMENTS_CACHE: [
        { id: "payment-1", customer_id: "cust-1", amount_cents: 120000 },
      ],
      JOBS_CACHE: [
        {
          id: "job-ready",
          customer_id: "cust-1",
          title: "North plant potholing",
          status: "scheduled",
          assigned_truck_id: "truck-1",
          assigned_member_id: "member-1",
          requires_locate: true,
          requires_permit: true,
          service_address: "100 North Plant Rd",
        },
        {
          id: "job-blocked",
          customer_id: "cust-1",
          title: "East trench daylighting",
          status: "scheduled",
          assigned_truck_id: "truck-2",
          assigned_member_id: "member-2",
          requires_locate: true,
          requires_permit: true,
          service_address: "250 East Trench Ave",
        },
      ],
      HYDROVAC_LOCATE_TICKETS_CACHE: [
        { id: "loc-ready", job_id: "job-ready", status: "active", valid_until: "2026-04-08T12:00:00.000Z", work_site_address: "100 North Plant Rd" },
        { id: "loc-bad", job_id: "job-blocked", status: "active", valid_until: "not-a-real-date", work_site_address: "250 East Trench Ave" },
      ],
      HYDROVAC_PERMITS_CACHE: [
        { id: "permit-ready", job_id: "job-ready", status: "open", permit_valid_until: "2026-04-08T12:00:00.000Z" },
        { id: "permit-bad", job_id: "job-blocked", status: "open", permit_valid_until: "still-not-a-date" },
      ],
      HYDROVAC_MANIFESTS_CACHE: [
        {
          id: "manifest-live",
          customer_id: "cust-1",
          job_id: "job-ready",
          truck_id: "truck-1",
          status: "in_transit",
          metadata: { load_still_in_truck: true, disposal_ready_by: "2026-04-02" },
        },
        {
          id: "manifest-overdue",
          customer_id: "cust-1",
          job_id: "job-blocked",
          truck_id: "truck-2",
          status: "in_transit",
          metadata: { load_still_in_truck: true, disposal_ready_by: "2026-04-01" },
        },
        {
          id: "manifest-bill",
          customer_id: "cust-1",
          job_id: "job-blocked",
          truck_id: "truck-2",
          status: "confirmed",
          invoiced: false,
          disposal_charge_cents: 148000,
          metadata: {},
        },
        {
          id: "manifest-shared",
          customer_id: "cust-2",
          job_id: "job-other",
          truck_id: "truck-1",
          status: "in_transit",
          metadata: { load_still_in_truck: true, disposal_ready_by: "2026-04-03" },
        },
      ],
    });
    const api = context.window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE;
    const customer = {
      id: "cust-1",
      name: "North plant account",
      address_line1: "100 North Plant Rd",
      lifetime_value_cents: 850000,
      updated_at: "2026-04-01T10:00:00.000Z",
    };

    const metrics = api.customerWorkbenchMetrics(customer);
    const snapshot = api.customerHydrovacWorkbenchSnapshot(customer, metrics, { business: { key: "hydrovac" } });

    expect(metrics.balance).toBe(180000);
    expect(snapshot.activeJobs).toHaveLength(2);
    expect(snapshot.readyJobs).toHaveLength(1);
    expect(snapshot.blockedJobs).toHaveLength(1);
    expect(snapshot.blockedJobs[0].job.id).toBe("job-blocked");
    expect(snapshot.blockedJobs[0].reasons).toEqual(expect.arrayContaining(["Locate not ready", "Permit not ready"]));
    expect(snapshot.liveLoads).toHaveLength(2);
    expect(snapshot.dueLoads).toHaveLength(1);
    expect(snapshot.overdueLoads).toHaveLength(1);
    expect(snapshot.confirmedUnbilled).toHaveLength(1);
    expect(snapshot.uninvoicedChargeCents).toBe(148000);
    expect(snapshot.sharedTruckRiskCount).toBe(1);
    expect(snapshot.siteAddresses).toEqual(expect.arrayContaining(["100 North Plant Rd", "250 East Trench Ave"]));
    expect(snapshot.activeFlags).toBeGreaterThanOrEqual(4);
  });

  test("ranks blocked hydrovac accounts ahead of calmer accounts", () => {
    const context = loadCustomersWorkspace();
    const api = context.window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE;

    const urgentScore = api.customerHydrovacWorkbenchScore(
      { id: "cust-urgent", lifetime_value_cents: 1200000 },
      { balance: 210000 },
      {
        blockedJobs: [{}],
        overdueLoads: [{}],
        expiredLocates: [],
        expiredPermits: [],
        dueLoads: [],
        expiringLocates: [],
        expiringPermits: [],
        confirmedUnbilled: [{}],
        liveLoads: [{}],
        activeJobs: [{}, {}],
      }
    );

    const calmScore = api.customerHydrovacWorkbenchScore(
      { id: "cust-calm", lifetime_value_cents: 1200000 },
      { balance: 0 },
      {
        blockedJobs: [],
        overdueLoads: [],
        expiredLocates: [],
        expiredPermits: [],
        dueLoads: [],
        expiringLocates: [],
        expiringPermits: [],
        confirmedUnbilled: [],
        liveLoads: [],
        activeJobs: [],
      }
    );

    expect(urgentScore).toBeGreaterThan(calmScore);
  });

  test("renders hydrovac action cards and app shelf copy around dispatch, loads, and billing", () => {
    const detailContext = loadCustomerDetail();
    const api = detailContext.window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL;
    const customer = {
      id: "cust-1",
      company_name: "North plant account",
      name: "Avery Lopez",
      address_line1: "100 North Plant Rd",
      email: "avery@example.test",
      phone: "555-0100",
    };
    const snapshot = {
      blockedJobs: [{ job: { id: "job-1" }, reasons: ["Permit not ready"] }],
      activeJobs: [{ id: "job-1" }, { id: "job-2" }],
      readyJobs: [{ id: "job-2" }],
      liveLoads: [{ id: "manifest-1" }],
      overdueLoads: [{ id: "manifest-1" }],
      dueLoads: [],
      confirmedUnbilled: [{ id: "manifest-2" }],
      uninvoicedChargeCents: 148000,
      siteAddresses: ["100 North Plant Rd", "250 East Trench Ave"],
    };

    const cardHtml = api.renderCustomerActionCard({
      customer,
      customerIdValue: customer.id,
      knownAddresses: snapshot.siteAddresses,
      balance: 148000,
      actions: [{ label: "Open dispatch", className: "btn btn-primary", data: { "customer-action": "dispatch" } }],
      blueprint: { business: { key: "hydrovac" } },
      hydrovacSnapshot: snapshot,
    });
    const appCards = api.customerWorkbenchAppCards({
      customer,
      customerIdValue: customer.id,
      balance: 148000,
      knownAddresses: snapshot.siteAddresses,
      customerRequestsRows: [],
      customerBidRows: [],
      customerOrders: [],
      customerJobsRows: [{ id: "job-1" }, { id: "job-2" }],
      customerPayments: [],
      activityTimeline: [],
      openRequestsCount: 0,
      openProposalCount: 0,
      activeOrderCount: 0,
      activeJobCount: 2,
      lastTouchValue: "2026-04-01T09:00:00.000Z",
      blueprint: { business: { key: "hydrovac" } },
      hydrovacSnapshot: snapshot,
    });

    expect(cardHtml).toContain("Dispatch blockers are tied to this account");
    expect(cardHtml).toContain("Load pressure");
    expect(cardHtml).toContain("Billing capture");
    expect(cardHtml).toContain("Footprint");
    expect(cardHtml).toContain("Open dispatch");

    expect(appCards.find((card) => card.key === "work")).toMatchObject({
      meta: "Dispatch",
      status: "1 dispatch blocker",
    });
    expect(appCards.find((card) => card.key === "money")).toMatchObject({
      meta: "Billing",
      status: "$1480.00 disposal to bill",
    });
    expect(appCards.find((card) => card.key === "follow_through")).toMatchObject({
      meta: "Site memory",
    });
  });
});
