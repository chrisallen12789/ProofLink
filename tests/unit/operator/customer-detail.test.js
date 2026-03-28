"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadCustomerDetail(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-customer-detail.js"),
    "utf8"
  );

  const context = {
    window: {},
    console,
    LEADS_CACHE: [],
    BIDS_CACHE: [],
    JOBS_CACHE: [],
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window;
}

describe("operator customer detail", () => {
  test("bidGrandTotalCents falls back to included line items when total is missing", () => {
    const api = loadCustomerDetail();

    expect(api.bidGrandTotalCents({
      line_items: [
        { kind: "base", quantity: 2, unit_price_cents: 15000 },
        { kind: "allowance", quantity: 1, unit_price_cents: 5000 },
        { kind: "option", quantity: 1, unit_price_cents: 9000 },
      ],
    })).toBe(35000);
  });

  test("bidGrandTotalCents prefers explicit totals when present", () => {
    const api = loadCustomerDetail();

    expect(api.bidGrandTotalCents({
      total_cents: 42000,
      line_items: [
        { kind: "base", quantity: 1, unit_price_cents: 1000 },
      ],
    })).toBe(42000);
  });

  test("customerMemoryChecklist reflects repeat-service memory for landscaping", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      address_line1: "123 Main St",
      city: "Tulsa",
      state: "OK",
      zip: "74103",
      access_notes: "Gate code 4421",
      service_plan_name: "Weekly mow",
    }, {
      business: {
        key: "landscaping",
      },
    });

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.label)).toEqual([
      "Property profile",
      "Access notes",
      "Repeat-service memory",
      "Seasonal opportunities",
    ]);
    expect(items.slice(0, 3).every((item) => item.ready)).toBe(true);
    expect(items[3].ready).toBe(false);
  });

  test("customerMemoryChecklist highlights cleaning visit cadence and checklist memory", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      address_line1: "455 Elm St",
      city: "Dallas",
      state: "TX",
      zip: "75001",
      entry_notes: "Use side entrance",
      checklist_notes: "Kitchen first, then upstairs bath",
      recurring_notes: "Every other Tuesday",
    }, {
      business: {
        key: "cleaning",
      },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Site profile",
      "Access instructions",
      "Scope memory",
      "Visit cadence",
    ]);
    expect(items.every((item) => item.ready)).toBe(true);
  });

  test("customerMemoryChecklist captures HVAC equipment and diagnostic memory", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      equipment_serial: "TRN-44921",
      access_notes: "Mechanical room behind unit 3",
      failure_symptoms: "Short cycling after 10 minutes",
      parts_follow_up: "Control board ordered",
    }, {
      business: {
        key: "hvac",
      },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Equipment history",
      "Site and access",
      "Diagnostic memory",
      "Follow-up context",
    ]);
    expect(items.every((item) => item.ready)).toBe(true);
  });

  test("customerMemoryChecklist keeps plumbing emergency and repair follow-through visible", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      fixture_notes: "Second-floor hall bath sink trap replaced in 2025",
      shutoff_notes: "Whole-home shutoff in garage closet",
      emergency_notes: "Ceiling leak over dining room",
      restoration_notes: "Drywall patch likely after repair",
    }, {
      business: {
        key: "plumbing",
      },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Fixture history",
      "Site and shutoff",
      "Emergency context",
      "Repair follow-through",
    ]);
    expect(items.every((item) => item.ready)).toBe(true);
  });

  test("customerCollectionGuidance highlights the first payment step when money is still open", () => {
    const api = loadCustomerDetail({
      formatDateTime: (value) => `formatted:${value}`,
    });

    const guidance = api.customerCollectionGuidance(
      { email: "owner@example.com" },
      [{ id: "order_1" }],
      [],
      15000
    );

    expect(guidance.title).toBe("The first payment step is still open");
    expect(guidance.description).toContain("Send the invoice");
  });

  test("customerRelationshipGuidance keeps HVAC follow-through visible before the next visit slips", () => {
    const api = loadCustomerDetail({
      formatDateTime: (value) => `formatted:${value}`,
      formatUsd: (value) => `$${value}`,
    });

    const guidance = api.customerRelationshipGuidance({
      customer: {
        maintenance_notes: "Spring maintenance due in April",
        parts_follow_up: "Control board still waiting on approval",
      },
      openRequestsCount: 0,
      openProposalCount: 1,
      activeOrderCount: 0,
      activeJobCount: 0,
      balance: 12000,
      latestInteraction: { summary: "Customer asked for parts ETA" },
      latestPayment: { paid_at: "2026-03-20" },
      blueprint: {
        business: {
          key: "hvac",
        },
      },
    });

    expect(guidance.title).toBe("Move the live proposal to a decision");
    expect(guidance.items.map((item) => item.label)).toEqual([
      "Open requests",
      "Live proposals",
      "Active work",
      "Money follow-through",
      "System follow-through",
    ]);
    expect(guidance.items[1].tone).toBe("warn");
    expect(guidance.items[4].note).toContain("Spring maintenance due in April");
  });

  test("customerPostWorkGuidance keeps plumbing closeout and collection visible after the repair", () => {
    const api = loadCustomerDetail({
      formatDateTime: (value) => `formatted:${value}`,
      formatUsd: (value) => `$${value}`,
    });

    const guidance = api.customerPostWorkGuidance({
      customer: {
        restoration_notes: "Drywall patch visit still needs scheduling",
        issue_summary: "Leak was isolated under the upstairs vanity",
      },
      customerOrders: [{
        id: "order_1",
        status: "completed",
        updated_at: "2026-03-26T15:00:00Z",
      }],
      customerJobs: [{
        id: "job_1",
        status: "completed",
        completed_at: "2026-03-26T16:00:00Z",
      }],
      balance: 8400,
      blueprint: {
        business: {
          key: "plumbing",
        },
      },
    });

    expect(guidance.title).toBe("Turn finished work into the next easy step");
    expect(guidance.description).toContain("formatted:2026-03-26T16:00:00Z");
    expect(guidance.items.map((item) => item.label)).toEqual([
      "Repair closeout stays visible",
      "Issue history is reusable",
      "Final money step",
    ]);
    expect(guidance.items[0].note).toContain("Drywall patch visit still needs scheduling");
    expect(guidance.items[2].note).toContain("$8400");
  });

  test("customer detail source uses shared memory checklist classes", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-customer-detail.js"),
      "utf8"
    );

    expect(source).toContain("memory-checklist");
    expect(source).toContain("memory-checklist__item");
    expect(source).toContain("memory-checklist__item--ready");
    expect(source).toContain("customerRelationshipGuidance");
    expect(source).toContain("customerPostWorkGuidance");
    expect(source).toContain("customer-next-step-card");
    expect(source).toContain("After the work wraps");
    expect(source).not.toContain('style="padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;');
    expect(source).not.toContain('background:${item.ready ? "rgba(46,125,50,.10)" : "rgba(255,255,255,.03)"}');
    expect(source).not.toContain('style="margin-top:10px;"');
    expect(source).not.toContain('style="margin-top:14px;"');
    expect(source).not.toContain('style="font-size:.8rem;"');
  });
});
