"use strict";

const path = require("path");

describe("netlify/functions/platform-abuse-monitor", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/platform-abuse-monitor.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const supabasePkgPath = require.resolve("@supabase/supabase-js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[supabasePkgPath];
    delete process.env.INTERNAL_SECRET;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  function createSupabaseMock() {
    const tenantsQuery = {
      select: vi.fn(() => tenantsQuery),
      in: vi.fn(async () => ({ data: [], error: null })),
    };

    return {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user_1" } }, error: null })),
      },
      from: vi.fn((table) => {
        if (table === "tenants") return tenantsQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };
  }

  function loadHandler({ requireAdminContextImpl, createClientImpl } = {}) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireAdminContext: requireAdminContextImpl || vi.fn(async () => ({ operatorId: "admin_1" })),
      },
    };

    require.cache[supabasePkgPath] = {
      id: supabasePkgPath,
      filename: supabasePkgPath,
      loaded: true,
      exports: {
        createClient: createClientImpl || vi.fn(() => createSupabaseMock()),
      },
    };

    return require(handlerPath).handler;
  }

  test("rejects unscheduled public GET requests", async () => {
    const createClient = vi.fn(() => createSupabaseMock());
    const handler = loadHandler({ createClientImpl: createClient });

    const response = await handler({
      httpMethod: "GET",
      headers: {},
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: "Forbidden" });
    expect(createClient).not.toHaveBeenCalled();
  });

  test("requires platform-admin auth for manual POST runs", async () => {
    const createClient = vi.fn(() => createSupabaseMock());
    const requireAdminContext = vi.fn(async () => {
      const error = new Error("Forbidden: admin role required");
      error.statusCode = 403;
      throw error;
    });
    const handler = loadHandler({
      createClientImpl: createClient,
      requireAdminContextImpl: requireAdminContext,
    });

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: "Bearer token_123" },
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: "Forbidden: admin role required" });
    expect(requireAdminContext).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  test("allows scheduled GET runs to complete without admin auth", async () => {
    const createClient = vi.fn(() => createSupabaseMock());
    const requireAdminContext = vi.fn(async () => {
      throw new Error("should not be called for scheduled GET");
    });
    const handler = loadHandler({
      createClientImpl: createClient,
      requireAdminContextImpl: requireAdminContext,
    });

    const response = await handler({
      httpMethod: "GET",
      headers: { "x-nf-event": "schedule" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({ ok: true, scanned: 0, flagged: 0 })
    );
    expect(requireAdminContext).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  test("normalizes flagged tenant names from business_name when legacy name is empty", async () => {
    const updateEq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const conductInsert = vi.fn(async () => ({ error: null }));
    const productsEq = vi.fn(async () => ({
      data: [{ name: "Counterfeit vacuum kits", description: "" }],
      error: null,
    }));
    const bannedKeywordsEq = vi.fn(async () => ({ data: [], error: null }));

    const tenantsQuery = {
      select: vi.fn(() => tenantsQuery),
      in: vi.fn(async () => ({
        data: [{
          id: "tenant_1",
          slug: "riverfront",
          business_name: "Riverfront Milling",
          name: "",
          owner_email: "owner@example.com",
          onboarding_request_id: null,
          status: "active",
        }],
        error: null,
      })),
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") {
          return {
            select: tenantsQuery.select,
            in: tenantsQuery.in,
            update,
          };
        }
        if (table === "products") {
          return {
            select: vi.fn(() => ({ eq: productsEq })),
          };
        }
        if (table === "pl_banned_keywords") {
          return {
            select: vi.fn(() => ({ eq: bannedKeywordsEq })),
          };
        }
        if (table === "tenant_conduct_log") {
          return { insert: conductInsert };
        }
        if (table === "orders") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                gte: vi.fn(async () => ({ count: 0 })),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const createClient = vi.fn(() => supabase);
    const handler = loadHandler({ createClientImpl: createClient });

    const response = await handler({
      httpMethod: "GET",
      headers: { "x-nf-event": "schedule" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(
      expect.objectContaining({
        ok: true,
        flagged: 1,
        details: [
          expect.objectContaining({
            tenant_id: "tenant_1",
            slug: "riverfront",
            name: "Riverfront Milling",
          }),
        ],
      })
    );
    expect(update).toHaveBeenCalled();
    expect(updateEq).toHaveBeenCalledWith("id", "tenant_1");
    expect(conductInsert).toHaveBeenCalledTimes(1);
  });
});
