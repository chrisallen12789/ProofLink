"use strict";

const path = require("path");

describe("netlify/functions/get-platform-stats", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/get-platform-stats.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  test("normalizes recent tenant names from business_name when name is empty", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") {
          return {
            select: vi.fn((_cols, options) => {
              if (options && options.head) {
                return {
                  eq: vi.fn(async () => ({ count: 1, data: null, error: null })),
                  gte: vi.fn(async () => ({ count: 1, data: null, error: null })),
                  not: vi.fn(async () => ({ count: 1, data: null, error: null })),
                };
              }
              return {
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({
                    data: [{
                      id: "tenant_1",
                      name: "",
                      business_name: "Riverfront Milling",
                      slug: "riverfront-milling",
                      owner_email: "ops@riverfront.test",
                      status: "active",
                    }],
                    error: null,
                  })),
                })),
              };
            }),
          };
        }
        if (table === "tenant_onboarding_requests") {
          return {
            select: vi.fn((_cols, options) => {
              if (options && options.head) {
                return {
                  gte: vi.fn(async () => ({ count: 0, data: null, error: null })),
                };
              }
              return {
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: [], error: null })),
                })),
                then: undefined,
              };
            }),
          };
        }
        if (table === "orders") {
          return {
            select: vi.fn((_cols, options) => {
              if (options && options.count === "exact") {
                return Promise.resolve({ data: [], count: 0, error: null });
              }
              return {
                gte: vi.fn(async () => ({ data: [], error: null })),
              };
            }),
          };
        }
        if (table === "v_tenant_limit_health") {
          return {
            select: vi.fn(async () => ({ data: [], error: null })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireAdminContext: vi.fn(async () => ({ supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };

    const handler = require(handlerPath).handler;
    const response = await handler({ httpMethod: "GET" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.recent_tenants[0]).toEqual(expect.objectContaining({
      name: "Riverfront Milling",
      business_name: "Riverfront Milling",
      slug: "riverfront-milling",
    }));
  });
});
