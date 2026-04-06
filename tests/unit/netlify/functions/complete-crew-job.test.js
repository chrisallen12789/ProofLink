"use strict";

const path = require("path");

function makeSelectChain(result) {
  return {
    ...result,
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: vi.fn(async () => result),
  };
}

function makeListChain(result) {
  return {
    ...result,
    select() {
      return this;
    },
    eq() {
      return this;
    },
  };
}

function makeUpdateChain(result, onUpdate = () => {}) {
  return {
    update(payload) {
      onUpdate(payload);
      return this;
    },
    eq() {
      return this;
    },
    select() {
      return this;
    },
    maybeSingle: vi.fn(async () => result),
  };
}

describe("netlify/functions/complete-crew-job", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/complete-crew-job.js");
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

  test("requires and persists hydrovac completion_handoff", async () => {
    const job = {
      id: "job_1",
      tenant_id: "tenant_1",
      status: "in_progress",
      job_type: "hydrovac_excavation",
      requires_confined_space_permit: false,
      metadata: {},
    };
    const updatedJob = { ...job };
    let capturedPatch = null;
    let jobFromCalls = 0;
    const jobSelectChain = makeSelectChain({ data: job, error: null });
    const jobUpdateChain = makeUpdateChain({ data: updatedJob, error: null }, (patch) => {
      capturedPatch = patch;
      Object.assign(updatedJob, patch);
    });
    const permitsTable = makeListChain({ data: [], error: null });
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "jobs") return jobFromCalls++ === 0 ? jobSelectChain : jobUpdateChain;
        if (table === "confined_space_permits") return permitsTable;
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
          email: "crew@example.com",
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
        hydrovacJobType: vi.fn(() => "hydrovac_excavation"),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_1",
        completion_handoff: {
          load_status: "truck_clear",
          locates_verified_on_site: true,
          field_summary: "Crew exposed the line and cleared the truck.",
          office_follow_up: ["invoice"],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(capturedPatch.metadata.crew_closeout.field_summary).toContain("cleared the truck");
    expect(capturedPatch.completion_note).toContain("Hydrovac closeout");
    expect(JSON.parse(res.body).job.completion_handoff.load_status).toBe("truck_clear");
  });

  test("still requires completion_note for non-hydrovac jobs", async () => {
    const job = {
      id: "job_2",
      tenant_id: "tenant_1",
      status: "in_progress",
      job_type: "service_call",
      metadata: {},
    };
    const adminSb = {
      from: vi.fn(() => makeSelectChain({ data: job, error: null })),
    };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireOperatorContext: vi.fn(async () => ({
          tenantId: "tenant_1",
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
        requireHydrovacOperatorContext: vi.fn(async () => {
          throw new Error("not hydrovac");
        }),
      },
    };
    require.cache[compliancePath] = {
      id: compliancePath,
      filename: compliancePath,
      loaded: true,
      exports: {
        collectHydrovacLifecycleIssues: vi.fn(async () => []),
        hydrovacJobType: vi.fn(() => ""),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_2",
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("completion_note");
  });

  test("falls back to custom_fields when jobs.metadata is unavailable", async () => {
    const job = {
      id: "job_3",
      tenant_id: "tenant_1",
      status: "in_progress",
      job_type: "hydrovac_excavation",
      requires_confined_space_permit: false,
      custom_fields: {},
    };
    const updatedJob = { ...job };
    let capturedPatch = null;
    let jobFromCalls = 0;
    const jobSelectChain = makeSelectChain({ data: job, error: null });
    const jobUpdateChain = makeUpdateChain({ data: updatedJob, error: null }, (patch) => {
      capturedPatch = patch;
      Object.assign(updatedJob, patch);
    });
    const permitsTable = makeListChain({ data: [], error: null });
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "jobs") return jobFromCalls++ === 0 ? jobSelectChain : jobUpdateChain;
        if (table === "confined_space_permits") return permitsTable;
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
          email: "crew@example.com",
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
        hydrovacJobType: vi.fn(() => "hydrovac_excavation"),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_3",
        completion_handoff: {
          load_status: "truck_clear",
          locates_verified_on_site: true,
          field_summary: "Crew daylighted the trench and cleared the truck.",
          office_follow_up: ["invoice"],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(capturedPatch.custom_fields.crew_closeout.field_summary).toContain("daylighted");
    expect(capturedPatch.metadata).toBeUndefined();
    expect(JSON.parse(res.body).job.completion_handoff.load_status).toBe("truck_clear");
  });
});
