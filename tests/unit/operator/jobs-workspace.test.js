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
  const jobDetailWrap = {
    innerHTML: "",
    querySelectorAll: vi.fn(() => []),
    querySelector: vi.fn(() => null),
  };
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
    saveJobRecord: vi.fn(async (patch = {}) => patch),
    setInlineMessage: vi.fn(),
    linkedOrderForJob: vi.fn(() => null),
    linkedLeadForOrder: vi.fn(() => null),
    linkedBidForOrder: vi.fn(() => null),
    orderDepositStatus: vi.fn(() => "not_due"),
    jobRevenueCents: vi.fn(() => 0),
    jobTrackedCostCents: vi.fn(() => 0),
    jobGrossProfitCents: vi.fn(() => 0),
    jobMarginRatio: vi.fn(() => 0),
    grossProfitToneClass: vi.fn(() => "pill-ok"),
    marginToneClass: vi.fn(() => "pill-ok"),
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
    orderPaymentState: vi.fn(() => "unpaid"),
    formatUsd: vi.fn((value) => `$${value}`),
    formatDateTime: vi.fn((value) => String(value)),
    formatPercent: vi.fn((value) => `${value}%`),
    paymentStateClass: vi.fn(() => "pill-ok"),
    renderRecordHeroCard: vi.fn((config = {}) => `<div class="record-hero">${String(config.title || "")}${String(config.actionsHtml || "")}</div>`),
    renderRecordActionButtons: vi.fn((actions = []) =>
      actions
        .map((action) => `<button type="button">${String(action.label || "")}</button>`)
        .join("")
    ),
    renderRecordActionRail: vi.fn((config = {}) => `<div class="record-action-rail">${(Array.isArray(config)
      ? config
      : Array.isArray(config.actions)
        ? config.actions
        : [])
      .map((action) => `<button type="button">${String(action.label || "")}</button>`)
      .join("")}</div>`),
    renderRecordFollowThroughCard: vi.fn((config = {}) => `<div class="record-follow-through">${String(config.title || "")}${String(config.controlsHtml || "")}${String(config.timelineHtml || "")}${(Array.isArray(config.actions) ? config.actions : [])
      .map((action) => `<button type="button">${String(action.label || "")}</button>`)
      .join("")}</div>`),
    renderLinkedRecordCard: vi.fn((config = {}) => `<div class="linked-record-card">${String(config.title || "")}${String(config.footerHtml || "")}</div>`),
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
    expect(source).toContain("workspace-command-center");
    expect(source).toContain("Execution focus");
    expect(source).toContain("Open dispatch");
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

  test("buildJobReadinessSummary and focus card use the assigned crew label from member records", () => {
    const { context } = loadJobsWorkspace({
      TEAM_MEMBERS_CACHE: [
        {
          id: "member_1",
          display_name: "Skylar Stevens",
          role_title: "Crew Lead",
          user_id: "user_1",
        },
      ],
      normalizeWorkflowStatusValue: vi.fn((value) => value),
      formatUsd: vi.fn((value) => `$${value}`),
    });

    const summary = context.buildJobReadinessSummary(
      { assigned_operator_id: "member_1", status: "scheduled" },
      null,
      null,
      null,
      { business: { key: "other" } }
    );
    const assignmentItem = summary.items.find((item) => item.label === "Assigned crew");

    expect(assignmentItem.note).toContain("Skylar Stevens (Crew Lead)");

    const markup = context.renderJobExecutionFocusCard({
      job: { assigned_operator_id: "member_1", status: "scheduled" },
      readiness: { blockers: [], nextStep: "" },
      depositStatus: "not_due",
      amountDueCents: 0,
      actions: [],
    });

    expect(markup).toContain("Skylar Stevens (Crew Lead)");
  });

  test("renderJobDetail shows compound route planning when same-day crew work still fits the minimum block", async () => {
    const { context, jobDetailWrap } = loadJobsWorkspace({
      TEAM_MEMBERS_CACHE: [
        {
          id: "member_1",
          display_name: "Skylar Stevens",
          role_title: "Crew Lead",
          user_id: "user_1",
        },
      ],
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "North trench",
          customer_id: "customer_1",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          scheduled_time: "08:00",
          assigned_member_id: "member_1",
          billable_hours: 1.5,
          minimum_hours: 4,
          travel_hours: 0.25,
        },
        {
          id: "job_2",
          title: "West basin cleanup",
          customer_id: "customer_1",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          scheduled_time: "12:00",
          assigned_member_id: "member_1",
          billable_hours: 1,
          minimum_hours: 4,
          travel_hours: 0.25,
        },
      ],
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "North Utility" }],
      normalizeWorkflowStatusValue: vi.fn((value) => value),
    });

    await context.renderJobDetail("job_1");

    expect(jobDetailWrap.innerHTML).toContain("Compound route planning");
    expect(jobDetailWrap.innerHTML).toContain("same minimum block");
    expect(jobDetailWrap.innerHTML).toContain("West basin cleanup");
    expect(jobDetailWrap.innerHTML).toContain("Expected hours");
    expect(jobDetailWrap.innerHTML).toContain("Save planning");
  });

  test("renderJobDetail surfaces assignment pressure and last field update details", async () => {
    const formatDateTime = vi.fn((value) => `formatted:${value}`);
    const { context, jobDetailWrap } = loadJobsWorkspace({
      TEAM_MEMBERS_CACHE: [
        {
          id: "member_1",
          display_name: "Skylar Stevens",
          role_title: "Crew Lead",
          user_id: "user_1",
        },
      ],
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "North trench",
          customer_id: "customer_1",
          status: "blocked",
          scheduled_date: "2026-04-08",
          assigned_member_id: "member_1",
          assigned_truck_id: "truck_1",
          billable_hours: 3,
          minimum_hours: 4,
          travel_hours: 0.5,
          blocker_note: "Customer gate is locked",
          updated_at: "2026-04-08T09:15:00Z",
        },
        {
          id: "job_2",
          title: "West basin cleanup",
          customer_id: "customer_1",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          assigned_member_id: "member_1",
          assigned_truck_id: "truck_1",
          billable_hours: 2.5,
          minimum_hours: 4,
          travel_hours: 0.5,
        },
      ],
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "North Utility" }],
      normalizeWorkflowStatusValue: vi.fn((value) => value),
      formatDateTime,
    });

    await context.renderJobDetail("job_1");

    expect(jobDetailWrap.innerHTML).toContain("Assignment pressure");
    expect(jobDetailWrap.innerHTML).toContain("Crew double-booked");
    expect(jobDetailWrap.innerHTML).toContain("Truck double-booked");
    expect(jobDetailWrap.innerHTML).toContain("Last field update: formatted:2026-04-08T09:15:00Z");
    expect(jobDetailWrap.innerHTML).toContain("Blocker note: Customer gate is locked");
  });

  test("buildJobCloseoutGuidance keeps hydrovac records, audit, and invoice handoff attached to the completed job", () => {
    const job = {
      id: "job_hv_2",
      status: "completed",
      job_type: "hydrovac_excavation",
      notes: "Crew finished the vault cleanout and hauled one load.",
    };
    const hydrovacState = {
      manifests: [
        {
          id: "manifest_hv_2",
          manifest_number: "MAN-88",
          status: "confirmed",
          disposal_facility_name: "North Transfer",
          disposal_ticket_number: "DT-44",
          quantity_actual: 1800,
          invoiced: false,
          metadata: {
            bol_number: "BOL-44",
          },
        },
      ],
    };
    const { context } = loadJobsWorkspace({
      isHydrovacJob: vi.fn(() => true),
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hydrovac",
          label: "Hydrovac",
          recordFocus: ["Locate coverage", "Manifest closeout", "Billing handoff"],
        },
      })),
      hydrovacJobManifestSnapshot: vi.fn(() => ({
        openLoads: 0,
        confirmedUnbilled: 1,
        manifests: hydrovacState.manifests,
      })),
      normalizeWorkflowStatusValue: vi.fn((value) => value),
      orderAmountDueCents: vi.fn(() => 4500),
      formatUsd: vi.fn((value) => `$${value}`),
    });

    const readiness = context.buildJobReadinessSummary(job, { id: "order_hv_2" }, null, hydrovacState, {
      business: { key: "hydrovac" },
    });
    const guidance = context.buildJobCloseoutGuidance(
      job,
      { id: "order_hv_2" },
      readiness,
      4500,
      null,
      { business: { key: "hydrovac" } }
    );

    expect(guidance.title).toContain("hydrovac closeout");
    expect(guidance.description).toContain("audit");
    expect(guidance.chips).toEqual(expect.arrayContaining([
      "1 load tracked",
      "2 packet gaps",
      "1 waiting on invoice",
    ]));
    expect(guidance.items.map((item) => item.label)).toEqual([
      "Field note saved",
      "Load records confirmed",
      "Customer records ready",
      "Audit packet ready",
      "Billing handoff",
    ]);
    expect(guidance.items.find((item) => item.label === "Customer records ready")).toMatchObject({
      ready: false,
      note: "Prepare the customer-records email for MAN-88 before the file leaves the office.",
    });
    expect(guidance.items.find((item) => item.label === "Audit packet ready")).toMatchObject({
      ready: false,
      note: "Prepare the audit handoff for MAN-88 before records or compliance archive this job.",
    });
    expect(guidance.items.find((item) => item.label === "Billing handoff")).toMatchObject({
      ready: false,
      note: "Draft the hydrovac invoice for MAN-88 and keep the money chain attached to this job.",
    });
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

  test("buildJobCompletionActions prioritizes hydrovac office handoff when closeout is not clean", () => {
    const { context } = loadJobsWorkspace({
      isHydrovacJob: vi.fn(() => true),
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hydrovac",
          label: "Hydrovac",
          recordFocus: [],
        },
      })),
      hydrovacJobManifestSnapshot: vi.fn(() => ({
        openLoads: 0,
        confirmedUnbilled: 1,
        manifests: [
          {
            id: "manifest_hv_3",
            manifest_number: "MAN-99",
            status: "confirmed",
            invoiced: false,
            disposal_facility_name: "North Transfer",
            disposal_ticket_number: "DT-91",
            quantity_actual: 1200,
            metadata: {
              bol_number: "BOL-91",
            },
          },
        ],
      })),
      normalizeWorkflowStatusValue: vi.fn((value) => value),
      orderAmountDueCents: vi.fn(() => 9900),
    });

    const actions = context.buildJobCompletionActions(
      { id: "job_hv_3", status: "completed", job_type: "hydrovac_excavation" },
      { id: "order_hv_3", customer_email: "ops@example.com" },
      null,
      9900,
      { business: { key: "hydrovac" } }
    );

    expect(actions.map((action) => action.label)).toEqual([
      "Prepare customer records",
      "Prepare audit handoff",
      "Draft hydrovac invoice",
      "Open money",
      "Open hydrovac ops",
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
    expect(source).toContain("Prepare customer records");
    expect(source).toContain("Prepare audit handoff");
    expect(source).toContain("Draft hydrovac invoice");
    expect(source).toContain("Open hydrovac ops");
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

  test("jobs workspace shows a crew portal handoff action for assigned work", async () => {
    const renderRecordActionRail = vi.fn((config = {}) => `<div class="record-action-rail">${(Array.isArray(config.actions) ? config.actions : [])
      .map((action) => `<button type="button">${String(action.label || "")}</button>`)
      .join("")}</div>`);
    const { context, jobDetailWrap } = loadJobsWorkspace({
      JOBS_CACHE: [{
        id: "job_crew_1",
        title: "North trench daylighting",
        status: "scheduled",
        customer_id: "customer_1",
        assigned_operator_id: "member_1",
      }],
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "North Utility" }],
      TEAM_MEMBERS_CACHE: [{ id: "member_1", display_name: "Skylar Stevens" }],
      renderRecordActionRail,
    });

    await context.renderJobDetail("job_crew_1");

    expect(renderRecordActionRail).toHaveBeenCalledWith(expect.objectContaining({
      actions: expect.arrayContaining([
        expect.objectContaining({
          label: "Open in crew portal",
          data: expect.objectContaining({ "job-quick-action": "open-crew" }),
        }),
      ]),
    }));
    expect(jobDetailWrap.innerHTML).toContain("Open in crew portal");
  });

  test("jobs workspace can assign a crew member and open the crew portal from job detail", async () => {
    let saveHandler = null;
    let saveAndOpenHandler = null;
    const assignmentSelect = { value: "member_1" };
    const assignmentMsg = {};
    const saveButton = {
      addEventListener: vi.fn((eventName, handler) => {
        if (eventName === "click") saveHandler = handler;
      }),
    };
    const saveAndOpenButton = {
      addEventListener: vi.fn((eventName, handler) => {
        if (eventName === "click") saveAndOpenHandler = handler;
      }),
    };
    const saveJobRecord = vi.fn(async (patch = {}) => {
      const updatedJob = {
        id: "job_crew_2",
        title: "Downtown flush and daylighting",
        status: "scheduled",
        customer_id: "customer_1",
        ...patch,
      };
      return updatedJob;
    });
    const openSpy = vi.fn();
    const { context, jobDetailWrap } = loadJobsWorkspace({
      JOBS_CACHE: [{
        id: "job_crew_2",
        title: "Downtown flush and daylighting",
        status: "scheduled",
        customer_id: "customer_1",
      }],
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "Downtown Utilities" }],
      TEAM_MEMBERS_CACHE: [{
        id: "member_1",
        display_name: "Skylar Stevens",
        role_title: "Crew Lead",
        operator_id: "operator_1",
      }],
      saveJobRecord,
      window: { open: openSpy },
    });

    jobDetailWrap.querySelector = vi.fn((selector) => ({
      "#jobAssignmentMember": assignmentSelect,
      "#jobAssignmentMsg": assignmentMsg,
      "#btnJobSaveCrewAssignment": saveButton,
      "#btnJobAssignAndOpenCrew": saveAndOpenButton,
    }[selector] || null));
    jobDetailWrap.querySelectorAll = vi.fn(() => []);

    await context.renderJobDetail("job_crew_2");
    expect(jobDetailWrap.innerHTML).toContain("Assign and open crew portal");
    expect(typeof saveAndOpenHandler).toBe("function");

    await saveAndOpenHandler();

    expect(saveJobRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: "job_crew_2",
      assigned_member_id: "member_1",
      assigned_operator_id: "operator_1",
    }));
    expect(openSpy).toHaveBeenCalledWith("/crew/?job=job_crew_2&source=operator", "_blank", "noopener");
  });

  test("jobs workspace can save crew planning from job detail", async () => {
    const saveJobRecord = vi.fn(async (patch = {}) => patch);
    const planningMsg = { textContent: "" };
    const expectedInput = { value: "1.75" };
    const minimumInput = { value: "4" };
    const travelInput = { value: "0.5" };
    const savePlanningButton = { addEventListener: vi.fn() };
    const logHoursButton = { addEventListener: vi.fn() };
    const saveAssignmentButton = { addEventListener: vi.fn() };
    const assignAndOpenButton = { addEventListener: vi.fn() };
    const openRequestButton = { addEventListener: vi.fn() };
    const openBidButton = { addEventListener: vi.fn() };
    const openCustomerButton = { addEventListener: vi.fn() };
    const { context, jobDetailWrap } = loadJobsWorkspace({
      TEAM_MEMBERS_CACHE: [
        {
          id: "member_1",
          display_name: "Skylar Stevens",
          role_title: "Crew Lead",
          user_id: "user_1",
        },
      ],
      JOBS_CACHE: [
        {
          id: "job_plan_1",
          title: "North trench",
          customer_id: "customer_1",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          assigned_member_id: "member_1",
          billable_hours: 1.5,
          minimum_hours: 4,
          travel_hours: 0.25,
        },
      ],
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "North Utility" }],
      saveJobRecord,
      renderJobDetail: vi.fn(() => Promise.resolve()),
    });

    const queryMap = {
      "#jobCrewExpectedHours": expectedInput,
      "#jobCrewMinimumBlock": minimumInput,
      "#jobCrewTravelHours": travelInput,
      "#jobCrewPlanningMsg": planningMsg,
      "#btnJobSaveCrewPlanning": savePlanningButton,
      "#btnJobLogHours": logHoursButton,
      "#btnJobSaveCrewAssignment": saveAssignmentButton,
      "#btnJobAssignAndOpenCrew": assignAndOpenButton,
      "#jobAssignmentMsg": { textContent: "" },
      "#jobAssignmentMember": { value: "member_1" },
      "#btnJobOpenRequest": openRequestButton,
      "#btnJobOpenBid": openBidButton,
      "#btnJobOpenCustomer": openCustomerButton,
    };
    jobDetailWrap.querySelector = vi.fn((selector) => {
      return queryMap[selector] || null;
    });

    await context.renderJobDetail("job_plan_1");
    await savePlanningButton.addEventListener.mock.calls[0][1]();

    expect(saveJobRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: "job_plan_1",
      billable_hours: 1.75,
      minimum_hours: 4,
      travel_hours: 0.5,
    }));
  });

  test("jobs workspace surfaces crew blocker acknowledgment in job detail", async () => {
    const { context, jobDetailWrap } = loadJobsWorkspace({
      JOBS_CACHE: [{
        id: "job_blocked_1",
        title: "South main repair",
        status: "blocked",
        customer_id: "customer_1",
        assigned_operator_id: "member_1",
        blocker_note: "Customer gate is locked",
      }],
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "South Main" }],
      TEAM_MEMBERS_CACHE: [{ id: "member_1", display_name: "Skylar Stevens", role_title: "Crew Lead" }],
    });

    await context.renderJobDetail("job_blocked_1");

    expect(jobDetailWrap.innerHTML).toContain("Crew acknowledgment");
    expect(jobDetailWrap.innerHTML).toContain("Crew reported a blocker");
    expect(jobDetailWrap.innerHTML).toContain("Customer gate is locked");
  });
});
