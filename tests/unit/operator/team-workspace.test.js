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
});
