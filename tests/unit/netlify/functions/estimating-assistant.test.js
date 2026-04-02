"use strict";

const path = require("path");

describe("estimating assistant", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/agent/agents/estimating-assistant.js");
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("surfaces missing bid estimate inputs without inventing pricing", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getEstimateRecordContext: vi.fn(async () => ({
          bid: {
            id: "bid_1",
          },
          primary_record: {
            id: "bid_1",
            title: "Rooftop leak review",
            project_summary: "",
            scope_of_work: "",
            internal_notes: "",
          },
          primary_record_type: "bid",
          customer: null,
          prior_similar_records: [],
          known_price_total_cents: 0,
          has_measurements: false,
          missing_data: [],
          assumptions: [],
          data_used: [],
        })),
      },
    };

    const { runEstimatingAssistant } = require(modulePath);
    const result = await runEstimatingAssistant({
      supabase: {},
      tenantId: "tenant_1",
      input: { bid_id: "bid_1" },
    });

    expect(result.report.summary_status).toBe("blocked");
    expect(result.report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "estimate_missing_scope_summary",
      "estimate_missing_measurements",
    ]));
    expect(result.context_summary.bid_id).toBe("bid_1");
    expect(JSON.stringify(result.report)).not.toContain("$");
    expect(result.report.recommended_actions.map((item) => item.id)).toContain("review_actual_price_sources");
  });

  test("uses bid pricing and linked history without inventing new prices", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getEstimateRecordContext: vi.fn(async () => ({
          bid: {
            id: "bid_2",
          },
          primary_record: {
            id: "bid_2",
            title: "Cooling tower service",
            project_summary: "Inspect tower controls and replace failed sensor.",
            scope_of_work: "Verify wiring, replace the failed sensor, and test the system.",
            service_address: "44 Harbor Rd",
            internal_notes: "Use approved tower parts only.",
          },
          primary_record_type: "bid",
          customer: {
            id: "customer_2",
            name: "Harbor Works",
          },
          prior_similar_records: [
            { id: "order_1", title: "Tower repair" },
            { id: "bid_1", title: "Tower diagnostic" },
          ],
          known_price_total_cents: 42000,
          has_measurements: true,
          missing_data: [],
          assumptions: [],
          data_used: [{ label: "Related history", count: 2, detail: "orders,bids" }],
        })),
      },
    };

    const { runEstimatingAssistant } = require(modulePath);
    const result = await runEstimatingAssistant({
      supabase: {},
      tenantId: "tenant_1",
      input: { bid_id: "bid_2" },
    });

    expect(result.report.summary_status).toBe("ready");
    expect(result.report.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "estimate_known_pricing_present",
      "estimate_prior_history_available",
    ]));
    expect(result.context_summary.bid_id).toBe("bid_2");
    expect(JSON.stringify(result.report)).toContain("$420.00");
  });
});
