"use strict";

const path = require("path");

describe("netlify/functions/stripe-webhook", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/stripe-webhook.js");
  const helperPath = path.resolve(process.cwd(), "netlify/functions/_prooflink_payments.js");
  const supabasePkgPath = require.resolve("@supabase/supabase-js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[helperPath];
    delete require.cache[supabasePkgPath];
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  function loadHandler({ createClient = vi.fn() } = {}) {
    require.cache[helperPath] = {
      id: helperPath,
      filename: helperPath,
      loaded: true,
      exports: {
        buildTenantPaymentState: vi.fn(),
        clean: (value) => String(value || "").trim(),
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        normalizeBillingStatus: vi.fn(() => "active"),
        normalizeConnectStatus: vi.fn(() => "active"),
        patchTenant: vi.fn(async () => null),
        supabaseAdmin: vi.fn(async () => null),
        verifyStripeSignature: vi.fn(() => true),
        findTenantByStripeAccount: vi.fn(async () => null),
        findTenantByStripeCustomer: vi.fn(async () => null),
        findTenantByStripeSubscription: vi.fn(async () => null),
      },
    };
    require.cache[supabasePkgPath] = {
      id: supabasePkgPath,
      filename: supabasePkgPath,
      loaded: true,
      exports: { createClient },
    };

    return require(handlerPath).handler;
  }

  test("continues processing when Supabase idempotency env is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = loadHandler({ createClient: vi.fn(() => { throw new Error("should not be called"); }) });

    try {
      const response = await handler({
        httpMethod: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: JSON.stringify({
          id: "evt_123",
          type: "ping.event",
          data: { object: {} },
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledWith(
        "[stripe-webhook] skipping idempotency check because Supabase admin env is missing"
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
