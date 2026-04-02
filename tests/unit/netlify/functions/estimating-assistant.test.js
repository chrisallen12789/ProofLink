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

  test("surfaces missing estimate inputs without inventing pricing", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getEstimateRecordContext: vi.fn(async () => ({
          primary_record: {
            id: "lead_1",
            title: "Rooftop leak review",
            summary: "",
            notes: "",
          },
          primary_record_type: "lead",
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
      input: { lead_id: "lead_1" },
    });

    expect(result.report.summary_status).toBe("blocked");
    expect(result.report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "estimate_missing_scope_summary",
      "estimate_missing_measurements",
    ]));
    expect(JSON.stringify(result.report)).not.toContain("$");
    expect(result.report.recommended_actions.map((item) => item.id)).toContain("review_actual_price_sources");
  });
});
