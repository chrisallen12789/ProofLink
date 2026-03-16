(function (global) {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function pill(value) {
    value = String(value || 'unknown').toLowerCase();
    return '<span class="pl-status-pill pl-status-pill--' + esc(value) + '">' + esc(value.replace(/_/g, ' ')) + '</span>';
  }
  function pressure(t) {
    if (t.health_blocked) return '<strong style="color:#b42318">Blocked</strong>';
    if (t.health_warning) return '<strong style="color:#b54708">Warning</strong>';
    return '<span>Stable</span>';
  }
  function pressureText(t) {
    if (!t.health_resource || t.health_percent == null) return 'No active pressure';
    return esc(String(t.health_resource).replace(/_/g, ' ') + ' · ' + t.health_percent + '%');
  }
  function renderRow(t) {
    return ''
      + '<tr data-tenant-id="' + esc(t.id || '') + '">'
      + '<td>' + esc(t.name || t.slug || '') + '</td>'
      + '<td>' + esc(t.prooflink_plan_key || 'starter') + '</td>'
      + '<td>' + pill(t.billing_status || t.billingStatus || 'unknown') + '</td>'
      + '<td>' + pressure(t) + '<div style="font-size:.78rem;color:#667085">' + pressureText(t) + '</div></td>'
      + '<td>' + esc((t.storage_used_mb || 0) + ' / ' + (t.max_storage_mb || 0) + ' MB') + '</td>'
      + '<td>' + esc(t.recommended_plan_key || '—') + '</td>'
      + '</tr>';
  }
  function renderTable(rows) {
    rows = rows || [];
    return ''
      + '<section class="pl-admin-control-tower">'
      + '<header><h2>Tenant control tower</h2><p>Capacity, billing posture, and storage pressure in one view.</p></header>'
      + '<table class="pl-admin-tenant-table"><thead><tr><th>Tenant</th><th>Plan</th><th>Billing</th><th>Pressure</th><th>Storage</th><th>Recommended next plan</th></tr></thead><tbody>'
      + (rows.length ? rows.map(renderRow).join('') : '<tr><td colspan="6">No tenants found.</td></tr>')
      + '</tbody></table></section>';
  }
  global.ProofLinkAdminControlTower = { renderTable: renderTable };
})(window);
