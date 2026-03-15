import { nextPlan, planLabel, upgradeInfo } from "../../platform/upgrade-paths.js";

export function renderBillingCTA({
  currentPlan = "starter",
  featureKey = null,
  billingUrl = "/operator/billing"
} = {}) {
  const info = upgradeInfo(featureKey);
  const suggestedPlan = info.requiredTier || nextPlan(currentPlan);

  return `
    <section class="pl-billing-cta" data-feature-key="${featureKey || ""}">
      <div class="pl-billing-cta__copy">
        <h3>${info.title}</h3>
        <p>${info.body}</p>
        <p>Current plan: <strong>${planLabel(currentPlan)}</strong></p>
        <p>Recommended upgrade: <strong>${planLabel(suggestedPlan)}</strong></p>
      </div>
      <div class="pl-billing-cta__actions">
        <a class="pl-upgrade-btn" href="${billingUrl}?upgrade=${suggestedPlan}&feature=${featureKey || ""}">
          Upgrade now
        </a>
      </div>
    </section>
  `;
}
