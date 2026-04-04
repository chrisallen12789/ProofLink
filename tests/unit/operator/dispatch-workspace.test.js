"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeField() {
  return {
    value: "",
    innerHTML: "",
    addEventListener: vi.fn(),
  };
}

function loadDispatchWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-dispatch-workspace.js"),
    "utf8"
  );

  const dispatchBoard = {
    innerHTML: "",
    children: [],
    querySelectorAll: vi.fn(() => []),
  };
  const dispatchDetail = {
    innerHTML: "",
    querySelector: vi.fn(() => null),
  };
  const dispatchStageStrip = { innerHTML: "" };
  const dispatchActionBar = {
    innerHTML: "",
    querySelectorAll: vi.fn(() => []),
  };
  const dispatchDate = makeField();
  const btnRefreshDispatchBoard = makeField();

  const context = {
    console,
    window: {},
    dispatchBoard,
    dispatchDetail,
    dispatchStageStrip,
    dispatchActionBar,
    dispatchDate,
    btnRefreshDispatchBoard,
    JOBS_CACHE: [],
    EQUIPMENT_CACHE: [],
    TEAM_MEMBERS_CACHE: [],
    HYDROVAC_LOCATE_TICKETS_CACHE: [],
    HYDROVAC_PERMITS_CACHE: [],
    HYDROVAC_DRIVER_COMPLIANCE_CACHE: [],
    HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE: [],
    ACTIVE_DISPATCH_JOB_ID: "",
    ACTIVE_JOB_ID: "",
    document: {
      createElement: vi.fn(() => ({
        className: "",
        innerHTML: "",
        textContent: "",
        appendChild: vi.fn(),
      })),
    },
    isHydrovacJob: vi.fn(() => false),
    hydrovacJobSortDate: vi.fn(() => ""),
    hydrovacJobManifestSnapshot: vi.fn(() => ({ openGallons: 0, openLoads: 0, unbilledChargeCents: 0 })),
    hydrovacManifestToneClass: vi.fn(() => "pill-on"),
    hydrovacJobNeedsLocate: vi.fn(() => false),
    hydrovacJobNeedsPermit: vi.fn(() => false),
    normalizeWorkflowStatusValue: vi.fn((value) => value),
    teamMemberLabel: vi.fn(() => "Crew member"),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    titleCaseWords: (value) => String(value),
    formatUsd: vi.fn((value) => `$${value}`),
    renderRecordHeroCard: vi.fn((config = {}) => `<div class="record-hero">${String(config.title || "")}${String(config.description || "")}${String(config.actionsHtml || "")}</div>`),
    setInlineMessage: vi.fn(),
    switchTab: vi.fn(),
    requestOperatorFunction: vi.fn(() => Promise.resolve()),
    fetchJobs: vi.fn(() => Promise.resolve()),
    fetchEquipment: vi.fn(() => Promise.resolve()),
    fetchHydrovacLocateTickets: vi.fn(() => Promise.resolve()),
    fetchHydrovacComplianceData: vi.fn(() => Promise.resolve()),
    $: vi.fn(() => null),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, dispatchBoard, dispatchDetail, dispatchDate, btnRefreshDispatchBoard };
}

describe("operator dispatch workspace", () => {
  test("renderDispatchWorkspace shows empty detail state when there are no hydrovac jobs", () => {
    const { context, dispatchDetail, dispatchDate, dispatchBoard } = loadDispatchWorkspace();
    dispatchDate.value = "2026-03-26";

    context.window.renderDispatchWorkspace();

    expect(context.renderRecordHeroCard).toHaveBeenCalled();
    expect(dispatchBoard.innerHTML).toContain("Truck board");
    expect(dispatchDetail.innerHTML).toContain("No hydrovac jobs are scheduled");
  });

  test("initDispatchWorkspaceBindings only wires controls once", () => {
    const { context, dispatchDate, btnRefreshDispatchBoard } = loadDispatchWorkspace();

    context.window.initDispatchWorkspaceBindings();
    context.window.initDispatchWorkspaceBindings();

    expect(btnRefreshDispatchBoard.addEventListener).toHaveBeenCalledTimes(1);
    expect(dispatchDate.addEventListener).toHaveBeenCalledTimes(1);
  });

  test("dispatchTruckPlanner blocks cross-customer live loads and flags disposal timing", () => {
    const { context } = loadDispatchWorkspace();

    context.setDispatchTruckLoadState("truck_7", {
      rows: [{
        id: "manifest_a",
        job_id: "job_old",
        customer_id: "cust_old",
        quantity_actual: 1200,
        metadata: {
          load_state: "live_in_truck",
          bol_number: "BOL-7",
          live_load_hold_reason: "Truck still filling",
          disposal_ready_by: "2026-03-27",
        },
      }],
      loading: false,
      error: "",
      loadedAt: Date.now(),
    });

    const planner = context.dispatchTruckPlanner(
      { id: "truck_7", debris_tank_capacity_gallons: 2000 },
      { id: "job_new", customer_id: "cust_new" },
      "2026-03-28"
    );

    expect(planner.crossCustomerLoads).toHaveLength(1);
    expect(planner.overdueLoads).toHaveLength(1);
    expect(planner.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Cross-contamination risk", blocking: true }),
        expect.objectContaining({ label: "Disposal overdue", blocking: false }),
      ])
    );
  });

  test("dispatchTruckAuditPacket summarizes lifecycle, BOL, and hold reason", () => {
    const { context } = loadDispatchWorkspace({
      JOBS_CACHE: [{ id: "job_1", title: "Hydrovac trench" }],
      CUSTOMERS_CACHE: [{ id: "cust_1", name: "North Utility" }],
    });

    const packet = context.dispatchTruckAuditPacket(
      { id: "truck_1", unit_number: "HX-12", debris_tank_capacity_gallons: 2000 },
      {
        rows: [{
          id: "manifest_1",
          job_id: "job_1",
          customer_id: "cust_1",
          quantity_actual: 1200,
          status: "delivered",
          metadata: {
            load_state: "live_in_truck",
            bol_number: "BOL-12",
            live_load_hold_reason: "Waiting on compatible second load",
            disposal_ready_by: "2026-03-29",
          },
        }],
        liveLoads: [{}],
        carryoverLoads: [{}],
        gallons: 1200,
        capacityGallons: 2000,
      },
      [{ id: "job_1", title: "Hydrovac trench" }],
      [{ id: "cust_1", name: "North Utility" }]
    );

    expect(packet).toContain("Truck: HX-12");
    expect(packet).toContain("Lifecycle: Live in truck");
    expect(packet).toContain("BOL: BOL-12");
    expect(packet).toContain("Hold reason: Waiting on compatible second load");
  });

  test("renderDispatchAgentReview keeps blockers, route signals, and open-job actions visible", () => {
    const { context } = loadDispatchWorkspace();

    const markup = context.window.renderDispatchAgentReview({
      report: {
        summary: "The dispatch plan for 2026-04-03 needs operator review before it is truly executable.",
        summary_status: "blocked",
        findings: [{
          title: "Open jobs still need an owner",
          detail: "1 open job does not yet have an assigned crew member or operator.",
          severity: "warning",
          record_refs: [{ record_type: "job", record_id: "job_9", label: "North trench" }],
        }],
        blockers: [{
          title: "Resolve the overlapping crew slot",
          detail: "Move or reassign one of the overlapping jobs so the route is executable in the real world.",
        }],
        recommended_actions: [{
          title: "Tighten the route before crews roll",
          detail: "Bundle same-site work where it makes sense, then assign concrete times.",
          priority: "high",
        }],
        data_used: [{ label: "Jobs on selected date", count: 5 }],
        confidence: { label: "medium" },
        generated_at: "2026-04-02T14:00:00Z",
      },
      context_summary: {
        upcoming_jobs: 6,
        assignment_conflicts: 1,
        bundle_opportunities: 1,
      },
      generated_at: "2026-04-02T14:00:00Z",
    }, "2026-04-03");

    expect(markup).toContain("Dispatch / Scheduling Assistant");
    expect(markup).toContain("1 conflict");
    expect(markup).toContain("1 bundle opportunity");
    expect(markup).toContain("Open job");
  });
});
