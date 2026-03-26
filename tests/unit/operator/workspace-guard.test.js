"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadWorkspaceGuard(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-workspace-guard.js"),
    "utf8"
  );

  const context = {
    console,
    window: {},
    Set,
    WORKSPACE_DIRTY_TABS: new Set(),
    workspaceTabLabel: vi.fn((tab) => `Label for ${tab}`),
    currentWorkspaceBlueprint: vi.fn(() => ({ key: "starter" })),
    showConfirmModal: vi.fn(async () => true),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator workspace guard", () => {
  test("workspaceExitMessage uses the current workspace tab label", () => {
    const context = loadWorkspaceGuard();

    expect(context.window.workspaceExitMessage("orders")).toContain("Label for orders");
    expect(context.workspaceTabLabel).toHaveBeenCalledWith("orders", { key: "starter" });
  });

  test("confirmWorkspaceChange returns true for clean tabs", async () => {
    const context = loadWorkspaceGuard();

    await expect(context.window.confirmWorkspaceChange("orders", "jobs")).resolves.toBe(true);
    expect(context.showConfirmModal).not.toHaveBeenCalled();
  });

  test("confirmWorkspaceChange defers to the modal for dirty tabs", async () => {
    const context = loadWorkspaceGuard({
      showConfirmModal: vi.fn(async () => false),
    });
    context.WORKSPACE_DIRTY_TABS.add("orders");

    await expect(context.window.confirmWorkspaceChange("orders", "jobs")).resolves.toBe(false);
    expect(context.showConfirmModal).toHaveBeenCalledWith(
      expect.stringContaining("Label for orders"),
      "Leave without saving",
      "Stay here"
    );
  });
});
