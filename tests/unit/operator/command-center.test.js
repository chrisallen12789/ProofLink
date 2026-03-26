"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeButton(attrs = {}) {
  const listeners = new Map();
  return {
    getAttribute: (name) => attrs[name] || "",
    addEventListener: (event, handler) => listeners.set(event, handler),
    click: async () => {
      const handler = listeners.get("click");
      if (handler) return handler();
      return undefined;
    },
  };
}

function loadCommandCenter(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-command-center.js"),
    "utf8"
  );

  const guidanceButtons = overrides.guidanceButtons || [];
  const pipelineStageButtons = overrides.pipelineStageButtons || [];
  const pipelineActionButtons = overrides.pipelineActionButtons || [];
  const moneyStageButtons = overrides.moneyStageButtons || [];
  const moneyActionButtons = overrides.moneyActionButtons || [];

  const guidanceWrap = {
    innerHTML: "",
    querySelectorAll: vi.fn(() => guidanceButtons),
  };
  const pipelineStageStrip = {
    innerHTML: "",
    querySelectorAll: vi.fn(() => pipelineStageButtons),
  };
  const pipelineActionBar = {
    innerHTML: "",
    querySelectorAll: vi.fn(() => pipelineActionButtons),
  };
  const moneyStageStrip = {
    innerHTML: "",
    querySelectorAll: vi.fn(() => moneyStageButtons),
  };
  const moneyActionBar = {
    innerHTML: "",
    querySelectorAll: vi.fn(() => moneyActionButtons),
  };

  const context = {
    console,
    window: {},
    Set,
    guidanceWrap,
    pipelineStageStrip,
    pipelineActionBar,
    moneyStageStrip,
    moneyActionBar,
    dashboardWrap: null,
    currentWorkspaceBlueprint: vi.fn(() => ({
      business: { key: "starter" },
      workflowRubric: {
        intake: "Capture what matters first.",
        scheduling: "Schedule with confidence.",
        field: "Field updates stay quick.",
        payment: "Collect on time.",
        repeatWork: "Turn wins into repeat work.",
      },
    })),
    workspaceBidLabel: vi.fn(() => "Walkthrough Bids"),
    workspaceTabLabel: vi.fn((tab) => `Label ${tab}`),
    workspaceJobsNavLabel: vi.fn(() => "Active Jobs"),
    workspaceCatalogLabel: vi.fn(() => "Products"),
    isHydrovacWorkspace: vi.fn(() => false),
    isTabVisibleInWorkspace: vi.fn(() => true),
    LEADS_CACHE: [],
    BIDS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    JOBS_CACHE: [],
    PAYMENTS_CACHE: [],
    CUSTOMERS_CACHE: [],
    CURRENT_FOLLOW_UP_QUEUE: [],
    switchTab: vi.fn(),
    pipelineStageStats: vi.fn(() => [
      { tab: "leads", eyebrow: "Stage 1", value: 2, title: "Requests", copy: "Inbound work." },
      { tab: "jobs", eyebrow: "Stage 4", value: 1, title: "Active jobs", copy: "Live work." },
    ]),
    renderWorkCommandCenter: vi.fn(),
    clearLeadForm: vi.fn(),
    renderLeadDetail: vi.fn(() => Promise.resolve()),
    startNewBid: vi.fn(),
    preferredBidProfile: vi.fn(() => "default"),
    clearPaymentForm: vi.fn(),
    renderPayments: vi.fn(),
    ACTIVE_LEAD_ID: "existing-lead",
    ACTIVE_CUSTOMER_ID: "customer_1",
    sortedPayments: vi.fn((rows) => rows),
    currentPayment: vi.fn(() => null),
    orderPaymentState: vi.fn(() => "unpaid"),
    normalizeWorkflowStatusValue: vi.fn((value) => String(value || "").trim().toLowerCase()),
    orderDepositGapCents: vi.fn(() => 0),
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context,
    guidanceWrap,
    pipelineStageStrip,
    pipelineActionBar,
    moneyStageStrip,
    moneyActionBar,
  };
}

describe("operator command center", () => {
  test("renderGuidance shows hydrovac operations and hides invisible tabs", () => {
    const { context, guidanceWrap } = loadCommandCenter({
      currentWorkspaceBlueprint: vi.fn(() => ({ business: { key: "hydrovac" } })),
      isHydrovacWorkspace: vi.fn(() => true),
      isTabVisibleInWorkspace: vi.fn((tab) => tab !== "domains"),
      LEADS_CACHE: [{ id: "lead_1" }],
      BIDS_CACHE: [{ id: "bid_1" }],
      CRM_ORDERS_CACHE: [{ id: "order_1" }],
      JOBS_CACHE: [{ id: "job_1" }],
    });

    context.window.renderGuidance();

    expect(guidanceWrap.innerHTML).toContain("Hydrovac operations");
    expect(guidanceWrap.innerHTML).toContain("Daily shell");
    expect(guidanceWrap.innerHTML).toContain("Template intake");
    expect(guidanceWrap.innerHTML).not.toContain("Domains");
  });

  test("renderPipelineWorkspace wires the new-request action into leads", async () => {
    const newRequestButton = makeButton({ "data-pipeline-action": "new-request" });
    const { context, pipelineActionBar } = loadCommandCenter({
      pipelineActionButtons: [newRequestButton],
    });

    context.window.renderPipelineWorkspace();
    await newRequestButton.click();

    expect(pipelineActionBar.innerHTML).toContain("New request");
    expect(context.ACTIVE_LEAD_ID).toBeNull();
    expect(context.clearLeadForm).toHaveBeenCalled();
    expect(context.renderLeadDetail).toHaveBeenCalledWith(null);
    expect(context.switchTab).toHaveBeenCalledWith("leads");
  });

  test("renderMoneyWorkspace wires payment recording into the shared payment flow", () => {
    const newPaymentButton = makeButton({ "data-money-action": "new-payment" });
    const { context, moneyActionBar } = loadCommandCenter({
      moneyActionButtons: [newPaymentButton],
      PAYMENTS_CACHE: [{ id: "payment_1" }],
    });

    context.window.renderMoneyWorkspace();
    newPaymentButton.click();

    expect(moneyActionBar.innerHTML).toContain("Record payment");
    expect(context.clearPaymentForm).toHaveBeenCalled();
    expect(context.renderPayments).toHaveBeenCalled();
  });
});
