"use strict";

const path = require("path");

describe("netlify/functions/order", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/order.js");

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    process.env.MAIL_FROM = "hello@example.com";
    process.env.MAIL_TO = "ops@example.com";
    process.env.PUBLIC_SITE_URL = "http://127.0.0.1:8888";
    process.env.URL = "http://127.0.0.1:8888";
    process.env.TURNSTILE_SECRET_KEY = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadHandler() {
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
});
