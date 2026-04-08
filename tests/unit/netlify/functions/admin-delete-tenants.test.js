"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-delete-tenants.js");
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
      requireAdminContext: vi.fn(async () => ({ supabase })),
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

function makeDeleteChain(result = { error: null }) {
  return {
    in: vi.fn(async () => result),
  };
}

describe("netlify/functions/admin-delete-tenants", () => {
  test("returns 502 when tenant order-state verification fails", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenants") throw new Error(`Unexpected table ${table}`);
        const chain = {
          select: vi.fn(() => chain),
          in: vi.fn(() => chain),
          gt: vi.fn(async () => ({ data: null, error: { message: "count unavailable" } })),
        };
        return chain;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenant_ids: ["tenant_1"] }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(502);
      expect(body.error).toBe("Failed to verify tenant order state: count unavailable");
    } finally {
      restore();
    }
  });

  test("returns 502 when prerequisite cleanup fails before tenant deletion", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenant_conduct_log") {
          return {
            delete: vi.fn(() => makeDeleteChain({ error: { message: "conduct delete blocked" } })),
          };
        }
        if (table === "operator_members") {
          return {
            delete: vi.fn(() => makeDeleteChain({ error: null })),
          };
        }
        if (table === "tenants") {
          return {
            delete: vi.fn(() => makeDeleteChain({ error: null })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenant_ids: ["tenant_1"], force: true }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(502);
      expect(body.error).toBe("Failed to clean tenant conduct log: conduct delete blocked");
    } finally {
      restore();
    }
  });
});
