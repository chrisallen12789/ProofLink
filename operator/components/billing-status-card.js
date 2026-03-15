export function renderBillingStatusCard(tenant = {}) {
  const billingStatus = tenant.billing_status || "inactive";
  const connectStatus = tenant.connect_status || "not_started";
  const planKey = tenant.prooflink_plan_key || "starter";
  const checkoutReady =
    billingStatus === "active" && connectStatus === "connect_connected" && planKey !== "starter";

  return `
    <section class="pl-billing-status-card">
      <h2>Billing and upgrade status</h2>
      <ul>
        <li><strong>Plan:</strong> ${planKey}</li>
        <li><strong>Platform billing:</strong> ${billingStatus}</li>
        <li><strong>Stripe Connect:</strong> ${connectStatus}</li>
        <li><strong>Online checkout eligible:</strong> ${checkoutReady ? "Yes" : "No"}</li>
      </ul>
    </section>
  `;
}
