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
    PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {},
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
    formatDateTime: vi.fn((value) => String(value)),
    formatPercent: vi.fn((value) => `${value}%`),
    paymentStateClass: vi.fn(() => "pill-ok"),
    formatWorkflowPaymentState: vi.fn((value) => value),
    titleCaseWords: (value) => String(value),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    ...overrides,
  };

  if (overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL) {
    context.window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL = overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL;
  }

  vm.createContext(context);
  vm.runInContext(source, context);
  if (overrides.renderJobDetail) {
    context.window.renderJobDetail = overrides.renderJobDetail;
  }
  return { context, jobsList, jobDetailWrap };
}

describe("operator jobs workspace", () => {
  test("keeps the job review language operator-safe", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-jobs-workspace.js"),
      "utf8"
    );

    expect(source).toContain("Billing readiness review");
    expect(source).toContain("Closeout check");
    expect(source).toContain("Run closeout review");
    expect(source).toContain("Site packet review");
    expect(source).not.toContain("Run closeout coach");
    expect(source).not.toContain("Field Closeout Coach");
  });

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

    const summary = context.buildJobReadinessSummary(job, null, null, {
      tickets: [],
      manifests: [],
      truckLoads: [
        {
          id: "manifest_live",
          manifest_number: "MAN-42",
          customer_id: "customer_other",
        },
      ],
    });

    expect(summary.title).toContain("blocker");
    expect(summary.blockers.map((item) => item.label)).toEqual(expect.arrayContaining([
      "Customer linked",
      "Service address",
      "Assigned crew",
      "Locate ticket",
      "Confined-space permit",
      "Compliance alerts",
      "Loads ready for closeout",
      "Truck load carryover",
    ]));
    expect(summary.nextStep).toContain("Link a customer");
  });

  test("buildJobCloseoutGuidance keeps payment follow-through visible after field work is done", () => {
    const { context } = loadJobsWorkspace({
      window: {
        PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE: {
          bookingDraftTimingInsight: vi.fn(() => ({
            reason: "The maintenance window is opening for this system, so the next visit should be queued now.",
            bookingDate: "2026-04-15",
          })),
        },
      },
      formatUsd: vi.fn((value) => `$${value}`),
      normalizeWorkflowStatusValue: vi.fn((value) => value),
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
          label: "HVAC",
          recordFocus: [],
        },
      })),
    });

    const guidance = context.buildJobCloseoutGuidance(
      { status: "completed" },
      null,
      { blockers: [], nextStep: "" },
      8500,
      {
        diagnostic_notes: "Low suction pressure confirmed",
        parts_follow_up: "Compressor contactor needs follow-up",
      }
    );

    expect(guidance.title).toBe("Field work is done, and payment is the next move");
    expect(guidance.description).toContain("invoice");
    expect(guidance.chips).toContain("$8500 still open");
    expect(guidance.items).toEqual([
      { label: "Findings logged", ready: true, note: "Low suction pressure confirmed" },
      { label: "Parts or return visit", ready: true, note: "Compressor contactor needs follow-up" },
      { label: "Approval or payment", ready: false, note: "Confirm whether approval, estimate follow-up, or payment collection is the next move after the technician leaves." },
      { label: "Renewal risk", ready: false, note: "The maintenance window is opening for this system, so the next visit should be queued now. Suggested next visit: 2026-04-15." },
    ]);
  });

  test("buildJobReactivationActions turns completed cleaning work into the next visit", () => {
    const { context } = loadJobsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "cleaning",
          label: "Cleaning",
          recordFocus: [],
        },
      })),
      normalizeWorkflowStatusValue: vi.fn((value) => value),
    });

    const actions = context.buildJobReactivationActions(
      { status: "completed" },
      null,
      {
        recurring_notes: "Every other Tuesday lobby touch-up",
      },
      0,
      { business: { key: "cleaning" } }
    );

    expect(actions.map((action) => action.label)).toEqual([
      "Schedule next cleaning visit",
      "Create cleaning follow-up request",
      "Open customer",
    ]);
  });

  test("buildJobCompletionActions adds review and rebooking for a completed paid visit", () => {
    const { context } = loadJobsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "cleaning",
          label: "Cleaning",
          recordFocus: [],
        },
      })),
      normalizeWorkflowStatusValue: vi.fn((value) => value),
    });

    const actions = context.buildJobCompletionActions(
      { status: "completed" },
      { id: "order_1", customer_email: "owner@example.com" },
      { recurring_notes: "Weekly lobby touch-up" },
      0,
      { business: { key: "cleaning" } }
    );

    expect(actions.map((action) => action.label)).toEqual([
      "Request review",
      "Schedule next cleaning visit",
      "Create cleaning follow-up request",
      "Open customer",
    ]);
  });

  test("buildJobCompletionActions can generate the next booked work when a recurring plan is due", () => {
    const { context } = loadJobsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
          label: "HVAC",
          recordFocus: [],
        },
      })),
      normalizeWorkflowStatusValue: vi.fn((value) => value),
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerRetentionWorkflowActions: vi.fn(() => ([
          { label: "Generate next booked work", action: "generate-next-order", className: "btn btn-primary btn-sm" },
          { label: "Create maintenance follow-up request", action: "create-request", className: "btn btn-ghost btn-sm" },
          { label: "Open customer", action: "open-reactivation-customer", className: "btn btn-ghost btn-sm" },
        ])),
      },
    });

    const actions = context.buildJobCompletionActions(
      { status: "completed" },
      { id: "order_1", customer_email: "ops@example.com" },
      { id: "customer_1", maintenance_notes: "Quarterly rooftop maintenance is due now" },
      0,
      { business: { key: "hvac" } }
    );

    expect(actions.map((action) => action.label)).toEqual([
      "Request review",
      "Generate next booked work",
      "Create maintenance follow-up request",
      "Open customer",
    ]);
  });

  test("jobCustomerMemoryItems reuses business-specific customer memory when it is available", () => {
    const { context } = loadJobsWorkspace({
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerMemoryChecklist: vi.fn(() => ([
          { label: "Property profile", ready: true, note: "123 Main St" },
          { label: "Access notes", ready: false, note: "Gate code still missing" },
        ])),
      },
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "landscaping",
          label: "Landscaping",
          recordFocus: ["Property profile", "Route cadence"],
        },
      })),
    });

    const items = context.jobCustomerMemoryItems({ id: "customer_1", name: "Logan's Lawn Care" });

    expect(items).toEqual([
      { label: "Property profile", ready: true, note: "123 Main St" },
      { label: "Access notes", ready: false, note: "Gate code still missing" },
    ]);
  });

  test("jobs workspace source uses shared memory checklist classes for readiness and customer memory", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-jobs-workspace.js"),
      "utf8"
    );

    expect(source).toContain("renderJobCustomerMemoryCard");
    expect(source).toContain("jobCustomerMemoryItems");
    expect(source).toContain("jobCloseoutChecklistItems");
    expect(source).toContain("buildJobCompletionActions");
    expect(source).toContain("buildJobReactivationActions");
    expect(source).toContain("data-job-reactivation-action");
    expect(source).toContain("request-review");
    expect(source).toContain("generate-next-order");
    expect(source).toContain("requestOrderReview(order.id");
    expect(source).toContain('class="memory-checklist u-mt-10"');
    expect(source).toContain('class="memory-checklist"');
    expect(source).toContain("memory-checklist__item--warn");
    expect(source).not.toContain('fetch("/.netlify/functions/request-review"');
    expect(source).not.toContain('background:${item.ready ? "rgba(46,125,50,.10)" : "rgba(200,75,47,.08)"}');
    expect(source).not.toContain('background:rgba(255,255,255,.03);');
    expect(source).not.toContain('style="margin-top:14px;"');
  });

  test("renderJobAgentReport keeps blockers, actions, and evidence visible", () => {
    const { context } = loadJobsWorkspace();

    const html = context.renderJobAgentReport({
      summary: "This job is not billing ready yet.",
      summary_status: "blocked",
      blockers: [
        { title: "Upload the after photo", detail: "Completion proof is still missing." },
      ],
      recommended_actions: [
        { title: "Create the invoice draft on the linked order", detail: "Generate the invoice now.", priority: "high" },
      ],
      findings: [
        { title: "Closeout note is missing", detail: "The crew finished without a usable note.", severity: "warning" },
      ],
      evidence: [
        { id: "proof_package", label: "Proof package" },
      ],
      billing_readiness: { score: 40 },
      confidence: { label: "medium" },
      data_used: [{ label: "Photos", count: 2 }],
      generated_at: "2026-04-02T10:15:00.000Z",
    });

    expect(html).toContain("Billing readiness 40/100");
    expect(html).toContain("Upload the after photo");
    expect(html).toContain("Create the invoice draft on the linked order");
    expect(html).toContain("Proof package");
    expect(html).toContain("Photos: 2");
  });
});
