"use strict";

const path = require("path");

describe("retention reactivation manager", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/agent/agents/retention-reactivation-manager.js");
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("separates immediate reactivation from open-work and plan-recovery holds", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getRetentionReactivationContext: vi.fn(async () => ({
          focus_customer_id: "customer_1",
          customers: [
            { id: "customer_1", name: "Harbor Works", recurring_notes: "Monthly inspection", updated_at: "2026-03-01T00:00:00.000Z" },
            { id: "customer_2", name: "North Plant", recurring_notes: "Quarterly wash", updated_at: "2026-03-15T00:00:00.000Z" },
            { id: "customer_3", name: "South Dock", maintenance_notes: "Semiannual repair follow-up", updated_at: "2026-03-10T00:00:00.000Z" },
          ],
          stale_customers: [
            { id: "customer_1" },
            { id: "customer_2" },
            { id: "customer_3" },
          ],
          service_plans: [
            { id: "plan_1", customer_id: "customer_2", status: "active", next_run_on: "" },
          ],
          recent_orders: [
            { id: "order_1", customer_id: "customer_3", status: "new" },
          ],
          recent_jobs: [],
          assumptions: [],
          data_used: [{ label: "Focus customers", count: 3, detail: "customers" }],
        })),
      },
    };

    const { runRetentionReactivationManager } = require(modulePath);
    const result = await runRetentionReactivationManager({
      supabase: {},
      tenantId: "tenant_1",
      input: { customer_id: "customer_1" },
    });

    expect(result.report.agent_key).toBe("retention_reactivation_manager");
    expect(result.context_summary.focus_customers).toBe(3);
    expect(result.context_summary.reactivate_now).toBe(1);
    expect(result.context_summary.recent_work_still_open).toBe(1);
    expect(result.context_summary.plan_recovery).toBe(1);
    expect(result.report.blockers.map((item) => item.id)).toContain("retention_plan_recovery_overlap");
  });

  test("treats customer-memory fields as repeat-service signals for reactivation", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getRetentionReactivationContext: vi.fn(async () => ({
          focus_customer_id: "customer_memory_1",
          customers: [
            {
              id: "customer_memory_1",
              name: "Boiler House",
              checklist_notes: "Monthly boiler room walkthrough and filter swap",
              updated_at: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "customer_memory_2",
              name: "Warehouse Annex",
              equipment_notes: "RTU-2 still needs spring follow-up",
              updated_at: "2026-02-02T00:00:00.000Z",
            },
          ],
          stale_customers: [
            { id: "customer_memory_1" },
            { id: "customer_memory_2" },
          ],
          service_plans: [],
          recent_orders: [],
          recent_jobs: [],
          assumptions: [],
          data_used: [{ label: "Focus customers", count: 2, detail: "customers" }],
        })),
      },
    };

    const { runRetentionReactivationManager } = require(modulePath);
    const result = await runRetentionReactivationManager({
      supabase: {},
      tenantId: "tenant_1",
      input: { customer_id: "customer_memory_1" },
    });

    expect(result.context_summary.reactivate_now).toBe(2);
    expect(result.report.findings.map((item) => item.detail).join(" ")).toContain("checklist_notes");
    expect(result.report.findings.map((item) => item.category)).toEqual([
      "reactivate_now",
      "reactivate_now",
    ]);
  });
});
