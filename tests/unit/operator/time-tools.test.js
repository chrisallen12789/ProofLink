"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadTimeTools(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-time-tools.js"),
    "utf8"
  );

  const elements = {
    timeLoggedBody: { innerHTML: "", style: { display: "block" } },
    timeLoggedToggle: {
      querySelector: vi.fn(() => ({ textContent: "" })),
    },
  };

  const context = {
    console,
    window: {},
    document: {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => ({
        id: "",
        innerHTML: "",
        style: {},
        remove: vi.fn(),
      })),
      getElementById: vi.fn((id) => elements[id] || null),
    },
    fetchTimeEntries: vi.fn(async () => []),
    escapeHtml: (value) => String(value),
    formatUsd: (value) => `$${value}`,
    showToast: vi.fn(),
    getAccessToken: vi.fn(async () => "token"),
    fetch: vi.fn(),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements };
}

describe("operator time tools", () => {
  test("renderTimeEntries shows an empty state when no entries exist", async () => {
    const { context, elements } = loadTimeTools();

    await context.window.renderTimeEntries("order_123");

    expect(elements.timeLoggedBody.innerHTML).toContain("No time entries yet. Log time here to keep invoicing accurate.");
  });

  test("renderTimeEntries renders totals for existing entries", async () => {
    const entries = [
      { description: "Main line jetting", duration_minutes: 90, billable: true, amount_cents: 22500, date: "2026-03-26" },
      { description: "Cleanup", duration_minutes: 30, billable: false, amount_cents: 0, date: "2026-03-26" },
    ];
    const { context, elements } = loadTimeTools({
      fetchTimeEntries: vi.fn(async () => entries),
    });

    await context.window.renderTimeEntries("order_123");

    expect(elements.timeLoggedBody.innerHTML).toContain("Main line jetting");
    expect(elements.timeLoggedBody.innerHTML).toContain("2.00 hrs");
    expect(elements.timeLoggedBody.innerHTML).toContain("$22500");
    expect(elements.timeLoggedBody.innerHTML).toContain("Add uninvoiced hours to invoice");
  });

  test("time tools source keeps plain-language strings without encoding drift", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-time-tools.js"),
      "utf8"
    );

    expect(source).toContain("Loading...");
    expect(source).toContain("No time entries yet. Log time here to keep invoicing accurate.");
    expect(source).toContain('btn.textContent = "Saving..."');
    expect(source).toContain('span.textContent = "Time logged"');
    expect(source).toContain("Add uninvoiced hours to invoice");
    expect(source).toContain("Or, enter an end time");
    expect(source).not.toContain("â€¦");
    expect(source).not.toContain("â€”");
    expect(source).not.toContain("âš¡");
    expect(source).not.toContain("â–¾");
  });
});
