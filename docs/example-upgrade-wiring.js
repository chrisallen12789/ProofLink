import { mountUpgradeModal } from "../operator/components/upgrade-modal.js";

export function openCheckoutUpgrade(tenant) {
  mountUpgradeModal({
    currentPlan: tenant?.prooflink_plan_key || "starter",
    featureKey: "onlineCheckout",
    billingUrl: "/operator/billing"
  });
}

export async function startUpgrade(targetPlan, featureKey) {
  const response = await fetch("/.netlify/functions/create-billing-upgrade-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ targetPlan, featureKey })
  });

  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Unable to start upgrade");
  }

  return payload;
}
