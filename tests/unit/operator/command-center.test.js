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
    TENANT_ID: "tenant_1",
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
    ACTIVE_ORDER_ID: "",
    ACTIVE_CUSTOMER_ID: "customer_1",
    FOLLOW_UP_QUEUE_MESSAGE: "",
    FOLLOW_UP_QUEUE_MESSAGE_TONE: "",
    setFollowUpQueueMessage: vi.fn(),
    requestOperatorFunction: vi.fn(() => Promise.resolve({})),
    sortedPayments: vi.fn((rows) => rows),
    currentPayment: vi.fn(() => null),
    orderPaymentState: vi.fn(() => "unpaid"),
    normalizeWorkflowStatusValue: vi.fn((value) => String(value || "").trim().toLowerCase()),
    formatDateOnly: vi.fn((value) => String(value)),
    orderDepositGapCents: vi.fn(() => 0),
    forecastMonthOrders: vi.fn(() => 0),
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    $: vi.fn(() => null),
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
  test("buildDashboardCollectionGuidance prioritizes overdue balances first", () => {
    const { context } = loadCommandCenter({
      formatUsd: (value) => `$${value}`,
    });

    const guidance = context.buildDashboardCollectionGuidance({
      outstandingBalance: 22000,
      overdueBalance: 9000,
      missingDepositBalance: 0,
      completedUnpaidBalance: 4000,
    });

    expect(guidance.title).toBe("Overdue money needs attention first");
    expect(guidance.chips).toContain("$9000 overdue");
  });

  test("buildDashboardRepeatWorkGuidance prioritizes due recurring work before passive renewals", () => {
    const { context } = loadCommandCenter();

    const guidance = context.buildDashboardRepeatWorkGuidance({
      duePlansCount: 2,
      activePlansCount: 5,
      todayBookingsCount: 1,
      blueprint: { business: { key: "cleaning" } },
    });

    expect(guidance.title).toBe("Recurring work is due right now");
    expect(guidance.chips).toContain("2 recurring visits due");
    expect(guidance.chips).toContain("5 active plans");
  });

  test("buildDashboardRepeatWorkGuidance turns healthy HVAC renewals into maintenance follow-through", () => {
    const { context } = loadCommandCenter();

    const guidance = context.buildDashboardRepeatWorkGuidance({
      duePlansCount: 0,
      activePlansCount: 3,
      todayBookingsCount: 0,
      blueprint: { business: { key: "hvac" } },
    });

    expect(guidance.title).toBe("Repeat work is in a healthy place");
    expect(guidance.description).toContain("maintenance");
    expect(guidance.chips).toContain("3 active plans");
    expect(guidance.chips).toContain("Nothing urgent to renew");
  });

  test("buildDashboardRepeatWorkGuidance surfaces renewal risk before calling repeat work healthy", () => {
    const { context } = loadCommandCenter();

    const guidance = context.buildDashboardRepeatWorkGuidance({
      duePlansCount: 0,
      activePlansCount: 4,
      todayBookingsCount: 0,
      atRiskPlansCount: 2,
      blueprint: { business: { key: "cleaning" } },
    });

    expect(guidance.title).toBe("Some repeat work is at renewal risk");
    expect(guidance.description).toContain("next visit");
    expect(guidance.chips).toContain("2 plans missing the next move");
    expect(guidance.chips).toContain("4 active plans");
  });

  test("buildDashboardReactivationGuidance spotlights dormant cleaning accounts", () => {
    const { context } = loadCommandCenter();

    const guidance = context.buildDashboardReactivationGuidance({
      dormantRepeatCount: 3,
      blueprint: { business: { key: "cleaning" } },
    });

    expect(guidance.title).toBe("Dormant repeat accounts need reactivation");
    expect(guidance.description).toContain("Rebook");
    expect(guidance.chips).toContain("3 accounts need reactivation");
  });

  test("priorityReactivationCustomer picks the stalest dormant repeat account", () => {
    const { context } = loadCommandCenter({
      window: {
        PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
          customerRepeatCadenceInsight: (customer) => customer.id === "customer_stale"
            ? { message: "This account usually runs about every 14 days and is roughly 20 days past that rhythm." }
            : null,
        },
      },
      CUSTOMERS_CACHE: [
        { id: "customer_recent", name: "Recent Repeat", recurring_notes: "Monthly", updated_at: "2026-03-26T12:00:00Z" },
        { id: "customer_stale", name: "Quiet Cleaning", recurring_notes: "Every other Tuesday", updated_at: "2026-02-01T12:00:00Z" },
      ],
      SERVICE_PLANS_CACHE: [],
      CRM_ORDERS_CACHE: [],
      JOBS_CACHE: [],
      LEADS_CACHE: [],
      BIDS_CACHE: [],
    });

    const target = context.priorityReactivationCustomer({
      customers: context.CUSTOMERS_CACHE,
      blueprint: { business: { key: "cleaning" } },
    });

    expect(target.customer.name).toBe("Quiet Cleaning");
    expect(target.note).toContain("20 days past that rhythm");
  });

  test("repeatWorkReasonContext reuses booking timing intelligence for the next repeat account", () => {
    const { context } = loadCommandCenter({
      window: {
        PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE: {
          bookingDraftTimingInsight: vi.fn(() => ({
            reason: "The maintenance window is opening for this system, so the next visit should be queued now.",
            bookingDate: "2026-04-15",
          })),
        },
      },
      CUSTOMERS_CACHE: [
        { id: "customer_1", name: "Harbor Suites", maintenance_notes: "Spring cooling tune-up" },
      ],
      SERVICE_PLANS_CACHE: [
        { id: "plan_1", customer_id: "customer_1", status: "active" },
      ],
    });

    const reason = context.repeatWorkReasonContext({
      activePlans: context.SERVICE_PLANS_CACHE,
      blueprint: { business: { key: "hvac" } },
    });

    expect(reason.customerName).toBe("Harbor Suites");
    expect(reason.note).toContain("maintenance window is opening");
    expect(reason.suggestedDate).toBe("2026-04-15");
  });

  test("renderDashboard shows repeat-service focus on shared dashboard classes", () => {
    const { context } = loadCommandCenter({
      dashboardWrap: { innerHTML: "", querySelectorAll: vi.fn(() => []), querySelector: vi.fn(() => null) },
      window: {
        PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
          customerRetentionWorkflowActions: vi.fn(() => [
            { label: "Generate next booked work", action: "generate-next-order", className: "btn btn-primary btn-sm" },
            { label: "Create cleaning follow-up request", action: "create-request", className: "btn btn-ghost btn-sm" },
            { label: "Open customer", action: "open-reactivation-customer", className: "btn btn-ghost btn-sm" },
          ]),
          customerScheduleActionLabel: vi.fn(() => "Schedule next cleaning visit"),
          customerCreateRequestActionLabel: vi.fn(() => "Create cleaning follow-up request"),
        },
        PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE: {
          bookingDraftTimingInsight: vi.fn(() => ({
            reason: "The seasonal window is opening, so this property follow-up should be queued now.",
            bookingDate: "2026-04-11",
          })),
        },
      },
      workspaceSummaryData: vi.fn(() => ({ priorityOutcomes: ["Keep the next renewal visible."] })),
      servicePipelineSnapshot: vi.fn(() => ({ leads: 1, quoted: 2, booked: 3, inProgress: 1, completed: 0, paid: 0 })),
      todayActionItems: vi.fn(() => []),
      dashboardClientTrackerRows: vi.fn(() => []),
      buildFollowUpQueue: vi.fn(() => []),
      currentMonthExpenseCents: vi.fn(() => 0),
      quotedRevenueCents: vi.fn(() => 0),
      PRODUCTS_CACHE: [],
      sortedCustomers: vi.fn(() => []),
      staleLeads: vi.fn(() => []),
      completedUnpaidOrders: vi.fn(() => []),
      dueServicePlans: vi.fn(() => [{ id: "plan_1", customer_id: "customer_1" }]),
      SERVICE_PLANS_CACHE: [{ id: "plan_1", customer_id: "customer_1", status: "active" }],
      ordersMissingDeposits: vi.fn(() => []),
      orderAmountDueCents: vi.fn(() => 0),
      outstandingBalanceCents: vi.fn(() => 0),
      overdueBalanceCents: vi.fn(() => 0),
      formatUsd: vi.fn((value) => `$${value}`),
      workspaceOrderLabelLower: vi.fn(() => "booked work"),
      workspaceCatalogLabelLower: vi.fn(() => "services"),
      openOrdersCount: vi.fn(() => 0),
      currentMonthRevenueCents: vi.fn(() => 0),
      currentMonthOrderCount: vi.fn(() => 0),
      averageOrderValueCents: vi.fn(() => 0),
      currentMonthCustomerCount: vi.fn(() => 0),
      BOOKINGS_CACHE: [],
      CRM_ORDERS_CACHE: [],
      PAYMENTS_CACHE: [],
      EXPENSES_CACHE: [],
      CUSTOMERS_CACHE: [{ id: "customer_1", name: "Logan's Lawn Care", recurring_notes: "Every other Tuesday" }],
      LEADS_CACHE: [],
      JOBS_CACHE: [],
      BIDS_CACHE: [],
      DASHBOARD_LAUNCH_CHECKLIST: null,
      DASHBOARD_PAYMENT_STATE: null,
      renderTodayFocusSection: vi.fn(() => ""),
      hydrovacDashboardSnapshot: vi.fn(() => null),
      localStorage: {
        getItem: vi.fn((key) => (key === "pl_onboarding_dismissed" ? "false" : "")),
        setItem: vi.fn(),
      },
      location: { origin: "https://prooflink.co" },
      navigator: { clipboard: { writeText: vi.fn(() => Promise.resolve()) } },
      money: vi.fn((value) => `$${value}`),
      monthKeyFromDate: vi.fn(() => "2026-03"),
      yyyymm: vi.fn(() => "2026-03"),
      paymentRevenueContributionCents: vi.fn(() => 0),
      workspaceSummaryData: vi.fn(() => ({ priorityOutcomes: ["Keep the next renewal visible."] })),
    });

    context.window.renderDashboard();

    expect(context.dashboardWrap.innerHTML).toContain("Repeat-service focus");
    expect(context.dashboardWrap.innerHTML).toContain("AI ops queue");
    expect(context.dashboardWrap.innerHTML).toContain("dashboard-focus-card");
    expect(context.dashboardWrap.innerHTML).toContain("dashboard-focus-title");
    expect(context.dashboardWrap.innerHTML).toContain("seasonal window is opening");
    expect(context.dashboardWrap.innerHTML).toContain("Suggested next visit: 2026-04-11");
    expect(context.dashboardWrap.innerHTML).toContain("onboarding-card");
    expect(context.dashboardWrap.innerHTML).toContain("onboarding-progress__fill");
    expect(context.dashboardWrap.innerHTML).not.toContain('style="font-weight:700;"');
    expect(context.dashboardWrap.innerHTML).not.toContain('style="margin-bottom:16px;border:1px solid rgba(200,75,47,.3);background:rgba(200,75,47,.04);"');
  });

  test("renderDashboardAiOpsQueue shows billing, dispatch, and collections actions together", () => {
    const { context } = loadCommandCenter();

    const html = context.window.PROOFLINK_OPERATOR_COMMAND_CENTER.renderDashboardAiOpsQueue({
      billing: {
        context_summary: { queued_jobs: 2 },
        report: {
          findings: [
            {
              title: "Missing job closeout",
              detail: "Crew left without signature capture.",
              severity: "warning",
              record_refs: [
                { record_type: "job", record_id: "job_1" },
                { record_type: "customer", record_id: "customer_1" },
              ],
            },
          ],
        },
      },
      dispatch: {
        report: {
          blockers: [{ code: "truck_missing" }],
          findings: [
            {
              title: "Truck still unassigned",
              detail: "Tomorrow's run still needs a truck.",
              severity: "critical",
              record_refs: [{ record_type: "job", record_id: "job_2" }],
            },
          ],
        },
      },
      collections: {
        context_summary: { overdue_count: 1, missing_due_dates: 1 },
        report: {
          findings: [
            {
              title: "Invoice has no due date",
              detail: "The balance is open and the due date is blank.",
              severity: "warning",
              record_refs: [
                { record_type: "order", record_id: "order_1" },
                { record_type: "customer", record_id: "customer_2" },
              ],
            },
          ],
        },
      },
      ui: { message: "AI ops review refreshed.", tone: "ok" },
      useDispatchTab: true,
    });

    expect(html).toContain("2 billing queued");
    expect(html).toContain("1 dispatch blocker");
    expect(html).toContain("1 overdue balance");
    expect(html).toContain("1 missing due date");
    expect(html).toContain("Record payment");
    expect(html).toContain("Open dispatch");
    expect(html).toContain("Open order");
    expect(html).toContain("Open customer");
  });

  test("runDashboardAiOpsReview refreshes the shared AI caches", async () => {
    const targetDate = new Date().toISOString().slice(0, 10);
    const requestOperatorFunction = vi.fn((name, options) => {
      expect(name).toBe("ai-agent-report");
      const agentKey = options?.body?.agent_key;
      if (agentKey === "billing_blocker_detector") {
        return Promise.resolve({
          generated_at: "2026-04-02T10:00:00.000Z",
          context_summary: { queued_jobs: 3 },
          report: {
            findings: [
              {
                title: "Billing queue item",
                severity: "warning",
                record_refs: [{ record_type: "job", record_id: "job_10" }],
              },
            ],
          },
        });
      }
      if (agentKey === "dispatch_scheduling_assistant") {
        return Promise.resolve({
          generated_at: "2026-04-02T10:05:00.000Z",
          context_summary: { open_jobs: 4 },
          report: {
            blockers: [{ code: "crew_gap" }],
            findings: [
              {
                title: "Dispatch queue item",
                severity: "critical",
                record_refs: [{ record_type: "job", record_id: "job_11" }],
              },
            ],
          },
        });
      }
      if (agentKey === "collections_followup_assistant") {
        return Promise.resolve({
          generated_at: "2026-04-02T10:10:00.000Z",
          context_summary: { overdue_count: 2, missing_due_dates: 1 },
          report: {
            findings: [
              {
                title: "Collections queue item",
                severity: "warning",
                record_refs: [
                  { record_type: "order", record_id: "order_10" },
                  { record_type: "customer", record_id: "customer_10" },
                ],
              },
            ],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected agent key: ${agentKey}`));
    });

    const { context } = loadCommandCenter({
      isHydrovacWorkspace: vi.fn(() => true),
      requestOperatorFunction,
      window: {
        PROOFLINK_BILLING_BLOCKER_AGENT_STATE: {
          report: null,
          context_summary: null,
          generated_at: "",
        },
        PROOFLINK_COLLECTIONS_AGENT_STATE: {
          report: null,
          context_summary: null,
          generated_at: "",
        },
        PROOFLINK_DISPATCH_AGENT_REVIEW_CACHE: {},
      },
    });

    await context.window.PROOFLINK_OPERATOR_COMMAND_CENTER.runDashboardAiOpsReview({
      business: { key: "hydrovac" },
    });

    expect(requestOperatorFunction).toHaveBeenCalledTimes(3);
    expect(requestOperatorFunction).toHaveBeenNthCalledWith(
      1,
      "ai-agent-report",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ agent_key: "billing_blocker_detector", limit: 8 }),
      })
    );
    expect(requestOperatorFunction).toHaveBeenNthCalledWith(
      2,
      "ai-agent-report",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          agent_key: "dispatch_scheduling_assistant",
          target_date: targetDate,
          days: 3,
          job_type: "hydrovac",
        }),
      })
    );
    expect(requestOperatorFunction).toHaveBeenNthCalledWith(
      3,
      "ai-agent-report",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ agent_key: "collections_followup_assistant" }),
      })
    );
    expect(context.window.PROOFLINK_BILLING_BLOCKER_AGENT_STATE.context_summary).toEqual({ queued_jobs: 3 });
    expect(context.window.PROOFLINK_COLLECTIONS_AGENT_STATE.context_summary).toEqual({
      overdue_count: 2,
      missing_due_dates: 1,
    });
    expect(context.window.PROOFLINK_DISPATCH_AGENT_REVIEW_CACHE[targetDate]).toEqual(
      expect.objectContaining({
        context_summary: { open_jobs: 4 },
        generated_at: "2026-04-02T10:05:00.000Z",
        report: expect.objectContaining({
          blockers: [{ code: "crew_gap" }],
        }),
      })
    );
    expect(context.window.PROOFLINK_AI_OPS_QUEUE_STATE).toEqual(
      expect.objectContaining({
        message: "AI ops review refreshed.",
        tone: "ok",
      })
    );
  });

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
