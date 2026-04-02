"use strict";

const path = require("path");

describe("service plan renewal manager", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/agent/agents/service-plan-renewal-manager.js");
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("separates due-soon plans from missing-next-run and overdue renewal accounts", async () => {
    const today = new Date();
    const dueSoon = new Date(today.getTime() + (7 * 86400000)).toISOString().slice(0, 10);
    const overdue = new Date(today.getTime() - (3 * 86400000)).toISOString().slice(0, 10);

    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getServicePlanRenewalContext: vi.fn(async () => ({
          focus_plan_id: "plan_1",
          service_plans: [
            { id: "plan_1", customer_id: "customer_1", title: "Monthly wash", status: "active", next_run_on: dueSoon, updated_at: "2026-04-01T00:00:00.000Z" },
            { id: "plan_2", customer_id: "customer_2", title: "Quarterly HVAC", status: "active", next_run_on: "", updated_at: "2026-03-28T00:00:00.000Z" },
            { id: "plan_3", customer_id: "customer_3", title: "Drain follow-up", status: "active", next_run_on: overdue, updated_at: "2026-03-20T00:00:00.000Z" },
          ],
          customers: [
            { id: "customer_1", name: "North Plant" },
            { id: "customer_2", name: "Harbor Suites" },
            { id: "customer_3", name: "Dock Works" },
          ],
          related_orders: [],
          assumptions: [],
          data_used: [{ label: "Service plans", count: 3, detail: "service_plans" }],
        })),
      },
    };

    const { runServicePlanRenewalManager } = require(modulePath);
    const result = await runServicePlanRenewalManager({
      supabase: {},
      tenantId: "tenant_1",
      input: { plan_id: "plan_1" },
    });

    expect(result.report.agent_key).toBe("service_plan_renewal_manager");
    expect(result.context_summary.active_plans).toBe(3);
    expect(result.context_summary.due_soon).toBe(1);
    expect(result.context_summary.missing_next_run).toBe(1);
    expect(result.context_summary.reactivation_needed).toBe(1);
    expect(result.report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "service_plan_missing_next_run",
      "service_plan_reactivation_needed",
    ]));
  });
});
