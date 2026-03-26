"use strict";

const path = require("path");

function makeSelectChain(result) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: vi.fn(async () => result),
  };
}

describe("netlify/functions/update-crew-job", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/update-crew-job.js");
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

  test("blocks crew start when hydrovac compliance issues exist", async () => {
    const job = {
      id: "job_1",
      tenant_id: "tenant_1",
      assigned_member_id: "member_1",
      assigned_operator_id: null,
      status: "scheduled",
      actual_start_at: null,
      actual_end_at: null,
      job_type: "hydrovac_excavation",
    };
    const member = { id: "member_1", role: "tech" };
    const jobsTable = makeSelectChain({ data: job, error: null });
    const membersTable = makeSelectChain({ data: member, error: null });
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "jobs") return jobsTable;
        if (table === "operator_members") return membersTable;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireOperatorContext: vi.fn(async () => ({
          tenantId: "tenant_1",
          role: "tech",
          user: { id: "user_1" },
        })),
        getAdminClient: () => adminSb,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[hydrovacPath] = {
      id: hydrovacPath,
      filename: hydrovacPath,
      loaded: true,
      exports: {
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
        hydrovacJobType: vi.fn(() => "hydrovac_excavation"),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;

    const res = await handler({
      httpMethod: "PATCH",
      body: JSON.stringify({ job_id: "job_1", status: "in_progress" }),
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain("locate ticket");
  });
});
