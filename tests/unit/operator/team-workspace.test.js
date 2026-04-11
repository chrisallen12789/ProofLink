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

function loadTeamWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-team-workspace.js"),
    "utf8"
  );

  const elements = {
    teamMembersList: { innerHTML: "" },
    hoursStart: makeField(),
    hoursEnd: makeField(),
    hoursReport: { innerHTML: "", _data: null },
    btnTrainingRollout: makeField(),
    btnInviteTeamMember: makeField(),
    btnLogTeamTime: makeField(),
    btnLogMaintenanceTime: makeField(),
    btnRefreshTeam: makeField(),
    btnLoadHours: makeField(),
    btnExportHoursCsv: makeField(),
  };

  const context = {
    console,
    window: {},
    TEAM_MEMBERS_CACHE: [],
    HYDROVAC_DRIVER_COMPLIANCE_CACHE: [],
    document: {
      createElement: vi.fn(() => ({
        id: "",
        style: {},
        className: "",
        innerHTML: "",
        querySelector: vi.fn(() => ({ onclick: null })),
        addEventListener: vi.fn(),
        appendChild: vi.fn(),
        remove: vi.fn(),
      })),
      body: { appendChild: vi.fn() },
      getElementById: vi.fn(() => null),
    },
    $: (id) => elements[id] || null,
    authHeaders: vi.fn(() => ({ Authorization: "Bearer token" })),
    fetchHydrovacDriverQualifications: vi.fn(() => Promise.resolve()),
    renderHydrovacDriverWorkspace: vi.fn(),
    showToast: vi.fn(),
    showConfirmModal: vi.fn(() => Promise.resolve(true)),
    notifyOperator: vi.fn(),
    getOperatorAccessToken: vi.fn(() => Promise.resolve("token")),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    formatUsd: (value) => `$${value}`,
    fetch: vi.fn(async () => ({ ok: true, json: async () => ({ members: [] }) })),
    Blob,
    URL: { createObjectURL: vi.fn(() => "blob:url"), revokeObjectURL: vi.fn() },
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements };
}

describe("operator team workspace", () => {
  test("renderHoursReport shows empty state when there is no activity", () => {
    const { context, elements } = loadTeamWorkspace();

    context.window.renderHoursReport({ members: [], totals: {} });

    expect(elements.hoursReport.innerHTML).toContain("No hours logged in this period.");
  });

  test("renderHoursReport surfaces union floor context when compensation data is present", () => {
    const { context, elements } = loadTeamWorkspace();

    context.window.renderHoursReport({
      members: [{
        name: "Skylar Stevens",
        role: "member",
        total_minutes: 120,
        billable_minutes: 120,
        training_minutes: 120,
        maintenance_minutes: 0,
        pricing_overhead_cost_cents: 8200,
        asset_basis_candidate_cost_cents: 0,
        job_count: 0,
        estimated_pay_cents: 8200,
        effective_rate_cents: 4100,
        compensation: {
          contract_floor_cents: 4100,
          source: "contract_floor",
          union_classification_name: "Metal Trades",
        },
        entries: [{
          description: "Time entry",
          duration_minutes: 120,
          billable: true,
          work_type: "driver_training",
          work_type_label: "Driver training",
          training_type: "driver_safety",
          cost_bucket: "pricing_overhead",
          started_at: "2026-04-09T12:00:00.000Z",
        }],
        jobs: [],
      }],
      totals: {
        total_minutes: 120,
        billable_minutes: 120,
        training_minutes: 120,
        maintenance_minutes: 0,
        member_count: 1,
        estimated_pay_cents: 8200,
        pricing_overhead_cost_cents: 8200,
        asset_basis_candidate_cost_cents: 0,
      },
    });

    expect(elements.hoursReport.innerHTML).toContain("Metal Trades");
    expect(elements.hoursReport.innerHTML).toContain("contract floor");
    expect(elements.hoursReport.innerHTML).toContain("source contract floor");
    expect(elements.hoursReport.innerHTML).toContain("Driver training");
    expect(elements.hoursReport.innerHTML).toContain("Pricing overhead");
  });

  test("loadTeamWorkspace fetches members once and refreshes qualifications on revisit", async () => {
    const fetchTeamMembers = vi.fn(() => Promise.resolve());
    const fetchHydrovacDriverQualifications = vi.fn(() => Promise.resolve());
    const { context, elements } = loadTeamWorkspace({
      fetchHydrovacDriverQualifications,
    });

    context.window.fetchTeamMembers = fetchTeamMembers;
    context.fetchTeamMembers = fetchTeamMembers;

    await context.window.loadTeamWorkspace();
    await context.window.loadTeamWorkspace();

    expect(fetchTeamMembers).toHaveBeenCalledTimes(1);
    expect(fetchHydrovacDriverQualifications).toHaveBeenCalledTimes(2);
    expect(elements.hoursStart.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("initTeamWorkspaceBindings only wires listeners once", () => {
    const { context, elements } = loadTeamWorkspace();

    context.window.initTeamWorkspaceBindings();
    context.window.initTeamWorkspaceBindings();

    expect(elements.btnTrainingRollout.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnInviteTeamMember.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnLogTeamTime.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnLogMaintenanceTime.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnRefreshTeam.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnLoadHours.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnExportHoursCsv.addEventListener).toHaveBeenCalledTimes(1);
  });

  test("fetchTeamMembers falls back to the operator token when authHeaders is unavailable", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ members: [{ id: "member_1", name: "Skylar", role: "member" }] }),
    }));
    const getOperatorAccessToken = vi.fn(() => Promise.resolve("token_123"));
    const { context } = loadTeamWorkspace({
      authHeaders: undefined,
      fetch,
      getOperatorAccessToken,
    });

    await context.window.fetchTeamMembers();

    expect(getOperatorAccessToken).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/.netlify/functions/manage-operator-members",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token_123",
        }),
      })
    );
    expect(context.TEAM_MEMBERS_CACHE).toHaveLength(1);
  });

  test("renderTeamPanel surfaces roster pressure, unassigned jobs, and active crew load", () => {
    const { context, elements } = loadTeamWorkspace({
      TEAM_MEMBERS_CACHE: [
        { id: "member_1", display_name: "Skylar Stevens", role: "member", driver_label: "Vactor operator", worker_label: "Labor" },
        { id: "member_2", display_name: "Jordan Diaz", role: "member", driver_label: "Relief driver" },
      ],
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [
        { member_id: "member_1", warnings: [], medical_certificate_expiry: "2026-04-20" },
      ],
      JOBS_CACHE: [
        { id: "job_1", assigned_operator_id: "member_1", status: "in_progress", billable_hours: 1.5, minimum_hours: 4, travel_hours: 0.25, updated_at: "2026-04-08T09:15:00Z" },
        { id: "job_2", assigned_operator_id: "member_1", status: "dispatched", billable_hours: 3, minimum_hours: 4, travel_hours: 0.5 },
        { id: "job_5", assigned_operator_id: "member_1", status: "blocked", billable_hours: 0.5, minimum_hours: 4, travel_hours: 0, blocker_note: "Customer gate is locked" },
        { id: "job_3", assigned_operator_id: "member_2", status: "scheduled", billable_hours: 1, minimum_hours: 4, travel_hours: 0.25 },
        { id: "job_4", status: "scheduled" },
      ],
    });

    context.window.renderTeamPanel();

    expect(elements.teamMembersList.innerHTML).toContain("In the field");
    expect(elements.teamMembersList.innerHTML).toContain("Unassigned jobs");
    expect(elements.teamMembersList.innerHTML).toContain("Roster pressure");
    expect(elements.teamMembersList.innerHTML).toContain("Block capacity");
    expect(elements.teamMembersList.innerHTML).toContain("Driver setup");
    expect(elements.teamMembersList.innerHTML).toContain("Training");
    expect(elements.teamMembersList.innerHTML).toContain("Refresh");
    expect(elements.teamMembersList.innerHTML).toContain("2 active");
    expect(elements.teamMembersList.innerHTML).toContain("1 assigned job");
    expect(elements.teamMembersList.innerHTML).toContain("planned / 4h block");
    expect(elements.teamMembersList.innerHTML).toContain("left in block");
    expect(elements.teamMembersList.innerHTML).toContain("Double-booked");
    expect(elements.teamMembersList.innerHTML).toContain("Driver-ready");
    expect(elements.teamMembersList.innerHTML).toContain("Driver setup needed");
    expect(elements.teamMembersList.innerHTML).toContain("Training not started");
    expect(elements.teamMembersList.innerHTML).toContain("Mixed role");
    expect(elements.teamMembersList.innerHTML).toContain("Refresh");
    expect(elements.teamMembersList.innerHTML).toContain("Last field update 2026-04-08T09:15:00Z");
    expect(elements.teamMembersList.innerHTML).toContain("Blocker: Customer gate is locked");
    expect(elements.teamMembersList.innerHTML).toContain("Training");
    expect(elements.teamMembersList.innerHTML).toContain("Monday rollout");
    expect(elements.teamMembersList.innerHTML).toContain("needing follow-up");
    expect(elements.teamMembersList.innerHTML).toContain("1 blocked");
    expect(elements.teamMembersList.innerHTML).toContain("1 supervised");
    expect(elements.teamMembersList.innerHTML).toContain("0 follow-through");
    expect(elements.teamMembersList.innerHTML).toContain("Next:");
    expect(elements.teamMembersList.innerHTML).toContain("Profile");
    expect(elements.teamMembersList.innerHTML).toContain("Log time");
    expect(elements.teamMembersList.innerHTML).toContain("Log training time");
    expect(elements.teamMembersList.innerHTML).toContain("Training");
    expect(elements.teamMembersList.innerHTML).toContain("Profile");
    expect(elements.teamMembersList.innerHTML).toContain("Crew portal");
  });

  test("team profile evidence links completed steps to training time and driver records", () => {
    const { context } = loadTeamWorkspace({
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [
        {
          member_id: "member_1",
          cdl_class: "Class A",
          cdl_state: "MI",
          cdl_expiry_date: "2026-12-31",
          medical_certificate_expiry: "2026-10-01",
          defensive_driving_completed: true,
          confined_space_certified: true,
          h2s_alive_certified: true,
          hos_available_driving_minutes: 360,
          last_mvr_check_date: "2026-04-01",
        },
      ],
    });

    const member = { id: "member_1", driver_label: "Vactor operator" };
    const profile = {
      items: [
        { key: "driving", label: "Driving orientation", complete: true, completedAt: "2026-04-10", completedBy: "Office", completionNote: "Observed road test and backing drill." },
        { key: "vactor", label: "Vactor operator walkthrough", complete: true, completedAt: "2026-04-10", completedBy: "Office", completionNote: "Covered startup, boom, and spoil handling." },
      ],
    };
    const history = {
      entries: [
        {
          work_type: "driver_training",
          training_type: "driver_safety",
          description: "Driver road orientation",
          duration_minutes: 120,
          started_at: "2026-04-10T14:00:00.000Z",
        },
        {
          work_type: "driver_training",
          training_type: "vactor_operator",
          description: "Vactor controls walkthrough",
          duration_minutes: 90,
          started_at: "2026-04-10T16:00:00.000Z",
        },
      ],
    };

    const evidenceHtml = context.renderTrainingEvidenceSnapshot(profile, history, member);
    const qualificationHtml = context.renderDriverQualificationSnapshot(member);

    expect(evidenceHtml).toContain("Time evidence");
    expect(evidenceHtml).toContain("Readiness evidence");
    expect(evidenceHtml).toContain("Driver road orientation");
    expect(evidenceHtml).toContain("CDL on file: Class A MI");
    expect(evidenceHtml).toContain("Confined space record is on file");
    expect(evidenceHtml).toContain("Observed road test and backing drill.");
    expect(qualificationHtml).toContain("CDL: Class A MI");
    expect(qualificationHtml).toContain("Med card: expires");
    expect(qualificationHtml).toContain("HOS available");
  });

  test("training profile carries step-level completion notes from item meta", () => {
    const { context } = loadTeamWorkspace({
      SETUP_STATE: {
        config: {
          team_training_profiles: {
            member_1: {
              items: { driving: true },
              item_meta: {
                driving: {
                  completed_at: "2026-04-10T15:00:00.000Z",
                  completed_by: "Office",
                  completion_note: "Observed road test and reviewed incident process.",
                },
              },
            },
          },
        },
      },
    });

    const profile = context.teamTrainingProfile({ id: "member_1", driver_label: "Vactor operator" });

    expect(profile.items.find((item) => item.key === "driving")?.completionNote).toBe(
      "Observed road test and reviewed incident process."
    );
  });

  test("record evidence profile tracks required office records by role", () => {
    const { context } = loadTeamWorkspace({
      SETUP_STATE: {
        config: {
          team_training_profiles: {
            member_1: {
              record_evidence: {
                cdl_copy: {
                  present: true,
                  recorded_at: "2026-04-10T15:00:00.000Z",
                  recorded_by: "Office",
                  note: "Stored in driver packet.",
                },
              },
            },
          },
        },
      },
    });

    const profile = context.teamRecordEvidenceProfile({ id: "member_1", driver_label: "Vactor operator" });
    const summary = context.teamRecordEvidenceSummary({ id: "member_1", driver_label: "Vactor operator" });

    expect(profile.items.find((item) => item.key === "cdl_copy")?.present).toBe(true);
    expect(profile.items.find((item) => item.key === "med_card_copy")?.present).toBe(false);
    expect(summary.label).toBe("Records missing");
    expect(summary.note).toContain("office records");
  });

  test("training save validation requires evidence for key rollout steps", () => {
    const { context } = loadTeamWorkspace({
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [],
    });

    const member = { id: "member_2", worker_label: "Labor" };
    const profile = {
      items: [
        { key: "crew_app", label: "Crew app sign-in", complete: false },
        { key: "worksite", label: "Worksite labor orientation", complete: false },
      ],
    };

    const blockedIssues = context.teamTrainingSaveValidation(
      profile,
      { crew_app: true, worksite: true },
      { entries: [] },
      member
    );
    const allowedIssues = context.teamTrainingSaveValidation(
      profile,
      { crew_app: true, worksite: true },
      {
        entries: [
          {
            work_type: "trade_training",
            training_type: "worksite_safety",
            description: "Site safety walkthrough",
            duration_minutes: 60,
          },
        ],
      },
      member
    );

    expect(blockedIssues).toHaveLength(1);
    expect(blockedIssues[0]).toContain("Worksite labor orientation");
    expect(allowedIssues).toHaveLength(0);
  });

  test("team timeline merges signoffs, time, jobs, and qualification milestones", () => {
    const { context } = loadTeamWorkspace({
      SETUP_STATE: {
        config: {
          team_training_profiles: {
            member_1: {
              record_evidence: {
                cdl_copy: {
                  present: true,
                  recorded_at: "2026-04-08T10:00:00.000Z",
                  recorded_by: "Office",
                  note: "Filed in driver packet.",
                },
              },
            },
          },
        },
      },
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [
        {
          member_id: "member_1",
          cdl_class: "Class A",
          cdl_state: "MI",
          cdl_expiry_date: "2026-12-31",
          medical_certificate_expiry: "2026-10-01",
          last_mvr_check_date: "2026-04-01",
          mvr_status: "clear",
          hos_last_synced_at: "2026-04-10T06:00:00.000Z",
          hos_available_driving_minutes: 420,
          first_aid_certified: true,
          first_aid_cert_expiry_date: "2026-08-15",
          h2s_alive_certified: true,
          h2s_cert_expiry_date: "2026-11-30",
        },
      ],
    });

    const member = {
      id: "member_1",
      driver_label: "Vactor operator",
      updated_at: "2026-04-10T12:00:00.000Z",
      compensation: {
        resolved_hourly_rate_cents: 4500,
        contract_floor_cents: 4100,
        union_classification_name: "Metal Trades",
        source: "member_override",
        updated_at: "2026-04-10T12:00:00.000Z",
      },
    };
    const profile = {
      items: [
        {
          key: "ride_along",
          label: "Ride-along signoff",
          complete: true,
          completedAt: "2026-04-10T09:00:00.000Z",
          completedBy: "Office",
          completionNote: "Shadowed full morning route.",
        },
      ],
    };
    const history = {
      entries: [
        {
          work_type: "driver_training",
          work_type_label: "Driver training",
          description: "Ride-along route training",
          duration_minutes: 240,
          cost_bucket: "pricing_overhead",
          started_at: "2026-04-10T13:00:00.000Z",
        },
      ],
      jobs: [
        {
          title: "Downtown cleanout",
          customer_name: "Acme Plant",
          status: "completed",
          actual_end_at: "2026-04-09T17:00:00.000Z",
        },
      ],
    };

    const html = context.renderTeamTimeline(member, history, profile);

    expect(html).toContain("Training signoff");
    expect(html).toContain("Ride-along signoff");
    expect(html).toContain("Ride-along route training");
    expect(html).toContain("Assigned job");
    expect(html).toContain("Downtown cleanout");
    expect(html).toContain("Compensation");
    expect(html).toContain("Metal Trades pay context");
    expect(html).toContain("Office record");
    expect(html).toContain("CDL copy");
    expect(html).toContain("Qualification update");
    expect(html).toContain("First aid current");
    expect(html).toContain("Driver hours sync");
    expect(html).toContain("CDL expiry");
    expect(html).toContain("Med card expiry");
    expect(html).toContain("MVR check");
  });

  test("rollout restriction reflects driver, labor, and mixed-role readiness clearly", () => {
    const { context } = loadTeamWorkspace({
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [
        { member_id: "driver_ready", warnings: [], cdl_class: "Class A" },
        { member_id: "mixed_ready", warnings: [], cdl_class: "Class A" },
      ],
      SETUP_STATE: {
        config: {
          team_training_profiles: {
            driver_ready: {
              items: {
                crew_app: true,
                yard_route: true,
                driving: true,
                worksite: true,
                vactor: true,
                ride_along: true,
              },
            },
            labor_ready: {
              items: {
                crew_app: true,
                yard_route: true,
                ppe: true,
                worksite: true,
                handoff: true,
                ride_along: true,
              },
            },
            mixed_ready: {
              items: {
                crew_app: true,
                yard_route: true,
                driving: true,
                ppe: true,
                worksite: true,
                vactor: true,
                handoff: true,
                ride_along: true,
              },
            },
          },
        },
      },
    });

    const driverBlocked = context.teamMemberRolloutRestriction({ id: "driver_blocked", driver_label: "Vactor operator" });
    const driverReady = context.teamMemberRolloutRestriction({ id: "driver_ready", driver_label: "Vactor operator" });
    const laborReady = context.teamMemberRolloutRestriction({ id: "labor_ready", worker_label: "Labor" });
    const mixedReady = context.teamMemberRolloutRestriction({ id: "mixed_ready", driver_label: "Relief driver", worker_label: "Labor" });

    expect(driverBlocked.label).toBe("Restricted from solo dispatch");
    expect(driverReady.label).toBe("Solo-ready");
    expect(laborReady.label).toBe("Ready for field support");
    expect(mixedReady.label).toBe("Ready for driver or labor dispatch");
  });

  test("qualification refresh pressure flags due-soon and overdue driver records", () => {
    const { context } = loadTeamWorkspace({
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [
        {
          member_id: "member_due",
          medical_certificate_expiry: "2026-04-20",
        },
        {
          member_id: "member_overdue",
          cdl_expiry_date: "2026-04-01",
        },
      ],
    });

    const dueSoon = context.teamQualificationRefreshPressure({ id: "member_due", driver_label: "Vactor operator" });
    const overdue = context.teamQualificationRefreshPressure({ id: "member_overdue", driver_label: "Vactor operator" });

    expect(dueSoon.label).toBe("Refresh due soon");
    expect(dueSoon.note).toContain("Med card");
    expect(overdue.label).toBe("Qualification refresh overdue");
    expect(overdue.note).toContain("CDL");
  });

  test("training summary flags due-soon and overdue refresh for completed rollout steps", () => {
    const { context } = loadTeamWorkspace({
      SETUP_STATE: {
        config: {
          team_training_profiles: {
            member_due: {
              items: {
                crew_app: true,
                yard_route: true,
                ppe: true,
                worksite: true,
                handoff: true,
                ride_along: true,
              },
              item_meta: {
                ppe: { completed_at: "2026-01-20T12:00:00.000Z", completed_by: "Office" },
                ride_along: { completed_at: "2026-03-15T12:00:00.000Z", completed_by: "Office" },
              },
            },
            member_overdue: {
              items: {
                crew_app: true,
                yard_route: true,
                ppe: true,
                worksite: true,
                handoff: true,
                ride_along: true,
              },
              item_meta: {
                ride_along: { completed_at: "2026-02-01T12:00:00.000Z", completed_by: "Office" },
              },
            },
          },
        },
      },
    });

    const dueSoon = context.teamTrainingSummary({ id: "member_due", worker_label: "Labor" });
    const overdue = context.teamTrainingSummary({ id: "member_overdue", worker_label: "Labor" });

    expect(dueSoon.label).toBe("Training refresh due soon");
    expect(dueSoon.note).toContain("PPE and site safety");
    expect(overdue.label).toBe("Training refresh overdue");
    expect(overdue.note).toContain("Ride-along signoff");
  });

  test("rollout restriction reflects stale training refresh pressure", () => {
    const { context } = loadTeamWorkspace({
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [
        { member_id: "driver_ready", warnings: [], cdl_class: "Class A" },
      ],
      SETUP_STATE: {
        config: {
          team_training_profiles: {
            driver_ready: {
              items: {
                crew_app: true,
                yard_route: true,
                driving: true,
                worksite: true,
                vactor: true,
                ride_along: true,
              },
              item_meta: {
                ride_along: { completed_at: "2026-02-01T12:00:00.000Z", completed_by: "Office" },
              },
            },
          },
        },
      },
    });

    const restriction = context.teamMemberRolloutRestriction({ id: "driver_ready", driver_label: "Vactor operator" });
    const nextAction = context.teamMemberNextAction({ id: "driver_ready", driver_label: "Vactor operator" });

    expect(restriction.label).toBe("Training refresh overdue");
    expect(restriction.note).toContain("Ride-along signoff");
    expect(nextAction.label).toBe("Refresh stale training steps");
  });

  test("team timeline surfaces training refresh events", () => {
    const { context } = loadTeamWorkspace();

    const member = { id: "member_1", worker_label: "Labor" };
    const profile = {
      items: [
        {
          key: "ride_along",
          label: "Ride-along signoff",
          complete: true,
          completedAt: "2026-03-15T12:00:00.000Z",
          completedBy: "Office",
          refreshDueAt: "2026-04-14T12:00:00.000Z",
          refreshLabel: "Refresh due soon",
          refreshStatus: "soon",
          refreshNote: "Ride-along signoff should be refreshed by 4/14/2026.",
        },
      ],
    };

    const html = context.renderTeamTimeline(member, { entries: [], jobs: [] }, profile);

    expect(html).toContain("Refresh due soon");
    expect(html).toContain("Ride-along signoff");
    expect(html).toContain("should be refreshed");
  });

  test("readiness gates summarize blocked, follow-up, and clear rollout items", () => {
    const { context } = loadTeamWorkspace({
      HYDROVAC_DRIVER_COMPLIANCE_CACHE: [
        {
          member_id: "member_1",
          cdl_class: "Class A",
          medical_certificate_expiry: "2026-04-20",
        },
      ],
      SETUP_STATE: {
        config: {
          team_training_profiles: {
            member_1: {
              items: {
                crew_app: true,
                yard_route: true,
                driving: true,
                worksite: true,
                vactor: true,
                ride_along: true,
              },
              item_meta: {
                ride_along: { completed_at: "2026-02-15T12:00:00.000Z", completed_by: "Office" },
              },
              record_evidence: {
                cdl_copy: { present: true, recorded_at: "2026-04-10T12:00:00.000Z", recorded_by: "Office" },
              },
            },
          },
        },
      },
    });

    const readiness = context.teamReadinessGates({ id: "member_1", driver_label: "Vactor operator" });
    const html = context.renderTeamReadinessGates({ id: "member_1", driver_label: "Vactor operator" });

    expect(readiness.blockedCount).toBe(2);
    expect(readiness.warningCount).toBeGreaterThan(0);
    expect(readiness.items.some((item) => item.label === "Training refresh overdue")).toBe(true);
    expect(readiness.items.some((item) => item.label === "Refresh due soon")).toBe(true);
    expect(readiness.items.some((item) => item.label === "Driver record")).toBe(true);
    expect(readiness.items.some((item) => item.label === "Records missing")).toBe(true);
    expect(html).toContain("Blocked rollout items need attention first.");
    expect(html).toContain("Refresh stale training");
    expect(html).toContain("Schedule qualification refresh");
    expect(html).toContain("Mark office records");
  });
});
