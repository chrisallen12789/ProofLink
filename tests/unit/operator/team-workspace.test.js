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
    btnInviteTeamMember: makeField(),
    btnRefreshTeam: makeField(),
    btnLoadHours: makeField(),
    btnExportHoursCsv: makeField(),
  };

  const context = {
    console,
    window: {},
    TEAM_MEMBERS_CACHE: [],
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

    expect(elements.btnInviteTeamMember.addEventListener).toHaveBeenCalledTimes(1);
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
        { id: "member_1", display_name: "Skylar Stevens", role: "member" },
        { id: "member_2", display_name: "Jordan Diaz", role: "member" },
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
    expect(elements.teamMembersList.innerHTML).toContain("2 active");
    expect(elements.teamMembersList.innerHTML).toContain("1 assigned job");
    expect(elements.teamMembersList.innerHTML).toContain("planned / 4h block");
    expect(elements.teamMembersList.innerHTML).toContain("left in block");
    expect(elements.teamMembersList.innerHTML).toContain("Double-booked");
    expect(elements.teamMembersList.innerHTML).toContain("Last field update 2026-04-08T09:15:00Z");
    expect(elements.teamMembersList.innerHTML).toContain("Blocker: Customer gate is locked");
  });
});
