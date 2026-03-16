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
  "netlify/functions/create-billing-portal-session.js"
);

function loadHandlerWithStripeMock(mockCreate) {
  const stripePath = require.resolve("stripe");
  const originalStripeModule = require.cache[stripePath];
  const originalHandlerModule = require.cache[handlerPath];

  const StripeMock = function Stripe() {
    return {
      billingPortal: {
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

describe("create-billing-portal-session integration", () => {
  test("unauthenticated callers are rejected", async () => {
    const mockCreate = vi.fn();
    const { handler, restore } = loadHandlerWithStripeMock(mockCreate);

    try {
      const admin = createAdminClient();
      const tenantA = await admin
        .from("tenants")
        .select("id, stripe_customer_id")
        .eq("slug", TENANTS.tenantA.slug)
        .single();

      await admin
        .from("tenants")
        .update({ stripe_customer_id: tenantA.data.stripe_customer_id || "cus_pltest_tenant_a" })
        .eq("id", tenantA.data.id);

      const res = await handler(
        buildEvent({
          method: "POST",
          body: { tenantId: tenantA.data.id },
        })
      );

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toMatch(/auth|unauthorized|authenticated/i);
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("tenant A operator cannot create a portal session for tenant B", async () => {
    const mockCreate = vi.fn();
    const { handler, restore } = loadHandlerWithStripeMock(mockCreate);

    try {
      const admin = createAdminClient();
      const tenantB = await admin
        .from("tenants")
        .select("id")
        .eq("slug", TENANTS.tenantB.slug)
        .single();
      const tenantBCustomerId = "cus_pltest_tenant_b";

      await admin
        .from("tenants")
        .update({ stripe_customer_id: tenantBCustomerId })
        .eq("id", tenantB.data.id);

      const accessToken = await getAccessToken(USERS.tenantAAdmin);
      const res = await handler(
        buildEvent({
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: { customerId: tenantBCustomerId },
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
      url: "https://billing.example.test/session/pltest",
    });
    const { handler, restore } = loadHandlerWithStripeMock(mockCreate);

    try {
      const admin = createAdminClient();
      const tenantA = await admin
        .from("tenants")
        .select("id")
        .eq("slug", TENANTS.tenantA.slug)
        .single();
      const tenantACustomerId = "cus_pltest_tenant_a";

      await admin
        .from("tenants")
        .update({ stripe_customer_id: tenantACustomerId })
        .eq("id", tenantA.data.id);

      const accessToken = await getAccessToken(USERS.tenantAAdmin);
      const res = await handler(
        buildEvent({
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: { tenantId: tenantA.data.id },
        })
      );

      const body = JSON.parse(res.body);
      expect(res.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.url).toContain("billing.example.test");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: tenantACustomerId,
        })
      );
    } finally {
      restore();
    }
  });
});
