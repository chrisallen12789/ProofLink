import { renderBillingCTA } from "./billing-cta.js";
import { renderPlanComparison } from "./plan-comparison.js";

export function renderUpgradeModal({
  currentPlan = "starter",
  featureKey = null,
  billingUrl = "/operator/billing"
} = {}) {
  return `
    <div class="pl-upgrade-modal" role="dialog" aria-modal="true" aria-label="Upgrade plan">
      <div class="pl-upgrade-modal__backdrop" data-close-upgrade="true"></div>
      <div class="pl-upgrade-modal__panel">
        <button type="button" class="pl-upgrade-modal__close" data-close-upgrade="true">×</button>
        ${renderBillingCTA({ currentPlan, featureKey, billingUrl })}
        ${renderPlanComparison(currentPlan)}
      </div>
    </div>
  `;
}

export function mountUpgradeModal({
  root = document.body,
  currentPlan = "starter",
  featureKey = null,
  billingUrl = "/operator/billing"
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderUpgradeModal({ currentPlan, featureKey, billingUrl });
  const node = wrapper.firstElementChild;

  function close() {
    node.remove();
  }

  node.addEventListener("click", (event) => {
    if (event.target?.matches("[data-close-upgrade='true']")) close();
  });

  root.appendChild(node);
  return node;
}
