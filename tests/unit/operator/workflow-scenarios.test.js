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
});
