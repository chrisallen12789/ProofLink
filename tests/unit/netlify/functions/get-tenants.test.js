"use strict";

const path = require("path");

describe("netlify/functions/get-tenants", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/get-tenants.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  test("searches business_name and normalizes it back onto the response rows", async () => {
    const tenantChain = {
      select: vi.fn(() => tenantChain),
      order: vi.fn(() => tenantChain),
      range: vi.fn(() => tenantChain),
      or: vi.fn(async () => ({
        data: [{
          id: "tenant_1",
          business_name: "Riverfront Milling",
          name: null,
          slug: "riverfront-milling",
          owner_email: "ops@riverfront.test",
          status: "active",
        }],
        error: null,
        count: 1,
      })),
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") return tenantChain;
        if (table === "orders") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
          };
        }
        if (table === "tenant_config") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          };
        }
        if (table === "products") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
          };
        }
        if (table === "v_tenant_limit_health") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
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
    const response = await handler({
      httpMethod: "GET",
      queryStringParameters: { q: "Riverfront" },
    });

    expect(response.statusCode).toBe(200);
    expect(tenantChain.or).toHaveBeenCalledWith(
      "business_name.ilike.%Riverfront%,name.ilike.%Riverfront%,slug.ilike.%Riverfront%,owner_email.ilike.%Riverfront%"
    );

    const body = JSON.parse(response.body);
    expect(body.tenants[0]).toEqual(expect.objectContaining({
      business_name: "Riverfront Milling",
      slug: "riverfront-milling",
    }));
  });
});
