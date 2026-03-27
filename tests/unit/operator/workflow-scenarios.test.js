"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadModule(file, overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), file),
    "utf8"
  );

  const context = {
    console,
    window: {},
    formatDateTime: (value) => `formatted:${value}`,
    formatUsd: (value) => `$${value}`,
    titleCaseWords: (value) => String(value),
    normalizeWorkflowStatusValue: (value) => String(value || "").trim().toLowerCase(),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator workflow scenarios", () => {
  test("the request-to-payment chain keeps the next move clear as work advances", () => {
    const customerApi = loadModule("operator/operator-customer-detail.js");
    const ordersApi = loadModule("operator/operator-orders-workspace.js");
    const jobsApi = loadModule("operator/operator-jobs-workspace.js");

    const customerGuidance = customerApi.window.customerCollectionGuidance(
      { email: "owner@example.com" },
      [],
      [],
      0
    );
    const orderGuidance = ordersApi.orderCollectionGuidance(
      { customer_email: "owner@example.com" },
      12000,
      "overdue",
      0,
      null
    );
    const closeoutGuidance = jobsApi.window.buildJobCloseoutGuidance(
      { status: "completed" },
      null,
      { blockers: [], nextStep: "" },
      12000
    );

    expect(customerGuidance.title).toBe("No money follow-through yet");
    expect(orderGuidance.title).toBe("Payment follow-up is overdue");
    expect(closeoutGuidance.title).toBe("Field work is done, and payment is the next move");
  });

  test("the request-to-booked-work handoff keeps one plain-language path across the operator", () => {
    const leadSource = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-lead-plan-workspace.js"),
      "utf8"
    );
    const commandSource = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-command-center.js"),
      "utf8"
    );
    const shellSource = fs.readFileSync(
      path.resolve(process.cwd(), "operator/index.html"),
      "utf8"
    );

    expect(leadSource).toContain("Open booked work");
    expect(leadSource).toContain("the quote, booked work, and job that follow");
    expect(commandSource).toContain("Open the client, booked work, job, or request directly");
    expect(shellSource).toContain("proposals move into booked work");
    expect(shellSource).not.toContain("quoted or booked work");
  });

  test("the booked-work to time-to-payment path stays plain and reassuring", () => {
    const timeSource = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-time-tools.js"),
      "utf8"
    );
    const ordersSource = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-orders-workspace.js"),
      "utf8"
    );
    const crewSource = fs.readFileSync(
      path.resolve(process.cwd(), "crew/crew.js"),
      "utf8"
    );

    expect(timeSource).toContain("No time entries yet. Log time here to keep invoicing accurate.");
    expect(timeSource).toContain("Add uninvoiced hours to invoice");
    expect(ordersSource).toContain("Payment follow-up is overdue");
    expect(crewSource).toContain("invoice or customer follow-through");
    expect(timeSource).not.toContain("â€¦");
    expect(timeSource).not.toContain("â€”");
  });
});
