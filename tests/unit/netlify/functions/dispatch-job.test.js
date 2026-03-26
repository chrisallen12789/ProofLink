"use strict";

const path = require("path");

function makeResult(data, error = null) {
  return { data, error };
}

function makeSingleChain(result) {
  return {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    gt() { return this; },
    limit() { return this; },
    neq() { return this; },
    maybeSingle: vi.fn(async () => result),
  };
}

function makeArrayChain(result) {
  return {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    gt() { return this; },
    limit() { return this; },
    neq() { return this; },
    maybeSingle: vi.fn(async () => result),
    then(resolve) {
      return Promise.resolve(result).then(resolve);
    },
  };
}

describe("netlify/functions/dispatch-job", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/dispatch-job.js");
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

  test("logs a compliance alert when dispatch is blocked for a missing locate ticket", async () => {
    const jobsUpdate = vi.fn();
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "jobs") {
          return {
            select() { return this; },
            eq() { return this; },
            maybeSingle: vi.fn(async () => makeResult({
              id: "job_1",
              tenant_id: "tenant_1",
              status: "scheduled",
              title: "Hydrovac dig",
              job_type: "hydrovac_excavation",
              scheduled_date: "2026-03-26",
            })),
            update: jobsUpdate,
          };
        }
        if (table === "equipment") {
          return makeSingleChain(makeResult({
            id: "truck_1",
            tenant_id: "tenant_1",
            is_cdl_required: true,
            name: "Unit 12",
            unit_number: "12",
          }));
        }
        if (table === "operator_members") {
          return makeSingleChain(makeResult({
            id: "member_1",
            tenant_id: "tenant_1",
            operator_id: "operator_1",
            role: "driver",
            display_name: "Pat Driver",
          }));
        }
        if (table === "utility_locate_tickets") {
          return makeArrayChain(makeResult([]));
        }
        if (table === "driver_qualifications") {
          return makeSingleChain(makeResult({
            tenant_id: "tenant_1",
            member_id: "member_1",
            cdl_expiry_date: "2026-12-31",
            medical_certificate_expiry: "2026-12-31",
          }));
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const logComplianceAlerts = vi.fn(async () => []);

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
        asBoolean: (value, fallback) => value == null ? fallback : value === true || value === "true",
        asNumber: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
        clean: (value) => String(value || "").trim(),
        parseJsonBody: (event) => JSON.parse(event.body || "{}"),
        requireHydrovacOperatorContext: vi.fn(async () => ({
          tenantId: "tenant_1",
          adminSb,
          hydrovacSettings: { require_locate_ticket_for_excavation: true },
          email: "owner@example.com",
        })),
        daysUntil: () => null,
      },
    };
    require.cache[compliancePath] = {
      id: compliancePath,
      filename: compliancePath,
      loaded: true,
      exports: {
        jobRequiresLocateTicket: vi.fn(() => true),
        logComplianceAlerts,
        resolveComplianceAlerts: vi.fn(async () => []),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_1",
        assigned_truck_id: "truck_1",
        driver_member_id: "member_1",
      }),
    });

    expect(res.statusCode).toBe(409);
    expect(logComplianceAlerts).toHaveBeenCalledWith(
      adminSb,
      "tenant_1",
      expect.arrayContaining([expect.objectContaining({ code: "locate_ticket_missing" })]),
      expect.objectContaining({ referenceId: "job_1" })
    );
    expect(jobsUpdate).not.toHaveBeenCalled();
  });
});
