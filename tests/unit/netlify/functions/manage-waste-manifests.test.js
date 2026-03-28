"use strict";

const path = require("path");

function makeResult(data, error = null) {
  return { data, error };
}

describe("netlify/functions/manage-waste-manifests", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/manage-waste-manifests.js");
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

  function installMocks({ adminSb }) {
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
        asMoneyCents: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
        asNumber: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
        clean: (value) => String(value || "").trim(),
        parseJsonBody: (event) => JSON.parse(event.body || "{}"),
        requireHydrovacOperatorContext: vi.fn(async () => ({
          tenantId: "tenant_1",
          adminSb,
          hydrovacSettings: {},
          email: "owner@example.com",
        })),
        startOfUtcDay: (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
        endOfUtcDay: (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)),
        toIsoOrNull: (value) => value || null,
      },
    };
    require.cache[compliancePath] = {
      id: compliancePath,
      filename: compliancePath,
      loaded: true,
      exports: {
        manifestConfirmationIssues: vi.fn(() => []),
        logComplianceAlerts: vi.fn(async () => []),
        resolveComplianceAlerts: vi.fn(async () => []),
        manifestMarkedLive: (manifest) => String(manifest?.metadata?.load_state || "").trim().toLowerCase() === "live_in_truck",
        truckLoadIssuesForRows: vi.fn(() => []),
      },
    };
  }

  test("patch merges manual packet-prep metadata onto the manifest", async () => {
    const existingManifest = {
      id: "manifest_1",
      tenant_id: "tenant_1",
      job_id: "job_1",
      status: "in_transit",
      metadata: {
        bol_number: "BOL-7",
      },
    };
    let wasteManifestSelectCalls = 0;
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "waste_manifests") {
          return {
            select: vi.fn(() => {
              wasteManifestSelectCalls += 1;
              if (wasteManifestSelectCalls === 1) {
                return {
                  eq() { return this; },
                  maybeSingle: vi.fn(async () => makeResult(existingManifest)),
                };
              }
              return {
                eq() { return this; },
                neq() { return this; },
                maybeSingle: vi.fn(async () => makeResult(existingManifest)),
                in: vi.fn(() => this),
                order: vi.fn(() => this),
                then(resolve) { return Promise.resolve(makeResult([{ id: "manifest_1", quantity_estimated: 10, disposal_cost_cents: 0, disposal_charge_cents: 0, status: "in_transit" }])).then(resolve); },
              };
            }),
            update: vi.fn((patch) => ({
              eq() { return this; },
              select() { return this; },
              maybeSingle: vi.fn(async () => makeResult({ ...existingManifest, ...patch })),
            })),
          };
        }
        if (table === "jobs") {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve(makeResult(null))),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    installMocks({ adminSb });
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: "PATCH",
      body: JSON.stringify({
        id: "manifest_1",
        customer_records_prepared_at: "2026-03-28T14:00:00.000Z",
        audit_packet_prepared_at: "2026-03-28T14:05:00.000Z",
        load_isolation_note: "Keep this truck isolated until disposal is complete",
      }),
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.manifest.metadata).toEqual(expect.objectContaining({
      bol_number: "BOL-7",
      customer_records_prepared_at: "2026-03-28T14:00:00.000Z",
      audit_packet_prepared_at: "2026-03-28T14:05:00.000Z",
      load_isolation_note: "Keep this truck isolated until disposal is complete",
    }));
  });

  test("patch preserves arbitrary metadata keys while merging known manifest fields", async () => {
    const existingManifest = {
      id: "manifest_2",
      tenant_id: "tenant_1",
      job_id: "job_2",
      status: "in_transit",
      metadata: {
        bol_number: "BOL-8",
        live_load_hold_reason: "Awaiting disposal",
      },
    };
    let wasteManifestSelectCalls = 0;
    const adminSb = {
      from: vi.fn((table) => {
        if (table === "waste_manifests") {
          return {
            select: vi.fn(() => {
              wasteManifestSelectCalls += 1;
              if (wasteManifestSelectCalls === 1) {
                return {
                  eq() { return this; },
                  maybeSingle: vi.fn(async () => makeResult(existingManifest)),
                };
              }
              return {
                eq() { return this; },
                neq() { return this; },
                maybeSingle: vi.fn(async () => makeResult(existingManifest)),
                in: vi.fn(() => this),
                order: vi.fn(() => this),
                then(resolve) { return Promise.resolve(makeResult([])).then(resolve); },
              };
            }),
            update: vi.fn((patch) => ({
              eq() { return this; },
              select() { return this; },
              maybeSingle: vi.fn(async () => makeResult({ ...existingManifest, ...patch })),
            })),
          };
        }
        if (table === "jobs") {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve(makeResult(null))),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    installMocks({ adminSb });
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: "PATCH",
      body: JSON.stringify({
        id: "manifest_2",
        metadata: {
          disposal_route: "North transfer route",
        },
        audit_archived_at: "2026-03-28T15:00:00.000Z",
      }),
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.manifest.metadata).toEqual(expect.objectContaining({
      bol_number: "BOL-8",
      live_load_hold_reason: "Awaiting disposal",
      disposal_route: "North transfer route",
      audit_archived_at: "2026-03-28T15:00:00.000Z",
    }));
  });
});
