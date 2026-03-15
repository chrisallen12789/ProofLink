const Stripe = require("stripe");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const customerId = body.customerId;
    if (!customerId) return json(400, { ok: false, error: "Missing customerId" });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.URL}/operator/billing.html`
    });

    return json(200, { ok: true, url: session.url });
  } catch (error) {
    return json(500, { ok: false, error: error.message || "Unable to create billing portal session" });
  }
};
