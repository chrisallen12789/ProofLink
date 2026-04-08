"use strict";

const path = require("path");

function makeResult(data, error = null) {
  return { data, error };
}

function createQuery(result, options = {}) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    gt: vi.fn(() => query),
    limit: vi.fn(() => query),
    neq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };

  if (options.thenable) {
    query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  }

  return query;
}

function createJobsTable({ job, conflictingJobs = [], updatedJob = null, updateSpy = vi.fn() }) {
  return {
    select: vi.fn(() => {
      const query = createQuery(makeResult(job), { thenable: true });
      const originalEq = query.eq;
      query.eq = vi.fn((field, value) => {
        originalEq(field, value);
        if (field === "id") {
          query.maybeSingle = vi.fn(async () => makeResult(job));
        }
        if (field === "assigned_truck_id") {
          query.then = (resolve, reject) => Promise.resolve(makeResult(conflictingJobs)).then(resolve, reject);
        }
        return query;
      });
      return query;
    }),
    update: updateSpy.mockImplementation(() => ({
      eq() { return this; },
      select() { return this; },
      maybeSingle: vi.fn(async () => makeResult(updatedJob || { ...job, status: "dispatched" })),
    })),
  };
}

function createAdminSb({
  job,
  truck,
  member,
  locateTickets = [],
  qualifications = {},
  conflictingJobs = [],
  truckLoads = [],
  updatedJob = null,
  updateSpy = vi.fn(),
  equipmentUpdateSpy = vi.fn(),
} = {}) {
  return {
    from: vi.fn((table) => {
      if (table === "jobs") {
        return createJobsTable({ job, conflictingJobs, updatedJob, updateSpy });
      }
      if (table === "equipment") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: vi.fn(async () => makeResult(truck)),
          update: equipmentUpdateSpy.mockImplementation(() => ({
            eq() { return this; },
          })),
        };
      }
      if (table === "operator_members") {
        return createQuery(makeResult(member));
      }
      if (table === "utility_locate_tickets") {
        return createQuery(makeResult(locateTickets), { thenable: true });
      }
      if (table === "driver_qualifications") {
        return createQuery(makeResult(qualifications));
      }
      if (table === "waste_manifests") {
        return createQuery(makeResult(truckLoads), { thenable: true });
      }
      if (table === "compliance_alerts") {
        return {
          update() { return this; },
          eq() { return this; },
          in() { return this; },
          select: vi.fn(async () => makeResult([])),
          insert: vi.fn(() => ({
            select: vi.fn(async () => makeResult([])),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe("netlify/functions/dispatch-job", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/dispatch-job.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const hydrovacPath = path.resolve(process.cwd(), "netlify/functions/utils/hydrovac.js");
  const compliancePath = path.resolve(process.cwd(), "netlify/functions/lib/hydrovac-compliance.js");

  const baseJob = {
    id: "job_1",
    tenant_id: "tenant_1",
    status: "scheduled",
    title: "Hydrovac dig",
    job_type: "hydrovac_excavation",
    customer_id: "cust_1",
    scheduled_date: "2026-03-26",
    scheduled_time: "09:00",
  };
  const baseTruck = {
    id: "truck_1",
    tenant_id: "tenant_1",
    is_cdl_required: true,
    name: "Unit 12",
    unit_number: "12",
  };
  const baseMember = {
    id: "member_1",
    tenant_id: "tenant_1",
    operator_id: "operator_1",
    role: "driver",
    display_name: "Pat Driver",
  };
  const baseQualifications = {
    tenant_id: "tenant_1",
    member_id: "member_1",
    cdl_expiry_date: "2026-12-31",
    medical_certificate_expiry: "2026-12-31",
  };

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[hydrovacPath];
    delete require.cache[compliancePath];
  });

  function installMocks({ adminSb, logComplianceAlerts = vi.fn(async () => []), resolveComplianceAlerts = vi.fn(async () => []) }) {
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
        manifestBolNumber: (manifest) => String(manifest?.metadata?.bol_number || "").trim(),
        manifestLiveHoldReason: (manifest) => String(manifest?.metadata?.live_load_hold_reason || "").trim(),
        manifestMarkedLive: (manifest) => String(manifest?.metadata?.load_state || "").trim().toLowerCase() === "live_in_truck",
        resolveComplianceAlerts,
        truckLoadIssuesForRows: (loads, job) => (loads || []).flatMap((manifest) => {
          if (String(manifest?.job_id || "") === String(job?.id || "")) return [];
          if (String(manifest?.customer_id || "") !== String(job?.customer_id || "")) {
            return [{
              code: "truck_cross_contamination_risk",
              message: `Truck still carries manifest ${manifest.manifest_number}.`,
            }];
          }
          return [{
            code: "truck_live_load_open",
            message: `Truck still carries manifest ${manifest.manifest_number}.`,
          }];
        }),
      },
    };
    return { logComplianceAlerts, resolveComplianceAlerts };
  }

  test("logs a compliance alert when dispatch is blocked for a missing locate ticket", async () => {
    const updateSpy = vi.fn();
    const adminSb = createAdminSb({
      job: baseJob,
      truck: baseTruck,
      member: baseMember,
      locateTickets: [],
      qualifications: baseQualifications,
      updateSpy,
    });
    const { logComplianceAlerts } = installMocks({ adminSb });

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
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("blocks dispatch when the assigned truck carries another customer's live load", async () => {
    const updateSpy = vi.fn();
    const adminSb = createAdminSb({
      job: baseJob,
      truck: baseTruck,
      member: baseMember,
      locateTickets: [{ id: "ticket_1" }],
      qualifications: baseQualifications,
      truckLoads: [{
        id: "manifest_1",
        manifest_number: "MAN-1",
        job_id: "job_other",
        customer_id: "cust_other",
        metadata: {
          load_state: "live_in_truck",
          bol_number: "BOL-1",
          live_load_hold_reason: "Waiting on disposal window",
        },
      }],
      updateSpy,
    });
    const { logComplianceAlerts } = installMocks({ adminSb });

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_1",
        assigned_truck_id: "truck_1",
        driver_member_id: "member_1",
      }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("truck_cross_contamination_risk");
    expect(logComplianceAlerts).toHaveBeenCalledWith(
      adminSb,
      "tenant_1",
      expect.arrayContaining([expect.objectContaining({ code: "truck_cross_contamination_risk" })]),
      expect.objectContaining({ referenceId: "job_1" })
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("blocks dispatch when a live carryover load is missing BOL documentation", async () => {
    const updateSpy = vi.fn();
    const adminSb = createAdminSb({
      job: baseJob,
      truck: baseTruck,
      member: baseMember,
      locateTickets: [{ id: "ticket_1" }],
      qualifications: baseQualifications,
      truckLoads: [{
        id: "manifest_2",
        manifest_number: "MAN-2",
        job_id: "job_other",
        customer_id: "cust_1",
        metadata: {
          load_state: "live_in_truck",
          live_load_hold_reason: "Waiting for a full load",
        },
      }],
      updateSpy,
    });
    const { logComplianceAlerts } = installMocks({ adminSb });

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_1",
        assigned_truck_id: "truck_1",
        driver_member_id: "member_1",
      }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("manifest_bol_missing");
    expect(logComplianceAlerts).toHaveBeenCalledWith(
      adminSb,
      "tenant_1",
      expect.arrayContaining([expect.objectContaining({ code: "manifest_bol_missing" })]),
      expect.objectContaining({ referenceId: "job_1" })
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("allows same-customer live loads but returns disposal warnings", async () => {
    const updateSpy = vi.fn();
    const adminSb = createAdminSb({
      job: baseJob,
      truck: baseTruck,
      member: baseMember,
      locateTickets: [{ id: "ticket_1" }],
      qualifications: baseQualifications,
      truckLoads: [{
        id: "manifest_3",
        manifest_number: "MAN-3",
        job_id: "job_prior",
        customer_id: "cust_1",
        metadata: {
          load_state: "live_in_truck",
          bol_number: "BOL-3",
          live_load_hold_reason: "Same account continuation",
          disposal_ready_by: "2026-03-26",
        },
      }],
      updatedJob: { ...baseJob, status: "dispatched", assigned_truck_id: "truck_1" },
      updateSpy,
    });
    installMocks({ adminSb });

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_1",
        assigned_truck_id: "truck_1",
        driver_member_id: "member_1",
      }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "truck_live_load_open" }),
        expect.objectContaining({ type: "truck_disposal_due_today" }),
      ])
    );
    expect(updateSpy).toHaveBeenCalled();
  });

  test("allows a compound route override when the same crew still fits inside the minimum block", async () => {
    const updateSpy = vi.fn();
    const adminSb = createAdminSb({
      job: { ...baseJob, minimum_hours: 4, billable_hours: 1.5, travel_hours: 0.25 },
      truck: baseTruck,
      member: baseMember,
      locateTickets: [{ id: "ticket_1" }],
      qualifications: baseQualifications,
      conflictingJobs: [{
        id: "job_prior",
        title: "Vault cleanout",
        scheduled_date: "2026-03-26",
        status: "dispatched",
        assigned_member_id: "member_1",
        assigned_operator_id: "operator_1",
        minimum_hours: 4,
        billable_hours: 1.25,
        travel_hours: 0.25,
      }],
      updatedJob: { ...baseJob, status: "dispatched", assigned_truck_id: "truck_1" },
      updateSpy,
    });
    installMocks({ adminSb });

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_1",
        assigned_truck_id: "truck_1",
        driver_member_id: "member_1",
        compound_route_override: true,
      }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "compound_route_override" }),
      ])
    );
    expect(updateSpy).toHaveBeenCalled();
  });

  test("blocks a compound route override when the total estimated work runs past the minimum block", async () => {
    const updateSpy = vi.fn();
    const adminSb = createAdminSb({
      job: { ...baseJob, minimum_hours: 4, billable_hours: 2.5, travel_hours: 0.5 },
      truck: baseTruck,
      member: baseMember,
      locateTickets: [{ id: "ticket_1" }],
      qualifications: baseQualifications,
      conflictingJobs: [{
        id: "job_prior",
        title: "Line expose",
        scheduled_date: "2026-03-26",
        status: "dispatched",
        assigned_member_id: "member_1",
        assigned_operator_id: "operator_1",
        minimum_hours: 4,
        billable_hours: 2.5,
        travel_hours: 0.5,
      }],
      updateSpy,
    });
    installMocks({ adminSb });

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        job_id: "job_1",
        assigned_truck_id: "truck_1",
        driver_member_id: "member_1",
        compound_route_override: true,
      }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("compound_route_exceeds_minimum");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
