"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-stripe-health.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

function loadHandlerWithMocks({ supabase }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
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

describe("netlify/functions/admin-stripe-health", () => {
  const originalFetch = global.fetch;
  const envSnapshot = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
  });

  test("returns a healthy Stripe readiness summary", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_platform";
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_billing";
    global.fetch = vi.fn(async () => ({ ok: true }));

    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenants") throw new Error(`Unexpected table ${table}`);

        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn((column, value) => {
            if (column === "connect_status" && value === "connect_connected") {
              return Promise.resolve({ count: 3, error: null });
            }
            if (column === "online_payments_enabled" && value === true) {
              return Promise.resolve({ count: 2, error: null });
            }
            throw new Error(`Unexpected eq(${column}, ${value})`);
          }),
          not: vi.fn(async () => ({ count: 2, error: null })),
        };

        return chain;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({ httpMethod: "GET" });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.summary.ok).toBe(true);
      expect(body.connect.count).toBe(3);
      expect(body.connect.online_payments_enabled_count).toBe(2);
      expect(body.connect.billing_customer_count).toBe(2);
      expect(body.webhook.ok).toBe(true);
    } finally {
      restore();
    }
  });

  test("returns a degraded summary when billing webhook secret or tenant queries are missing", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_bad";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_platform";
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Bad key" } }),
    }));

    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenants") throw new Error(`Unexpected table ${table}`);

        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(async () => ({ count: 0, error: { message: "query failed" } })),
          not: vi.fn(async () => ({ count: 0, error: { message: "query failed" } })),
        };

        return chain;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({ httpMethod: "GET" });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.summary.ok).toBe(false);
      expect(body.stripe_key.ok).toBe(false);
      expect(body.connect.message).toBe("Could not query tenant connect status.");
      expect(body.webhook.ok).toBe(false);
      expect(body.webhook.billing_secret_present).toBe(false);
    } finally {
      restore();
    }
  });
});
