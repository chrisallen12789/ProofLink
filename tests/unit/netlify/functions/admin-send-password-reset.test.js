"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-send-password-reset.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const runtimeConfigPath = path.resolve(process.cwd(), "netlify/functions/utils/runtime-config.js");

function loadHandlerWithMocks({ authExports, runtimeConfigExports }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
    [runtimeConfigPath, require.cache[runtimeConfigPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: authExports,
  };
  require.cache[runtimeConfigPath] = {
    id: runtimeConfigPath,
    filename: runtimeConfigPath,
    loaded: true,
    exports: runtimeConfigExports,
  };
  delete require.cache[handlerPath];

  return {
    handler: require(handlerPath).handler,
    restore() {
      delete require.cache[handlerPath];
      for (const [modulePath, original] of originals.entries()) {
        if (original) require.cache[modulePath] = original;
        else delete require.cache[modulePath];
      }
    },
  };
}

function makeTenantQuery({ result, error }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: result ?? null, error: error ?? null })),
  };
  return chain;
}

function makeOperatorQuery({ result, error }) {
  const chain = {
    select: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: result ?? null, error: error ?? null })),
  };
  return chain;
}

describe("netlify/functions/admin-send-password-reset", () => {
  test("returns 502 when auth users cannot be listed", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") {
          return makeTenantQuery({
            result: {
              id: "tenant_1",
              business_name: "North College",
              owner_email: "owner@example.com",
            },
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({ data: null, error: { message: "auth unavailable" } })),
        },
      },
    };

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ ok: true })),
        getAdminClient: vi.fn(() => supabase),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      runtimeConfigExports: {
        getConfiguredSiteUrl: vi.fn(() => "https://prooflink.co"),
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenant_id: "tenant_1" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(502);
      expect(body.error).toBe("Failed to load auth users: auth unavailable");
    } finally {
      restore();
    }
  });

  test("returns 502 when the tenant operator lookup fails", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") {
          return makeTenantQuery({
            result: {
              id: "tenant_1",
              business_name: "North College",
              owner_email: "owner@example.com",
            },
          });
        }
        if (table === "operators") {
          return makeOperatorQuery({
            error: { message: "operator lookup failed" },
          });
        }
        if (table === "operator_members") {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ error: null })),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: { users: [{ id: "auth_user_1", email: "owner@example.com" }] },
            error: null,
          })),
        },
        resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      },
    };

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ ok: true })),
        getAdminClient: vi.fn(() => supabase),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      runtimeConfigExports: {
        getConfiguredSiteUrl: vi.fn(() => "https://prooflink.co"),
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenant_id: "tenant_1" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(502);
      expect(body.error).toBe("Failed to load tenant operator: operator lookup failed");
      expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
