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
    saveJobRecord: vi.fn(async (patch = {}) => patch),
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

  test("renderDispatchWorkspace resolves assigned driver from assigned_operator_id when needed", () => {
    const { context, dispatchDetail, dispatchDate } = loadDispatchWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobSortDate: vi.fn((job) => job.scheduled_date || ""),
      teamMemberLabel: vi.fn((member) => member.display_name || member.name || "Crew member"),
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", display_name: "Skylar Stevens", user_id: "user_1" },
      ],
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "North trench",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          service_address: "123 Main St",
          assigned_operator_id: "member_1",
          customer_name: "North Utility",
        },
      ],
    });
    dispatchDate.value = "2026-04-08";

    context.window.renderDispatchWorkspace();

    expect(dispatchDetail.innerHTML).toContain("Skylar Stevens");
    expect(dispatchDetail.innerHTML).toContain("Open in crew portal");
  });

  test("renderDispatchWorkspace shows crew acknowledgment when dispatch is still waiting on field updates", () => {
    const { context, dispatchDetail, dispatchDate } = loadDispatchWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobSortDate: vi.fn((job) => job.scheduled_date || ""),
      teamMemberLabel: vi.fn((member) => member.display_name || member.name || "Crew member"),
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", display_name: "Skylar Stevens", user_id: "user_1" },
      ],
      JOBS_CACHE: [
        {
          id: "job_2",
          title: "West basin cleanup",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          assigned_operator_id: "member_1",
          customer_name: "West Basin",
        },
      ],
    });
    dispatchDate.value = "2026-04-08";

    context.window.renderDispatchWorkspace();

    expect(dispatchDetail.innerHTML).toContain("Crew acknowledgment");
    expect(dispatchDetail.innerHTML).toContain("Waiting on crew acknowledgment");
  });

  test("renderDispatchWorkspace surfaces blocker notes, field update timing, and assignment actions", () => {
    const formatDateTime = vi.fn((value) => `formatted:${value}`);
    const { context, dispatchDetail, dispatchDate } = loadDispatchWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobSortDate: vi.fn((job) => job.scheduled_date || ""),
      teamMemberLabel: vi.fn((member) => member.display_name || member.name || "Crew member"),
      formatDateTime,
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", display_name: "Skylar Stevens", user_id: "user_1" },
      ],
      JOBS_CACHE: [
        {
          id: "job_blocked_1",
          title: "West basin cleanup",
          status: "blocked",
          scheduled_date: "2026-04-08",
          assigned_operator_id: "member_1",
          blocker_note: "Customer gate is locked",
          updated_at: "2026-04-08T09:15:00Z",
          customer_name: "West Basin",
        },
      ],
    });
    dispatchDate.value = "2026-04-08";

    context.window.renderDispatchWorkspace();

    expect(dispatchDetail.innerHTML).toContain("Crew reported a blocker");
    expect(dispatchDetail.innerHTML).toContain("Blocker note: Customer gate is locked");
    expect(dispatchDetail.innerHTML).toContain("Last field update: formatted:2026-04-08T09:15:00Z");
    expect(dispatchDetail.innerHTML).toContain("Save assignment");
    expect(dispatchDetail.innerHTML).toContain("Assign and open crew portal");
    expect(dispatchDetail.innerHTML).toContain("Assignment pressure");
  });

  test("dispatchCompoundRouteSummary allows a same-day crew bundle inside the four-hour minimum", () => {
    const { context } = loadDispatchWorkspace();

    const summary = context.dispatchCompoundRouteSummary(
      {
        id: "job_1",
        scheduled_date: "2026-04-08",
        assigned_member_id: "member_1",
        minimum_hours: 4,
        billable_hours: 1.5,
        travel_hours: 0.25,
      },
      [
        {
          id: "job_1",
          scheduled_date: "2026-04-08",
          assigned_member_id: "member_1",
          minimum_hours: 4,
          billable_hours: 1.5,
          travel_hours: 0.25,
        },
        {
          id: "job_2",
          title: "West basin cleanup",
          scheduled_date: "2026-04-08",
          scheduled_time: "12:00",
          assigned_member_id: "member_1",
          minimum_hours: 4,
          billable_hours: 1,
          travel_hours: 0.25,
          status: "scheduled",
        },
      ],
      "member_1",
      "2026-04-08"
    );

    expect(summary.overrideAvailable).toBe(true);
    expect(summary.hardConflict).toBe(false);
    expect(summary.label).toBe("Compound route available");
  });

  test("renderDispatchWorkspace surfaces the compound route override when same-day work still fits the minimum block", () => {
    const { context, dispatchDetail, dispatchDate } = loadDispatchWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobSortDate: vi.fn((job) => job.scheduled_date || ""),
      teamMemberLabel: vi.fn((member) => member.display_name || member.name || "Crew member"),
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", display_name: "Skylar Stevens", user_id: "user_1" },
      ],
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "North trench",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          scheduled_time: "08:00",
          assigned_member_id: "member_1",
          minimum_hours: 4,
          billable_hours: 1.5,
          travel_hours: 0.25,
          customer_name: "North Utility",
        },
        {
          id: "job_2",
          title: "West basin cleanup",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          scheduled_time: "12:00",
          assigned_member_id: "member_1",
          minimum_hours: 4,
          billable_hours: 1,
          travel_hours: 0.25,
          customer_name: "West Basin",
        },
      ],
    });
    dispatchDate.value = "2026-04-08";

    context.window.renderDispatchWorkspace();

    expect(dispatchDetail.innerHTML).toContain("Crew workload");
    expect(dispatchDetail.innerHTML).toContain("Compound route available");
    expect(dispatchDetail.innerHTML).toContain("Allow this crew to compound the same-day route");
    expect(dispatchDetail.innerHTML).toContain("Expected hours");
    expect(dispatchDetail.innerHTML).toContain("Save planning");
  });

  test("dispatchColumnCrewCapacity reports crew block availability for a loaded truck column", () => {
    const { context } = loadDispatchWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobSortDate: vi.fn((job) => job.scheduled_date || ""),
      teamMemberLabel: vi.fn((member) => member.display_name || member.name || "Crew member"),
    });
    const jobs = [
      {
        id: "job_1",
        title: "North trench",
        status: "scheduled",
        scheduled_date: "2026-04-08",
        scheduled_time: "08:00",
        assigned_truck_id: "truck_1",
        assigned_member_id: "member_1",
        minimum_hours: 4,
        billable_hours: 1.5,
        travel_hours: 0.25,
        customer_name: "North Utility",
      },
      {
        id: "job_2",
        title: "West basin cleanup",
        status: "scheduled",
        scheduled_date: "2026-04-08",
        scheduled_time: "12:00",
        assigned_truck_id: "truck_1",
        assigned_member_id: "member_1",
        minimum_hours: 4,
        billable_hours: 1,
        travel_hours: 0.25,
        customer_name: "West Basin",
      },
    ];

    const summary = context.dispatchColumnCrewCapacity(
      jobs,
      jobs,
      "2026-04-08"
    );

    expect(summary).toMatchObject({
      label: "Crew block available",
      tone: "pill-warn",
    });
    expect(summary.note).toContain("assigned crew");
  });

  test("dispatchAssignmentConflictSummary flags crew and truck double-booking separately", () => {
    const { context } = loadDispatchWorkspace();
    const activeJob = {
      id: "job_1",
      scheduled_date: "2026-04-08",
      assigned_truck_id: "truck_1",
      assigned_member_id: "member_1",
      minimum_hours: 4,
      billable_hours: 3,
      travel_hours: 0.5,
    };
    const jobs = [
      activeJob,
      {
        id: "job_2",
        scheduled_date: "2026-04-08",
        assigned_truck_id: "truck_1",
        assigned_member_id: "member_1",
        minimum_hours: 4,
        billable_hours: 2.5,
        travel_hours: 0.5,
        status: "scheduled",
      },
    ];

    const summary = context.dispatchAssignmentConflictSummary(
      activeJob,
      jobs,
      "truck_1",
      "member_1",
      "2026-04-08"
    );

    expect(summary.hardConflict).toBe(true);
    expect(summary.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Crew double-booked" }),
      expect.objectContaining({ label: "Truck double-booked" }),
    ]));
  });

  test("renderDispatchWorkspace keeps the truck board shell visible for loaded truck columns", () => {
    const { context, dispatchBoard, dispatchDate } = loadDispatchWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobSortDate: vi.fn((job) => job.scheduled_date || ""),
      teamMemberLabel: vi.fn((member) => member.display_name || member.name || "Crew member"),
      EQUIPMENT_CACHE: [
        { id: "truck_1", unit_number: "HX-12", name: "HX-12", is_active: true, debris_tank_capacity_gallons: 2000 },
      ],
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", display_name: "Skylar Stevens", user_id: "user_1" },
      ],
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "North trench",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          scheduled_time: "08:00",
          assigned_truck_id: "truck_1",
          assigned_member_id: "member_1",
          minimum_hours: 4,
          billable_hours: 1.5,
          travel_hours: 0.25,
          customer_name: "North Utility",
        },
        {
          id: "job_2",
          title: "West basin cleanup",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          scheduled_time: "12:00",
          assigned_truck_id: "truck_1",
          assigned_member_id: "member_1",
          minimum_hours: 4,
          billable_hours: 1,
          travel_hours: 0.25,
          customer_name: "West Basin",
        },
      ],
    });
    dispatchDate.value = "2026-04-08";

    context.window.renderDispatchWorkspace();

    expect(dispatchBoard.innerHTML).toContain("Truck board");
    expect(dispatchBoard.innerHTML).toContain("HX-12");
  });

  test("renderDispatchWorkspace only refreshes truck loads when the cache is stale", async () => {
    const requestOperatorFunction = vi.fn(async () => ({ manifests: [] }));
    const { context, dispatchDate } = loadDispatchWorkspace({
      isHydrovacJob: vi.fn(() => true),
      hydrovacJobSortDate: vi.fn((job) => job.scheduled_date || ""),
      requestOperatorFunction,
      EQUIPMENT_CACHE: [
        { id: "truck_1", unit_number: "HX-12", name: "HX-12", is_active: true, debris_tank_capacity_gallons: 2000 },
      ],
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", display_name: "Skylar Stevens", user_id: "user_1" },
      ],
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "North trench",
          status: "scheduled",
          scheduled_date: "2026-04-08",
          assigned_truck_id: "truck_1",
          assigned_member_id: "member_1",
          customer_name: "North Utility",
        },
      ],
    });
    dispatchDate.value = "2026-04-08";

    context.window.renderDispatchWorkspace();
    await Promise.resolve();
    await Promise.resolve();

    expect(requestOperatorFunction).toHaveBeenCalledTimes(1);

    context.window.renderDispatchWorkspace();
    await Promise.resolve();
    await Promise.resolve();

    expect(requestOperatorFunction).toHaveBeenCalledTimes(1);
  });

  test("saveDispatchAssignment persists truck and crew ownership using member context", async () => {
    const saveJobRecord = vi.fn(async (patch = {}) => patch);
    const { context } = loadDispatchWorkspace({
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", operator_id: "operator_1", user_id: "user_1", display_name: "Skylar Stevens" },
      ],
      saveJobRecord,
    });

    await context.saveDispatchAssignment(
      { id: "job_1" },
      { truckId: "truck_1", memberId: "member_1" }
    );

    expect(saveJobRecord).toHaveBeenCalledWith({
      id: "job_1",
      assigned_truck_id: "truck_1",
      assigned_member_id: "member_1",
      assigned_operator_id: "operator_1",
    });
  });

  test("saveDispatchCrewPlanning persists expected hours, minimum block, and travel hours", async () => {
    const saveJobRecord = vi.fn(async (patch = {}) => patch);
    const { context } = loadDispatchWorkspace({ saveJobRecord });

    await context.saveDispatchCrewPlanning(
      { id: "job_1" },
      { billableHours: "1.5", minimumHours: "4", travelHours: "0.25" }
    );

    expect(saveJobRecord).toHaveBeenCalledWith({
      id: "job_1",
      billable_hours: 1.5,
      minimum_hours: 4,
      travel_hours: 0.25,
    });
  });

  test("saveDispatchCrewPlanning falls back to the shared job persistence helper when saveJobRecord is not global", async () => {
    const persistenceSave = vi.fn(async (patch = {}) => ({ ...patch, saved: true }));
    const { context } = loadDispatchWorkspace({
      saveJobRecord: undefined,
      window: {
        PROOFLINK_OPERATOR_JOB_PERSISTENCE: {
          saveJobRecord: persistenceSave,
        },
      },
    });

    const result = await context.saveDispatchCrewPlanning(
      { id: "job_1" },
      { billableHours: "2.5", minimumHours: "4", travelHours: "0.5" }
    );

    expect(persistenceSave).toHaveBeenCalledWith({
      id: "job_1",
      billable_hours: 2.5,
      minimum_hours: 4,
      travel_hours: 0.5,
    });
    expect(result).toMatchObject({ saved: true });
  });
});
