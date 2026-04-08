"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-get-onboarding-requests.js");
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

describe("netlify/functions/admin-get-onboarding-requests", () => {
  test("returns 400 for an invalid status filter", async () => {
    const supabase = { from: vi.fn() };
    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: { status: "unknown_status" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("Invalid status filter");
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

  test("lists onboarding requests with a valid status filter", async () => {
    const resultPromise = Promise.resolve({
      data: [{ id: "req_1", status: "submitted" }],
      error: null,
      count: 1,
    });
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(() => query),
      eq: vi.fn(() => query),
      or: vi.fn(() => query),
      then: resultPromise.then.bind(resultPromise),
      catch: resultPromise.catch.bind(resultPromise),
      finally: resultPromise.finally.bind(resultPromise),
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_onboarding_requests") throw new Error(`Unexpected table ${table}`);
        return query;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: { status: "submitted", limit: "25", offset: "0" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(query.eq).toHaveBeenCalledWith("status", "submitted");
      expect(body.requests).toHaveLength(1);
      expect(body.count).toBe(1);
      expect(body.limit).toBe(25);
      expect(body.offset).toBe(0);
    } finally {
      restore();
    }
  });
});
