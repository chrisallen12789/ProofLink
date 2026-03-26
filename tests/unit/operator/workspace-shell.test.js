"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createButton() {
  return {
    type: "",
    className: "",
    title: "",
    textContent: "",
    onclick: null,
    attributes: {},
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function createActions() {
  const actions = {
    backButton: null,
    querySelector(selector) {
      if (selector === "[data-panel-back]") return this.backButton;
      return null;
    },
    prepend(node) {
      this.backButton = node;
    },
  };
  return actions;
}

function loadWorkspaceShell(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-workspace-shell.js"),
    "utf8"
  );

  const jobsActions = createActions();
  const panels = overrides.panels || [
    {
      dataset: { panel: "jobs" },
      querySelector(selector) {
        if (selector === ".panel-actions") return jobsActions;
        return null;
      },
    },
  ];

  const context = {
    console,
    window: {},
    document: {
      querySelector: vi.fn(() => ({ dataset: { tab: "jobs" } })),
      querySelectorAll: vi.fn(() => panels),
      createElement: vi.fn(() => createButton()),
    },
    Set,
    PREVIOUS_PANEL_TAB: "orders",
    WORKSPACE_CONTEXT_GROUPS: {
      jobs: ["jobs", "orders", "payments", "payments"],
    },
    uniqList: (rows) => Array.from(new Set(rows)),
    currentWorkspaceBlueprint: vi.fn(() => ({ key: "starter" })),
    isTabVisibleInWorkspace: vi.fn((tab) => tab !== "payments"),
    workspaceTabLabel: vi.fn((tab) => `Label ${tab}`),
    escapeAttr: (value) => String(value),
    escapeHtml: (value) => String(value),
    switchTab: vi.fn(),
    workspacePanels: vi.fn(() => panels),
    setWorkspaceCollapsed: vi.fn(),
    updateWorkspaceWindowControls: vi.fn(),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, jobsActions };
}

describe("operator workspace shell", () => {
  test("workspaceContextTabsFor keeps only visible uniquely labeled tabs", () => {
    const { context } = loadWorkspaceShell();

    expect(context.window.workspaceContextTabsFor("jobs")).toEqual(["jobs", "orders"]);
  });

  test("renderPanelBackButtons adds a back button with the previous view label", () => {
    const { context, jobsActions } = loadWorkspaceShell();

    context.window.renderPanelBackButtons();

    expect(jobsActions.backButton).toBeTruthy();
    expect(jobsActions.backButton.textContent).toBe("Back to Label orders");
    jobsActions.backButton.onclick();
    expect(context.switchTab).toHaveBeenCalledWith("orders");
  });
});
