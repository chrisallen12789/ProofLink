"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadJobsWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-jobs-workspace.js"),
    "utf8"
  );

  const jobsList = {
    innerHTML: "",
    _buttons: [],
    querySelectorAll: vi.fn(() => jobsList._buttons),
  };
  const jobDetailWrap = { innerHTML: "" };
  const context = {
    console,
    window: {},
    Set,
    jobsList,
    jobDetailWrap,
    jobSearch: { value: "" },
    JOBS_CACHE: [],
    CUSTOMERS_CACHE: [],
    ACTIVE_JOB_ID: "",
    btnJobOpenOrder: { disabled: false },
    btnJobRecordPayment: { disabled: false },
    renderJobWorkspace: vi.fn(),
    populateJobForm: vi.fn(),
    linkedOrderForJob: vi.fn(() => null),
    linkedLeadForOrder: vi.fn(() => null),
    linkedBidForOrder: vi.fn(() => null),
    orderDepositStatus: vi.fn(() => "not_due"),
    jobRevenueCents: vi.fn(() => 0),
    jobTrackedCostCents: vi.fn(() => 0),
    jobGrossProfitCents: vi.fn(() => 0),
    jobMarginRatio: vi.fn(() => 0),
    trackedJobExpenses: vi.fn(() => []),
    normalizeExpenseType: vi.fn((value) => value),
    expenseHasLaborDetail: vi.fn(() => false),
    expenseAmountCents: vi.fn(() => 0),
    expenseLaborHoursValue: vi.fn(() => 0),
    expenseHasMaterialDetail: vi.fn(() => false),
    expenseIsChangeOrder: vi.fn(() => false),
    uniqList: (value) => Array.from(new Set(value)),
    expenseLeftoverNotes: vi.fn(() => []),
    expenseWasteNotes: vi.fn(() => []),
    calcHydrovacRevenueCents: vi.fn(() => null),
    hydrovacRevenueBreakdownHtml: vi.fn(() => ""),
    isHydrovacJob: vi.fn(() => false),
    hydrovacJobDetailState: vi.fn(() => null),
    currentWorkspaceBlueprint: vi.fn(() => ({
      business: {
        key: "other",
        label: "Business",
        recordFocus: [],
      },
    })),
    HYDROVAC_ALERTS_CACHE: [],
    HYDROVAC_PERMITS_CACHE: [],
    hydrovacJobNeedsLocate: vi.fn(() => false),
    hydrovacJobNeedsPermit: vi.fn(() => false),
    hydrovacJobManifestSnapshot: vi.fn(() => ({
      openLoads: 0,
      confirmedUnbilled: 0,
      manifests: [],
    })),
    normalizeWorkflowStatusValue: vi.fn((value) => value),
    orderAmountDueCents: vi.fn(() => 0),
    formatUsd: vi.fn((value) => `$${value}`),
    formatPercent: vi.fn((value) => `${value}%`),
    paymentStateClass: vi.fn(() => "pill-ok"),
    formatWorkflowPaymentState: vi.fn((value) => value),
    titleCaseWords: (value) => String(value),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  if (overrides.renderJobDetail) {
    context.window.renderJobDetail = overrides.renderJobDetail;
  }
  return { context, jobsList, jobDetailWrap };
}

describe("operator jobs workspace", () => {
  test("renderJobs shows the empty state when no jobs exist", () => {
    const { context, jobsList, jobDetailWrap } = loadJobsWorkspace({
      renderJobDetail: vi.fn(() => Promise.resolve()),
    });

    context.window.renderJobs("");

    expect(jobsList.innerHTML).toContain("No active jobs yet");
    expect(context.window.renderJobDetail).toHaveBeenCalledWith(null);
    expect(jobDetailWrap.innerHTML).toBe("");
  });

  test("renderJobs selects the first job when no active job is set", async () => {
    const job = {
      id: "job_1",
      title: "Main Street cleanup",
      customer_id: "customer_1",
      status: "scheduled",
      scheduled_date: "2026-03-26",
      service_address: "123 Main St",
      payment_state: "unpaid",
    };
    const customer = { id: "customer_1", name: "Logan's Lawn Care" };
    const renderJobDetail = vi.fn(() => Promise.resolve());
    const { context, jobsList } = loadJobsWorkspace({
      JOBS_CACHE: [job],
      CUSTOMERS_CACHE: [customer],
      renderJobDetail,
    });

    context.window.renderJobs("");

    expect(context.ACTIVE_JOB_ID).toBe("job_1");
    expect(jobsList.innerHTML).toContain("Main Street cleanup");
    expect(renderJobDetail).toHaveBeenCalledWith("job_1");
  });

  test("buildJobReadinessSummary surfaces hydrovac blockers clearly", () => {
    const job = {
      id: "job_hv_1",
      job_type: "hydrovac_excavation",
      scheduled_date: "2026-03-26",
      total_loads_hauled: 1,
    };
    const { context } = loadJobsWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobNeedsLocate: vi.fn(() => true),
      hydrovacJobNeedsPermit: vi.fn(() => true),
      HYDROVAC_PERMITS_CACHE: [],
      HYDROVAC_ALERTS_CACHE: [
        {
          id: "alert_1",
          reference_type: "job",
          reference_id: "job_hv_1",
          resolved: false,
          message: "Locate ticket is still missing.",
        },
      ],
      hydrovacJobManifestSnapshot: vi.fn(() => ({
        openLoads: 1,
        confirmedUnbilled: 0,
        manifests: [],
      })),
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hydrovac",
          label: "Hydrovac",
          recordFocus: ["Locate coverage", "Permit coverage", "Manifest closeout"],
        },
      })),
    });

    const summary = context.buildJobReadinessSummary(job, null, null, { tickets: [], manifests: [] });

    expect(summary.title).toContain("blocker");
    expect(summary.blockers.map((item) => item.label)).toEqual(expect.arrayContaining([
      "Customer linked",
      "Service address",
      "Assigned crew",
      "Locate ticket",
      "Confined-space permit",
      "Compliance alerts",
      "Loads ready for closeout",
    ]));
    expect(summary.nextStep).toContain("Link a customer");
  });
});
