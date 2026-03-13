// operator/provisioning.js
// Client-side logic for the ProofLink operator provisioning dashboard.
// Handles Supabase auth, request listing, approval, and provisioning triggers.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  // These values are read from env-injected meta tags OR window globals.
  // Ensure your operator pages set:
  //   <meta name="supabase-url" content="https://xxxx.supabase.co">
  //   <meta name="supabase-anon-key" content="eyJ...">
  // Or set window.SUPABASE_URL and window.SUPABASE_ANON_KEY before this script.

  const SUPABASE_URL  = getMeta('supabase-url')  || window.SUPABASE_URL  || '';
  const SUPABASE_ANON = getMeta('supabase-anon-key') || window.SUPABASE_ANON_KEY || '';

  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute('content') : '';
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let authToken   = null;
  let allRequests = [];
  let activeFilter = '';

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const authGate   = document.getElementById('auth-gate');
  const opShell    = document.getElementById('op-shell');
  const tbody      = document.getElementById('requests-tbody');
  const authBtn    = document.getElementById('auth-btn');
  const authError  = document.getElementById('auth-error');
  const refreshBtn = document.getElementById('refresh-btn');
  const signOutBtn = document.getElementById('sign-out-btn');

  // ── Init ──────────────────────────────────────────────────────────────────
  (async function init() {
    // Try to restore session from localStorage (Supabase-compatible key)
    const stored = loadStoredSession();
    if (stored) {
      authToken = stored;
      showShell();
      await loadRequests();
    }

    // Auth form
    authBtn.addEventListener('click', handleSignIn);
    document.getElementById('auth-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSignIn();
    });

    // Refresh
    refreshBtn.addEventListener('click', () => loadRequests());

    // Sign out
    signOutBtn.addEventListener('click', () => {
      authToken = null;
      clearStoredSession();
      opShell.style.display = 'none';
      authGate.style.display = 'flex';
    });

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.status || '';
        renderTable(allRequests);
      });
    });
  })();

  // ── Auth ──────────────────────────────────────────────────────────────────
  async function handleSignIn() {
    authError.textContent = '';
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) {
      authError.textContent = 'Please enter your email and password.';
      return;
    }

    authBtn.textContent = 'Signing in…';
    authBtn.disabled = true;

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.access_token) {
        authError.textContent = data.error_description || data.msg || 'Sign in failed.';
        authBtn.textContent = 'Sign In';
        authBtn.disabled = false;
        return;
      }

      authToken = data.access_token;
      storeSession(data.access_token);
      showShell();
      await loadRequests();

    } catch (err) {
      authError.textContent = 'Network error. Please try again.';
      authBtn.textContent = 'Sign In';
      authBtn.disabled = false;
    }
  }

  function showShell() {
    authGate.style.display = 'none';
    opShell.style.display = 'grid';
  }

  // ── Session storage ───────────────────────────────────────────────────────
  // Note: uses sessionStorage (tab-scoped) to avoid persisting tokens in localStorage
  function storeSession(token) {
    try { sessionStorage.setItem('pl_op_token', token); } catch {}
  }

  function loadStoredSession() {
    try { return sessionStorage.getItem('pl_op_token'); } catch { return null; }
  }

  function clearStoredSession() {
    try { sessionStorage.removeItem('pl_op_token'); } catch {}
  }

  // ── Load requests ─────────────────────────────────────────────────────────
  async function loadRequests() {
    tbody.innerHTML = `
      <tr class="loading-row">
        <td colspan="6">
          <div class="loader"></div>
          Loading requests…
        </td>
      </tr>`;

    try {
      const res = await fetch('/.netlify/functions/list-onboarding-requests', {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (res.status === 401 || res.status === 403) {
        clearStoredSession();
        opShell.style.display = 'none';
        authGate.style.display = 'flex';
        showToast('Session expired. Please sign in again.', 'error');
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');

      allRequests = data.requests || [];
      updateCounts(allRequests);
      renderTable(allRequests);

    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:3rem;color:#c62828;">
            Error loading requests: ${escapeHtml(err.message)}
          </td>
        </tr>`;
    }
  }

  // ── Update tab counts ─────────────────────────────────────────────────────
  function updateCounts(requests) {
    const counts = { submitted: 0, approved: 0, provisioning: 0, provisioned: 0, failed: 0 };
    requests.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status]++; });

    document.getElementById('count-all').textContent = requests.length;
    Object.entries(counts).forEach(([status, count]) => {
      const el = document.getElementById(`count-${status}`);
      if (el) el.textContent = count;
    });
  }

  // ── Render table ──────────────────────────────────────────────────────────
  function renderTable(requests) {
    const filtered = activeFilter
      ? requests.filter((r) => r.status === activeFilter)
      : requests;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <div class="empty-icon">📭</div>
              <div class="empty-title">No requests found</div>
              <p>No onboarding requests match the current filter.</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((r) => buildRow(r)).join('');

    // Bind action buttons
    tbody.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const id     = btn.dataset.id;
        if (action === 'approve') handleApprove(id, btn);
        if (action === 'provision') handleProvision(id, btn);
        if (action === 'retry') handleApproveAndProvision(id, btn);
      });
    });

    // Error detail toggles
    tbody.querySelectorAll('[data-toggle-error]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.toggleError);
        if (target) {
          target.style.display = target.style.display === 'none' ? '' : 'none';
        }
      });
    });
  }

  function buildRow(r) {
    const date = r.created_at
      ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '–';

    const typeLabel = {
      bakery: 'Bakery', contractor: 'Contractor', lawn_care: 'Lawn Care',
      pet_services: 'Pet Services', meal_prep: 'Meal Prep',
      maker_crafter: 'Maker/Crafter', cleaning: 'Cleaning', tutoring: 'Tutoring',
    }[r.business_type] || r.business_type || '–';

    const actionHtml = buildActions(r);
    const errorHtml  = r.provision_error
      ? `<tr class="error-row" id="error-${r.id}-row" style="display:none;">
           <td colspan="6">
             <div class="error-detail">${escapeHtml(r.provision_error)}</div>
           </td>
         </tr>`
      : '';

    return `
      <tr>
        <td>
          <div class="td-business">${escapeHtml(r.business_name)}</div>
          <div class="td-email">${escapeHtml(r.owner_email)}</div>
          ${r.business_slug ? `<div style="font-size:0.7rem;color:#9c9490;font-family:monospace;">${escapeHtml(r.business_slug)}</div>` : ''}
        </td>
        <td class="td-type">${escapeHtml(typeLabel)}</td>
        <td class="td-type">${escapeHtml(r.city_state || '–')}</td>
        <td class="td-date">${date}</td>
        <td>${statusBadge(r.status, r.provision_error)}</td>
        <td>${actionHtml}</td>
      </tr>
      ${errorHtml}`;
  }

  function buildActions(r) {
    if (r.status === 'submitted') {
      return `<button class="btn-sm btn-approve" data-action="approve" data-id="${r.id}">✓ Approve</button>`;
    }
    if (r.status === 'approved') {
      return `<button class="btn-sm btn-provision" data-action="provision" data-id="${r.id}">▶ Provision</button>`;
    }
    if (r.status === 'failed') {
      return `
        <button class="btn-sm btn-retry" data-action="retry" data-id="${r.id}">↺ Retry</button>
        ${r.provision_error ? `<button class="btn-sm" style="margin-left:4px;background:var(--error-bg);color:var(--error-text);border:1px solid var(--error-border);" data-toggle-error="error-${r.id}-row">Details</button>` : ''}`;
    }
    if (r.status === 'provisioned') {
      return `<span style="font-size:0.75rem;color:var(--success-text);">✓ Live</span>`;
    }
    if (r.status === 'provisioning') {
      return `<span style="font-size:0.75rem;color:#1565c0;">⋯ In progress</span>`;
    }
    return '–';
  }

  function statusBadge(status, hasError) {
    return `<span class="badge ${status}"><span class="badge-dot"></span>${status}</span>`;
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  async function handleApprove(id, btn) {
    btn.disabled = true;
    btn.textContent = '…';

    try {
      const res = await fetch('/.netlify/functions/approve-onboarding-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval failed');

      showToast('Request approved. Ready to provision.', 'success');
      await loadRequests();

    } catch (err) {
      showToast(`Approve failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = '✓ Approve';
    }
  }

  // ── Provision ─────────────────────────────────────────────────────────────
  async function handleProvision(id, btn) {
    btn.disabled = true;
    btn.textContent = '…';

    try {
      const res = await fetch('/.netlify/functions/provision-tenant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Provisioning failed');

      if (data.already_provisioned) {
        showToast('Already provisioned.', 'success');
      } else {
        showToast(`Tenant provisioned: ${data.tenant?.slug}`, 'success');
      }

      await loadRequests();

    } catch (err) {
      showToast(`Provision failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = '▶ Provision';
    }
  }

  // ── Retry (approve + provision in sequence) ───────────────────────────────
  async function handleApproveAndProvision(id, btn) {
    btn.disabled = true;
    btn.textContent = '…';

    try {
      // Step 1: approve
      const approveRes = await fetch('/.netlify/functions/approve-onboarding-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ id }),
      });

      const approveData = await approveRes.json();
      if (!approveRes.ok) throw new Error(approveData.error || 'Approval failed');

      // Step 2: provision
      const provRes = await fetch('/.netlify/functions/provision-tenant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ id }),
      });

      const provData = await provRes.json();
      if (!provRes.ok) throw new Error(provData.error || 'Provisioning failed');

      showToast(`Tenant provisioned: ${provData.tenant?.slug}`, 'success');
      await loadRequests();

    } catch (err) {
      showToast(`Retry failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = '↺ Retry';
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  // ── Util ──────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
