"use strict";

const path = require("path");

describe("AI systems architect", () => {
  const modulePath = path.resolve(
    process.cwd(),
    "netlify/functions/agent/agents/ai-systems-architect.js"
  );
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("recommends shared AI hardening after the major operator lanes are already exposed", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getAgentWorkforceContext: vi.fn(async () => ({
          tenant: {
            business_name: "Harbor Works",
            plan_key: "growth",
          },
          business_context: {
            pending_quotes: [
              { id: "quote_1", title: "North plant estimate" },
              { id: "quote_2", title: "South plant estimate" },
              { id: "quote_3", title: "Transit yard estimate" },
            ],
            expired_quotes: [
              { id: "quote_4", title: "Dock wash estimate" },
            ],
            stale_customers: new Array(7).fill(0).map((_, index) => ({
              id: `customer_${index + 1}`,
            })),
            multi_location_customers: [
              { customer_id: "customer_1", name: "Harbor Campus" },
              { customer_id: "customer_2", name: "City Works" },
            ],
          },
          service_plan_summary: {
            active_count: 5,
            at_risk_count: 2,
          },
          agent_audit: {
            event_count: 1,
            usage_by_mode: {
              "copilot:quote_rescue": 2,
            },
          },
          assumptions: [],
          data_used: [
            { label: "Pending quotes", count: 3, detail: "quotes" },
            { label: "Stale customers", count: 7, detail: "customers" },
          ],
          context_summary: {
            billing_candidates: 0,
            open_balances: 0,
            active_service_plans: 5,
            recent_agent_runs: 1,
          },
        })),
      },
    };

    const { runAiSystemsArchitect } = require(modulePath);
    const result = await runAiSystemsArchitect({
      supabase: {},
      tenantId: "tenant_1",
    });

    expect(result.report.agent_key).toBe("ai_systems_architect");
    expect(result.report.summary).toContain("expose 0 shipped AI lanes");
    expect(result.report.summary).toContain("add 0 new structured lanes");
    expect(result.report.summary).toContain("harden 1 shared AI file area");
    expect(result.context_summary.exposure_gaps).toBe(0);
    expect(result.context_summary.new_lane_candidates).toBe(0);
    expect(result.context_summary.ai_file_targets).toBe(1);
    expect(result.report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["systems_harden_shared_model_config"])
    );
    expect(result.report.blockers.map((item) => item.id)).toContain("systems_blocker_low_ai_telemetry");
  });
});
