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
  "netlify/functions/stripe-platform-checkout.js"
);
const paymentsModulePath = path.resolve(
  process.cwd(),
  "netlify/functions/_prooflink_payments.js"
);

function loadHandlerWithStripeRequestMock(mockStripeRequest) {
  const originalPaymentsModule = require.cache[paymentsModulePath];
  const originalHandlerModule = require.cache[handlerPath];
  const actualPayments = require(paymentsModulePath);

  require.cache[paymentsModulePath] = {
    id: paymentsModulePath,
    filename: paymentsModulePath,
    loaded: true,
    exports: {
      ...actualPayments,
      stripeRequest: mockStripeRequest,
    },
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

      if (originalPaymentsModule) {
        require.cache[paymentsModulePath] = originalPaymentsModule;
      } else {
        delete require.cache[paymentsModulePath];
      }
    },
  };
}

describe("stripe-platform-checkout integration", () => {
  test("starting checkout does not immediately upgrade effective plan state", async () => {
    process.env.STRIPE_PRICE_STARTER_MONTHLY =
      process.env.STRIPE_PRICE_STARTER_MONTHLY || "price_starter_pltest";
    process.env.STRIPE_PRICE_GROWTH_MONTHLY =
      process.env.STRIPE_PRICE_GROWTH_MONTHLY || "price_growth_pltest";

    const mockStripeRequest = vi.fn().mockResolvedValue({
      id: "cs_pltest_platform_checkout",
      url: "https://checkout.example.test/platform/pltest",
      customer: "cus_pltest_platform_checkout",
    });
    const { handler, restore } = loadHandlerWithStripeRequestMock(mockStripeRequest);

    try {
      const admin = createAdminClient();
      const tenantBefore = await admin
        .from("tenants")
        .select("id, prooflink_plan_key, billing_status, stripe_customer_id")
        .eq("slug", TENANTS.tenantA.slug)
        .single();

      await admin
        .from("tenants")
        .update({
          prooflink_plan_key: "starter",
          billing_status: "onboarding",
          stripe_customer_id: null,
        })
        .eq("id", tenantBefore.data.id);

      const accessToken = await getAccessToken(USERS.tenantAAdmin);
      const res = await handler(
        buildEvent({
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: {
            tenantId: tenantBefore.data.id,
            planKey: "growth",
          },
        })
      );

      const body = JSON.parse(res.body);
      const tenantAfter = await admin
        .from("tenants")
        .select("prooflink_plan_key, billing_status, stripe_customer_id")
        .eq("id", tenantBefore.data.id)
        .single();

      expect(res.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(mockStripeRequest).toHaveBeenCalledTimes(1);
      expect(tenantAfter.data.prooflink_plan_key).toBe("starter");
      expect(tenantAfter.data.billing_status).toBe("checkout_started");
      expect(tenantAfter.data.stripe_customer_id).toBe("cus_pltest_platform_checkout");
    } finally {
      restore();
    }
  });
});
