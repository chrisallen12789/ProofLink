"use strict";

const path = require("path");

describe("netlify/functions/order", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/order.js");
  const rateLimitModulePath = require.resolve(
    path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js")
  );
  const checkRateLimitMock = vi.fn(() => ({ allowed: true }));
  const rateLimitResponseMock = vi.fn((retryAfterMs) => ({
    statusCode: 429,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: "Too many requests", retryAfterMs }),
  }));
  const getClientIPMock = vi.fn(() => "127.0.0.1");

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    process.env.MAIL_FROM = "hello@example.com";
    process.env.MAIL_TO = "ops@example.com";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:8888";
    process.env.SITE_URL = "http://127.0.0.1:8888";
    process.env.URL = "http://127.0.0.1:8888";
    process.env.DEPLOY_PRIME_URL = "";
    process.env.TURNSTILE_SECRET_KEY = "";
    process.env.ALLOW_LOCAL_TURNSTILE_BYPASS = "";
    process.env.ALLOW_LOCAL_EMAIL_SKIP = "";
    process.env.RESEND_API_KEY = "resend_pltest";
    checkRateLimitMock.mockClear();
    rateLimitResponseMock.mockClear();
    getClientIPMock.mockClear();
    delete require.cache[rateLimitModulePath];
    const rateLimitModule = require(rateLimitModulePath);
    rateLimitModule.checkRateLimit = checkRateLimitMock;
    rateLimitModule.rateLimitResponse = rateLimitResponseMock;
    rateLimitModule.getClientIP = getClientIPMock;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadHandler() {
    delete require.cache[handlerPath];
    delete require.cache[rateLimitModulePath];
    const rateLimitModule = require(rateLimitModulePath);
    rateLimitModule.checkRateLimit = checkRateLimitMock;
    rateLimitModule.rateLimitResponse = rateLimitResponseMock;
    rateLimitModule.getClientIP = getClientIPMock;
    return require(handlerPath).handler;
  }

  test("returns 405 for unsupported methods", async () => {
    const handler = await loadHandler();
    const res = await handler({ httpMethod: "GET", headers: {} });
    expect(res.statusCode).toBe(405);
  });

  test("rejects honeypot submissions", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        fax: "filled",
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Submission rejected.");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects submissions that are too fast", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        startedAt: Date.now(),
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Submission rejected.");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects empty carts", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [],
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Your cart is empty.");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects invalid delivery ZIP codes before downstream side effects", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "delivery",
        deliveryZip: "ABCDE",
        items: [{ name: "Item" }],
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Delivery ZIP code must be 5 digits.");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects missing required fields before downstream side effects", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantSlug: "tenant-1",
        items: [{ name: "Item" }],
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("tenantId is required");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("fails closed when TURNSTILE_SECRET_KEY is missing outside explicit local mode", async () => {
    process.env.PUBLIC_SITE_URL = "https://prooflink.co";
    process.env.SITE_URL = "https://prooflink.co";
    process.env.URL = "https://prooflink.co";
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe("configuration_error");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("valid Turnstile verification still works", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, orderId: "ord_pltest" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "mail_admin" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "mail_customer" }),
        text: async () => "",
      });

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantBusinessName: "ProofLink Test Tenant",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        turnstileToken: "token_pltest",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(4);
    const turnstileRequest = global.fetch.mock.calls[0];
    const proxyRequest = global.fetch.mock.calls[1];
    expect(turnstileRequest[1].body).toContain("remoteip=127.0.0.1");
    expect(proxyRequest[1].signal).toBeDefined();
  });

  test("returns success when the order saves but confirmation email delivery fails", async () => {
    process.env.ALLOW_LOCAL_TURNSTILE_BYPASS = "true";
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, orderId: "ord_pltest" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        text: async () => "Email service unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "mail_customer" }),
        text: async () => "",
      });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = await loadHandler();

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "tenant-1",
          tenantSlug: "tenant-1",
          tenantBusinessName: "ProofLink Test Tenant",
          customer_name: "Test",
          email: "test@example.com",
          phone: "555-111-2222",
          fulfillment: "pickup",
          items: [{ name: "Item" }],
          startedAt: Date.now() - 5000,
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
        ok: true,
        orderId: "ord_pltest",
        email_warning: true,
        email_failures: ["admin"],
      }));
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("explicit local bypass remains controlled", async () => {
    process.env.ALLOW_LOCAL_TURNSTILE_BYPASS = "true";
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, orderId: "ord_pltest" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "mail_admin" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "mail_customer" }),
        text: async () => "",
      });

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantBusinessName: "ProofLink Test Tenant",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("missing site URL fails closed before proxy/email work", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.PUBLIC_SITE_URL = "";
    process.env.SITE_URL = "";
    process.env.URL = "";
    process.env.DEPLOY_PRIME_URL = "";
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantBusinessName: "ProofLink Test Tenant",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        turnstileToken: "token_pltest",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe("configuration_error");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("missing RESEND_API_KEY returns success with an email warning after saving the order", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.RESEND_API_KEY = "";
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    process.env.SITE_URL = "https://app.prooflink.test";
    process.env.URL = "https://app.prooflink.test";
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, orderId: "ord_pltest" }),
      });

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantBusinessName: "ProofLink Test Tenant",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        turnstileToken: "token_pltest",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
      ok: true,
      email_warning: true,
      email_failures: ["admin", "customer"],
    }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("explicit local email skip remains controlled", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.RESEND_API_KEY = "";
    process.env.ALLOW_LOCAL_EMAIL_SKIP = "true";
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, orderId: "ord_pltest" }),
      });

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant-1",
        tenantSlug: "tenant-1",
        tenantBusinessName: "ProofLink Test Tenant",
        customer_name: "Test",
        email: "test@example.com",
        phone: "555-111-2222",
        fulfillment: "pickup",
        items: [{ name: "Item" }],
        turnstileToken: "token_pltest",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
