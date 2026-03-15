export const PLAN_ORDER = ["starter", "growth", "enterprise"];

export const PLAN_DISPLAY = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise"
};

export const UPGRADE_COPY = {
  onlineCheckout: {
    requiredTier: "growth",
    title: "Unlock online checkout",
    body: "Move to Growth to accept online payments once billing and Stripe Connect are fully ready."
  },
  advancedAnalytics: {
    requiredTier: "enterprise",
    title: "Unlock advanced analytics",
    body: "Move to Enterprise for deeper reporting, exports, and premium controls."
  },
  operatorSeats: {
    requiredTier: "growth",
    title: "Unlock more operator seats",
    body: "Move to Growth to add more users to your business workspace."
  },
  customDomain: {
    requiredTier: "growth",
    title: "Unlock custom domains",
    body: "Move to Growth to use premium launch and public-site controls."
  }
};

export function nextPlan(planKey = "starter") {
  const idx = PLAN_ORDER.indexOf(planKey);
  if (idx === -1 || idx === PLAN_ORDER.length - 1) return planKey;
  return PLAN_ORDER[idx + 1];
}

export function planLabel(planKey = "starter") {
  return PLAN_DISPLAY[planKey] || "Starter";
}

export function upgradeInfo(featureKey) {
  return UPGRADE_COPY[featureKey] || {
    requiredTier: "growth",
    title: "Upgrade your plan",
    body: "Upgrade your ProofLink plan to unlock this capability."
  };
}
