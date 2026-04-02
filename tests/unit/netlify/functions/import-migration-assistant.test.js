"use strict";

const path = require("path");

describe("import migration assistant", () => {
  const handlerPath = path.resolve(
    process.cwd(),
    "netlify/functions/agent/agents/import-migration-assistant.js"
  );

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
  });

  test("reviews open work imports and suggests a reusable profile", async () => {
    const { runImportMigrationAssistant } = require(handlerPath);

    const result = await runImportMigrationAssistant({
      tenantId: "tenant_1",
      input: {
        import_kind: "open_work",
        file_name: "jobber-open-work.csv",
        headers: [
          "Client Name",
          "Email",
          "Status",
          "Job Name",
          "Service Date",
          "Total",
          "Notes",
        ],
        sample_rows: [
          {
            client_name: "Maple Street HOA",
            email: "board@maple.com",
            status: "quoted",
            job_name: "Front walk wash",
            service_date: "2026-04-05",
            total: "1450.00",
            notes: "Board inspection in April.",
          },
          {
            client_name: "Harbor Suites",
            email: "ops@harborsuites.com",
            status: "booked",
            job_name: "Garage cleanup",
            service_date: "",
            total: "900.00",
            notes: "Needs a morning arrival window.",
          },
        ],
      },
    });

    expect(result.report.agent_key).toBe("import_migration_assistant");
    expect(result.context_summary.recommended_kind).toBe("open_work");
    expect(result.context_summary.route_counts.bids).toBe(1);
    expect(result.context_summary.route_counts.orders).toBe(1);
    expect(result.context_summary.route_counts.jobs).toBe(1);
    expect(result.report.findings.some((finding) => finding.title.includes("service date"))).toBe(true);
    expect(result.context_summary.profile_suggestion.label).toContain("jobber-open-work");
    expect(result.context_summary.profile_suggestion.field_aliases.title).toContain("job_name");
  });
});
