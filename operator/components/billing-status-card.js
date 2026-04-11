export function renderBillingStatusCard(tenant = {}) {
  const billingStatus = tenant.billing_status || 'inactive';
  const connectStatus = tenant.connect_status || 'manual';
  const planKey = tenant.prooflink_plan_key || "starter";
  const manualMode = tenant.manual_mode !== false;
  const collectionReady = manualMode || (billingStatus === 'active' && connectStatus === 'ready' && planKey !== 'starter');

  return `
    <section class="pl-billing-status-card">
      <h2>Billing and collection status</h2>
      <ul>
        <li><strong>Plan:</strong> ${planKey}</li>
        <li><strong>Platform billing:</strong> ${billingStatus}</li>
        <li><strong>Collection mode:</strong> ${connectStatus}</li>
        <li><strong>Manual collection:</strong> ${manualMode ? 'Enabled' : 'Disabled'}</li>
        <li><strong>Customer collection ready:</strong> ${collectionReady ? 'Yes' : 'No'}</li>
      </ul>
    </section>
  `;
}
