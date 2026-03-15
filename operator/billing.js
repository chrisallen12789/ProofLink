import { renderBillingStatusCard } from "./components/billing-status-card.js";
import { renderPlanComparison } from "./components/plan-comparison.js";
import { renderBillingCTA } from "./components/billing-cta.js";
import { mountUpgradeModal } from "./components/upgrade-modal.js";

async function getTenantBillingState() {
  const response = await fetch("/.netlify/functions/tenant-payment-status", {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Failed to load tenant billing state");
  }

  return response.json();
}

function safeTenant(payload) {
  return payload?.tenant || payload || {};
}

function mountBillingPage(root, tenant) {
  const currentPlan = tenant?.prooflink_plan_key || "starter";

  root.innerHTML = `
    ${renderBillingStatusCard(tenant)}
    ${renderBillingCTA({ currentPlan, billingUrl: "/operator/billing" })}
    ${renderPlanComparison(currentPlan)}
  `;

  root.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-open-upgrade]");
    if (!trigger) return;

    const featureKey = trigger.getAttribute("data-feature-key") || null;
    mountUpgradeModal({
      currentPlan,
      featureKey,
      billingUrl: "/operator/billing"
    });
  });
}

async function init() {
  const root = document.getElementById("billingRoot");
  if (!root) return;

  root.innerHTML = "<p>Loading billing...</p>";

  try {
    const payload = await getTenantBillingState();
    mountBillingPage(root, safeTenant(payload));
  } catch (error) {
    root.innerHTML = `<p>Unable to load billing state: ${error.message}</p>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
