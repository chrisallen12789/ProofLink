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

  function pressurePill(row) {
    var blocked = !!row.health_blocked;
    var warning = !!row.health_warning;
    var status = blocked ? 'blocked' : (warning ? 'warning' : 'healthy');
    var label = blocked ? 'blocked' : (warning ? 'warning' : 'healthy');
    return '<span class="pl-status-pill pl-status-pill--' + status + '">' + esc(label) + '</span>';
  }

  function formatPercent(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n.toFixed(0) + '%' : '—';
  }

  function formatStorage(row) {
    var used = Number(row.storage_used_mb);
    var limit = Number(row.storage_limit_mb);
    if (!Number.isFinite(used) && !Number.isFinite(limit)) return '—';
    if (!Number.isFinite(limit) || limit <= 0) return (Number.isFinite(used) ? used.toFixed(2) : '0.00') + ' MB';
    return used.toFixed(2) + ' / ' + limit.toFixed(2) + ' MB';
  }

  function pressureText(row) {
    if (!row.health_resource) return '—';
    return esc(String(row.health_resource).replace(/_/g, ' ')) + ' • ' + esc(formatPercent(row.pressure_percent));
  }

  function recommendationText(row) {
    if (!row.recommended_plan_key) return '—';
    return 'Upgrade to ' + esc(String(row.recommended_plan_key).replace(/_/g, ' '));
  }

  function renderRow(t) {
    return ''
      + '<tr data-tenant-id="' + esc(t.id || '') + '">'
      + '<td><div style="font-weight:600">' + esc(t.name || t.slug || 'Unknown tenant') + '</div><div style="font-size:.78rem;color:var(--muted)">' + esc(t.owner_email || '') + '</div></td>'
      + '<td>' + esc(t.prooflink_plan_key || 'starter') + '</td>'
      + '<td>' + pressurePill(t) + '</td>'
      + '<td>' + pressureText(t) + '</td>'
      + '<td>' + formatStorage(t) + '</td>'
      + '<td>' + recommendationText(t) + '</td>'
      + '<td>' + pill(t.billing_status || t.billingStatus || 'unknown') + '</td>'
      + '<td>' + pill(t.connect_status || t.connectStatus || t.stripe_status || 'unknown') + '</td>'
      + '</tr>';
  }

  function sortRows(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var aRank = a.health_blocked ? 3 : (a.health_warning ? 2 : 1);
      var bRank = b.health_blocked ? 3 : (b.health_warning ? 2 : 1);
      if (bRank !== aRank) return bRank - aRank;
      return Number(b.pressure_percent || 0) - Number(a.pressure_percent || 0);
    });
  }

  function renderSummary(rows) {
    var blocked = 0;
    var warning = 0;
    var storage = 0;
    rows.forEach(function (row) {
      if (row.health_blocked) blocked += 1;
      else if (row.health_warning) warning += 1;
      if (String(row.health_resource || '').toLowerCase() === 'storage') storage += 1;
    });

    return ''
      + '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin:.75rem 0 1rem">'
      + '<div class="kpi-card"><div class="kpi-label">Blocked tenants</div><div class="kpi-value" style="color:var(--error)">' + blocked + '</div></div>'
      + '<div class="kpi-card"><div class="kpi-label">Warning tenants</div><div class="kpi-value" style="color:var(--warn)">' + warning + '</div></div>'
      + '<div class="kpi-card"><div class="kpi-label">Storage pressure</div><div class="kpi-value">' + storage + '</div></div>'
      + '</div>';
  }

  function renderTable(rows) {
    rows = sortRows(rows || []);
    return ''
      + '<section class="pl-admin-control-tower">'
      + '<header><h2>Tenant control tower</h2><p>Capacity risk, storage pressure, and next-plan recommendations in one view.</p></header>'
      + renderSummary(rows)
      + '<table class="pl-admin-tenant-table"><thead><tr><th>Tenant</th><th>Plan</th><th>Health</th><th>Pressure</th><th>Storage</th><th>Recommendation</th><th>Billing</th><th>Stripe</th></tr></thead><tbody>'
      + (rows.length ? rows.map(renderRow).join('') : '<tr><td colspan="8">No tenants found.</td></tr>')
      + '</tbody></table></section>';
  }

  global.ProofLinkAdminControlTower = { renderTable: renderTable };
})(window);
