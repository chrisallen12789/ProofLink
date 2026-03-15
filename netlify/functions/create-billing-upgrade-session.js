const Stripe = require("stripe");

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function getPriceIdForPlan(targetPlan) {
  const map = {
    growth: process.env.STRIPE_PRICE_GROWTH || "",
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE || ""
  };

  const priceId = map[targetPlan];
  if (!priceId) throw new Error(`No Stripe price configured for plan: ${targetPlan}`);
  return priceId;
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const tenantId = body.tenantId;
    const targetPlan = body.targetPlan;
    const featureKey = body.featureKey || null;
    const customerEmail = body.customerEmail || null;

    if (!tenantId) return json(400, { ok: false, error: "Missing tenantId" });
    if (!targetPlan) return json(400, { ok: false, error: "Missing targetPlan" });

    const stripe = getStripe();
    const price = getPriceIdForPlan(targetPlan);
    const appUrl = requireEnv("URL");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      success_url: `${appUrl}/operator/billing.html?upgrade=success`,
      cancel_url: `${appUrl}/operator/billing.html?upgrade=cancelled`,
      line_items: [{ price, quantity: 1 }],
      customer_email: customerEmail || undefined,
      metadata: {
        tenant_id: tenantId,
        target_plan: targetPlan,
        feature_key: featureKey || ""
      }
    });

    return json(200, {
      ok: true,
      url: session.url,
      sessionId: session.id,
      targetPlan
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Unable to create billing session"
    });
  }
};
