"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadCrew(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "crew/crew.js"),
    "utf8"
  );

  const elements = new Map();
  const ensureElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        style: {},
        className: "",
        dataset: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        closest: vi.fn(() => null),
        focus: vi.fn(),
      });
    }
    return elements.get(id);
  };

  const document = {
    getElementById: vi.fn((id) => ensureElement(id)),
    addEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      style: {},
      addEventListener: vi.fn(),
      click: vi.fn(),
      remove: vi.fn(),
      setAttribute: vi.fn(),
    })),
    body: { appendChild: vi.fn() },
    head: { appendChild: vi.fn() },
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  };

  const context = {
    console,
    window: {},
    document,
    navigator: { onLine: true, geolocation: { getCurrentPosition: vi.fn() } },
    indexedDB: { open: vi.fn() },
    fetch: vi.fn(),
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    sessionStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, ensureElement };
}

describe("crew job actions", () => {
  test("renderJobActions surfaces compliance blockers ahead of field actions", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobActions");
    vm.runInContext("ACTIVE_JOB = { compliance_message: 'Locate ticket is required before work can start.' };", context);

    context.renderJobActions("scheduled");

    expect(ensureElement("jobActions").innerHTML).toContain("Locate ticket is required before work can start.");
    expect(ensureElement("jobActions").innerHTML).toContain("Clock In");
    expect(ensureElement("jobActions").innerHTML).toContain("Report Issue");
  });

  test("renderJobActions keeps field memory attached while work is active", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobActions");

    context.renderJobActions("scheduled", {
      service_address: "123 Main St",
      customers: {
        phone: "555-555-1212",
        email: "owner@example.com",
      },
      notes: "Gate code 2468. Watch the back hydrant.",
    });

    expect(ensureElement("jobActions").innerHTML).toContain(
      "Keep in mind before you move this job forward"
    );
    expect(ensureElement("jobActions").innerHTML).toContain("Service location: 123 Main St");
    expect(ensureElement("jobActions").innerHTML).toContain("Customer contact: 555-555-1212 | owner@example.com");
    expect(ensureElement("jobActions").innerHTML).toContain("Scope and notes: Gate code 2468. Watch the back hydrant.");
  });

  test("renderJobActions uses clearer paused and completed field guidance", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobActions");

    context.renderJobActions("blocked", { blocker_note: "" });
    expect(ensureElement("jobActions").innerHTML).toContain(
      "Work is paused. Tell the office exactly what is stopping progress"
    );

    context.renderJobActions("completed", {});
    expect(ensureElement("jobActions").innerHTML).toContain("Job complete");
    expect(ensureElement("jobActions").innerHTML).toContain(
      "The office can now handle any remaining invoice or customer follow-through"
    );
  });

  test("fieldActionGuidance keeps the crew guidance plain and reassuring", () => {
    const { context } = loadCrew();

    expect(context.fieldActionGuidance("scheduled", {})).toContain("Clock in when you are on site.");
    expect(context.fieldActionGuidance("in_progress", {})).toContain("closeout is quick");
    expect(context.fieldActionGuidance("completed", {})).toContain("invoice or customer follow-through");
    expect(context.fieldActionGuidance("blocked", { blocker_note: "Customer gate is locked" })).toBe(
      "Blocked: Customer gate is locked"
    );
  });

  test("crewJobMemoryItems fills in missing basics with clear prompts", () => {
    const { context } = loadCrew();

    const items = context.crewJobMemoryItems({});

    expect(items).toContain("Service location is missing. Confirm the address with the office before you travel.");
    expect(items).toContain("Customer contact is missing. Ask the office for the best number before access becomes a problem.");
    expect(items).toContain("Scope and notes are still light. Add a field note if the work changes so the office can finish strong.");
  });
});
