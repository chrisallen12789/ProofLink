"use strict";

const path = require("path");

function makeJobsTable(job, updated) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: vi.fn(async () => ({ data: job, error: null })),
    update: vi.fn(() => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: updated, error: null }),
          }),
        }),
      }),
    })),
  };
}

describe("netlify/functions/update-job-status", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/update-job-status.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const hydrovacPath = path.resolve(process.cwd(), "netlify/functions/utils/hydrovac.js");
  const compliancePath = path.resolve(process.cwd(), "netlify/functions/lib/hydrovac-compliance.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[hydrovacPath];
    delete require.cache[compliancePath];
  });

  test("blocks hydrovac start when lifecycle issues exist", async () => {
    const job = { id: "job_1", status: "scheduled", job_type: "hydrovac_excavation" };
    const jobsTable = makeJobsTable(job, { ...job, status: "in_progress" });
    const adminSb = { from: vi.fn(() => jobsTable) };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[hydrovacPath] = {
      id: hydrovacPath,
      filename: hydrovacPath,
      loaded: true,
      exports: {
        clean: (value) => String(value || "").trim(),
        parseJsonBody: (event) => JSON.parse(event.body || "{}"),
        requireHydrovacOperatorContext: vi.fn(async () => ({
          tenantId: "tenant_1",
          adminSb,
          hydrovacSettings: { require_locate_ticket_for_excavation: true },
        })),
      },
    };
    require.cache[compliancePath] = {
      id: compliancePath,
      filename: compliancePath,
      loaded: true,
      exports: {
        collectHydrovacLifecycleIssues: vi.fn(async () => [
          { code: "locate_ticket_missing", message: "An active locate ticket is required before this hydrovac job can start." },
        ]),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;

    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ job_id: "job_1", status: "in_progress" }),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain("locate ticket");
    expect(jobsTable.update).not.toHaveBeenCalled();
  });

  test("stamps missing lifecycle timestamps when hydrovac closeout succeeds", async () => {
    const job = {
      id: "job_1",
      status: "in_progress",
      job_type: "hydrovac",
      actual_start_at: null,
      actual_end_at: null,
    };
    const updated = { ...job, status: "completed", actual_start_at: "set", actual_end_at: "set" };
    const jobsTable = makeJobsTable(job, updated);
    const adminSb = { from: vi.fn(() => jobsTable) };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[hydrovacPath] = {
      id: hydrovacPath,
      filename: hydrovacPath,
      loaded: true,
      exports: {
        clean: (value) => String(value || "").trim(),
        parseJsonBody: (event) => JSON.parse(event.body || "{}"),
        requireHydrovacOperatorContext: vi.fn(async () => ({
          tenantId: "tenant_1",
          adminSb,
          hydrovacSettings: {},
        })),
      },
    };
    require.cache[compliancePath] = {
      id: compliancePath,
      filename: compliancePath,
      loaded: true,
      exports: {
        collectHydrovacLifecycleIssues: vi.fn(async () => []),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;

    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ job_id: "job_1", status: "completed", notes: "Closed out in field." }),
    });

    expect(res.statusCode).toBe(200);
    expect(jobsTable.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        notes: "Closed out in field.",
        actual_start_at: expect.any(String),
        actual_end_at: expect.any(String),
      })
    );
  });
});
