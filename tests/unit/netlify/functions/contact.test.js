"use strict";

const path = require("path");

describe("netlify/functions/contact", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/contact.js");

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadHandler() {
    delete require.cache[handlerPath];
    return require(handlerPath).handler;
  }

  test("fails closed when TURNSTILE_SECRET_KEY is missing outside explicit local mode", async () => {
    process.env.PUBLIC_SITE_URL = "https://prooflink.co";
    process.env.SITE_URL = "https://prooflink.co";
    process.env.URL = "https://prooflink.co";

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        email: "test@example.com",
        subject: "Hello",
        message: "This is a valid contact message.",
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
        name: "Test",
        email: "test@example.com",
        subject: "Hello",
        message: "This is a valid contact message.",
        turnstileToken: "token_pltest",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("explicit local bypass remains controlled", async () => {
    process.env.ALLOW_LOCAL_TURNSTILE_BYPASS = "true";
    global.fetch
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
        name: "Test",
        email: "test@example.com",
        subject: "Hello",
        message: "This is a valid contact message.",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("missing RESEND_API_KEY fails closed outside explicit local email mode", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.RESEND_API_KEY = "";
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    process.env.SITE_URL = "https://app.prooflink.test";
    process.env.URL = "https://app.prooflink.test";
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        email: "test@example.com",
        subject: "Hello",
        message: "This is a valid contact message.",
        turnstileToken: "token_pltest",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe("configuration_error");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("explicit local email skip remains controlled", async () => {
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.RESEND_API_KEY = "";
    process.env.ALLOW_LOCAL_EMAIL_SKIP = "true";
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        email: "test@example.com",
        subject: "Hello",
        message: "This is a valid contact message.",
        turnstileToken: "token_pltest",
        startedAt: Date.now() - 5000,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
