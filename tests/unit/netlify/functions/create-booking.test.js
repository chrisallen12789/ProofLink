"use strict";

const path = require("path");

describe("netlify/functions/create-booking", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/create-booking.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");
  const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[emailPath];
    delete require.cache[rateLimitPath];
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
  });

  function installMocks({ supabase }) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        getAdminClient: () => supabase,
        requireOperatorContext: vi.fn(async () => ({ supabase, tenantId: "tenant_1", operatorId: "operator_1" })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[emailPath] = {
      id: emailPath,
      filename: emailPath,
      loaded: true,
      exports: {
        sendEmail: vi.fn(async () => ({ id: "email_1" })),
        templates: {
          bookingConfirmation: vi.fn((payload) => payload),
          newBookingOperator: vi.fn((payload) => payload),
        },
      },
    };
    require.cache[rateLimitPath] = {
      id: rateLimitPath,
      filename: rateLimitPath,
      loaded: true,
      exports: {
        checkRateLimit: vi.fn(() => ({ allowed: true })),
        rateLimitResponse: vi.fn((retryAfterMs) => ({ statusCode: 429, body: JSON.stringify({ retryAfterMs }) })),
        getClientIP: vi.fn(() => "127.0.0.1"),
      },
    };
  }

  test("rejects booking requests for past times", async () => {
    const supabase = { from: vi.fn() };
    installMocks({ supabase });
    const handler = require(handlerPath).handler;

    const start = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
    const end = new Date(Date.now() - (60 * 60 * 1000)).toISOString();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: "tenant_1",
        customer_name: "Chris",
        customer_email: "chris@example.com",
        title: "Visit",
        starts_at: start,
        ends_at: end,
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Bookings must be requested for a future time.");
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
