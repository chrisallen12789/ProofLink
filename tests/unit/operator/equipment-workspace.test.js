"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadEquipmentWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-equipment-workspace.js"),
    "utf8"
  );

  const elements = {
    equipmentList: { innerHTML: "" },
    btnAddEquipment: { addEventListener: vi.fn() },
    btnRefreshEquipment: { addEventListener: vi.fn() },
  };

  const context = {
    console,
    window: {},
    document: {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => ({
        id: "",
        className: "",
        innerHTML: "",
        style: {},
        querySelector: vi.fn(() => ({ onclick: null })),
        addEventListener: vi.fn(),
        remove: vi.fn(),
      })),
      getElementById: vi.fn((id) => elements[id] || null),
    },
    sb: {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: { access_token: "token" } } })),
      },
    },
    EQUIPMENT_CACHE: [],
    $: (id) => elements[id] || null,
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    showToast: vi.fn(),
    showConfirmModal: vi.fn(async () => true),
    fetch: vi.fn(async () => ({ json: async () => ({ equipment: [] }) })),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements };
}

describe("operator equipment workspace", () => {
  test("renderEquipment shows an empty state when there is no equipment", () => {
    const { context, elements } = loadEquipmentWorkspace();

    context.window.renderEquipment();

    expect(elements.equipmentList.innerHTML).toContain("No equipment yet.");
    expect(elements.equipmentList.innerHTML).toContain("Add first truck");
  });

  test("loadEquipmentWorkspace fetches the equipment list once", async () => {
    const fetch = vi.fn(async () => ({ json: async () => ({ equipment: [] }) }));
    const { context } = loadEquipmentWorkspace({ fetch });

    context.window.loadEquipmentWorkspace();
    await new Promise((resolve) => setTimeout(resolve, 0));
    context.window.loadEquipmentWorkspace();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("initEquipmentWorkspaceBindings only wires listeners once", () => {
    const { context, elements } = loadEquipmentWorkspace();

    context.window.initEquipmentWorkspaceBindings();
    context.window.initEquipmentWorkspaceBindings();

    expect(elements.btnAddEquipment.addEventListener).toHaveBeenCalledTimes(1);
    expect(elements.btnRefreshEquipment.addEventListener).toHaveBeenCalledTimes(1);
  });
});
