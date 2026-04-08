"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-send-tenant-message.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");

function loadHandlerWithMocks({ supabase, sendEmail = vi.fn(async () => ({ id: "email_1" })) }) {
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
    exports: {
      requireAdminContext: vi.fn(async () => ({ supabase })),
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: { sendEmail },
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
    sendEmail,
  };
}

describe("netlify/functions/admin-send-tenant-message", () => {
  test("returns 500 when tenant lookup fails", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: { message: "lookup failed" } })),
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenants") throw new Error(`Unexpected table ${table}`);
        return query;
      }),
    };

    const { handler, restore, sendEmail } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({
          tenant_id: "tenant_1",
          subject: "Support update",
          message: "We need one more detail.",
        }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(500);
      expect(body.error).toBe("Failed to load tenant: lookup failed");
      expect(sendEmail).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("returns 400 when tenant owner email is missing", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "tenant_1",
          business_name: "Acme Hydro",
          owner_email: "",
          owner_name: "Jamie",
          slug: "acme-hydro",
        },
        error: null,
      })),
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenants") throw new Error(`Unexpected table ${table}`);
        return query;
      }),
    };

    const { handler, restore, sendEmail } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({
          tenant_id: "tenant_1",
          subject: "Support update",
          message: "We need one more detail.",
        }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("Tenant owner email is not configured");
      expect(sendEmail).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("sends a tenant message with current tenant identity fields", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "tenant_1",
          business_name: "Acme Hydro",
          owner_email: "owner@example.com",
          owner_name: " Jamie ",
          slug: "acme-hydro",
        },
        error: null,
      })),
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenants") throw new Error(`Unexpected table ${table}`);
        return query;
      }),
    };

    const { handler, restore, sendEmail } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({
          tenant_id: "tenant_1",
          subject: "Support update",
          message: "Line 1\nLine 2",
        }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "owner@example.com",
          subject: "Support update",
          html: expect.stringContaining("For Acme Hydro via ProofLink"),
        })
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining("Hi Jamie,"),
        })
      );
      expect(body.ok).toBe(true);
      expect(body.to).toBe("owner@example.com");
    } finally {
      restore();
    }
  });
});
