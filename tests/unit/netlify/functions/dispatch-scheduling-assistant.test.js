"use strict";

const path = require("path");

describe("dispatch scheduling assistant", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/agent/agents/dispatch-scheduling-assistant.js");
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("flags unscheduled, unassigned, conflicting, and bundle-worthy jobs", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getDispatchSchedulingContext: vi.fn(async () => ({
          target_date: "2026-04-03",
          job_type: "hydrovac",
          upcoming_jobs: [
            { id: "job_unscheduled", title: "Permit review", scheduled_date: "", scheduled_time: "", assigned_member_id: "", assigned_operator_id: "", customer_id: "customer_1", service_address: "100 Main St" },
            { id: "job_unassigned", title: "North trench", scheduled_date: "2026-04-03", scheduled_time: "08:00", assigned_member_id: "", assigned_operator_id: "", customer_id: "customer_2", service_address: "101 Main St" },
            { id: "job_conflict_a", title: "Hydrovac east", scheduled_date: "2026-04-03", scheduled_time: "09:00", assigned_member_id: "member_1", assigned_operator_id: "operator_1", customer_id: "customer_3", service_address: "200 State St" },
            { id: "job_conflict_b", title: "Hydrovac west", scheduled_date: "2026-04-03", scheduled_time: "09:00", assigned_member_id: "member_1", assigned_operator_id: "operator_1", customer_id: "customer_4", service_address: "300 State St" },
            { id: "job_bundle_a", title: "Campus east", scheduled_date: "2026-04-03", scheduled_time: "11:00", assigned_member_id: "member_2", assigned_operator_id: "operator_2", customer_id: "customer_5", service_address: "1 College Ave" },
            { id: "job_bundle_b", title: "Campus west", scheduled_date: "2026-04-03", scheduled_time: "13:00", assigned_member_id: "member_3", assigned_operator_id: "operator_3", customer_id: "customer_5", service_address: "2 College Ave" },
            { id: "job_missing_time", title: "Anytime cleanup", scheduled_date: "2026-04-03", scheduled_time: "", assigned_member_id: "member_4", assigned_operator_id: "operator_4", customer_id: "customer_6", service_address: "9 River Rd" },
          ],
          assumptions: [],
          data_used: [{ label: "Jobs on selected date", count: 6, detail: "jobs" }],
        })),
      },
    };

    const { runDispatchSchedulingAssistant } = require(modulePath);
    const result = await runDispatchSchedulingAssistant({
      supabase: {},
      tenantId: "tenant_1",
      input: { target_date: "2026-04-03", job_type: "hydrovac" },
    });

    expect(result.report.summary).toContain("2026-04-03");
    expect(result.report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "dispatch_unscheduled_jobs",
      "dispatch_assignment_conflict",
    ]));
    expect(result.report.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "dispatch_unassigned_jobs",
      "dispatch_missing_times",
      "dispatch_bundle_opportunity",
    ]));
    expect(result.report.recommended_actions.map((item) => item.id)).toEqual(expect.arrayContaining([
      "dispatch_review_unscheduled_work",
      "dispatch_tighten_route_shape",
    ]));
    expect(result.context_summary.bundle_opportunities).toBe(1);
  });
});
