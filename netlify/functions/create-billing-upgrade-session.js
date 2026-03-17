const Stripe = require("stripe");
const {
  clean,
  findTenantById,
  json,
  readJson,
  requireOperatorContext,
} = require("./_prooflink_payments");

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
    const body = readJson(event);
    const tenantId = clean(body.tenantId || body.tenant_id);
    const targetPlan = clean(body.targetPlan || body.target_plan);
    const featureKey = clean(body.featureKey || body.feature_key) || null;

    if (!tenantId) return json(400, { ok: false, error: "Missing tenantId" });
    if (!targetPlan) return json(400, { ok: false, error: "Missing targetPlan" });

    await requireOperatorContext(event, tenantId);

    const tenant = await findTenantById(tenantId);
    if (!tenant) {
      return json(404, { ok: false, error: "Tenant not found" });
    }

    const stripe = getStripe();
    const price = getPriceIdForPlan(targetPlan);
    const appUrl = requireEnv("URL");
    const customerEmail = clean(tenant.owner_email || body.customerEmail || body.customer_email) || null;

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
    return json(Number(error.statusCode || 500), {
      ok: false,
      error: error.message || "Unable to create billing session"
    });
  }
};
