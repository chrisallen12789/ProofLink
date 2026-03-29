"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/stripe-order-checkout.js");
const paymentsPath = path.resolve(process.cwd(), "netlify/functions/_prooflink_payments.js");
const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");

function loadHandlerWithMocks({ paymentsExports, rateLimitExports }) {
  const originals = new Map([
    [paymentsPath, require.cache[paymentsPath]],
    [rateLimitPath, require.cache[rateLimitPath]],
    [handlerPath, require.cache[handlerPath]],
  ]);

  require.cache[paymentsPath] = {
    id: paymentsPath,
    filename: paymentsPath,
    loaded: true,
    exports: paymentsExports,
  };
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: rateLimitExports,
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

describe("netlify/functions/stripe-order-checkout", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("applies the enforced tenant application fee when checkout is created", async () => {
    const stripeRequest = vi.fn(async (_path, _method, payload) => ({
      id: "cs_test_123",
      url: "https://checkout.stripe.test/session_123",
      customer: "cus_test_123",
      livemode: false,
      payload,
    }));

    const upsertPaymentRecord = vi.fn(async () => ({}));

    const { handler, restore } = loadHandlerWithMocks({
      paymentsExports: {
        buildTenantPaymentState: vi.fn(() => ({ onlinePaymentsEligible: true })),
        clean: (value) => String(value || "").trim(),
        ensureTenantApplicationFeeBps: vi.fn(async (tenant) => ({
          ...tenant,
          application_fee_bps: 750,
          stripe_connect_account_id: tenant.stripe_connect_account_id || "acct_test_123",
        })),
        findTenantById: vi.fn(async () => ({
          id: "tenant_123",
          stripe_connect_account_id: "acct_test_123",
          application_fee_bps: 0,
          currency: "usd",
        })),
        getBaseUrl: vi.fn(() => "https://prooflink.co"),
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        readJson: vi.fn(() => ({
          tenantId: "tenant_123",
          orderId: "order_123",
        })),
        requireOperatorContext: vi.fn(async () => ({
          operatorId: "operator_123",
        })),
        stripeRequest,
        supabaseAdmin: vi.fn(async () => ([{
          id: "order_123",
          total_cents: 20000,
          customer_id: "customer_123",
          customer_name: "Chris Proof",
          email: "owner@example.com",
        }])),
        upsertPaymentRecord,
      },
      rateLimitExports: {
        checkRateLimit: vi.fn(() => ({ allowed: true })),
        rateLimitResponse: vi.fn(() => ({ statusCode: 429, body: JSON.stringify({ error: "rate limited" }) })),
        getClientIP: vi.fn(() => "127.0.0.1"),
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        headers: {
          authorization: "Bearer token",
        },
        body: JSON.stringify({
          tenantId: "tenant_123",
          orderId: "order_123",
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(stripeRequest).toHaveBeenCalledWith(
        "/checkout/sessions",
        "POST",
        expect.objectContaining({
          "payment_intent_data[application_fee_amount]": 1500,
          "payment_intent_data[transfer_data][destination]": "acct_test_123",
        })
      );
      expect(upsertPaymentRecord).toHaveBeenCalledWith(expect.objectContaining({
        amount_platform_fee: 1500,
      }));
    } finally {
      restore();
    }
  });
});
