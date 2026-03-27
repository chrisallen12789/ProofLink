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

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.label)).toEqual([
      "Property profile",
      "Access notes",
      "Repeat-service memory",
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
});
