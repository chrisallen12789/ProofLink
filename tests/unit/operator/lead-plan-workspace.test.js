"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeField() {
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    checked: false,
    disabled: false,
    addEventListener: vi.fn(),
  };
}

function loadLeadPlanWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-lead-plan-workspace.js"),
    "utf8"
  );

  const context = {
    console,
    window: {},
    FETCHING: new Set(),
    LEADS_CACHE: [],
    SERVICE_PLANS_CACHE: [],
    CUSTOMERS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    JOBS_CACHE: [],
    BIDS_CACHE: [],
    ACTIVE_LEAD_ID: "",
    ACTIVE_PLAN_ID: "",
    ACTIVE_ORDER_ID: "",
    ACTIVE_JOB_ID: "",
    ACTIVE_BID_ID: "",
    SERVICE_PLANS_FEATURE_READY: true,
    leadSearch: makeField(),
    btnNewLead: makeField(),
    leadForm: makeField(),
    btnLeadCreateBid: makeField(),
    btnLeadOpenBid: makeField(),
    planSearch: makeField(),
    btnNewPlan: makeField(),
    planSourceOrderId: makeField(),
    planForm: makeField(),
    btnGeneratePlanOrder: makeField(),
    btnOpenPlanOrder: makeField(),
    btnRunDuePlans: makeField(),
    planCustomerId: makeField(),
    leadCustomerId: makeField(),
    leadsList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    plansList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    planDetailWrap: { innerHTML: "" },
    leadDetailWrap: { innerHTML: "" },
    leadId: makeField(),
    leadStatus: makeField(),
    leadPriority: makeField(),
    leadTitle: makeField(),
    leadRequestedService: makeField(),
    leadContactName: makeField(),
    leadContactEmail: makeField(),
    leadContactPhone: makeField(),
    leadPreferredContact: makeField(),
    leadSourceType: makeField(),
    leadServiceAddress: makeField(),
    leadSummary: makeField(),
    leadNotes: makeField(),
    leadMsg: {},
    planId: makeField(),
    planStatus: makeField(),
    planTitle: makeField(),
    planServiceAddress: makeField(),
    planCadence: makeField(),
    planIntervalDays: makeField(),
    planNextRunOn: makeField(),
    planAmount: makeField(),
    planDepositAmount: makeField(),
    planAutoCreateJob: { checked: true },
    planScheduleWindow: makeField(),
    planSummary: makeField(),
    planNotes: makeField(),
    planMsg: {},
    bidSearch: makeField(),
    bidMsg: {},
    sb: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: [], error: null })),
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: { id: "row_1" }, error: null })),
      })),
      rpc: vi.fn(async () => ({ data: {}, error: null })),
    },
    scopeQuery: vi.fn((query) => query),
    isMissingDatabaseFeatureError: vi.fn(() => false),
    sortedCustomers: vi.fn((rows) => rows),
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    formatUsd: (value) => `$${value}`,
    formatDateTime: (value) => value,
    money: (value) => Number(value || 0).toFixed(2),
    toCents: (value) => Math.round(Number(value || 0) * 100),
    titleCaseWords: (value) => String(value || "").replace(/\b\w/g, (char) => char.toUpperCase()),
    servicePlanAmountCents: (plan) => Number(plan?.amount_cents || 0),
    servicePlanNextRunTime: (plan) => Number(plan?.next_run_rank || 0),
    servicePlanNextRunLabel: (plan) => String(plan?.next_run_on || ""),
    planCadenceLabel: (cadence) => cadence,
    dueServicePlans: vi.fn(() => []),
    orderPaymentState: vi.fn(() => "unpaid"),
    orderAmountDueCents: vi.fn(() => 0),
    orderTotalCents: vi.fn(() => 0),
    orderDepositRequiredCents: vi.fn(() => 0),
    formatWorkflowPaymentState: (value) => value,
    todayDateValue: vi.fn(() => "2026-04-25"),
    buildPlanLineItems: vi.fn(() => []),
    normalizeServicePlanItems: vi.fn((items) => items),
    withTenantScope: (value) => value,
    opId: vi.fn(() => "operator_1"),
    TENANT_ID: "tenant_1",
    TENANT_COLUMN: "tenant_id",
    OPERATOR_COLUMN: "operator_id",
    setInlineMessage: vi.fn(),
    renderDashboard: vi.fn(),
    renderGuidance: vi.fn(),
    renderMoney: vi.fn(() => Promise.resolve()),
    renderOrders: vi.fn(),
    renderJobs: vi.fn(),
    renderBids: vi.fn(),
    renderRequestWorkspace: vi.fn(),
    currentServicePlan: vi.fn(() => null),
    currentLead: vi.fn(() => null),
    currentBid: vi.fn(() => null),
    preferredBidProfile: vi.fn(() => "default"),
    normalizeBidProfile: vi.fn((value) => value),
    bidDraftFromLeadRecord: vi.fn(() => ({ id: "draft_1", updated_at: "2026-03-26T10:00:00.000Z" })),
    bidRowFromDraft: vi.fn(() => ({})),
    draftFromBidRow: vi.fn(() => ({ id: "draft_1" })),
    cloneJson: (value, fallback = null) => (value == null ? fallback : JSON.parse(JSON.stringify(value))),
    persistBidDrafts: vi.fn(),
    loadPersistedBids: vi.fn(() => Promise.resolve()),
    findBidRecordById: vi.fn(() => null),
    linkedOrderForLead: vi.fn(() => null),
    seedOrderDepositDefaults: vi.fn((order) => Promise.resolve(order)),
    fetchCrmOrders: vi.fn(() => Promise.resolve()),
    fetchJobs: vi.fn(() => Promise.resolve()),
    fetchPayments: vi.fn(() => Promise.resolve()),
    saveCustomerRecord: vi.fn(() => Promise.resolve({ id: "customer_1" })),
    findExistingCustomerRecord: vi.fn(() => null),
    markWorkspaceClean: vi.fn(),
    setBidWorkspaceBootstrapping: vi.fn(),
    switchTab: vi.fn(),
    debounce: (fn) => fn,
    $: vi.fn(() => null),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator lead plan workspace", () => {
  test("sortedLeads matches contact and service fields", () => {
    const context = loadLeadPlanWorkspace({
      LEADS_CACHE: [
        {
          id: "lead_1",
          title: "Front yard cleanup",
          contact_name: "Logan",
          requested_service_type: "Landscaping",
          service_address: "12 Main St",
          status: "new",
          updated_at: "2026-03-25T08:00:00.000Z",
        },
        {
          id: "lead_2",
          title: "HVAC tune-up",
          contact_name: "Mira",
          requested_service_type: "HVAC",
          service_address: "88 Oak Ave",
          status: "quoted",
          updated_at: "2026-03-26T08:00:00.000Z",
        },
      ],
    });

    const matches = context.window.sortedLeads("logan");

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("lead_1");
  });

  test("sortedServicePlans orders due-soon plans first and filters by customer name", () => {
    const context = loadLeadPlanWorkspace({
      CUSTOMERS_CACHE: [
        { id: "customer_1", name: "Benkari Vacs" },
        { id: "customer_2", name: "Logan's Lawn Care" },
      ],
      SERVICE_PLANS_CACHE: [
        {
          id: "plan_1",
          customer_id: "customer_1",
          title: "Hydrovac monthly",
          status: "active",
          next_run_rank: 10,
          updated_at: "2026-03-25T08:00:00.000Z",
        },
        {
          id: "plan_2",
          customer_id: "customer_2",
          title: "Lawn route",
          status: "active",
          next_run_rank: 1,
          updated_at: "2026-03-24T08:00:00.000Z",
        },
      ],
    });

    const filtered = context.window.sortedServicePlans("logan");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("plan_2");
    expect(context.window.sortedServicePlans()[0].id).toBe("plan_2");
  });

  test("initLeadPlanWorkspaceBindings only wires controls once", () => {
    const context = loadLeadPlanWorkspace();

    context.window.initLeadPlanWorkspaceBindings();
    context.window.initLeadPlanWorkspaceBindings();

    expect(context.leadSearch.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.leadForm.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.planSearch.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.planForm.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnRunDuePlans.addEventListener).toHaveBeenCalledTimes(1);
  });
});
