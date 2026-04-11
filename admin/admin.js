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
var notifyTenantId     = null;
var tenantSearchTimer  = null;
var _auditLogOffset    = 0;

// Row data caches — keyed by id so onclick handlers only pass safe UUIDs
var requestCache = {};
var tenantCache  = {};

// Bulk selection for tenant conduct actions
var selectedTenants = {};

// Bulk selection for onboarding requests
var selectedOb = {};

// Internal AI control state
var aiControlState = {
  agents: [],
  tenants: [],
  selectedTenantId: '',
  workforceReport: null,
  systemsReport: null,
};

// In-flight guard — prevents double-submitting async operations
var _inFlight = {};

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
  });
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
      if (r.status === 401) {
        sessionStorage.removeItem('pl_op_token');
        setAuth(true);
        throw new Error('Session expired. Please sign in again.');
      }
      if (r.status === 403) {
        throw new Error('Access denied. You do not have permission to perform this action.');
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
  if (id === 'audit-log')    loadAuditLog();
  if (id === 'billing')      loadBilling();
  if (id === 'ai-control')   loadAiControl();
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
          + '<div class="kpi-card"><div class="kpi-label">Manual-ready tenants</div><div class="kpi-value">' + ((d.tenants && d.tenants.stripe_connected) || 0) + '</div></div>';
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
  selectedOb = {};
  updateObBulkBar();
  var saOb = document.getElementById('select-all-ob');
  if (saOb) saOb.checked = false;
  tbody.innerHTML = '<tr class="loading-row"><td colspan="8"><span class="spinner"></span></td></tr>';

  authFetch(url)
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed to load requests');
      var rows = res.d.requests || res.d.data || [];

      // Store in cache for detail lookups
      rows.forEach(function (row) { requestCache[row.id] = row; });

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty">No applications found.</td></tr>';
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
        actions += '<button class="btn btn-sm btn-danger" onclick="deleteOnboardingRequest(\'' + esc(row.id) + '\')" title="Hard-delete this request">🗑</button>';
        actions += '</div>';

        return '<tr>'
          + '<td><input type="checkbox" onchange="toggleObSelect(\'' + esc(row.id) + '\',this.checked)" data-ob-cb="' + esc(row.id) + '"/></td>'
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
      tbody.innerHTML = '<tr><td colspan="8" style="padding:1.5rem;color:var(--error);font-size:.82rem">' + esc(e.message) + '</td></tr>';
      toast('Onboarding: ' + e.message, true);
    });
}

function debounceObSearch() {
  clearTimeout(window._obTimer);
  window._obTimer = setTimeout(loadOnboarding, 400);
}

// ── Onboarding bulk selection ─────────────────────────────────────────────────

function toggleObSelect(id, checked) {
  if (checked) selectedOb[id] = true;
  else         delete selectedOb[id];
  updateObBulkBar();
}

function selectAllOb(checked) {
  document.querySelectorAll('[data-ob-cb]').forEach(function (cb) {
    cb.checked = checked;
    if (checked) selectedOb[cb.dataset.obCb] = true;
    else         delete selectedOb[cb.dataset.obCb];
  });
  updateObBulkBar();
}

function clearObSelection() {
  selectedOb = {};
  document.querySelectorAll('[data-ob-cb]').forEach(function (cb) { cb.checked = false; });
  var sa = document.getElementById('select-all-ob');
  if (sa) sa.checked = false;
  updateObBulkBar();
}

function updateObBulkBar() {
  var bar = document.getElementById('ob-bulk-bar');
  if (!bar) return;
  var count = Object.keys(selectedOb).length;
  if (count === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  var el = document.getElementById('ob-bulk-count');
  if (el) el.textContent = count + ' request' + (count === 1 ? '' : 's') + ' selected';
}

// ── Onboarding delete ─────────────────────────────────────────────────────────

function deleteOnboardingRequest(id) {
  var row = requestCache[id] || {};
  var name = row.business_name || id;
  if (!confirm('Permanently delete the application from "' + name + '"?\n\nThis removes the submission from the database. It cannot be undone.')) return;
  if (_inFlight['ob-delete:' + id]) return;
  _inFlight['ob-delete:' + id] = true;

  authFetch('/.netlify/functions/admin-delete-onboarding-requests', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ ids: [id] }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Delete failed');
    toast('Application deleted.');
    loadOnboarding();
  })
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['ob-delete:' + id]; });
}

function bulkDeleteOnboardingRequests() {
  var ids = Object.keys(selectedOb);
  if (!ids.length) return;
  if (!confirm('Permanently delete ' + ids.length + ' selected application' + (ids.length === 1 ? '' : 's') + '?\n\nThis cannot be undone.')) return;
  if (_inFlight['ob-bulk-delete']) return;
  _inFlight['ob-bulk-delete'] = true;
  toast('Deleting ' + ids.length + ' application' + (ids.length === 1 ? '' : 's') + '…');

  authFetch('/.netlify/functions/admin-delete-onboarding-requests', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ ids: ids }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Delete failed');
    toast('✓ Deleted ' + (res.d.deleted || ids.length) + ' application' + (ids.length === 1 ? '' : 's'));
    clearObSelection();
    loadOnboarding();
  })
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['ob-bulk-delete']; });
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
  if (_inFlight['approve:' + id]) return;
  var row  = requestCache[id] || {};
  var name = row.business_name || id;
  if (!confirm('Approve and fully provision "' + name + '"?\n\nThis will create the tenant record, set up their operator account, and send the welcome email.\nThis action is not easily reversible.')) return;

  _inFlight['approve:' + id] = true;
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
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['approve:' + id]; });
}

function openRejectModal(id) {
  pendingRejectId = id;
  document.getElementById('reject-reason').value = '';
  openModal('reject-modal');
}

function confirmReject() {
  if (!pendingRejectId) return;
  if (_inFlight['reject:' + pendingRejectId]) return;
  var reason = document.getElementById('reject-reason').value.trim();
  closeModal('reject-modal');
  var id = pendingRejectId;
  pendingRejectId = null;
  _inFlight['reject:' + id] = true;

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
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['reject:' + id]; });
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
  if (_inFlight['provision:' + pendingProvisionId]) return;
  closeModal('provision-modal');
  var id  = pendingProvisionId;
  var row = requestCache[id] || {};
  pendingProvisionId = null;
  _inFlight['provision:' + id] = true;

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
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['provision:' + id]; });
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function viewDetail(id) {
  var row = requestCache[id];
  if (!row) { toast('Row not found — try refreshing', true); return; }

  document.getElementById('detail-modal-title').textContent = row.business_name;

  var kv = function (label, value) {
    return '<span class="k">' + esc(label) + '</span><span>' + esc(String(value == null ? '—' : value)) + '</span>';
  };

  var riskBadgeMap = { low: 'badge-provisioned', medium: 'badge-approved', high: 'badge-submitted', critical: 'badge-danger' };
  var riskHtml = row.risk_level
    ? '<span class="k">Risk level</span><span><span class="badge ' + (riskBadgeMap[row.risk_level] || 'badge-submitted') + '">' + esc(row.risk_level) + '</span></span>'
    : '';
  var reasonHtml = (row.reason_codes && row.reason_codes.length)
    ? kv('Reason codes', row.reason_codes.join(', '))
    : '';

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
    + riskHtml
    + reasonHtml
    + kv('Submitted',     fmtDt(row.created_at))
    + kv('Approved at',   row.approved_at ? fmtDt(row.approved_at) : '—')
    + (row.rejection_reason ? kv('Rejection reason', row.rejection_reason) : '')
    + (row.provision_error  ? '<span class="k" style="color:var(--error)">Provision error</span><span style="color:var(--error);word-break:break-all">' + esc(row.provision_error) + '</span>' : '')
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
  selectedTenants = {};
  updateBulkBar();
  var saEl = document.getElementById('select-all-tenants');
  if (saEl) saEl.checked = false;
  var tbody = document.getElementById('tenants-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="10"><span class="spinner"></span></td></tr>';

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
        tbody.innerHTML = '<tr><td colspan="10" class="empty">No tenants found.</td></tr>';
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
        if (canFlag)      conductActions += '<button class="btn btn-sm btn-warn"    onclick="conductAction(\'' + esc(t.id) + '\',\'flag\')">Flag</button>';
        if (canSuspend)   conductActions += '<button class="btn btn-sm btn-danger"  onclick="conductAction(\'' + esc(t.id) + '\',\'suspend\')">Suspend</button>';
        if (canReinstate) conductActions += '<button class="btn btn-sm btn-success" onclick="conductAction(\'' + esc(t.id) + '\',\'reinstate\')">Reinstate</button>';
        if (canTerminate) conductActions += '<button class="btn btn-sm" style="color:var(--error)" onclick="conductAction(\'' + esc(t.id) + '\',\'terminate\')">Terminate</button>';
        conductActions += '<button class="btn btn-sm" onclick="openConfigModal(\''   + esc(t.id) + '\')">Config</button>';
        conductActions += '<button class="btn btn-sm" onclick="openTenantDetail(\'' + esc(t.id) + '\')">View</button>';
        conductActions += '<button class="btn btn-sm" onclick="openNotifyModal(\''  + esc(t.id) + '\')">Notify</button>';
        conductActions += '<button class="btn btn-sm" onclick="sendPasswordReset(\'' + esc(t.id) + '\')" title="Send password reset email to owner">Reset PW</button>';
        conductActions += '<button class="btn btn-sm btn-danger" onclick="deleteTenant(\'' + esc(t.id) + '\')" title="Hard-delete this business">🗑</button>';
        conductActions += '</div>';

        return '<tr>'
          + '<td><input type="checkbox" onchange="toggleTenantSelect(\'' + esc(t.id) + '\',this.checked)" data-tenant-cb="' + esc(t.id) + '"/></td>'
          + '<td><div class="td-name">' + esc(t.name || t.slug) + '</div><div class="td-email">' + esc(t.owner_email || '') + '</div></td>'
          + '<td class="td-mono">' + esc(t.slug || '—') + '</td>'
          + '<td>' + statusBadge(tenantStatus) + '</td>'
          + '<td style="white-space:nowrap;font-size:.78rem">' + fmt(t.created_at) + '</td>'
          + '<td>' + statusBadge(t.stripe_status || 'manual') + '</td>'
          + '<td>' + (t.order_count != null ? t.order_count : '—') + '</td>'
          + '<td>' + gmvDisplay + '</td>'
          + '<td>' + esc(t.city_state || '—') + '</td>'
          + '<td>' + conductActions + '</td>'
          + '</tr>';
      }).join('');
    })
    .catch(function (e) {
      var mount = document.getElementById('tenant-control-tower-mount');
      if (mount) mount.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="10" style="padding:1.5rem;color:var(--error);font-size:.82rem">' + esc(e.message) + '</td></tr>';
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
  if (_inFlight['config:' + configTenantId]) return;
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

  var tid = configTenantId;
  _inFlight['config:' + tid] = true;

  authFetch('/.netlify/functions/update-tenant-config', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ tenant_id: tid, config: config }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed');
    toast('Config saved.');
    loadTenants();
  })
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['config:' + tid]; });
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
  if (_inFlight['conduct:' + tenantId + ':' + action]) return;
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

  _inFlight['conduct:' + tenantId + ':' + action] = true;
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
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['conduct:' + tenantId + ':' + action]; });
}

// ── Bulk conduct actions ──────────────────────────────────────────────────────

function toggleTenantSelect(tenantId, checked) {
  if (checked) {
    selectedTenants[tenantId] = true;
  } else {
    delete selectedTenants[tenantId];
  }
  updateBulkBar();
}

function selectAllTenants(checked) {
  document.querySelectorAll('[data-tenant-cb]').forEach(function (cb) {
    cb.checked = checked;
    if (checked) selectedTenants[cb.dataset.tenantCb] = true;
    else         delete selectedTenants[cb.dataset.tenantCb];
  });
  updateBulkBar();
}

function clearBulkSelection() {
  selectedTenants = {};
  document.querySelectorAll('[data-tenant-cb]').forEach(function (cb) { cb.checked = false; });
  var sa = document.getElementById('select-all-tenants');
  if (sa) sa.checked = false;
  updateBulkBar();
}

function updateBulkBar() {
  var bar = document.getElementById('bulk-action-bar');
  if (!bar) return;
  var count = Object.keys(selectedTenants).length;
  if (count === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  var countEl = document.getElementById('bulk-count');
  if (countEl) countEl.textContent = count + ' tenant' + (count === 1 ? '' : 's') + ' selected';
}

function bulkConductAction(action) {
  var ids = Object.keys(selectedTenants);
  if (!ids.length) return;
  var labels = { flag: 'Flag', suspend: 'Suspend', reinstate: 'Reinstate', terminate: 'Terminate' };
  var label = labels[action] || action;
  if (!confirm(label + ' ' + ids.length + ' selected tenant' + (ids.length === 1 ? '' : 's') + '?\n\nThis applies "' + action + '" to all selected tenants.')) return;

  var notes = '';
  if (action === 'suspend' || action === 'terminate' || action === 'flag') {
    notes = prompt('Reason (optional — applies to all selected):') || '';
  }

  toast(label + 'ing ' + ids.length + ' tenants…');
  var key = 'bulk:' + action;
  if (_inFlight[key]) return;
  _inFlight[key] = true;

  var promises = ids.map(function (id) {
    return authFetch('/.netlify/functions/admin-update-tenant-conduct', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ tenant_id: id, action: action, admin_notes: notes || undefined }),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, id: id, d: d }; }); });
  });

  Promise.allSettled(promises).then(function (results) {
    var failed = results.filter(function (r) { return r.status === 'rejected' || (r.value && !r.value.ok); });
    if (failed.length === 0) {
      toast('✓ ' + label + 'd ' + ids.length + ' tenant' + (ids.length === 1 ? '' : 's'));
    } else {
      toast(failed.length + ' of ' + ids.length + ' actions failed — check individual tenants', true);
    }
    clearBulkSelection();
    loadTenants();
  }).finally(function () { delete _inFlight[key]; });
}

// ── Tenant delete ─────────────────────────────────────────────────────────────

function deleteTenant(tenantId) {
  var t    = tenantCache[tenantId] || {};
  var name = t.name || t.slug || tenantId;
  var hasOrders = t.order_count && t.order_count > 0;
  var msg  = 'Permanently delete "' + name + '"?\n\nThis removes the business and all its records from the database. This CANNOT be undone.';
  if (hasOrders) msg += '\n\n⚠ This tenant has ' + t.order_count + ' orders. Type CONFIRM to force-delete anyway.';

  if (hasOrders) {
    var confirmed = prompt(msg);
    if (confirmed !== 'CONFIRM') { toast('Deletion cancelled.'); return; }
  } else {
    if (!confirm(msg)) return;
  }

  if (_inFlight['delete:' + tenantId]) return;
  _inFlight['delete:' + tenantId] = true;
  toast('Deleting "' + name + '"…');

  authFetch('/.netlify/functions/admin-delete-tenants', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ tenant_ids: [tenantId], force: hasOrders }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Delete failed');
    toast('✓ "' + name + '" deleted.');
    loadTenants();
  })
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['delete:' + tenantId]; });
}

function bulkDeleteTenants() {
  var ids = Object.keys(selectedTenants);
  if (!ids.length) return;

  // Check if any selected tenants have orders
  var withOrders = ids.filter(function (id) { return tenantCache[id] && tenantCache[id].order_count > 0; });
  var force = false;

  var msg = 'Permanently delete ' + ids.length + ' selected business' + (ids.length === 1 ? '' : 'es') + '?\n\nThis removes all records from the database and CANNOT be undone.';
  if (withOrders.length) {
    var names = withOrders.map(function (id) { return tenantCache[id].name || id; }).join(', ');
    var typed = prompt(msg + '\n\n⚠ ' + withOrders.length + ' of these have orders: ' + names + '\n\nType CONFIRM to force-delete all anyway:');
    if (typed !== 'CONFIRM') { toast('Deletion cancelled.'); return; }
    force = true;
  } else {
    if (!confirm(msg)) return;
  }

  if (_inFlight['bulk-delete-tenants']) return;
  _inFlight['bulk-delete-tenants'] = true;
  toast('Deleting ' + ids.length + ' business' + (ids.length === 1 ? '' : 'es') + '…');

  authFetch('/.netlify/functions/admin-delete-tenants', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ tenant_ids: ids, force: force }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Delete failed');
    var d = res.d;
    if (d.failed > 0) {
      toast(d.deleted + ' deleted, ' + d.failed + ' failed — check individual tenants', true);
    } else {
      toast('✓ Deleted ' + d.deleted + ' business' + (d.deleted === 1 ? '' : 'es'));
    }
    clearBulkSelection();
    loadTenants();
  })
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['bulk-delete-tenants']; });
}

// ── Password reset ────────────────────────────────────────────────────────────

function sendPasswordReset(tenantId) {
  var t    = tenantCache[tenantId] || {};
  var name = t.name || t.slug || tenantId;
  var email = t.owner_email || '(unknown email)';
  if (!confirm('Send a password reset email to ' + email + ' (' + name + ')?')) return;
  if (_inFlight['reset:' + tenantId]) return;
  _inFlight['reset:' + tenantId] = true;
  toast('Sending reset email…');

  authFetch('/.netlify/functions/admin-send-password-reset', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ tenant_id: tenantId }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed to send reset');
    toast('✓ Password reset sent to ' + (res.d.to || email));
  })
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['reset:' + tenantId]; });
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportTenantsCsv() {
  var rows = Object.values(tenantCache);
  if (!rows.length) { toast('No tenant data loaded — open the Tenants section first.', true); return; }

  var headers = ['Name', 'Slug', 'Owner Email', 'Owner Name', 'Status', 'Collection Mode', 'Orders', 'GMV', 'Location', 'Onboarded'];
  var csvRows = [headers.join(',')];

  rows.forEach(function (t) {
    var tenantStatus = t.status || (t.active !== false ? 'active' : 'inactive');
    var row = [
      t.name         || '',
      t.slug         || '',
      t.owner_email  || '',
      t.owner_name   || '',
      tenantStatus,
      t.stripe_status || '',
      t.order_count  != null ? t.order_count : '',
      t.gmv          != null ? Number(t.gmv).toFixed(2) : '',
      t.city_state   || '',
      t.created_at   ? new Date(t.created_at).toLocaleDateString() : '',
    ].map(function (v) {
      var s = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(s) ? '"' + s + '"' : s;
    });
    csvRows.push(row.join(','));
  });

  var blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'prooflink-tenants-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSV downloaded — ' + rows.length + ' businesses');
}

// ── Tenant detail drawer ──────────────────────────────────────────────────────

function openTenantDetail(tenantId) {
  var t = tenantCache[tenantId] || {};
  var name = t.name || t.slug || tenantId;
  document.getElementById('tenant-detail-title').textContent = name;

  var kv = function (label, value) {
    return '<span class="k">' + esc(label) + '</span><span>' + esc(String(value == null ? '—' : value)) + '</span>';
  };
  var tenantStatus = t.status || (t.active !== false ? 'active' : 'inactive');

  document.getElementById('tenant-detail-body').innerHTML =
    '<div class="detail-kv">'
    + kv('Business name',  t.name     || '—')
    + kv('Slug',           t.slug     || '—')
    + kv('Owner email',    t.owner_email || '—')
    + kv('Owner name',     t.owner_name  || '—')
    + kv('Location',       t.city_state  || '—')
    + kv('Business type',  t.business_type || '—')
    + '<span class="k">Status</span><span>' + statusBadge(tenantStatus) + '</span>'
    + '<span class="k">Stripe</span><span>'  + statusBadge(t.stripe_status || 'not_connected') + '</span>'
    + kv('Orders',         t.order_count   != null ? t.order_count   : '—')
    + kv('GMV',            t.gmv           != null ? '$' + Number(t.gmv).toFixed(2) : '—')
    + kv('Products',       t.product_count != null ? t.product_count : '—')
    + kv('Storage used',   t.storage_used_mb ? t.storage_used_mb + ' MB' : '—')
    + kv('Onboarded',      t.created_at ? fmt(t.created_at) : '—')
    + (t.suspended_at  ? kv('Suspended at',  fmtDt(t.suspended_at))  : '')
    + (t.terminated_at ? kv('Terminated at', fmtDt(t.terminated_at)) : '')
    + (t.flagged_at    ? kv('Flagged at',    fmtDt(t.flagged_at))    : '')
    + (t.conduct_notes ? kv('Last admin note', t.conduct_notes)      : '')
    + '</div>';

  document.getElementById('tenant-conduct-log').innerHTML = '<div class="empty">Loading conduct history…</div>';

  var actions = '<button class="btn" onclick="closeModal(\'tenant-detail-modal\')">Close</button>'
    + '<button class="btn" onclick="openNotifyModal(\'' + esc(tenantId) + '\');closeModal(\'tenant-detail-modal\')">Notify</button>'
    + '<button class="btn" onclick="openConfigModal(\'' + esc(tenantId) + '\');closeModal(\'tenant-detail-modal\')">Edit config</button>'
    + '<button class="btn" onclick="sendPasswordReset(\'' + esc(tenantId) + '\');closeModal(\'tenant-detail-modal\')">Reset password</button>'
    + '<button class="btn btn-danger" onclick="closeModal(\'tenant-detail-modal\');deleteTenant(\'' + esc(tenantId) + '\')">Delete</button>';
  document.getElementById('tenant-detail-actions').innerHTML = actions;

  openModal('tenant-detail-modal');
  loadConductLog(tenantId);
}

function loadConductLog(tenantId) {
  var el = document.getElementById('tenant-conduct-log');
  authFetch('/.netlify/functions/admin-get-conduct-log?tenant_id=' + encodeURIComponent(tenantId))
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed');
      var log = res.d.log || [];
      if (!log.length) {
        el.innerHTML = '<p style="color:var(--muted);font-size:.8rem;padding:.5rem 0">No conduct actions recorded yet.</p>';
        return;
      }
      el.innerHTML = log.map(function (entry) {
        var actionColors = { flag: '#b45309', suspend: '#c84b2f', terminate: '#7f1d1d', reinstate: '#2e7d32' };
        var color = actionColors[entry.action] || 'var(--muted)';
        return '<div style="display:flex;gap:.5rem;align-items:baseline;padding:.35rem 0;border-bottom:1px solid var(--border)">'
          + '<span style="font-weight:700;color:' + color + ';min-width:70px;font-size:.78rem;text-transform:uppercase">' + esc(entry.action) + '</span>'
          + '<span style="color:var(--muted);font-size:.75rem;white-space:nowrap">' + fmtDt(entry.performed_at) + '</span>'
          + (entry.admin_notes ? '<span style="font-size:.78rem;color:var(--ink)">' + esc(entry.admin_notes) + '</span>' : '')
          + '</div>';
      }).join('');
    })
    .catch(function (e) {
      el.innerHTML = '<p style="color:var(--error);font-size:.8rem">' + esc(e.message) + '</p>';
    });
}

// ── Tenant notification ───────────────────────────────────────────────────────

function openNotifyModal(tenantId) {
  notifyTenantId = tenantId;
  var t = tenantCache[tenantId] || {};
  var desc = document.getElementById('notify-modal-desc');
  if (desc) desc.textContent = 'Sending to: ' + (t.owner_email || tenantId);
  var subj = document.getElementById('notify-subject');
  var msg  = document.getElementById('notify-message');
  if (subj) subj.value = '';
  if (msg)  msg.value  = '';
  openModal('notify-modal');
}

function sendTenantMessage() {
  if (!notifyTenantId) return;
  if (_inFlight['notify:' + notifyTenantId]) return;
  var subject = (document.getElementById('notify-subject') || {}).value || '';
  var message = (document.getElementById('notify-message') || {}).value || '';
  if (!subject.trim()) { toast('Subject is required', true); return; }
  if (!message.trim()) { toast('Message is required', true); return; }

  _inFlight['notify:' + notifyTenantId] = true;
  var tid = notifyTenantId;
  closeModal('notify-modal');

  authFetch('/.netlify/functions/admin-send-tenant-message', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ tenant_id: tid, subject: subject.trim(), message: message.trim() }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
  .then(function (res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed to send');
    toast('Message sent to ' + (res.d.to || 'tenant'));
  })
  .catch(function (e) { toast(e.message, true); })
  .finally(function () { delete _inFlight['notify:' + tid]; });
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function loadAuditLog(offset) {
  _auditLogOffset = offset || 0;
  var tbody  = document.getElementById('audit-log-tbody');
  var pagDiv = document.getElementById('audit-log-pagination');
  if (tbody)  tbody.innerHTML  = '<tr class="loading-row"><td colspan="4"><span class="spinner"></span></td></tr>';
  if (pagDiv) pagDiv.innerHTML = '';

  var url = '/.netlify/functions/admin-get-audit-log?limit=50&offset=' + _auditLogOffset;
  authFetch(url)
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed to load audit log');
      var log   = res.d.log   || [];
      var total = res.d.total || 0;

      if (!tbody) return;
      if (!log.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">No audit entries yet.</td></tr>';
        return;
      }

      var actionColors = { flag: '#b45309', suspend: '#c84b2f', terminate: '#7f1d1d', reinstate: '#2e7d32' };
      tbody.innerHTML = log.map(function (entry) {
        var tenantName = (entry.tenants && entry.tenants.name) ? entry.tenants.name : entry.tenant_id;
        var tenantSlug = (entry.tenants && entry.tenants.slug) ? '/' + entry.tenants.slug : '';
        var color = actionColors[entry.action] || 'var(--muted)';
        return '<tr>'
          + '<td><div class="td-name">' + esc(tenantName) + '</div><div class="td-email td-mono">' + esc(tenantSlug) + '</div></td>'
          + '<td><span style="font-weight:700;color:' + color + ';text-transform:uppercase;font-size:.78rem">' + esc(entry.action) + '</span></td>'
          + '<td style="font-size:.78rem;color:var(--muted);max-width:220px">' + esc(entry.admin_notes || entry.reason_code || '—') + '</td>'
          + '<td style="white-space:nowrap;font-size:.78rem">' + fmtDt(entry.performed_at) + '</td>'
          + '</tr>';
      }).join('');

      // Pagination
      if (pagDiv && total > 50) {
        var totalPages = Math.ceil(total / 50);
        var curPage    = Math.floor(_auditLogOffset / 50);
        var html = 'Showing ' + (_auditLogOffset + 1) + '–' + Math.min(_auditLogOffset + 50, total) + ' of ' + total + ' &nbsp;';
        if (curPage > 0) html += '<button class="btn btn-sm" onclick="loadAuditLog(' + ((curPage - 1) * 50) + ')">← Prev</button> ';
        if (curPage < totalPages - 1) html += '<button class="btn btn-sm" onclick="loadAuditLog(' + ((curPage + 1) * 50) + ')">Next →</button>';
        pagDiv.innerHTML = html;
      }
    })
    .catch(function (e) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="padding:1.5rem;color:var(--error);font-size:.82rem">' + esc(e.message) + '</td></tr>';
      toast('Audit log: ' + e.message, true);
    });
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

// ── Billing / Stripe Health ────────────────────────────────────────────────────

var _billingLoaded = false;

function loadBilling() {
  if (_billingLoaded) return;
  _billingLoaded = true;

  ['hc-stripe-key', 'hc-stripe-connect', 'hc-stripe-webhook'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="health-dot unknown"></div>Checking\u2026';
  });

  authFetch('/.netlify/functions/admin-stripe-health')
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.d.error || 'Health check failed');
      var d = res.d;
      setHealthStatus('hc-stripe-key',     'hc-stripe-key-note',     d.stripe_key.ok, d.stripe_key.ok ? 'Valid' : 'Invalid',            d.stripe_key.message);
      setHealthStatus('hc-stripe-connect', 'hc-stripe-connect-note', d.connect.ok,    d.connect.count + ' connected',                    d.connect.message);
      setHealthStatus('hc-stripe-webhook', 'hc-stripe-webhook-note', d.webhook.ok,    d.webhook.ok    ? 'Configured' : 'Not configured', d.webhook.message);
    })
    .catch(function (e) {
      ['hc-stripe-key', 'hc-stripe-connect', 'hc-stripe-webhook'].forEach(function (id) {
        setHealthStatus(id, id + '-note', false, 'Error', e.message);
      });
    });
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
    .then(function (r) {
      setHealthStatus('hc-stats', 'hc-stats-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Function responding normally.' : 'HTTP ' + r.status);
      setHealthStatus('hc-sb', 'hc-sb-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Supabase responding through function layer.' : 'Could not reach Supabase — check SUPABASE_URL and service role key.');
    })
    .catch(function (e) {
      setHealthStatus('hc-stats', 'hc-stats-note', false, 'Error', e.message);
      setHealthStatus('hc-sb', 'hc-sb-note', false, 'Error', 'Cannot confirm Supabase connection.');
    });

  authFetch('/.netlify/functions/admin-get-onboarding-requests?limit=1')
    .then(function (r) { setHealthStatus('hc-ob','hc-ob-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Function responding normally.' : 'HTTP ' + r.status); })
    .catch(function (e) { setHealthStatus('hc-ob','hc-ob-note', false, 'Error', e.message); });

  authFetch('/.netlify/functions/get-tenants?limit=1')
    .then(function (r) { setHealthStatus('hc-tenants','hc-tenants-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Function responding normally.' : 'HTTP ' + r.status); })
    .catch(function (e) { setHealthStatus('hc-tenants','hc-tenants-note', false, 'Error', e.message); });

  fetch('/.netlify/functions/check-slug?slug=healthcheck-' + Date.now())
    .then(function (r) { setHealthStatus('hc-slug','hc-slug-note', r.ok, r.ok ? 'Connected' : 'Error', r.ok ? 'Public function responding normally.' : 'HTTP ' + r.status); })
    .catch(function (e) { setHealthStatus('hc-slug','hc-slug-note', false, 'Error', e.message); });

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
      if (vRes.status === 401 || vRes.status === 403) {
        // Token invalid or user is not an admin — clear and show login
        sessionStorage.removeItem('pl_op_token');
        setAuth(true);
        return;
      }
      if (!vRes.ok) {
        // Network or server error — keep session, show login to let user retry
        setAuth(true);
        return;
      }
      token = saved;
      document.getElementById('admin-email-display').textContent = vRes.d.email || 'Admin';
      setAuth(false);
      bootAdmin();
    }).catch(function () {
      // Network failure — don't clear a potentially valid token
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

function fetchAdminTenants(params) {
  params = params || {};
  var searchParams = new URLSearchParams();
  Object.keys(params).forEach(function(key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });
  var qs = searchParams.toString();
  var url = '/.netlify/functions/get-tenants' + (qs ? '?' + qs : '');
  return authFetch(url)
    .then(function(r) {
      return r.json().then(function(d) { return { ok: r.ok, d: d }; });
    })
    .then(function(res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed to load tenants');
      return Array.isArray(res.d.tenants) ? res.d.tenants : [];
    });
}

function aiControlMsg(message, tone) {
  var el = document.getElementById('ai-control-msg');
  if (!el) return;
  el.className = 'ai-control-msg' + (tone ? ' ' + tone : '');
  el.textContent = message || '';
}

function renderAiTenantSelect() {
  var select = document.getElementById('ai-tenant-select');
  if (!select) return;
  var tenants = Array.isArray(aiControlState.tenants) ? aiControlState.tenants.slice() : [];
  if (!tenants.length) {
    select.innerHTML = '<option value="">No tenants available</option>';
    select.disabled = true;
    return;
  }

  if (!aiControlState.selectedTenantId || !tenants.some(function(row) { return row.id === aiControlState.selectedTenantId; })) {
    aiControlState.selectedTenantId = tenants[0].id;
  }

  select.disabled = false;
  select.innerHTML = tenants.map(function(row) {
    var label = (row.name || row.slug || row.id) + (row.slug ? ' (' + row.slug + ')' : '');
    return '<option value="' + esc(row.id) + '"' + (row.id === aiControlState.selectedTenantId ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
  select.onchange = function() {
    aiControlState.selectedTenantId = this.value || '';
    aiControlState.workforceReport = null;
    aiControlState.systemsReport = null;
    renderAiWorkforceReport();
    renderAiSystemsReport();
    aiControlMsg('Tenant updated. Run the workforce review or systems review to inspect the internal guidance for this business.', '');
  };
}

function fetchAiAgentRoster() {
  return authFetch('/.netlify/functions/ai-agent-report')
    .then(function(r) {
      return r.json().then(function(d) { return { ok: r.ok, d: d }; });
    })
    .then(function(res) {
      if (!res.ok) throw new Error(res.d.error || 'Failed to load the internal agent roster');
      return Array.isArray(res.d.agents) ? res.d.agents : [];
    });
}

function renderAiAgentRoster() {
  var wrap = document.getElementById('ai-roster-wrap');
  if (!wrap) return;
  var agents = Array.isArray(aiControlState.agents) ? aiControlState.agents : [];
  if (!agents.length) {
    wrap.innerHTML = '<div class="empty">No internal agents were returned.</div>';
    return;
  }

  wrap.innerHTML = '<div class="ai-roster-list">' + agents.map(function(agent) {
    var tools = Array.isArray(agent.allowed_tools) ? agent.allowed_tools : [];
    var inputs = Array.isArray(agent.inputs) ? agent.inputs : [];
    return '<article class="ai-roster-card">'
      + '<div class="ai-roster-card__head">'
      + '<div class="ai-roster-card__title">' + esc(agent.label || agent.key || 'Agent') + '</div>'
      + '<div class="ai-roster-card__key">' + esc(agent.key || '') + '</div>'
      + '</div>'
      + '<div class="ai-roster-card__copy">' + esc(agent.purpose || 'No purpose documented.') + '</div>'
      + '<div class="ai-roster-chip-row">'
      + '<span class="badge badge-approved">' + esc(inputs.length + ' input' + (inputs.length === 1 ? '' : 's')) + '</span>'
      + '<span class="badge badge-submitted">' + esc(tools.length + ' allowed tool' + (tools.length === 1 ? '' : 's')) + '</span>'
      + '</div>'
      + '<div class="ai-roster-card__meta"><strong>Confidence:</strong> ' + esc(agent.confidence_signal || 'Not documented.') + '</div>'
      + '</article>';
  }).join('') + '</div>';
}

function currentAiTenantName() {
  var selected = (aiControlState.tenants || []).find(function(row) {
    return row.id === aiControlState.selectedTenantId;
  });
  return selected ? (selected.name || selected.slug || selected.id) : 'Selected tenant';
}

function renderAiWorkforceReport() {
  var wrap = document.getElementById('ai-workforce-report-wrap');
  if (!wrap) return;

  var payload = aiControlState.workforceReport || null;
  var report = payload && payload.report ? payload.report : null;
  var context = payload && payload.context_summary ? payload.context_summary : {};
  if (!report) {
    wrap.innerHTML = '<div class="empty">Choose a tenant and run the workforce review to see missing specialist lanes and training targets.</div>';
    return;
  }

  var findings = Array.isArray(report.findings) ? report.findings.slice(0, 6) : [];
  var blockers = Array.isArray(report.blockers) ? report.blockers.slice(0, 4) : [];
  var actions = Array.isArray(report.recommended_actions) ? report.recommended_actions.slice(0, 6) : [];
  var confidence = report.confidence && report.confidence.score != null
    ? Math.round(Number(report.confidence.score) * 100)
    : null;

  wrap.innerHTML =
    '<div class="ai-report-summary">'
      + '<div class="ai-report-summary__title">' + esc(currentAiTenantName()) + '</div>'
      + '<div class="ai-report-summary__copy">' + esc(report.summary || 'No summary returned.') + '</div>'
      + '<div class="ai-roster-chip-row">'
        + '<span class="badge badge-submitted">' + esc(String(context.new_agent_candidates || 0) + ' new lane' + (Number(context.new_agent_candidates || 0) === 1 ? '' : 's')) + '</span>'
        + '<span class="badge badge-approved">' + esc(String(context.training_targets || 0) + ' training target' + (Number(context.training_targets || 0) === 1 ? '' : 's')) + '</span>'
        + (confidence == null ? '' : '<span class="badge badge-provisioned">' + esc('Confidence ' + confidence + '%') + '</span>')
      + '</div>'
    + '</div>'
    + '<div class="ai-report-section">'
      + '<div class="ai-report-section__title">Findings</div>'
      + (findings.length
        ? '<div class="ai-report-list">' + findings.map(function(item) {
            return '<article class="ai-report-item">'
              + '<div class="ai-report-item__head"><strong>' + esc(item.title || 'Finding') + '</strong><span>' + esc(String(item.severity || 'info')) + '</span></div>'
              + '<div class="ai-report-item__copy">' + esc(item.detail || '') + '</div>'
            + '</article>';
          }).join('') + '</div>'
        : '<div class="empty">No findings were returned.</div>')
    + '</div>'
    + '<div class="ai-report-section">'
      + '<div class="ai-report-section__title">Blockers</div>'
      + (blockers.length
        ? '<div class="ai-report-list">' + blockers.map(function(item) {
            return '<article class="ai-report-item ai-report-item--warn">'
              + '<div class="ai-report-item__head"><strong>' + esc(item.title || 'Blocker') + '</strong></div>'
              + '<div class="ai-report-item__copy">' + esc(item.detail || '') + '</div>'
            + '</article>';
          }).join('') + '</div>'
        : '<div class="empty">No blockers were returned.</div>')
    + '</div>'
    + '<div class="ai-report-section">'
      + '<div class="ai-report-section__title">Recommended actions</div>'
      + (actions.length
        ? '<div class="ai-report-list">' + actions.map(function(item) {
            return '<article class="ai-report-item">'
              + '<div class="ai-report-item__head"><strong>' + esc(item.title || 'Action') + '</strong><span>' + esc(String(item.priority || 'review')) + '</span></div>'
              + '<div class="ai-report-item__copy">' + esc(item.detail || '') + '</div>'
            + '</article>';
          }).join('') + '</div>'
        : '<div class="empty">No actions were returned.</div>')
    + '</div>';
}

function renderAiSystemsReport() {
  var wrap = document.getElementById('ai-systems-report-wrap');
  if (!wrap) return;

  var payload = aiControlState.systemsReport || null;
  var report = payload && payload.report ? payload.report : null;
  var context = payload && payload.context_summary ? payload.context_summary : {};
  if (!report) {
    wrap.innerHTML = '<div class="empty">Choose a tenant and run the systems review to see AI architecture gaps, lane exposure opportunities, and shared AI file hardening targets.</div>';
    return;
  }

  var findings = Array.isArray(report.findings) ? report.findings.slice(0, 6) : [];
  var blockers = Array.isArray(report.blockers) ? report.blockers.slice(0, 4) : [];
  var actions = Array.isArray(report.recommended_actions) ? report.recommended_actions.slice(0, 6) : [];
  var confidence = report.confidence && report.confidence.score != null
    ? Math.round(Number(report.confidence.score) * 100)
    : null;

  wrap.innerHTML =
    '<div class="ai-report-summary">'
      + '<div class="ai-report-summary__title">' + esc(currentAiTenantName()) + '</div>'
      + '<div class="ai-report-summary__copy">' + esc(report.summary || 'No summary returned.') + '</div>'
      + '<div class="ai-roster-chip-row">'
        + '<span class="badge badge-submitted">' + esc(String(context.exposure_gaps || 0) + ' exposure gap' + (Number(context.exposure_gaps || 0) === 1 ? '' : 's')) + '</span>'
        + '<span class="badge badge-approved">' + esc(String(context.new_lane_candidates || 0) + ' new lane' + (Number(context.new_lane_candidates || 0) === 1 ? '' : 's')) + '</span>'
        + '<span class="badge badge-provisioned">' + esc(String(context.ai_file_targets || 0) + ' AI file target' + (Number(context.ai_file_targets || 0) === 1 ? '' : 's')) + '</span>'
        + (confidence == null ? '' : '<span class="badge badge-approved">' + esc('Confidence ' + confidence + '%') + '</span>')
      + '</div>'
    + '</div>'
    + '<div class="ai-report-section">'
      + '<div class="ai-report-section__title">Findings</div>'
      + (findings.length
        ? '<div class="ai-report-list">' + findings.map(function(item) {
            return '<article class="ai-report-item">'
              + '<div class="ai-report-item__head"><strong>' + esc(item.title || 'Finding') + '</strong><span>' + esc(String(item.severity || 'info')) + '</span></div>'
              + '<div class="ai-report-item__copy">' + esc(item.detail || '') + '</div>'
            + '</article>';
          }).join('') + '</div>'
        : '<div class="empty">No findings were returned.</div>')
    + '</div>'
    + '<div class="ai-report-section">'
      + '<div class="ai-report-section__title">Blockers</div>'
      + (blockers.length
        ? '<div class="ai-report-list">' + blockers.map(function(item) {
            return '<article class="ai-report-item ai-report-item--warn">'
              + '<div class="ai-report-item__head"><strong>' + esc(item.title || 'Blocker') + '</strong></div>'
              + '<div class="ai-report-item__copy">' + esc(item.detail || '') + '</div>'
            + '</article>';
          }).join('') + '</div>'
        : '<div class="empty">No blockers were returned.</div>')
    + '</div>'
    + '<div class="ai-report-section">'
      + '<div class="ai-report-section__title">Recommended actions</div>'
      + (actions.length
        ? '<div class="ai-report-list">' + actions.map(function(item) {
            return '<article class="ai-report-item">'
              + '<div class="ai-report-item__head"><strong>' + esc(item.title || 'Action') + '</strong><span>' + esc(String(item.priority || 'review')) + '</span></div>'
              + '<div class="ai-report-item__copy">' + esc(item.detail || '') + '</div>'
            + '</article>';
          }).join('') + '</div>'
        : '<div class="empty">No actions were returned.</div>')
    + '</div>';
}

function loadAiAgentRoster() {
  aiControlMsg('Refreshing the internal agent roster…', '');
  return fetchAiAgentRoster()
    .then(function(agents) {
      aiControlState.agents = agents;
      renderAiAgentRoster();
      aiControlMsg('Internal agent roster refreshed.', '');
      return agents;
    })
    .catch(function(err) {
      renderAiAgentRoster();
      aiControlMsg(err.message || 'Failed to load the internal agent roster.', 'error');
      throw err;
    });
}

function loadAiControl() {
  aiControlMsg('Loading internal AI controls…', '');
  Promise.all([
    fetchAdminTenants({ limit: 200 }),
    fetchAiAgentRoster(),
  ])
  .then(function(results) {
    aiControlState.tenants = Array.isArray(results[0]) ? results[0] : [];
    aiControlState.agents = Array.isArray(results[1]) ? results[1] : [];
    renderAiTenantSelect();
    renderAiAgentRoster();
    renderAiWorkforceReport();
    renderAiSystemsReport();
    aiControlMsg('Internal AI controls are ready. Tenant operators do not see this layer.', '');
  })
  .catch(function(err) {
    renderAiTenantSelect();
    renderAiAgentRoster();
    renderAiWorkforceReport();
    renderAiSystemsReport();
    aiControlMsg(err.message || 'Failed to load the internal AI controls.', 'error');
  });
}

function runAiWorkforceReview() {
  var tenantId = String(aiControlState.selectedTenantId || '').trim();
  if (!tenantId) {
    aiControlMsg('Choose a tenant before running the workforce review.', 'error');
    return;
  }

  aiControlMsg('Running the internal workforce review…', '');
  authFetch('/.netlify/functions/ai-agent-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_key: 'agent_workforce_architect',
      tenant_id: tenantId,
    }),
  })
  .then(function(r) {
    return r.json().then(function(d) { return { ok: r.ok, d: d }; });
  })
  .then(function(res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed to run the workforce review');
    aiControlState.workforceReport = {
      report: res.d.report || null,
      context_summary: res.d.context_summary || {},
      generated_at: res.d.generated_at || '',
    };
    renderAiWorkforceReport();
    aiControlMsg('Internal workforce review ready.', '');
  })
  .catch(function(err) {
    aiControlMsg(err.message || 'Failed to run the workforce review.', 'error');
  });
}

function runAiSystemsReview() {
  var tenantId = String(aiControlState.selectedTenantId || '').trim();
  if (!tenantId) {
    aiControlMsg('Choose a tenant before running the systems review.', 'error');
    return;
  }

  aiControlMsg('Running the internal systems reviewâ€¦', '');
  authFetch('/.netlify/functions/ai-agent-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_key: 'ai_systems_architect',
      tenant_id: tenantId,
    }),
  })
  .then(function(r) {
    return r.json().then(function(d) { return { ok: r.ok, d: d }; });
  })
  .then(function(res) {
    if (!res.ok) throw new Error(res.d.error || 'Failed to run the systems review');
    aiControlState.systemsReport = {
      report: res.d.report || null,
      context_summary: res.d.context_summary || {},
      generated_at: res.d.generated_at || '',
    };
    renderAiSystemsReport();
    aiControlMsg('Internal systems review ready.', '');
  })
  .catch(function(err) {
    aiControlMsg(err.message || 'Failed to run the systems review.', 'error');
  });
}

function loadTesters() {
  var tbody = document.getElementById('testers-tbody');
  if (tbody) tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><span class="spinner"></span></td></tr>';

  fetchAdminTenants({ limit: 200 })
  .then(function(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var now = new Date();

    // Filter to only active (non-expired) exemptions
    var active = rows.filter(function(t) {
      if (!t.billing_exempt) return false;
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

    fetchAdminTenants({ limit: 25, q: q })
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
              : '<button class="btn btn-sm btn-primary" onclick="grantExemption(\'' + t.id + '\',\'' + esc(t.name) + '\')">'
                + 'Grant ' + ((document.getElementById('tester-duration') || {}).value || '12') + ' months free'
                + '</button>'
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
  if (_inFlight['exempt:' + tenantId]) return;
  var monthsEl = document.getElementById('tester-duration');
  var months = monthsEl ? parseInt(monthsEl.value, 10) || 12 : 12;
  if (!confirm('Grant ' + months + ' months of free access to ' + tenantName + '?\n\nThey will be able to use ProofLink fully without a subscription until the exemption expires.')) return;

  _inFlight['exempt:' + tenantId] = true;
  authFetch('/api/admin/set-tester-exempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenantId, exempt: true, months: months })
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
    toast('✅ Exemption granted to ' + tenantName + ' — free until ' + new Date(res.d.billingExemptUntil).toLocaleDateString() + ' (' + res.d.slotsUsed + '/3 slots used)');
    loadTesters();
    document.getElementById('tester-tenant-search').value = '';
    document.getElementById('tester-tenant-results').innerHTML = '';
  })
  .catch(function(err) { alert('Error: ' + err.message); })
  .finally(function() { delete _inFlight['exempt:' + tenantId]; });
}

function revokeExemption(tenantId, tenantName) {
  if (_inFlight['revoke:' + tenantId]) return;
  if (!confirm('Revoke tester exemption for ' + tenantName + '?\n\nThey will be required to subscribe to continue using ProofLink.')) return;

  _inFlight['revoke:' + tenantId] = true;
  authFetch('/api/admin/set-tester-exempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenantId, exempt: false })
  })
  .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
  .then(function(res) {
    if (!res.ok) { alert(res.d.error || 'Failed to revoke exemption'); return; }
    toast('Exemption revoked for ' + tenantName);
    loadTesters();
  })
  .catch(function(err) { alert('Error: ' + err.message); })
  .finally(function() { delete _inFlight['revoke:' + tenantId]; });
}

