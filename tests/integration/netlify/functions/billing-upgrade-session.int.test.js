"use strict";

const path = require("path");
const {
  TENANTS,
  USERS,
  buildEvent,
  createAdminClient,
  getAccessToken,
} = require("../../../setup/test-helpers");

const handlerPath = path.resolve(
  process.cwd(),
  "netlify/functions/create-billing-upgrade-session.js"
);

function loadHandlerWithStripeMock(mockCreate) {
  const stripePath = require.resolve("stripe");
  const originalStripeModule = require.cache[stripePath];
  const originalHandlerModule = require.cache[handlerPath];

  const StripeMock = function Stripe() {
    return {
      checkout: {
        sessions: {
          create: mockCreate,
        },
      },
    };
  };

  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: StripeMock,
  };
  delete require.cache[handlerPath];

  const handler = require(handlerPath).handler;

  return {
    handler,
    restore() {
      delete require.cache[handlerPath];
      if (originalHandlerModule) {
        require.cache[handlerPath] = originalHandlerModule;
      }

      if (originalStripeModule) {
        require.cache[stripePath] = originalStripeModule;
      } else {
        delete require.cache[stripePath];
      }
    },
  };
}

describe("create-billing-upgrade-session integration", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_pltest";
    process.env.STRIPE_PRICE_GROWTH_MONTHLY =
      process.env.STRIPE_PRICE_GROWTH_MONTHLY || "price_growth_pltest";
    process.env.URL = process.env.URL || process.env.TEST_SITE_URL || "http://127.0.0.1:8888";
  });

  test("unauthenticated callers are rejected", async () => {
    const mockCreate = vi.fn();
    const { handler, restore } = loadHandlerWithStripeMock(mockCreate);

    try {
      const admin = createAdminClient();
      const tenantA = await admin
        .from("tenants")
        .select("id")
        .eq("slug", TENANTS.tenantA.slug)
        .single();

      const res = await handler(
        buildEvent({
          method: "POST",
          body: { tenantId: tenantA.data.id, targetPlan: "growth" },
        })
      );

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toMatch(/auth|unauthorized|authenticated/i);
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("tenant A operator cannot create an upgrade session for tenant B", async () => {
    const mockCreate = vi.fn();
    const { handler, restore } = loadHandlerWithStripeMock(mockCreate);

    try {
      const admin = createAdminClient();
      const tenantB = await admin
        .from("tenants")
        .select("id")
        .eq("slug", TENANTS.tenantB.slug)
        .single();
      const accessToken = await getAccessToken(USERS.tenantAAdmin);

      const res = await handler(
        buildEvent({
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: { tenantId: tenantB.data.id, targetPlan: "growth" },
        })
      );

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/operator membership|forbidden/i);
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("valid tenant-scoped request still succeeds", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "cs_pltest_upgrade",
      url: "https://checkout.example.test/session/pltest",
    });
    const { handler, restore } = loadHandlerWithStripeMock(mockCreate);

    try {
      const admin = createAdminClient();
      const tenantA = await admin
        .from("tenants")
        .select("id, owner_email")
        .eq("slug", TENANTS.tenantA.slug)
        .single();
      const accessToken = await getAccessToken(USERS.tenantAAdmin);

      const res = await handler(
        buildEvent({
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: {
            tenantId: tenantA.data.id,
            targetPlan: "growth",
            customerEmail: "attacker@example.com",
          },
        })
      );

      const body = JSON.parse(res.body);
      expect(res.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.targetPlan).toBe("growth");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_email: tenantA.data.owner_email,
          metadata: expect.objectContaining({
            tenant_id: tenantA.data.id,
            target_plan: "growth",
          }),
        })
      );
    } finally {
      restore();
    }
  });
});
