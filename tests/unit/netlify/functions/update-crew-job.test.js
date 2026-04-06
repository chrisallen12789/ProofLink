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

  test("persists hydrovac completion_handoff into job metadata on completion", async () => {
    const job = {
      id: "job_2",
      tenant_id: "tenant_1",
      assigned_member_id: "member_1",
      assigned_operator_id: null,
      status: "in_progress",
      actual_start_at: "2026-04-03T12:00:00.000Z",
      actual_end_at: null,
      job_type: "hydrovac_excavation",
      requires_confined_space_permit: false,
      metadata: {},
    };
    const member = { id: "member_1", role: "tech" };
    const updatedJob = { ...job };
    let capturedPatch = null;
    let jobFromCalls = 0;
    const jobSelectChain = makeSelectChain({ data: job, error: null });
    const jobUpdateChain = makeUpdateChain({ data: updatedJob, error: null }, (patch) => {
      capturedPatch = patch;
      Object.assign(updatedJob, patch);
    });
    const membersTable = makeSelectChain({ data: member, error: null });
    const permitsTable = makeListChain({ data: [], error: null });
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "jobs") return jobFromCalls++ === 0 ? jobSelectChain : jobUpdateChain;
        if (table === "operator_members") return membersTable;
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
          role: "tech",
          user: { id: "user_1", email: "crew@example.com" },
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
        collectHydrovacLifecycleIssues: vi.fn(async () => []),
        hydrovacJobType: vi.fn(() => "hydrovac_excavation"),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;

    const res = await handler({
      httpMethod: "PATCH",
      body: JSON.stringify({
        job_id: "job_2",
        status: "completed",
        completion_handoff: {
          load_status: "truck_clear",
          bol_number: "BOL-4401",
          locates_verified_on_site: true,
          field_summary: "Crew daylighted the trench and cleared the truck.",
          office_follow_up: ["invoice", "customer_records"],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(capturedPatch.metadata.crew_closeout.field_summary).toContain("daylighted");
    expect(capturedPatch.completion_note).toContain("Hydrovac closeout");
    expect(JSON.parse(res.body).job.completion_handoff.load_status).toBe("truck_clear");
  });

  test("rejects malformed hydrovac completion_handoff payloads with 400", async () => {
    const job = {
      id: "job_3",
      tenant_id: "tenant_1",
      assigned_member_id: "member_1",
      assigned_operator_id: null,
      status: "in_progress",
      actual_start_at: "2026-04-03T12:00:00.000Z",
      actual_end_at: null,
      job_type: "hydrovac_excavation",
      requires_confined_space_permit: true,
      metadata: {},
    };
    const member = { id: "member_1", role: "tech" };
    const jobSelectChain = makeSelectChain({ data: job, error: null });
    const membersTable = makeSelectChain({ data: member, error: null });
    const permitsTable = makeListChain({ data: [{ id: "permit_1" }], error: null });
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "jobs") return jobSelectChain;
        if (table === "operator_members") return membersTable;
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
        collectHydrovacLifecycleIssues: vi.fn(async () => []),
        hydrovacJobType: vi.fn(() => "hydrovac_excavation"),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "PATCH",
      body: JSON.stringify({
        job_id: "job_3",
        status: "completed",
        completion_handoff: {
          load_status: "live_load_remaining",
          field_summary: "Crew completed the dig and kept one compatible load in the truck.",
          permit_status: "needs_office_followup",
        },
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain("live load");
  });

  test("falls back to custom_fields when hydrovac jobs do not expose metadata", async () => {
    const job = {
      id: "job_4",
      tenant_id: "tenant_1",
      assigned_member_id: "member_1",
      assigned_operator_id: null,
      status: "in_progress",
      actual_start_at: "2026-04-03T12:00:00.000Z",
      actual_end_at: null,
      job_type: "hydrovac_excavation",
      requires_confined_space_permit: false,
      custom_fields: {},
    };
    const member = { id: "member_1", role: "tech" };
    const updatedJob = { ...job };
    let capturedPatch = null;
    let jobFromCalls = 0;
    const jobSelectChain = makeSelectChain({ data: job, error: null });
    const jobUpdateChain = makeUpdateChain({ data: updatedJob, error: null }, (patch) => {
      capturedPatch = patch;
      Object.assign(updatedJob, patch);
    });
    const membersTable = makeSelectChain({ data: member, error: null });
    const permitsTable = makeListChain({ data: [], error: null });
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "jobs") return jobFromCalls++ === 0 ? jobSelectChain : jobUpdateChain;
        if (table === "operator_members") return membersTable;
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
          role: "tech",
          user: { id: "user_1", email: "crew@example.com" },
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
        collectHydrovacLifecycleIssues: vi.fn(async () => []),
        hydrovacJobType: vi.fn(() => "hydrovac_excavation"),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "PATCH",
      body: JSON.stringify({
        job_id: "job_4",
        status: "completed",
        completion_handoff: {
          load_status: "truck_clear",
          bol_number: "BOL-5501",
          locates_verified_on_site: true,
          field_summary: "Crew daylighted the trench and cleared the truck.",
          office_follow_up: ["invoice"],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(capturedPatch.custom_fields.crew_closeout.bol_number).toBe("BOL-5501");
    expect(capturedPatch.metadata).toBeUndefined();
    expect(JSON.parse(res.body).job.completion_handoff.load_status).toBe("truck_clear");
  });
});
