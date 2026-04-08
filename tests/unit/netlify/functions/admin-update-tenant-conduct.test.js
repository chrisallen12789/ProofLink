"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-update-tenant-conduct.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

function loadHandlerWithMocks({ supabase }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      requireAdminContext: vi.fn(async () => ({
        supabase,
        user: { id: "user_admin_1" },
        operatorId: "op_admin_1",
      })),
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
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

describe("netlify/functions/admin-update-tenant-conduct", () => {
  test("returns 404 when the target tenant does not exist", async () => {
    const lookupChain = {
      select: vi.fn(() => lookupChain),
      eq: vi.fn(() => lookupChain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };

    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    const insert = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") {
          return {
            select: lookupChain.select,
            eq: lookupChain.eq,
            maybeSingle: lookupChain.maybeSingle,
            update,
          };
        }
        if (table === "tenant_conduct_log") {
          return { insert };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenant_id: "tenant_missing", action: "flag" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(404);
      expect(body.error).toBe("Tenant not found");
      expect(update).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("returns 500 when tenant lookup fails before conduct update", async () => {
    const lookupChain = {
      select: vi.fn(() => lookupChain),
      eq: vi.fn(() => lookupChain),
      maybeSingle: vi.fn(async () => ({ data: null, error: { message: "lookup failed" } })),
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") {
          return {
            select: lookupChain.select,
            eq: lookupChain.eq,
            maybeSingle: lookupChain.maybeSingle,
            update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          };
        }
        if (table === "tenant_conduct_log") {
          return { insert: vi.fn(async () => ({ error: null })) };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenant_id: "tenant_1", action: "suspend" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(500);
      expect(body.error).toBe("Failed to load tenant: lookup failed");
    } finally {
      restore();
    }
  });
});
