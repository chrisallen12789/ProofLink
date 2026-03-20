"use strict";

const path = require("path");
const {
  TENANTS,
  buildEvent,
  createAdminClient,
} = require("../../../setup/test-helpers");

const handlerPath = path.resolve(
  process.cwd(),
  "netlify/functions/stripe-webhook.js"
);
const paymentsModulePath = path.resolve(
  process.cwd(),
  "netlify/functions/_prooflink_payments.js"
);

function loadWebhookHandlerWithSignatureMock(mockVerifyStripeSignature) {
  const originalPaymentsModule = require.cache[paymentsModulePath];
  const originalHandlerModule = require.cache[handlerPath];
  const actualPayments = require(paymentsModulePath);

  require.cache[paymentsModulePath] = {
    id: paymentsModulePath,
    filename: paymentsModulePath,
    loaded: true,
    exports: {
      ...actualPayments,
      verifyStripeSignature: mockVerifyStripeSignature,
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

describe("stripe platform billing webhook integration", () => {
  test("abandoned checkout leaves effective plan state unchanged", async () => {
    process.env.STRIPE_WEBHOOK_SECRET =
      process.env.STRIPE_WEBHOOK_SECRET || "whsec_pltest_platform";

    const { handler, restore } = loadWebhookHandlerWithSignatureMock(() => true);

    try {
      const admin = createAdminClient();
      const tenant = await admin
        .from("tenants")
        .select("id")
        .eq("slug", TENANTS.tenantA.slug)
        .single();

      await admin
        .from("tenants")
        .update({
          prooflink_plan_key: "starter",
          billing_status: "checkout_started",
          stripe_customer_id: "cus_pltest_existing",
          stripe_subscription_id: null,
        })
        .eq("id", tenant.data.id);

      const res = await handler(
        buildEvent({
          method: "POST",
          headers: { "stripe-signature": "sig_pltest" },
          body: {
            type: "checkout.session.expired",
            data: {
              object: {
                id: "cs_pltest_expired",
                customer: "cus_pltest_existing",
                metadata: {
                  purpose: "prooflink_platform_billing",
                  tenant_id: tenant.data.id,
                  plan_key: "growth",
                },
              },
            },
          },
        })
      );

      const tenantAfter = await admin
        .from("tenants")
        .select("prooflink_plan_key, billing_status")
        .eq("id", tenant.data.id)
        .single();

      expect(res.statusCode).toBe(200);
      expect(tenantAfter.data.prooflink_plan_key).toBe("starter");
      expect(tenantAfter.data.billing_status).toBe("checkout_started");
    } finally {
      restore();
    }
  }, 30000);

  test("successful platform billing checkout applies the intended plan exactly once", async () => {
    process.env.STRIPE_WEBHOOK_SECRET =
      process.env.STRIPE_WEBHOOK_SECRET || "whsec_pltest_platform";

    const { handler, restore } = loadWebhookHandlerWithSignatureMock(() => true);

    try {
      const admin = createAdminClient();
      const tenant = await admin
        .from("tenants")
        .select("id")
        .eq("slug", TENANTS.tenantA.slug)
        .single();

      await admin
        .from("tenants")
        .update({
          prooflink_plan_key: "starter",
          billing_status: "checkout_started",
          stripe_customer_id: null,
          stripe_subscription_id: null,
        })
        .eq("id", tenant.data.id);

      const eventBody = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_pltest_completed",
            customer: "cus_pltest_completed",
            subscription: "sub_pltest_completed",
            client_reference_id: tenant.data.id,
            metadata: {
              purpose: "prooflink_platform_billing",
              tenant_id: tenant.data.id,
              plan_key: "growth",
            },
          },
        },
      };

      const firstRes = await handler(
        buildEvent({
          method: "POST",
          headers: { "stripe-signature": "sig_pltest" },
          body: eventBody,
        })
      );

      const secondRes = await handler(
        buildEvent({
          method: "POST",
          headers: { "stripe-signature": "sig_pltest" },
          body: eventBody,
        })
      );

      const tenantAfter = await admin
        .from("tenants")
        .select("prooflink_plan_key, billing_status, stripe_customer_id, stripe_subscription_id")
        .eq("id", tenant.data.id)
        .single();

      expect(firstRes.statusCode).toBe(200);
      expect(secondRes.statusCode).toBe(200);
      expect(tenantAfter.data.prooflink_plan_key).toBe("growth");
      expect(tenantAfter.data.billing_status).toBe("active");
      expect(tenantAfter.data.stripe_customer_id).toBe("cus_pltest_completed");
      expect(tenantAfter.data.stripe_subscription_id).toBe("sub_pltest_completed");
    } finally {
      restore();
    }
  });
});
