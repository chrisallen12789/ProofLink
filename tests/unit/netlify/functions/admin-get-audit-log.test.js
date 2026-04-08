"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-get-audit-log.js");
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

describe("netlify/functions/admin-get-audit-log", () => {
  test("returns 400 for a non-positive limit", async () => {
    const supabase = { from: vi.fn() };
    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: { limit: "0" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("limit must be a positive integer");
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("returns 400 for a negative offset", async () => {
    const supabase = { from: vi.fn() };
    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: { offset: "-1" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("offset must be a non-negative integer");
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("lists audit log entries with business_name tenant hydration", async () => {
    const resultPromise = Promise.resolve({
      data: [
        {
          id: "log_1",
          tenant_id: "tenant_1",
          action: "flag",
          tenants: { business_name: "Acme Hydro", slug: "acme-hydro" },
        },
      ],
      error: null,
      count: 1,
    });
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(() => query),
      eq: vi.fn(() => query),
      then: resultPromise.then.bind(resultPromise),
      catch: resultPromise.catch.bind(resultPromise),
      finally: resultPromise.finally.bind(resultPromise),
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
        queryStringParameters: { tenant_id: "tenant_1", limit: "25", offset: "0" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(query.select).toHaveBeenCalledWith(
        "id, tenant_id, action, reason_code, admin_notes, performed_by, performed_at, tenants!tenant_id(business_name, slug)",
        { count: "exact" }
      );
      expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant_1");
      expect(body.log).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(25);
      expect(body.offset).toBe(0);
    } finally {
      restore();
    }
  });
});
