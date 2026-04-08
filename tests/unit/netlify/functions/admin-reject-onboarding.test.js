"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-reject-onboarding.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");

function loadHandlerWithMocks({ authExports, emailExports }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
    [emailPath, require.cache[emailPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: authExports,
  };
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: emailExports,
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

describe("netlify/functions/admin-reject-onboarding", () => {
  test("returns 400 when rejection_reason is too long", async () => {
    const supabase = { from: vi.fn() };
    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: {
        sendEmail: vi.fn(() => Promise.resolve()),
        templates: { rejected: vi.fn(() => ({})) },
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ id: "req_1", rejection_reason: "x".repeat(2001) }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("rejection_reason must be 2000 characters or fewer");
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("returns 500 when onboarding request lookup fails", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: { message: "lookup failed" } })),
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_onboarding_requests") throw new Error(`Unexpected table ${table}`);
        return query;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: {
        sendEmail: vi.fn(() => Promise.resolve()),
        templates: { rejected: vi.fn(() => ({})) },
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ id: "req_1", rejection_reason: "Not a fit" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(500);
      expect(body.error).toBe("Failed to load onboarding request: lookup failed");
    } finally {
      restore();
    }
  });

  test("rejects a valid onboarding request and returns the trimmed reason", async () => {
    const lookupQuery = {
      select: vi.fn(() => lookupQuery),
      eq: vi.fn(() => lookupQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "req_1",
          status: "submitted",
          owner_name: "Taylor",
          business_name: "North College",
          owner_email: "owner@example.com",
        },
        error: null,
      })),
    };
    const updateEq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_onboarding_requests") throw new Error(`Unexpected table ${table}`);
        if (lookupQuery.select.mock.calls.length === 0) return lookupQuery;
        return { update };
      }),
    };
    const sendEmail = vi.fn(() => Promise.resolve());
    const rejectedTemplate = vi.fn((payload) => payload);

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: {
        sendEmail,
        templates: { rejected: rejectedTemplate },
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ id: "req_1", rejection_reason: "  Not a fit for the platform  " }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.rejection_reason).toBe("Not a fit for the platform");
      expect(updateEq).toHaveBeenCalledWith("id", "req_1");
      expect(rejectedTemplate).toHaveBeenCalledWith(expect.objectContaining({
        rejection_reason: "Not a fit for the platform",
      }));
      expect(sendEmail).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
