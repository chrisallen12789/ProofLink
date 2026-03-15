// Server-side guard helpers for Netlify functions.
// Wire these into create/save endpoints so limits are enforced on write, not just in the UI.

const PLAN_RULES = {
  starter: { products: 10, customers: 50, orders: 100, operators: 1 },
  growth: { products: Infinity, customers: Infinity, orders: Infinity, operators: 5 },
  enterprise: { products: Infinity, customers: Infinity, orders: Infinity, operators: Infinity }
};

function getPlanKey(tenant) {
  return (tenant && tenant.prooflink_plan_key) || "starter";
}

function limitFor(resourceKey, tenant) {
  const plan = PLAN_RULES[getPlanKey(tenant)] || PLAN_RULES.starter;
  return plan[resourceKey];
}

function enforceLimit(resourceKey, currentCount, tenant) {
  const limit = limitFor(resourceKey, tenant);
  if (limit === undefined || limit === Infinity) return true;
  return Number(currentCount || 0) < limit;
}

function enforcementResponse(resourceKey, currentCount, tenant) {
  return {
    ok: false,
    code: "plan_limit_reached",
    resourceKey,
    tenantPlan: getPlanKey(tenant),
    currentCount: Number(currentCount || 0),
    limit: limitFor(resourceKey, tenant)
  };
}

module.exports = {
  getPlanKey,
  limitFor,
  enforceLimit,
  enforcementResponse
};
