import { getPlanKey, limitFor } from "./plan-check.js";

export const ENFORCED_RESOURCES = {
  products: { label: "Products", upgradeTier: "growth" },
  customers: { label: "Customers", upgradeTier: "growth" },
  orders: { label: "Orders", upgradeTier: "growth" },
  operators: { label: "Operator seats", upgradeTier: "growth" }
};

export function buildLimitMessage({ resourceKey, tenant, currentCount = 0 }) {
  const label = ENFORCED_RESOURCES[resourceKey]?.label || resourceKey;
  const limit = limitFor(resourceKey, tenant);
  const plan = getPlanKey(tenant);

  return {
    ok: false,
    code: "plan_limit_reached",
    resourceKey,
    label,
    tenantPlan: plan,
    currentCount,
    limit,
    upgradeTier: ENFORCED_RESOURCES[resourceKey]?.upgradeTier || "growth",
    message: `${label} limit reached for the ${plan} plan. Current: ${currentCount}. Limit: ${limit}.`
  };
}
