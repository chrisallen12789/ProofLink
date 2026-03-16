const Stripe = require("stripe");
const {
  clean,
  findTenantById,
  findTenantByStripeCustomer,
  json,
  readJson,
  requireOperatorContext,
} = require("./_prooflink_payments");

async function resolveScopedTenant(body) {
  const tenantId = clean(body.tenantId || body.tenant_id);
  const customerId = clean(body.customerId || body.customer_id);

  if (tenantId) {
    const tenant = await findTenantById(tenantId);
    if (!tenant) {
      throw Object.assign(new Error("Tenant not found"), { statusCode: 404 });
    }
    return tenant;
  }

  if (customerId) {
    const tenant = await findTenantByStripeCustomer(customerId);
    if (!tenant) {
      throw Object.assign(new Error("Tenant not found for customerId"), { statusCode: 404 });
    }
    return tenant;
  }

  throw Object.assign(new Error("Missing tenantId or customerId"), { statusCode: 400 });
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = readJson(event);
    const tenant = await resolveScopedTenant(body);
    const scopedTenantId = clean(tenant.id || tenant.tenant_id || tenant.slug);
    const requestedCustomerId = clean(body.customerId || body.customer_id);

    await requireOperatorContext(event, scopedTenantId);

    const customerId = clean(tenant.stripe_customer_id);

    if (!customerId) {
      return json(400, { ok: false, error: "Missing Stripe customer for tenant" });
    }

    if (requestedCustomerId && requestedCustomerId !== customerId) {
      return json(403, {
        ok: false,
        error: "customerId does not belong to the authenticated tenant",
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.URL}/operator/billing.html`
    });

    return json(200, { ok: true, url: session.url });
  } catch (error) {
    return json(Number(error.statusCode || 500), {
      ok: false,
      error: error.message || "Unable to create billing portal session"
    });
  }
};
