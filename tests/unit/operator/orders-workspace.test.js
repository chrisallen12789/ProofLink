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
    window: {},
    formatDateTime: (value) => `formatted:${value}`,
    ...overrides,
  };

  if (overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL) {
    context.window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL = overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL;
  }

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

  test("keeps visible order-workspace language plain and uses shared UI classes", () => {
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
    expect(source).toContain("sms-thread-row");
    expect(source).toContain("sms-thread-bubble");
    expect(source).toContain("btn-block u-mt-12");
    expect(source).toContain("renderOrderCustomerMemoryCard");
    expect(source).toContain("orderCustomerMemoryItems");
    expect(source).toContain("renderOrderPrepGuidanceCard");
    expect(source).toContain("orderPrepGuidanceItems");
    expect(source).toContain("renderOrderNextMoveCard");
    expect(source).toContain("orderNextMoveItems");
    expect(source).toContain("renderOrderRetentionCard");
    expect(source).toContain("orderRetentionItems");
    expect(source).toContain("Keep the trade details attached to the booked work");
    expect(source).toContain("Prep before field handoff");
    expect(source).toContain("Best next office move");
    expect(source).toContain("After this work is done");
    expect(source).toContain("Make this booked work easier to execute well");
    expect(source).not.toContain('style="display:none;margin-top:12px;background:rgba(255,255,255,.03);');
    expect(source).not.toContain('style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;"');
    expect(source).not.toContain("style.cssText");
    expect(source).not.toContain('style="margin-top:14px;"');
    expect(source).not.toContain('style="display:flex;justify-content:flex-end;margin-bottom:5px;');
    expect(source).not.toContain('style="max-width:75%;background:#c84b2f;border-radius:10px;padding:6px 10px;font-size:.82rem;"');
    expect(source).not.toContain("ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“");
    expect(source).not.toContain("ÃƒÂ¢Ã…Â¡Ã‚Â¡ Add uninvoiced hours to invoice");
    expect(source).not.toContain("Project phases ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¸");
    expect(source).not.toContain("Time logged ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¸");
  });

  test("orderCustomerMemoryItems reuses business-specific customer memory when available", () => {
    const api = loadOrdersWorkspace({
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerMemoryChecklist: vi.fn(() => ([
          { label: "Property profile", ready: true, note: "123 Main St" },
          { label: "Access notes", ready: false, note: "Gate code still missing" },
        ])),
      },
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "landscaping",
          label: "Landscaping",
          recordFocus: ["Property profile", "Route cadence"],
        },
      })),
    });

    const items = api.orderCustomerMemoryItems({ id: "customer_1", name: "Logan's Lawn Care" });

    expect(items).toEqual([
      { label: "Property profile", ready: true, note: "123 Main St" },
      { label: "Access notes", ready: false, note: "Gate code still missing" },
    ]);
  });

  test("orderPrepGuidanceItems turns HVAC customer context into a booked-work handoff checklist", () => {
    const api = loadOrdersWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
          label: "HVAC",
          recordFocus: [],
        },
      })),
    });

    const items = api.orderPrepGuidanceItems(
      {
        customer_phone: "555-111-2222",
        notes: "Second-floor unit has intermittent cooling issue",
      },
      {
        equipment_notes: "Carrier rooftop unit RTU-2",
        entry_notes: "Call tenant before rooftop access",
        diagnostic_notes: "Cooling drops out after 20 minutes",
      }
    );

    expect(items).toEqual([
      { label: "System context", ready: true, note: "Carrier rooftop unit RTU-2" },
      { label: "Access and contact", ready: true, note: "Call tenant before rooftop access" },
      { label: "Diagnostic handoff", ready: true, note: "Cooling drops out after 20 minutes" },
    ]);
  });

  test("orderNextMoveItems turns plumbing context into the next office move", () => {
    const api = loadOrdersWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "plumbing",
          label: "Plumbing",
          recordFocus: [],
        },
      })),
    });

    const items = api.orderNextMoveItems(
      { notes: "Water damage photo already texted in" },
      {
        approval_notes: "Customer needs approval before wall access",
        restoration_notes: "Drywall repair follows if leak is behind wall",
        shutoff_notes: "Use hallway shutoff",
      },
      9500,
      "partially_paid"
    );

    expect(items).toEqual([
      { label: "Repair follow-through", ready: true, note: "Customer needs approval before wall access" },
      { label: "Site risk note", ready: true, note: "Use hallway shutoff" },
      { label: "Money follow-through", ready: false, note: "A balance is still open. Keep the reminder or payment step attached to this booked work." },
    ]);
  });

  test("orderRetentionItems keeps HVAC maintenance follow-through attached after booked work", () => {
    const api = loadOrdersWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hvac",
          label: "HVAC",
          recordFocus: [],
        },
      })),
    });

    const items = api.orderRetentionItems(
      { notes: "Return visit may need motor approval" },
      {
        maintenance_notes: "Quarterly tune-up stays active",
        tenant_notes: "Call facilities lead before rooftop return",
      },
      0,
      "paid"
    );

    expect(items).toEqual([
      { label: "Maintenance follow-up", ready: true, note: "Quarterly tune-up stays active", tone: "" },
      { label: "Customer update stays clear", ready: true, note: "Call facilities lead before rooftop return", tone: "" },
      { label: "Account closes cleanly", ready: true, note: "The money side is already in a good place, so the next move can stay focused on retention and repeat work.", tone: "" },
    ]);
  });
});
