"use strict";

const path = require("path");

describe("agent workforce architect", () => {
  const modulePath = path.resolve(
    process.cwd(),
    "netlify/functions/agent/agents/agent-workforce-architect.js"
  );
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("recommends new specialist agents and training targets from live workload pressure", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getAgentWorkforceContext: vi.fn(async () => ({
          tenant: {
            business_name: "Harbor Works",
            plan_key: "growth",
            online_payments_enabled: true,
          },
          business_context: {
            multi_location_customers: [
              { customer_id: "customer_1", name: "City Works" },
              { customer_id: "customer_2", name: "Harbor Campus" },
            ],
            stale_customers: new Array(7).fill(0).map((_, index) => ({
              id: `customer_stale_${index + 1}`,
            })),
            upcoming_jobs: [
              { id: "job_1", title: "North plant" },
              { id: "job_2", title: "South plant" },
              { id: "job_3", title: "City hall" },
              { id: "job_4", title: "Transit bay" },
              { id: "job_5", title: "Annex" },
            ],
          },
          billing_context: {
            candidate_jobs: [
              { id: "job_10", title: "Hydrovac east" },
              { id: "job_11", title: "Hydrovac west" },
              { id: "job_12", title: "Hydrovac north" },
            ],
          },
          collections_context: {
            open_balances: [
              {
                order_id: "order_1",
                order_title: "North campus cleanup",
                invoice_due_date: "",
                payment_due_date: "",
              },
              {
                order_id: "order_2",
                order_title: "South campus cleanup",
                invoice_due_date: "",
                payment_due_date: "",
              },
            ],
          },
          dispatch_context: {
            upcoming_jobs: [
              {
                id: "job_dispatch_1",
                title: "North plant",
                scheduled_date: "",
                assigned_member_id: "",
                assigned_operator_id: "",
              },
              {
                id: "job_dispatch_2",
                title: "South plant",
                scheduled_date: "2026-04-03",
                assigned_member_id: "",
                assigned_operator_id: "",
              },
              {
                id: "job_dispatch_3",
                title: "City hall",
                scheduled_date: "2026-04-03",
                assigned_member_id: "member_1",
                assigned_operator_id: "operator_1",
              },
              {
                id: "job_dispatch_4",
                title: "Transit bay",
                scheduled_date: "2026-04-03",
                assigned_member_id: "member_2",
                assigned_operator_id: "operator_2",
              },
            ],
          },
          import_learning: {
            profile_count: 2,
            source_systems: ["quickbooks"],
            correction_field_hotspots: [
              { field: "order_external_id", count: 3 },
              { field: "customer_name", count: 2 },
            ],
          },
          service_plan_summary: {
            active_count: 5,
            at_risk_count: 2,
            sample_customer_ids: ["customer_1", "customer_2"],
          },
          agent_audit: {
            event_count: 0,
            usage_by_agent: {},
          },
          assumptions: [],
          data_used: [
            { label: "Upcoming jobs", count: 5, detail: "jobs" },
            { label: "Import profiles", count: 2, detail: "tenant_config.import_profiles" },
          ],
        })),
      },
    };

    const { runAgentWorkforceArchitect } = require(modulePath);
    const result = await runAgentWorkforceArchitect({
      supabase: {},
      tenantId: "tenant_1",
    });

    expect(result.report.agent_key).toBe("agent_workforce_architect");
    expect(result.report.summary).toContain("add 1 specialist agent");
    expect(result.report.summary).toContain("sharpen 6 current agent lanes");
    expect(result.context_summary.new_agent_candidates).toBe(1);
    expect(result.context_summary.training_targets).toBe(6);
    expect(result.report.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      "workforce_training_field_closeout_coach",
      "workforce_training_site_packet_builder",
      "workforce_training_accounting_continuity_auditor",
      "workforce_gap_service_plan_renewal_manager",
      "workforce_training_import_migration_assistant",
      "workforce_training_collections_assistant",
      "workforce_training_dispatch_assistant",
    ]));
    expect(result.report.blockers.map((item) => item.id)).toContain("workforce_blocker_low_agent_adoption");
    expect(result.report.recommended_actions.some((action) => action.id === "workforce_action_train_accounting_continuity")).toBe(true);
  });

  test("stays calm when the current agent layer already covers the visible pressure points", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getAgentWorkforceContext: vi.fn(async () => ({
          tenant: {
            business_name: "Quiet Service Co",
            plan_key: "starter",
          },
          business_context: {
            multi_location_customers: [],
            stale_customers: [],
            upcoming_jobs: [],
          },
          billing_context: {
            candidate_jobs: [],
          },
          collections_context: {
            open_balances: [],
          },
          dispatch_context: {
            upcoming_jobs: [],
          },
          import_learning: {
            profile_count: 0,
            source_systems: [],
            correction_field_hotspots: [],
          },
          service_plan_summary: {
            active_count: 0,
            at_risk_count: 0,
            sample_customer_ids: [],
          },
          agent_audit: {
            event_count: 9,
            usage_by_agent: {
              billing_blocker_detector: 3,
              collections_followup_assistant: 3,
              dispatch_scheduling_assistant: 3,
            },
          },
          assumptions: [],
          data_used: [{ label: "Recent agent runs", count: 9, detail: "agent_audit_events" }],
        })),
      },
    };

    const { runAgentWorkforceArchitect } = require(modulePath);
    const result = await runAgentWorkforceArchitect({
      supabase: {},
      tenantId: "tenant_2",
    });

    expect(result.report.summary_status).toBe("ready");
    expect(result.context_summary.new_agent_candidates).toBe(0);
    expect(result.context_summary.training_targets).toBe(0);
    expect(result.report.findings.map((finding) => finding.id)).toContain("workforce_healthy_coverage");
    expect(result.report.blockers).toHaveLength(0);
  });
});
