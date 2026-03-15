import { guardFeature, guardLimit } from "../platform/plan-middleware.js";
import { renderFeatureLock } from "../operator/components/feature-lock.js";
import { renderUpgradePanel } from "../operator/components/upgrade-panel.js";

export function mountPaymentsPage({ tenant, root }) {
  const allowed = guardFeature({
    feature: "onlineCheckout",
    tenant,
    onDenied: () => {
      root.innerHTML = renderFeatureLock({
        title: "Online checkout locked",
        description: "Online checkout is part of the Growth plan and above.",
        requiredTier: "growth"
      }) + renderUpgradePanel(tenant?.prooflink_plan_key || "starter");
    }
  });

  if (!allowed) return;

  root.innerHTML = "<h1>Payments</h1>";
}

export function beforeCreateProduct({ tenant, currentCount }) {
  return guardLimit({
    feature: "products",
    currentCount,
    tenant,
    onDenied: ({ limit }) => {
      alert(`Product limit reached for your current plan. Limit: ${limit}`);
    }
  });
}
