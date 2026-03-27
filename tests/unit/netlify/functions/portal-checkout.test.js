"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/portal-checkout.js");
const authUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");
const paymentsPath = path.resolve(process.cwd(), "netlify/functions/_prooflink_payments.js");

function loadHandlerWithMocks({ authMockExports, rateLimitMockExports, paymentsMockExports }) {
  const originalAuthModule = require.cache[authUtilsPath];
  const originalRateLimitModule = require.cache[rateLimitPath];
  const originalPaymentsModule = require.cache[paymentsPath];
  const originalHandlerModule = require.cache[handlerPath];

  require.cache[authUtilsPath] = {
    id: authUtilsPath,
    filename: authUtilsPath,
    loaded: true,
    exports: authMockExports,
  };
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: rateLimitMockExports,
  };
  require.cache[paymentsPath] = {
    id: paymentsPath,
    filename: paymentsPath,
    loaded: true,
    exports: paymentsMockExports,
  };
  delete require.cache[handlerPath];

  const handler = require(handlerPath).handler;

  return {
    handler,
    restore() {
      delete require.cache[handlerPath];
      if (originalHandlerModule) require.cache[handlerPath] = originalHandlerModule;
      if (originalAuthModule) require.cache[authUtilsPath] = originalAuthModule;
      else delete require.cache[authUtilsPath];
      if (originalRateLimitModule) require.cache[rateLimitPath] = originalRateLimitModule;
      else delete require.cache[rateLimitPath];
      if (originalPaymentsModule) require.cache[paymentsPath] = originalPaymentsModule;
      else delete require.cache[paymentsPath];
    },
  };
}

function createQueryChain(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(async () => result),
  };
  return chain;
}

describe("netlify/functions/portal-checkout", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("builds checkout return URLs with tenant and email context intact", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === "orders") {
          return createQueryChain({
            data: [{
              id: "order_123",
              tenant_id: "tenant_123",
              customer_email: "customer@example.com",
              total_cents: 45000,
              amount_paid_cents: 5000,
              status: "confirmed",
              title: "Hydrovac daylighting",
            }],
            error: null,
          });
        }
        if (table === "tenants") {
          return createQueryChain({
            data: [{
              id: "tenant_123",
              stripe_connect_account_id: "acct_123",
              stripe_account_id: null,
            }],
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const stripeRequest = vi.fn(async (_path, _method, payload) => ({
      url: "https://checkout.stripe.test/session_123",
      payload,
    }));

    const { handler, restore } = loadHandlerWithMocks({
      authMockExports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      rateLimitMockExports: {
        checkRateLimit: () => ({ allowed: true }),
        rateLimitResponse: () => ({ statusCode: 429, body: JSON.stringify({ error: "rate limited" }) }),
        getClientIP: () => "127.0.0.1",
      },
      paymentsMockExports: {
        stripeRequest,
        getBaseUrl: () => "https://prooflink.co",
      },
    });

    try {
      const res = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          order_id: "order_123",
          email: "customer@example.com",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        ok: true,
        checkout_url: "https://checkout.stripe.test/session_123",
      });
      expect(stripeRequest).toHaveBeenCalledWith(
        "/checkout/sessions",
        "POST",
        expect.objectContaining({
          success_url: "https://prooflink.co/portal.html?tenant=tenant_123&email=customer%40example.com&order_id=order_123&checkout=success&session_id=%7BCHECKOUT_SESSION_ID%7D",
          cancel_url: "https://prooflink.co/portal.html?tenant=tenant_123&email=customer%40example.com&order_id=order_123&checkout=cancel",
        })
      );
    } finally {
      restore();
    }
  });

  test("returns a contact-needed response when online payments are unavailable", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === "orders") {
          return createQueryChain({
            data: [{
              id: "order_123",
              tenant_id: "tenant_123",
              customer_email: "customer@example.com",
              total_cents: 10000,
              amount_paid_cents: 0,
              status: "confirmed",
              title: "Drain cleaning",
            }],
            error: null,
          });
        }
        if (table === "tenants") {
          return createQueryChain({
            data: [{
              id: "tenant_123",
              stripe_connect_account_id: "",
              stripe_account_id: "",
            }],
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const stripeRequest = vi.fn();

    const { handler, restore } = loadHandlerWithMocks({
      authMockExports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      rateLimitMockExports: {
        checkRateLimit: () => ({ allowed: true }),
        rateLimitResponse: () => ({ statusCode: 429, body: JSON.stringify({ error: "rate limited" }) }),
        getClientIP: () => "127.0.0.1",
      },
      paymentsMockExports: {
        stripeRequest,
        getBaseUrl: () => "https://prooflink.co",
      },
    });

    try {
      const res = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          order_id: "order_123",
          email: "customer@example.com",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual(
        expect.objectContaining({
          ok: false,
          contact_needed: true,
          error: "Provider has not set up online payments",
        })
      );
      expect(stripeRequest).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
