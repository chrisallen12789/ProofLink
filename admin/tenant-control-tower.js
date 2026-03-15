(function (global) {
  function pill(value) {
    value = String(value || 'unknown').toLowerCase();
    return '<span class="pl-status-pill pl-status-pill--' + value + '">' + value.replace(/_/g, ' ') + '</span>';
  }
  function renderRow(t) {
    return ''
      + '<tr data-tenant-id="' + (t.id || '') + '">'
      + '<td>' + (t.name || '') + '</td>'
      + '<td>' + (t.prooflink_plan_key || 'starter') + '</td>'
      + '<td>' + pill(t.billing_status || t.billingStatus || 'unknown') + '</td>'
      + '<td>' + pill(t.connect_status || t.connectStatus || t.stripe_status || 'unknown') + '</td>'
      + '<td>' + pill(t.status || 'active') + '</td>'
      + '</tr>';
  }
  function renderTable(rows) {
    rows = rows || [];
    return ''
      + '<section class="pl-admin-control-tower">'
      + '<header><h2>Tenant control tower</h2><p>Plan, billing, connect, and launch truth in one place.</p></header>'
      + '<table class="pl-admin-tenant-table"><thead><tr><th>Tenant</th><th>Plan</th><th>Billing</th><th>Stripe</th><th>Access</th></tr></thead><tbody>'
      + (rows.length ? rows.map(renderRow).join('') : '<tr><td colspan="5">No tenants found.</td></tr>')
      + '</tbody></table></section>';
  }
  global.ProofLinkAdminControlTower = { renderTable: renderTable };
})(window);
