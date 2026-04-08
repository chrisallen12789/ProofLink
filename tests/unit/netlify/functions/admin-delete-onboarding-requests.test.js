"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-delete-onboarding-requests.js");
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

describe("netlify/functions/admin-delete-onboarding-requests", () => {
  test("returns 404 when no onboarding requests match the provided ids", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_onboarding_requests") throw new Error(`Unexpected table ${table}`);
        return {
          delete: vi.fn(() => ({
            in: vi.fn(async () => ({ error: null, count: 0 })),
          })),
        };
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ ids: ["req_missing"] }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(404);
      expect(body.error).toBe("No onboarding requests matched the provided ids");
    } finally {
      restore();
    }
  });

  test("returns deleted count when the matching requests are removed", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_onboarding_requests") throw new Error(`Unexpected table ${table}`);
        return {
          delete: vi.fn(() => ({
            in: vi.fn(async () => ({ error: null, count: 2 })),
          })),
        };
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ ids: ["req_1", "req_2"] }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.deleted).toBe(2);
    } finally {
      restore();
    }
  });
});
