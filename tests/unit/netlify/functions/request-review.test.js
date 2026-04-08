"use strict";

const path = require("path");

describe("netlify/functions/request-review", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/request-review.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");

  function loadHandler(overrides = {}) {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[emailPath];

    const auth = require(authPath);
    auth.respond = (statusCode, body) => ({
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const orderResult = overrides.orderResult || {
      data: {
        id: "order_1",
        customer_name: "Harbor Suites",
        email: "owner@example.com",
        review_requested_at: null,
        tenant_id: "tenant_1",
      },
      error: null,
    };
    const tenantResult = overrides.tenantResult || {
      data: { name: "ProofLink Test Tenant" },
      error: null,
    };
    const updateResult = overrides.updateResult || { error: null };
    const supabase = {
      from: vi.fn((table) => {
        if (table === "orders") {
          const maybeSingle = vi.fn(async () => orderResult);
          const thirdEq = { maybeSingle };
          const secondEq = {
            eq: vi.fn(() => thirdEq),
            maybeSingle,
          };
          const firstEq = {
            eq: vi.fn(() => secondEq),
          };
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => firstEq),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => updateResult),
              })),
            })),
          };
        }
        if (table === "tenants") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => tenantResult),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    auth.requireOperatorContext = vi.fn(async () => ({
      supabase,
      tenantId: "tenant_1",
      operatorId: "operator_1",
    }));

    const email = require(emailPath);
    email.sendEmail = vi.fn(() => Promise.resolve());

    return {
      handler: require(handlerPath).handler,
      auth,
      email,
    };
  }
  beforeEach(() => {
    process.env.SITE_URL = "https://example.test";
    process.env.PUBLIC_SITE_URL = "https://example.test";
    process.env.URL = "https://example.test";
  });

  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.URL;
  });


  beforeEach(() => {
    process.env.SITE_URL = "https://example.test";
    process.env.PUBLIC_SITE_URL = "https://example.test";
    process.env.URL = "https://example.test";
  });

  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.URL;
  });

  test("uses the normalized order email column", async () => {
    const { handler, email } = loadHandler();

    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ order_id: "order_1" }),
      headers: {},
    });

    expect(response.statusCode).toBe(200);
    expect(email.sendEmail).toHaveBeenCalled();
    expect(email.sendEmail.mock.calls[0][0].to).toBe("owner@example.com");
  });

  test("passes manual subject and message overrides through to the email template", async () => {
    const { handler, email } = loadHandler();

    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        order_id: "order_1",
        manual_subject: "Please review your hydrovac visit",
        manual_message: "Hi Harbor Suites,\n\nThanks again for the work today.",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(200);
    expect(email.sendEmail).toHaveBeenCalled();
    expect(email.sendEmail.mock.calls[0][0].subject).toBe("Please review your hydrovac visit");
    expect(email.sendEmail.mock.calls[0][0].html).toContain("Thanks again for the work today.");
  });

  test("does not fall back to an unscoped order lookup outside the caller tenant", async () => {
    const { handler, email } = loadHandler({
      orderResult: { data: null, error: null },
    });

    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ order_id: "foreign_order" }),
      headers: {},
    });

    expect(response.statusCode).toBe(404);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});
