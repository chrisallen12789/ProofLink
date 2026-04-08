"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-get-conduct-log.js");
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

describe("netlify/functions/admin-get-conduct-log", () => {
  test("returns 400 when tenant_id is missing", async () => {
    const supabase = { from: vi.fn() };
    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {},
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("tenant_id is required");
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("returns 400 for a non-positive limit", async () => {
    const supabase = { from: vi.fn() };
    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: { tenant_id: "tenant_1", limit: "0" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("limit must be a positive integer");
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("lists conduct log entries for a tenant", async () => {
    const limit = vi.fn(async () => ({
      data: [{ id: "log_1", action: "flag" }],
      error: null,
    }));
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit,
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_conduct_log") throw new Error(`Unexpected table ${table}`);
        return query;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: { tenant_id: "tenant_1", limit: "25" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant_1");
      expect(limit).toHaveBeenCalledWith(25);
      expect(body.log).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
