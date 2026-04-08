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
    const patchTenant = vi.fn(async () => null);
    const supabaseAdmin = vi.fn(async () => null);

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
        patchTenant,
        supabaseAdmin,
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

    return {
      handler: require(handlerPath).handler,
      helpers: require.cache[helperPath].exports,
    };
  }

  test("continues processing when Supabase idempotency env is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handler } = loadHandler({ createClient: vi.fn(() => { throw new Error("should not be called"); }) });

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

  test("returns 400 when a verified payload is not valid JSON", async () => {
    const { handler } = loadHandler();

    const response = await handler({
      httpMethod: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{not-json",
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ ok: false });
  });

  test("returns 500 and releases idempotency claim when processing fails after verification", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const insert = vi.fn(async () => ({ error: null }));
    const deleteEq = vi.fn(async () => ({ error: null }));
    const deleteMock = vi.fn(() => ({ eq: deleteEq }));
    const from = vi.fn((table) => {
      if (table !== "processed_webhook_events") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert,
        delete: deleteMock,
      };
    });

    const { handler, helpers } = loadHandler({
      createClient: vi.fn(() => ({ from })),
    });
    helpers.supabaseAdmin.mockRejectedValueOnce(new Error("payment patch failed"));

    const response = await handler({
      httpMethod: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: JSON.stringify({
        id: "evt_fail",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            metadata: {
              purpose: "tenant_order_checkout",
              order_id: "order-123",
              tenant_id: "tenant-123",
            },
          },
        },
      }),
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: "payment patch failed",
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteEq).toHaveBeenCalledWith("event_id", "evt_fail");
  });
});
