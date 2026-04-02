"use strict";

const path = require("path");

describe("quote rescue manager", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/agent/agents/quote-rescue-manager.js");
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("separates follow-up-ready, missing-facts, and stale proposal records", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getQuoteRescueManagerContext: vi.fn(async () => ({
          quotes: [
            {
              id: "quote_1",
              customer_id: "customer_1",
              title: "North wash quote",
              status: "pending",
              amount_cents: 24000,
              valid_until: "2026-04-30",
              created_at: "2026-03-20T00:00:00.000Z",
              updated_at: "2026-03-20T00:00:00.000Z",
              description: "Wash the north wall and awning",
            },
            {
              id: "quote_2",
              customer_id: "customer_2",
              title: "South wall quote",
              status: "expired",
              amount_cents: 18000,
              valid_until: "2026-03-10",
              created_at: "2026-03-01T00:00:00.000Z",
              updated_at: "2026-03-01T00:00:00.000Z",
              description: "South wall wash",
            },
          ],
          bids: [
            {
              id: "bid_1",
              customer_id: "customer_3",
              title: "Dock repair proposal",
              status: "sent",
              valid_until: "2026-04-28",
              total_cents: 0,
              project_summary: "",
              scope_of_work: "",
              service_address: "",
              created_at: "2026-03-25T00:00:00.000Z",
              updated_at: "2026-03-25T00:00:00.000Z",
            },
          ],
          customers: [
            { id: "customer_1", name: "North Plant" },
            { id: "customer_2", name: "South Plant" },
            { id: "customer_3", name: "Dock Works" },
          ],
          assumptions: [],
          data_used: [{ label: "Proposal records", count: 3, detail: "quotes,bids" }],
        })),
      },
    };

    const { runQuoteRescueManager } = require(modulePath);
    const result = await runQuoteRescueManager({
      supabase: {},
      tenantId: "tenant_1",
    });

    expect(result.report.agent_key).toBe("quote_rescue_manager");
    expect(result.context_summary.total_records).toBe(3);
    expect(result.context_summary.ready_to_follow_up).toBeGreaterThanOrEqual(1);
    expect(result.context_summary.missing_estimate_facts).toBe(1);
    expect(result.context_summary.stale_enough_to_rework).toBe(1);
    expect(result.report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "quote_rescue_missing_estimate_facts",
      "quote_rescue_stale_rework_needed",
    ]));
  });
});
