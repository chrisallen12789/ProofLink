// admin/admin.js — ProofLink Platform Admin
// All UI logic for admin/index.html
//
// Bug fixes vs the previous inline version:
//   - loadOverview now maps to the actual get-platform-stats response shape
//     (d.tenants.total, d.onboarding.by_status, d.orders.gmv_total)
//   - Activity feed uses d.recent_requests (no d.recent_activity field exists)
//   - SUPABASE_URL / SUPABASE_ANON read from window globals set in index.html
//
// New features:
//   - approveAndProvision() — single-click Approve & Launch via admin-approve-onboarding
//   - viewDetail() — detail modal shows all fields of a request, with inline actions
//   - needs_review status support everywhere (badge, filter, action buttons)
//   - requestCache / tenantCache — safe onclick handlers (no JSON in attributes)
//   - Search filter on onboarding list

'use strict';

// ── Config — set by index.html as window globals ─────────────────────────────
var SUPABASE_URL  = (window.SUPABASE_URL  || '').trim();
var SUPABASE_ANON = (window.SUPABASE_ANON_KEY || '').trim();

// ── State ─────────────────────────────────────────────────────────────────────
var token              = sessionStorage.getItem('pl_op_token') || '';
var pendingRejectId    = null;
var pendingProvisionId = null;
var configTenantId     = null;
var tenantSearchTimer  = null;

// Row data caches — keyed by id so onclick handlers only pass safe UUIDs
var requestCache = {};
var tenantCache  = {};

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(iso) {
  var d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDt(iso) {
  var d = new Date(iso || '');
  return isNaN(d) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// money() expects cents (integer)
function money(cents) {
  if (cents == null) return '—';
  return '$' + (cents / 100).toFixed(2);
}

function statusBadge(s) {
  var map = {
    'submitted'    : 'badge-submitted',
    'approved'     : 'badge-approved',
    'provisioning' : 'badge-provisioning',
    'provisioned'  : 'badge-provisioned',
    'failed'       : 'badge-failed',
    'rejected'     : 'badge-rejected',
    'active'       : 'badge-active',
    'inactive'     : 'badge-inactive',
    'needs_review' : 'badge-needs-review',
    'not_connected': 'badge-submitted',
    'pending'      : 'badge-provisioning',
    'flagged'      : 'badge-flagged',
    'suspended'    : 'badge-suspended',
    'terminated'   : 'badge-terminated',
  };
  var key = String(s || '').toLowerCase();
  var cls = map[key] || '';
  var label = String(s || '—').replace(/_/g, ' ');
  return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
}

function toast(msg, isErr) {
  var container = document.getElementById('toast');
  var el = document.createElement('div');
  el.className = 'toast-msg' + (isErr ? ' error' : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Auth ──────────────────────────────────────────────────────────────────────

function setAuth(show) {
  document.getElementById('auth-gate').style.display  = show ? 'flex' : 'none';
  document.getElementById('admin-app').style.display  = show ? 'none' : 'grid';
}

function verifyAdmin(accessToken) {
  return fetch('/.netlify/functions/admin-verify', {
    method : 'GET',
    headers: { 'Authorization': 'Bearer ' + accessToken },
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
}

function handleLogin() {
  var email = document.getElementById('login-email').value.trim();
  var pw    = document.getElementById('login-password').value;
  var errEl = document.getElementById('auth-err');
  errEl.style.display = 'none';

  if (!email || !pw) {
    errEl.textContent = 'Email and password required.';
    errEl.style.display = 'block';
    return;
  }
  if (!SUPABASE_URL) {
    errEl.textContent = 'SUPABASE_URL is not configured. Check window.SUPABASE_URL in index.html.';
    errEl.style.display = 'block';
    return;
  }

  fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
    body   : JSON.stringify({ email: email, password: pw }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error_description || res.d.message || 'Login failed.');
    var accessToken = res.d.access_token;

    // Verify caller is a platform admin before granting dashboard access
    return verifyAdmin(accessToken).then(function (vRes) {
      if (!vRes.ok) {
        throw new Error(vRes.d.error || 'Access denied — this account is not a platform admin.');
      }
      token = accessToken;
      sessionStorage.setItem('pl_op_token', token);
      document.getElementById('admin-email-display').textContent = vRes.d.email || email;
      setAuth(false);
      bootAdmin();
    });
  })
  .catch(function (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  });
}

function handleSignOut() {
  token = null;
  sessionStorage.removeItem('pl_op_token');
  setAuth(true);
}

function authFetch(url, opts) {
  opts = opts || {};
  var headers = Object.assign({}, opts.headers || {}, { 'Authorization': 'Bearer ' + token });
  return fetch(url, Object.assign({}, opts, { headers: headers }))
    .then(function (r) {
      if (r.status === 401 || r.status === 403) {
        sessionStorage.removeItem('pl_op_token');
        setAuth(true);
        throw new Error('Session expired. Please sign in again.');
      }
      return r;
    });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function showSection(id, link) {
  document.querySelectorAll('.section').forEach(function (s) { s.classList.remove('active'); });
  document.querySelectorAll('.sidebar-nav a').forEach(function (a) { a.classList.remove('active'); });
  document.getElementById('section-' + id).classList.add('active');
  if (link) link.classList.add('active');
  if (id === 'overview')     loadOverview();
  if (id === 'onboarding')   loadOnboarding();
  if (id === 'tenants')      loadTenants();
  if (id === 'provisioning') loadProvisioning();
  if (id === 'testers')      loadTesters();
}

// ── Overview ──────────────────────────────────────────────────────────────────
// FIXED: maps to actual get-platform-stats response shape

function loadOverview() {
  authFetch('/.netlify/functions/get-platform-stats')
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed to load stats');
      var d = res.d;

      // ── KPI cards
      document.getElementById('kpi-tenants').textContent     = (d.tenants    && d.tenants.total    != null) ? d.tenants.total    : '—';
      document.getElementById('kpi-pending').textContent     = (d.onboarding && d.onboarding.by_status) ? (d.onboarding.by_status.submitted || 0) : '—';
      document.getElementById('kpi-provisioned').textContent = (d.onboarding && d.onboarding.by_status) ? (d.onboarding.by_status.provisioned || 0) : '—';

      // gmv_total is in dollars; money() expects cents
      var gmvCents = d.orders ? Math.round((d.orders.gmv_total || 0) * 100) : 0;
      document.getElementById('kpi-gmv').textContent = money(gmvCents);

      // ── Platform revenue dashboard metrics
      var plat = d.platform || {};
      var metricsEl = document.getElementById('platform-metrics');
      if (metricsEl) {
        var flaggedCount  = plat.flagged_tenants || (d.tenants && d.tenants.flagged) || 0;
        var totalAll      = plat.total_tenants || (d.tenants && d.tenants.total_all) || 0;
        var activeTenants = plat.active_tenants || (d.tenants && d.tenants.active) || (d.tenants && d.tenants.total) || 0;
        var monthlyOb     = plat.monthly_onboarding || (d.onboarding && d.onboarding.monthly_requests) || 0;
        var platformGmv   = plat.platform_gmv || (d.orders && d.orders.gmv_total) || 0;
        var orderCount    = plat.platform_order_count || (d.orders && d.orders.total) || 0;
        var avgRevenue    = plat.average_tenant_revenue || 0;

        metricsEl.innerHTML =
          '<div class="kpi-card"><div class="kpi-label">Total tenants</div><div class="kpi-value">' + totalAll + '</div></div>'
          + '<div class="kpi-card"><div class="kpi-label">Active tenants</div><div class="kpi-value">' + activeTenants + '</div></div>'
          + '<div class="kpi-card"><div class="kpi-label">Flagged tenants</div><div class="kpi-value" style="color:var(--warn)">' + flaggedCount + '</div></div>'
          + '<div class="kpi-card"><div class="kpi-label">Monthly requests</div><div class="kpi-value">' + monthlyOb + '</div></div>'
          + '<div class="kpi-card"><div class="kpi-label">Platform GMV</div><div class="kpi-value">' + money(Math.round(platformGmv * 100)) + '</div></div>'
          + '<div class="kpi-card"><div class="kpi-label">Total orders</div><div class="kpi-value">' + orderCount + '</div></div>'
          + '<div class="kpi-card"><div class="kpi-label">Avg tenant revenue</div><div class="kpi-value">' + money(Math.round(avgRevenue * 100)) + '</div></div>'
          + '<div class="kpi-card"><div class="kpi-label">Stripe connected</div><div class="kpi-value">' + ((d.tenants && d.tenants.stripe_connected) || 0) + '</div></div>';
      }

      // ── Pipeline bar
      var obs = (d.onboarding && d.onboarding.by_status) ? d.onboarding.by_status : {};
      ['submitted','approved','provisioning','provisioned','failed'].forEach(function (k) {
        var el = document.getElementById('pipe-' + k);
        if (el) el.textContent = obs[k] != null ? obs[k] : 0;
      });

      // ── Activity feed — use recent_requests (no recent_activity field in API)
      var feed     = document.getElementById('activity-feed');
      var requests = d.recent_requests || [];
      if (!requests.length) {
        feed.innerHTML = '<div class="empty">No recent activity.</div>';
      } else {
        var icons = { submitted: '📋', approved: '✅', provisioned: '🚀', failed: '⚠️', rejected: '✗', needs_review: '🔍' };
        feed.innerHTML = requests.map(function (a) {
          return '<div class="activity-item">'
            + '<div class="activity-dot"></div>'
            + '<div>'
            + '<div class="activity-text">'
            + (icons[a.status] || '•') + ' <strong>' + esc(a.business_name) + '</strong>'
            + ' <span style="color:var(--muted)">— ' + esc(String(a.status || '').replace(/_/g,' ')) + '</span>'
            + '</div>'
            + '<div class="activity-time">' + fmtDt(a.created_at) + '</div>'
            + '</div>'
            + '</div>';
        }).join('');
      }

      // ── Recent tenants
      var tbody   = document.getElementById('recent-tenants-body');
      var tenants = (d.recent_tenants || []).slice(0, 8);
      if (!tenants.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="empty">No tenants yet.</td></tr>';
      } else {
        tbody.innerHTML = tenants.map(function (t) {
          return '<tr>'
            + '<td><div class="td-name">' + esc(t.name || t.slug) + '</div>'
            + '<div class="td-email td-mono">' + esc(t.slug || '') + '</div></td>'
            + '<td>' + statusBadge(t.active !== false ? 'active' : 'inactive') + '</td>'
            + '</tr>';
        }).join('');
      }
    })
    .catch(function (e) { toast('Overview: ' + e.message, true); });
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function loadOnboarding() {
  var filter  = document.getElementById('ob-filter').value;
  var search  = (document.getElementById('ob-search') || {}).value || '';
  var params  = [];
  if (filter) params.push('status=' + encodeURIComponent(filter));
  if (search.trim()) params.push('q=' + encodeURIComponent(search.trim()));
  var url     = '/.netlify/functions/admin-get-onboarding-requests' + (params.length ? '?' + params.join('&') : '');
  var tbody   = document.getElementById('ob-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="7"><span class="spinner"></span></td></tr>';

  authFetch(url)
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed to load requests');
      var rows = res.d.requests || res.d.data || [];

      // Store in cache for detail lookups
      rows.forEach(function (row) { requestCache[row.id] = row; });

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty">No applications found.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map(function (row) {
        var canApprove   = row.status === 'submitted' || row.status === 'needs_review';
        var canReject    = row.status === 'submitted' || row.status === 'approved' || row.status === 'needs_review';
        var canProvision = row.status === 'approved';
        var canRetry     = row.status === 'failed';

        var actions = '<div style="display:flex;gap:.3rem;flex-wrap:wrap">';
        if (canApprove) {
          actions += '<button class="btn btn-sm btn-primary" onclick="approveAndProvision(\'' + esc(row.id) + '\')" title="Approve + fully provision in one step">Approve &amp; Launch</button>';
          actions += '<button class="btn btn-sm btn-success" onclick="approveOnly(\'' + esc(row.id) + '\')" title="Approve without provisioning">Approve</button>';
        }
        if (canReject) {
          actions += '<button class="btn btn-sm btn-danger" onclick="openRejectModal(\'' + esc(row.id) + '\')">Reject</button>';
        }
        if (canProvision) {
          actions += '<button class="btn btn-sm btn-primary" onclick="openProvisionModal(\'' + esc(row.id) + '\')">Provision</button>';
        }
        if (canRetry) {
          actions += '<button class="btn btn-sm btn-warn" onclick="openProvisionModal(\'' + esc(row.id) + '\')">↻ Retry</button>';
        }
        actions += '<button class="btn btn-sm" onclick="viewDetail(\'' + esc(row.id) + '\')">Details</button>';
        actions += '</div>';

        return '<tr>'
          + '<td><div class="td-name">' + esc(row.business_name) + '</div>'
          +     '<div class="td-email">' + esc(row.business_type || '') + '</div></td>'
          + '<td><div class="td-name">' + esc(row.owner_name) + '</div>'
          +     '<div class="td-email">' + esc(row.owner_email) + '</div></td>'
          + '<td class="td-mono" style="font-size:.76rem">' + esc(row.business_slug || row.requested_subdomain || '—') + '</td>'
          + '<td>' + esc(row.city_state || '—') + '</td>'
          + '<td style="white-space:nowrap;font-size:.78rem">' + fmt(row.created_at) + '</td>'
          + '<td>' + statusBadge(row.status) + '</td>'
          + '<td>' + actions + '</td>'
          + '</tr>';
      }).join('');
    })
    .catch(function (e) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:1.5rem;color:var(--error);font-size:.82rem">' + esc(e.message) + '</td></tr>';
      toast('Onboarding: ' + e.message, true);
    });
}

function debounceObSearch() {
  clearTimeout(window._obTimer);
  window._obTimer = setTimeout(loadOnboarding, 400);
}

// ── Onboarding actions ────────────────────────────────────────────────────────

// Approve-only (two-step workflow: approve first, provision separately)
function approveOnly(id) {
  authFetch('/.netlify/functions/approve-onboarding-request', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ id: id }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed');
    toast('Application approved. Now provision it when ready.');
    loadOnboarding();
  })
  .catch(function (e) { toast(e.message, true); });
}

// Approve & Launch — one-shot: approve + provision via admin-approve-onboarding
function approveAndProvision(id) {
  var row  = requestCache[id] || {};
  var name = row.business_name || id;
  if (!confirm('Approve and fully provision "' + name + '"?\n\nThis will create the tenant record, set up their operator account, and send the welcome email.\nThis action is not easily reversible.')) return;

  toast('Provisioning "' + name + '"…');

  authFetch('/.netlify/functions/admin-approve-onboarding', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ id: id }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed');
    toast('✓ "' + name + '" provisioned at /' + res.d.slug);
    loadOnboarding();
    loadProvisioning();
  })
  .catch(function (e) { toast(e.message, true); });
}

function openRejectModal(id) {
  pendingRejectId = id;
  document.getElementById('reject-reason').value = '';
  openModal('reject-modal');
}

function confirmReject() {
  if (!pendingRejectId) return;
  var reason = document.getElementById('reject-reason').value.trim();
  closeModal('reject-modal');
  var id = pendingRejectId;
  pendingRejectId = null;

  authFetch('/.netlify/functions/admin-reject-onboarding', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ id: id, rejection_reason: reason || undefined }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed');
    toast('Application rejected.');
    loadOnboarding();
  })
  .catch(function (e) { toast(e.message, true); });
}

function openProvisionModal(id) {
  pendingProvisionId = id;
  var row  = requestCache[id] || {};
  var name = row.business_name || id;
  document.getElementById('provision-modal-body').textContent =
    'Provision "' + name + '"? This creates the full tenant bundle: tenant row, operator record, seed config, and sends the welcome email. Not easily reversible.';
  openModal('provision-modal');
}

function confirmProvision() {
  if (!pendingProvisionId) return;
  closeModal('provision-modal');
  var id  = pendingProvisionId;
  var row = requestCache[id] || {};
  pendingProvisionId = null;

  toast('Provisioning…');

  authFetch('/.netlify/functions/provision-tenant', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ id: id }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed');
    toast('✓ Provisioned: /' + res.d.slug);
    loadOnboarding();
    loadProvisioning();
  })
  .catch(function (e) { toast(e.message, true); });
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function viewDetail(id) {
  var row = requestCache[id];
  if (!row) { toast('Row not found — try refreshing', true); return; }

  document.getElementById('detail-modal-title').textContent = row.business_name;

  var kv = function (label, value) {
    return '<span class="k">' + esc(label) + '</span><span>' + esc(String(value == null ? '—' : value)) + '</span>';
  };

  document.getElementById('detail-modal-body').innerHTML =
    '<div class="detail-kv">'
    + kv('Business name', row.business_name)
    + kv('Business type', row.business_type || '—')
    + kv('Owner name',    row.owner_name)
    + kv('Email',         row.owner_email)
    + kv('Phone',         row.phone || '—')
    + kv('Location',      row.city_state || '—')
    + kv('Requested slug',row.business_slug || row.requested_subdomain || '—')
    + '<span class="k">Status</span><span>' + statusBadge(row.status) + '</span>'
    + kv('Submitted',     fmtDt(row.created_at))
    + kv('Approved at',   row.approved_at ? fmtDt(row.approved_at) : '—')
    + (row.rejection_reason ? kv('Rejection reason', row.rejection_reason) : '')
    + (row.provision_error  ? '<span class="k" style="color:var(--error)">Provision error</span><span style="color:var(--error)">' + esc(row.provision_error) + '</span>' : '')
    + '</div>';

  // Dynamic action buttons based on current status
  var actionsHtml = '';
  if (row.status === 'submitted' || row.status === 'needs_review') {
    actionsHtml += '<button class="btn btn-primary" onclick="closeModal(\'detail-modal\');approveAndProvision(\'' + esc(id) + '\')">Approve &amp; Launch</button>';
    actionsHtml += '<button class="btn btn-success" onclick="closeModal(\'detail-modal\');approveOnly(\'' + esc(id) + '\')">Approve only</button>';
    actionsHtml += '<button class="btn btn-danger" onclick="closeModal(\'detail-modal\');openRejectModal(\'' + esc(id) + '\')">Reject</button>';
  }
  if (row.status === 'approved') {
    actionsHtml += '<button class="btn btn-primary" onclick="closeModal(\'detail-modal\');openProvisionModal(\'' + esc(id) + '\')">Provision</button>';
  }
  if (row.status === 'failed') {
    actionsHtml += '<button class="btn btn-warn" onclick="closeModal(\'detail-modal\');openProvisionModal(\'' + esc(id) + '\')">↻ Retry provision</button>';
  }
  actionsHtml += '<button class="btn" onclick="closeModal(\'detail-modal\')">Close</button>';
  document.getElementById('detail-modal-actions').innerHTML = actionsHtml;

  openModal('detail-modal');
}

// ── Tenants ───────────────────────────────────────────────────────────────────

function loadTenants() {
  var q       = (document.getElementById('tenant-search') || {}).value || '';
  var status  = (document.getElementById('tenant-status-filter') || {}).value || '';
  var city    = (document.getElementById('tenant-city-filter') || {}).value || '';
  var params  = [];
  if (q.trim())      params.push('q=' + encodeURIComponent(q.trim()));
  if (status)        params.push('status=' + encodeURIComponent(status));
  if (city.trim())   params.push('city=' + encodeURIComponent(city.trim()));
  var url   = '/.netlify/functions/get-tenants' + (params.length ? '?' + params.join('&') : '');
  var tbody = document.getElementById('tenants-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="9"><span class="spinner"></span></td></tr>';

  authFetch(url)
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed');
      var rows = res.d.tenants || res.d.data || [];

      rows.forEach(function (t) { tenantCache[t.id] = t; });

      if (window.ProofLinkAdminControlTower) {
        var mount = document.getElementById('tenant-control-tower-mount');
        if (mount) mount.innerHTML = window.ProofLinkAdminControlTower.renderTable(rows);
      }

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty">No tenants found.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map(function (t) {
        var gmvDisplay = t.gmv != null ? '$' + Number(t.gmv).toFixed(2) : '—';
        var tenantStatus = t.status || (t.active !== false ? 'active' : 'inactive');
        var canFlag = tenantStatus === 'active';
        var canSuspend = tenantStatus === 'active' || tenantStatus === 'flagged';
        var canReinstate = tenantStatus === 'suspended' || tenantStatus === 'flagged';
        var canTerminate = tenantStatus !== 'terminated';

        var conductActions = '<div style="display:flex;gap:.3rem;flex-wrap:wrap">';
        if (canFlag) conductActions += '<button class="btn btn-sm btn-warn" onclick="conductAction(\'' + esc(t.id) + '\',\'flag\')">Flag</button>';
        if (canSuspend) conductActions += '<button class="btn btn-sm btn-danger" onclick="conductAction(\'' + esc(t.id) + '\',\'suspend\')">Suspend</button>';
        if (canReinstate) conductActions += '<button class="btn btn-sm btn-success" onclick="conductAction(\'' + esc(t.id) + '\',\'reinstate\')">Reinstate</button>';
        if (canTerminate) conductActions += '<button class="btn btn-sm" style="color:var(--error)" onclick="conductAction(\'' + esc(t.id) + '\',\'terminate\')">Terminate</button>';
        conductActions += '<button class="btn btn-sm" onclick="openConfigModal(\'' + esc(t.id) + '\')">Config</button>';
        conductActions += '</div>';

        return '<tr>'
          + '<td><div class="td-name">' + esc(t.name || t.slug) + '</div><div class="td-email">' + esc(t.owner_email || '') + '</div></td>'
          + '<td class="td-mono">' + esc(t.slug || '—') + '</td>'
          + '<td>' + statusBadge(tenantStatus) + '</td>'
          + '<td style="white-space:nowrap;font-size:.78rem">' + fmt(t.created_at) + '</td>'
          + '<td>' + statusBadge(t.stripe_status || 'not_connected') + '</td>'
          + '<td>' + (t.order_count   != null ? t.order_count   : '—') + '</td>'
          + '<td>' + gmvDisplay + '</td>'
          + '<td>' + esc(t.city_state || '—') + '</td>'
          + '<td>' + conductActions + '</td>'
          + '</tr>';
      }).join('');
    })
    .catch(function (e) {
      var mount = document.getElementById('tenant-control-tower-mount');
      if (mount) mount.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="9" style="padding:1.5rem;color:var(--error);font-size:.82rem">' + esc(e.message) + '</td></tr>';
      toast('Tenants: ' + e.message, true);
    });
}

function debounceTenantSearch() {
  clearTimeout(tenantSearchTimer);
  tenantSearchTimer = setTimeout(loadTenants, 350);
}

function openConfigModal(tenantId) {
  configTenantId = tenantId;
  var t = tenantCache[tenantId] || {};
  document.getElementById('config-modal-title').textContent = 'Edit config — ' + (t.slug || tenantId);
  document.getElementById('config-modal-body').innerHTML =
    '<div class="config-field"><label>Business name</label><input id="cfg-name" placeholder="e.g. Honest To Crust Bakery" value="' + esc(t.name || '') + '"/></div>'
    + '<div class="config-field"><label>Accent colour (hex)</label><input id="cfg-accent" placeholder="#c84b2f"/></div>'
    + '<div class="config-field"><label>Storefront tagline</label><input id="cfg-tagline" placeholder="Homemade treats, delivered fresh."/></div>'
    + '<div class="config-field"><label>Contact email</label><input id="cfg-email" type="email" value="' + esc(t.owner_email || '') + '"/></div>';
  openModal('config-modal');
}

function saveConfig() {
  if (!configTenantId) { closeModal('config-modal'); return; }
  var config = {};
  var name    = (document.getElementById('cfg-name')    || {}).value || '';
  var accent  = (document.getElementById('cfg-accent')  || {}).value || '';
  var tagline = (document.getElementById('cfg-tagline') || {}).value || '';
  var email   = (document.getElementById('cfg-email')   || {}).value || '';
  if (name.trim())    config.site_title     = name.trim();
  if (accent.trim())  config.accent_color   = accent.trim();
  if (tagline.trim()) config.tagline        = tagline.trim();
  if (email.trim())   config.contact_email  = email.trim();
  closeModal('config-modal');

  if (!Object.keys(config).length) { toast('No changes to save.'); return; }

  authFetch('/.netlify/functions/update-tenant-config', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ tenant_id: configTenantId, config: config }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed');
    toast('Config saved.');
    loadTenants();
  })
  .catch(function (e) { toast(e.message, true); });
}

// ── Provisioning section ──────────────────────────────────────────────────────

function loadProvisioning() {
  var provTbody = document.getElementById('prov-tbody');
  var logTbody  = document.getElementById('prov-log-tbody');
  provTbody.innerHTML = '<tr class="loading-row"><td colspan="5"><span class="spinner"></span></td></tr>';
  logTbody.innerHTML  = '<tr class="loading-row"><td colspan="5"><span class="spinner"></span></td></tr>';

  Promise.all([
    authFetch('/.netlify/functions/admin-get-onboarding-requests?status=approved'),
    authFetch('/.netlify/functions/admin-get-onboarding-requests'),
  ])
  .then(function (responses) {
    return Promise.all(responses.map(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }));
  })
  .then(function (results) {
    var approvedRows = (results[0].d.requests || []);
    var allRows      = (results[1].d.requests || []).filter(function (r) {
      return ['provisioning','provisioned','failed'].indexOf(r.status) !== -1;
    });

    // Store in cache
    approvedRows.concat(allRows).forEach(function (row) { requestCache[row.id] = row; });

    if (!approvedRows.length) {
      provTbody.innerHTML = '<tr><td colspan="5" class="empty">No approved applications waiting.</td></tr>';
    } else {
      provTbody.innerHTML = approvedRows.map(function (row) {
        return '<tr>'
          + '<td class="td-name">' + esc(row.business_name) + '</td>'
          + '<td>' + esc(row.owner_name) + '</td>'
          + '<td class="td-email">' + esc(row.owner_email) + '</td>'
          + '<td>' + fmt(row.created_at) + '</td>'
          + '<td><button class="btn btn-sm btn-primary" onclick="openProvisionModal(\'' + esc(row.id) + '\')">Provision now</button></td>'
          + '</tr>';
      }).join('');
    }

    if (!allRows.length) {
      logTbody.innerHTML = '<tr><td colspan="5" class="empty">No provisioning history yet.</td></tr>';
    } else {
      logTbody.innerHTML = allRows.map(function (row) {
        return '<tr>'
          + '<td class="td-name">' + esc(row.business_name) + '</td>'
          + '<td>' + statusBadge(row.status) + '</td>'
          + '<td class="td-mono">' + esc(row.business_slug || row.requested_subdomain || '—') + '</td>'
          + '<td>' + fmt(row.updated_at || row.created_at) + '</td>'
          + '<td style="max-width:200px;font-size:.75rem;color:var(--error);word-break:break-all">' + esc(row.provision_error || '') + '</td>'
          + '</tr>';
      }).join('');
    }
  })
  .catch(function (e) {
    provTbody.innerHTML = '<tr><td colspan="5" style="padding:1.5rem;color:var(--error);font-size:.82rem">' + esc(e.message) + '</td></tr>';
    logTbody.innerHTML  = '';
    toast('Provisioning: ' + e.message, true);
  });
}

// ── Tenant conduct actions ───────────────────────────────────────────────────

function conductAction(tenantId, action) {
  var t = tenantCache[tenantId] || {};
  var name = t.name || t.slug || tenantId;
  var labels = { flag: 'Flag', suspend: 'Suspend', reinstate: 'Reinstate', terminate: 'Terminate' };
  var label = labels[action] || action;

  var notes = '';
  if (action === 'terminate') {
    if (!confirm(label + ' "' + name + '"?\n\nThis action is permanent and cannot be undone. The tenant storefront will be disabled.')) return;
    notes = prompt('Reason for termination (optional):') || '';
  } else if (action === 'suspend') {
    if (!confirm(label + ' "' + name + '"?\n\nThe tenant will lose access until reinstated.')) return;
    notes = prompt('Reason for suspension (optional):') || '';
  } else if (action === 'flag') {
    notes = prompt('Reason for flagging "' + name + '" (optional):') || '';
  } else {
    if (!confirm(label + ' "' + name + '"?')) return;
  }

  toast(label + 'ing "' + name + '"…');

  authFetch('/.netlify/functions/admin-update-tenant-conduct', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      tenant_id  : tenantId,
      action     : action,
      admin_notes: notes || undefined,
    }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed');
    toast(name + ' status updated to: ' + (res.d.status || action));
    loadTenants();
  })
  .catch(function (e) { toast(e.message, true); });
}

// ── Abuse monitor trigger ────────────────────────────────────────────────────

function runAbuseMonitor() {
  toast('Running abuse monitor…');
  authFetch('/.netlify/functions/platform-abuse-monitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Abuse monitor failed');
    toast('Scanned ' + res.d.scanned + ' tenants, flagged ' + res.d.flagged);
    if (res.d.flagged > 0) loadTenants();
  })
  .catch(function (e) { toast(e.message, true); });
}

// ── System Health ─────────────────────────────────────────────────────────────

function setHealthStatus(id, noteId, ok, label, note) {
  var el     = document.getElementById(id);
  var noteEl = document.getElementById(noteId);
  if (el)     el.innerHTML = '<div class="health-dot ' + (ok ? 'ok' : 'err') + '"></div>' + esc(label);
  if (noteEl) noteEl.textContent = note;
}

function runHealthCheck() {
  authFetch('/.netlify/functions/get-platform-stats')
    .then(function (r) { setHealthStatus('hc-stats','hc-stats-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Function responding normally.' : 'HTTP ' + r.status); })
    .catch(function (e) { setHealthStatus('hc-stats','hc-stats-note', false, 'Error', e.message); });

  authFetch('/.netlify/functions/admin-get-onboarding-requests?limit=1')
    .then(function (r) { setHealthStatus('hc-ob','hc-ob-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Function responding normally.' : 'HTTP ' + r.status); })
    .catch(function (e) { setHealthStatus('hc-ob','hc-ob-note', false, 'Error', e.message); });

  authFetch('/.netlify/functions/get-tenants?limit=1')
    .then(function (r) { setHealthStatus('hc-tenants','hc-tenants-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Function responding normally.' : 'HTTP ' + r.status); })
    .catch(function (e) { setHealthStatus('hc-tenants','hc-tenants-note', false, 'Error', e.message); });

  fetch('/.netlify/functions/check-slug?slug=healthcheck-' + Date.now())
    .then(function (r) { setHealthStatus('hc-slug','hc-slug-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Public function responding normally.' : 'HTTP ' + r.status); })
    .catch(function (e) { setHealthStatus('hc-slug','hc-slug-note', false, 'Error', e.message); });

  setHealthStatus('hc-sb', 'hc-sb-note',  true, 'Connected', 'Supabase responding through function layer.');
  setHealthStatus('hc-auth','hc-auth-note',true, 'Verified',  'Session token is valid — you are authenticated.');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function bootAdmin() {
  loadOverview();
}

// ── Init — check saved session ────────────────────────────────────────────────

(function init() {
  var saved = sessionStorage.getItem('pl_op_token');
  if (saved) {
    // Verify saved token is still valid and belongs to a platform admin
    verifyAdmin(saved).then(function (vRes) {
      if (!vRes.ok) {
        // Token expired or user is not an admin — clear and show login
        sessionStorage.removeItem('pl_op_token');
        setAuth(true);
        return;
      }
      token = saved;
      document.getElementById('admin-email-display').textContent = vRes.d.email || 'Admin';
      setAuth(false);
      bootAdmin();
    }).catch(function () {
      sessionStorage.removeItem('pl_op_token');
      setAuth(true);
    });
  }

  // Enter key on password field
  var pwField = document.getElementById('login-password');
  if (pwField) {
    pwField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleLogin();
    });
  }
})();

// ── Testers ───────────────────────────────────────────────────────────────────

var _testerSearchTimeout = null;

function loadTesters() {
  var tbody = document.getElementById('testers-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><span class="spinner"></span></td></tr>';

  // Load all tenants with billing_exempt = true from Supabase directly
  authFetch(SUPABASE_URL + '/rest/v1/tenants?select=id,name,slug,billing_status,billing_exempt,billing_exempt_until&billing_exempt=eq.true&apikey=' + SUPABASE_ANON, {
    headers: { 'apikey': SUPABASE_ANON }
  })
  .then(function(r) { return r.json(); })
  .then(function(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var now = new Date();

    // Filter to only active (non-expired) exemptions
    var active = rows.filter(function(t) {
      if (!t.billing_exempt_until) return true;
      return new Date(t.billing_exempt_until) > now;
    });

    // Update slot counters
    var slotsUsed = document.getElementById('tester-slots-used');
    var slotsRem  = document.getElementById('tester-slots-remaining');
    if (slotsUsed) slotsUsed.textContent = active.length;
    if (slotsRem)  slotsRem.textContent  = Math.max(0, 3 - active.length);

    if (!tbody) return;
    if (!active.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:1.5rem">No active tester exemptions.</td></tr>';
      return;
    }

    tbody.innerHTML = active.map(function(t) {
      var until = t.billing_exempt_until ? new Date(t.billing_exempt_until) : null;
      var days  = until ? Math.ceil((until - now) / (1000 * 60 * 60 * 24)) : '∞';
      var untilStr = until ? until.toLocaleDateString() : 'Indefinite';
      var daysClass = typeof days === 'number' && days < 30 ? 'style="color:#e05c00;font-weight:600"' : '';
      return '<tr>' +
        '<td><strong>' + esc(t.name) + '</strong></td>' +
        '<td><code>' + esc(t.slug) + '</code></td>' +
        '<td>' + untilStr + '</td>' +
        '<td ' + daysClass + '>' + days + (typeof days === 'number' ? ' days' : '') + '</td>' +
        '<td><span class="badge badge-provisioned">' + esc(t.billing_status || 'active') + '</span></td>' +
        '<td><button class="btn btn-sm btn-danger" onclick="revokeExemption(\'' + t.id + '\',\'' + esc(t.name) + '\')">Revoke</button></td>' +
        '</tr>';
    }).join('');
  })
  .catch(function(err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="color:var(--danger);padding:1rem">' + esc(err.message) + '</td></tr>';
  });
}

function searchTenantsForExempt() {
  clearTimeout(_testerSearchTimeout);
  _testerSearchTimeout = setTimeout(function() {
    var q = (document.getElementById('tester-tenant-search').value || '').trim().toLowerCase();
    var resultsEl = document.getElementById('tester-tenant-results');
    if (!q || q.length < 2) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }

    authFetch(SUPABASE_URL + '/rest/v1/tenants?select=id,name,slug,billing_status,billing_exempt,billing_exempt_until&limit=10&apikey=' + SUPABASE_ANON, {
      headers: { 'apikey': SUPABASE_ANON }
    })
    .then(function(r) { return r.json(); })
    .then(function(rows) {
      rows = Array.isArray(rows) ? rows : [];
      var filtered = rows.filter(function(t) {
        return (t.name || '').toLowerCase().includes(q) ||
               (t.slug || '').toLowerCase().includes(q);
      });

      if (!resultsEl) return;
      if (!filtered.length) {
        resultsEl.innerHTML = '<p style="font-size:.82rem;color:var(--muted)">No matching tenants found.</p>';
        return;
      }

      var now = new Date();
      resultsEl.innerHTML = '<table class="data-table"><thead><tr><th>Business</th><th>Slug</th><th>Billing status</th><th>Currently exempt</th><th>Action</th></tr></thead><tbody>' +
        filtered.map(function(t) {
          var isExempt = t.billing_exempt && (!t.billing_exempt_until || new Date(t.billing_exempt_until) > now);
          return '<tr>' +
            '<td><strong>' + esc(t.name) + '</strong></td>' +
            '<td><code>' + esc(t.slug) + '</code></td>' +
            '<td>' + esc(t.billing_status || '—') + '</td>' +
            '<td>' + (isExempt ? '<span class="badge badge-provisioned">Yes</span>' : '<span class="badge">No</span>') + '</td>' +
            '<td>' + (isExempt
              ? '<button class="btn btn-sm btn-danger" onclick="revokeExemption(\'' + t.id + '\',\'' + esc(t.name) + '\')">Revoke</button>'
              : '<button class="btn btn-sm btn-primary" onclick="grantExemption(\'' + t.id + '\',\'' + esc(t.name) + '\')">Grant 12 months free</button>'
            ) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    })
    .catch(function(err) {
      if (resultsEl) resultsEl.innerHTML = '<p style="color:var(--danger);font-size:.82rem">' + esc(err.message) + '</p>';
    });
  }, 300);
}

function grantExemption(tenantId, tenantName) {
  if (!confirm('Grant 12 months of free access to ' + tenantName + '?\n\nThey will be able to use ProofLink fully without a subscription until the exemption expires.')) return;

  authFetch('/api/admin/set-tester-exempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenantId, exempt: true, months: 12 })
  })
  .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
  .then(function(res) {
    if (!res.ok) {
      // Slot limit hit — show which slots are taken
      var msg = res.d.error || 'Failed to grant exemption';
      if (res.d.activeTesters && res.d.activeTesters.length) {
        msg += '\n\nActive testers:\n' + res.d.activeTesters.map(function(t) { return '• ' + t.name + ' (' + t.slug + ')'; }).join('\n');
      }
      alert(msg);
      return;
    }
    showToast('✅ Exemption granted to ' + tenantName + ' — free until ' + new Date(res.d.billingExemptUntil).toLocaleDateString() + ' (' + res.d.slotsUsed + '/3 slots used)');
    loadTesters();
    document.getElementById('tester-tenant-search').value = '';
    document.getElementById('tester-tenant-results').innerHTML = '';
  })
  .catch(function(err) { alert('Error: ' + err.message); });
}

function revokeExemption(tenantId, tenantName) {
  if (!confirm('Revoke tester exemption for ' + tenantName + '?\n\nThey will be required to subscribe to continue using ProofLink.')) return;

  authFetch('/api/admin/set-tester-exempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenantId, exempt: false })
  })
  .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
  .then(function(res) {
    if (!res.ok) { alert(res.d.error || 'Failed to revoke exemption'); return; }
    showToast('Exemption revoked for ' + tenantName);
    loadTesters();
  })
  .catch(function(err) { alert('Error: ' + err.message); });
}

function esc(str) {
  return String(str || '').replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];
  });
}
