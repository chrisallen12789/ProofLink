"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadOrdersWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-orders-workspace.js"),
    "utf8"
  );

  const context = {
    console,
    formatDateTime: (value) => `formatted:${value}`,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator orders workspace", () => {
  test("orderCollectionGuidance prioritizes overdue follow-up when money is still open", () => {
    const api = loadOrdersWorkspace();

    const guidance = api.orderCollectionGuidance(
      { customer_email: "owner@example.com" },
      12500,
      "overdue",
      0,
      null
    );

    expect(guidance.title).toBe("Payment follow-up is overdue");
    expect(guidance.description).toContain("Send the reminder");
  });

  test("orderCollectionGuidance reassures the operator when work is financially closed", () => {
    const api = loadOrdersWorkspace();

    const guidance = api.orderCollectionGuidance(
      { customer_email: "owner@example.com" },
      0,
      "paid",
      0,
      { paid_at: "2026-03-27T09:00:00Z" }
    );

    expect(guidance.title).toBe("This work is financially closed");
    expect(guidance.description).toContain("formatted:2026-03-27T09:00:00Z");
  });

  test("keeps visible order-workspace language plain and free of old icon drift", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-orders-workspace.js"),
      "utf8"
    );

    expect(source).toContain("Project phases (show)");
    expect(source).toContain("Time logged (show)");
    expect(source).toContain("Customer notified.");
    expect(source).toContain("Recurring schedule saved.");
    expect(source).toContain('class="inline-soft-panel u-hidden"');
    expect(source).toContain('class="kicker detail-toggle"');
    expect(source).toContain('class="li-btn li-btn-reset"');
    expect(source).toContain("isOrderInlinePanelOpen");
    expect(source).not.toContain('style="display:none;margin-top:12px;background:rgba(255,255,255,.03);');
    expect(source).not.toContain('style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;"');
    expect(source).not.toContain("âœ“");
    expect(source).not.toContain("âš¡ Add uninvoiced hours to invoice");
    expect(source).not.toContain("Project phases â–¸");
    expect(source).not.toContain("Time logged â–¸");
  });
});
