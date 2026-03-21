const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { normalizeBillingStatus } = require("./_prooflink_payments");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(secret);
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service credentials");
  return createClient(url, key);
}

async function updateTenantPlanFromSession(session) {
  const tenantId = session?.metadata?.tenant_id;
  const targetPlan = session?.metadata?.target_plan;

  if (!tenantId || !targetPlan) return;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("tenants")
    .update({
      prooflink_plan_key: targetPlan,
      billing_status: "active"
    })
    .eq("id", tenantId);

  if (error) throw error;
}

async function updateSubscriptionState(subscription) {
  const tenantId = subscription?.metadata?.tenant_id;
  if (!tenantId) return;

  const supabase = getSupabase();

  const billingStatus = normalizeBillingStatus(subscription.status);

  const { error } = await supabase
    .from("tenants")
    .update({
      billing_status: billingStatus
    })
    .eq("id", tenantId);

  if (error) throw error;
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("Missing STRIPE_BILLING_WEBHOOK_SECRET");

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
    const stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    switch (stripeEvent.type) {
      case "checkout.session.completed":
        await updateTenantPlanFromSession(stripeEvent.data.object);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await updateSubscriptionState(stripeEvent.data.object);
        break;

      default:
        break;
    }

    return json(200, { ok: true, received: true });
  } catch (error) {
    return json(400, { ok: false, error: error.message || "Webhook failed" });
  }
};
