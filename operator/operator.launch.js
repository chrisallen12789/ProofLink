// FILE: operator/operator.launch.js
(function () {
  const cfg = window.PROOFLINK_CONFIG || {};
  const tenant = cfg.tenant || {};
  const paymentCfg = tenant.payments || {};
  const domainCfg = tenant.domains || {};
  const helpCfg = tenant.help || {};
  let livePaymentState = null;

  function $(id) { return document.getElementById(id); }
  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  }
  function badge(label, tone) { return `<span class="badge ${tone || ''}">${esc(label)}</span>`; }
  function statusTone(value) {
    const v = String(value || '').toLowerCase();
    if (["active", "connect_connected", "connected", "enabled", "paid", "live", "ready", "verified"].includes(v)) return 'good';
    if (["onboarding", "checkout_started", "connect_incomplete", "pending", "restricted", "staged", "disabled", "test", "incomplete", "loading"].includes(v)) return 'warn';
    if (["failed", "past_due", "canceled", "blocked"].includes(v)) return 'bad';
    return 'soon';
  }
  function titleCase(value) {
    const raw = String(value || '').replace(/[_-]+/g, ' ').trim();
    return raw ? raw.replace(/\b\w/g, (m) => m.toUpperCase()) : 'Unknown';
  }
  function yesNo(v) { return v ? 'Yes' : 'No'; }

  function bootstrapPaymentState() {
    const platform = paymentCfg.platformBilling || {};
    const commerce = paymentCfg.commerce || {};
    const ledger = paymentCfg.ledger || {};
    return {
      prooflinkPlanKey: platform.planKey || 'starter',
      planLabel: platform.planLabel || 'Starter',
      billingStatus: 'loading',
      connectStatus: 'loading',
      stripeCustomerId: '',
      stripeSubscriptionId: '',
      stripeAccountId: '',
      paymentsEnabled: false,
      onlinePaymentsEligible: false,
      livemode: ledger.livemode === true,
      onlinePaymentsReason: 'Live tenant payment status has not been fetched yet.',
      isLiveHydrated: false,
    };
  }

  function mergedPaymentState() {
    if (livePaymentState) {
      return {
        ...bootstrapPaymentState(),
        ...livePaymentState,
        isLiveHydrated: true,
      };
    }
    return bootstrapPaymentState();
  }

  async function apiPost(path, payload) {
    const runtime = window.PROOFLINK_OPERATOR_RUNTIME || {};
    const token = typeof runtime.getAccessToken === 'function' ? await runtime.getAccessToken() : '';
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function refreshPaymentState() {
    const data = await apiPost('/.netlify/functions/tenant-payment-status', {});
    livePaymentState = data.paymentState || null;
    applyPaymentButtonState();
    return livePaymentState;
  }
  
  function setPaymentMsg(text, bad) {
    const el = $('paymentActionMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = bad ? 'var(--danger)' : 'var(--muted)';
  }

  function applyPaymentButtonState() {
    const state = mergedPaymentState();
    const btnBilling = $('btnStartPlatformCheckout');
    const btnConnect = $('btnConnectStripe');
    const btnOrder = $('btnCreateOrderCheckout');

    if (btnBilling) {
      btnBilling.disabled = state.billingStatus === 'active';
      btnBilling.textContent = state.billingStatus === 'active'
        ? 'Platform billing active'
        : 'Start platform billing';
    }

    if (btnConnect) {
      btnConnect.disabled = state.connectStatus === 'connect_connected';
      btnConnect.textContent = state.connectStatus === 'connect_connected'
        ? 'Stripe connected'
        : 'Connect Stripe';
    }

    if (btnOrder) {
      btnOrder.disabled = !state.onlinePaymentsEligible;
      btnOrder.title = state.onlinePaymentsEligible
        ? ''
        : (state.onlinePaymentsReason || 'Online payments are not eligible yet.');
    }
  }

  window.renderPayments = function renderPaymentsEnhanced() {
    const list = $('paymentsList');
    const billingCard = $('billingSummaryCard');
    const connectCard = $('connectSummaryCard');
    const onlineCard = $('onlinePaymentsCard');
    const settingsWrap = $('paymentSettingsWrap');
    const educationWrap = $('paymentEducationWrap');
    if (!list) return;

    const platform = paymentCfg.platformBilling || {};
    const commerce = paymentCfg.commerce || {};
    const ledger = paymentCfg.ledger || {};
    const state = mergedPaymentState();
    const billingStatus = String(state.billingStatus || 'loading').toLowerCase();
    const connectStatus = String(state.connectStatus || 'loading').toLowerCase();
    const onlineReady = !!state.onlinePaymentsEligible;
    const allowedModes = Array.isArray(commerce.allowedModes) ? commerce.allowedModes : [];
    const livemode = state.livemode === true || ledger.livemode === true;
    const statusLoaded = state.isLiveHydrated === true;

    if (billingCard) {
      billingCard.innerHTML = `
        <div class="stat-big">${esc(state.planLabel || (state.prooflinkPlanKey === 'growth' ? 'Growth' : 'Starter'))}</div>
        <div class="badge-row">${badge(titleCase(billingStatus), statusTone(billingStatus))}${badge(titleCase(platform.billingInterval || 'monthly'), 'soon')}</div>
        <div class="stat-copy" style="margin-top:10px;">
          ${statusLoaded
            ? (billingStatus === 'active'
              ? 'Platform billing is active. Stripe webhooks are now the source of truth.'
              : 'Billing is not active yet. Stripe checkout completion alone is not enough until webhook truth lands.')
            : 'Loading live billing status from the backend. Static tenant config is not treated as payment truth.'}
        </div>
      `;
    }

    if (connectCard) {
      connectCard.innerHTML = `
        <div class="stat-big">${esc(titleCase(connectStatus))}</div>
        <div class="badge-row">${badge(livemode ? 'Live mode' : 'Test mode', livemode ? 'good' : 'warn')}${badge(state.stripeAccountId ? 'Account linked' : 'No account ID', state.stripeAccountId ? 'good' : 'warn')}</div>
        <div class="stat-copy" style="margin-top:10px;">
          ${statusLoaded
            ? (connectStatus === 'connect_connected'
              ? 'Stripe Connect is complete. Tenant payouts can route to the tenant account.'
              : 'Stripe Connect is not complete. Keep pay-online disabled until account updates confirm readiness.')
            : 'Loading live Stripe Connect status from the backend. Do not trust static config values here.'}
        </div>
      `;
    }

    if (onlineCard) {
      onlineCard.innerHTML = `
        <div class="stat-big">${onlineReady ? 'Eligible' : 'Blocked'}</div>
        <div class="badge-row">${badge(onlineReady ? 'Pay online allowed' : 'Offline/manual only', onlineReady ? 'good' : 'warn')}${badge(`Default: ${titleCase(commerce.defaultMode || 'pay_on_pickup')}`, 'soon')}</div>
        <div class="stat-copy" style="margin-top:10px;">${esc(state.onlinePaymentsReason || 'Online payments require active platform billing and a connected tenant Stripe account.')}</div>
      `;
    }

    if (settingsWrap) {
      settingsWrap.innerHTML = `
        <div class="status-stack">
          <div class="status-panel">
            <div class="badge-row" style="margin-bottom:12px;">${badge('ProofLink billing', 'soon')}${badge(titleCase(billingStatus), statusTone(billingStatus))}</div>
            <div class="status-kv">
              <div>Plan</div><div>${esc(state.planLabel || 'Starter')}</div>
              <div>Subscription status</div><div>${esc(titleCase(billingStatus))}</div>
              <div>Subscription ID</div><div class="mono">${esc(state.stripeSubscriptionId || 'Not recorded')}</div>
              <div>Customer ID</div><div class="mono">${esc(state.stripeCustomerId || 'Not recorded')}</div>
            </div>
          </div>
          <div class="status-panel">
            <div class="badge-row" style="margin-bottom:12px;">${badge('Tenant commerce', 'soon')}${badge(titleCase(connectStatus), statusTone(connectStatus))}</div>
            <div class="status-kv">
              <div>Connect account</div><div class="mono">${esc(state.stripeAccountId || 'Not recorded')}</div>
              <div>Connect ready</div><div>${yesNo(connectStatus === 'connect_connected')}</div>
              <div>Payments enabled</div><div>${yesNo(state.paymentsEnabled)}</div>
              <div>Allowed modes</div><div>${allowedModes.length ? allowedModes.map(titleCase).join(', ') : 'No modes set'}</div>
            </div>
          </div>
          <div class="status-panel">
            <div class="badge-row" style="margin-bottom:12px;">${badge('Access rule', onlineReady ? 'good' : 'warn')}${badge(onlineReady ? 'Eligible' : 'Blocked', onlineReady ? 'good' : 'warn')}</div>
            <div class="status-kv">
              <div>Billing active</div><div>${yesNo(billingStatus === 'active')}</div>
              <div>Connect complete</div><div>${yesNo(connectStatus === 'connect_connected')}</div>
              <div>Online payments</div><div>${yesNo(onlineReady)}</div>
              <div>Rule</div><div>Pay online is allowed only when billing_status = active and connect_status = connect_connected.</div>
            </div>
          </div>
        </div>
      `;
    }

    if (educationWrap) {
      educationWrap.innerHTML = `
        <div class="note-list">
          <div class="note-item"><strong>ProofLink subscription</strong> This is what the tenant pays the platform. It is separate from tenant revenue.</div>
          <div class="note-item"><strong>Stripe Connect</strong> This links the tenant's own payout account. Tenant customers pay the tenant, not ProofLink.</div>
          <div class="note-item"><strong>Hosted checkout</strong> Disabled until billing is active and Connect is fully complete.</div>
          <div class="note-item"><strong>Webhook truth</strong> Redirect success screens are informational only. Final billing and payout state must come from Stripe webhooks.</div>
          <div class="note-item"><strong>Current implementation</strong> Billing truth, Connect onboarding links, and operator visibility are live. Full automated tenant creation is still pending.</div>
        </div>
      `;
    }

    const rows = Array.isArray(PAYMENTS_CACHE) ? PAYMENTS_CACHE : [];
    list.innerHTML = rows.length ? '' : `<div class="muted">No payment ledger entries yet.</div>`;
    rows.forEach((p) => {
      const el = document.createElement('article');
      const amount = typeof formatUsd === 'function' ? formatUsd(p.amount_total || p.total_cents || 0) : `$${((Number(p.amount_total || p.total_cents || 0)) / 100).toFixed(2)}`;
      const status = titleCase(p.status || 'unknown');
      const paidAt = p.paid_at || p.created_at || '';
      el.className = 'list-item';
      el.innerHTML = `
        <div class="li-main">
          <div class="li-title">${esc(amount)} • ${esc(status)}</div>
          <div class="li-sub muted">${esc(p.payment_mode || 'unknown mode')} • ${esc(p.currency || ledger.currency || 'usd').toUpperCase()} • ${esc(paidAt ? formatDateTime(paidAt) : 'No timestamp')}</div>
        </div>
        <div class="li-meta">
          ${badge(p.livemode ? 'Live' : 'Test', p.livemode ? 'good' : 'warn')}
        </div>
      `;
      list.appendChild(el);
    });

    applyPaymentButtonState();
  };

  window.renderDomains = function renderDomains() {
    const settingsWrap = $('domainSettingsWrap');
    const instructionsWrap = $('domainInstructionsWrap');
    if (!settingsWrap || !instructionsWrap) return;
    const status = String(domainCfg.customDomainStatus || 'not_connected').toLowerCase();
    settingsWrap.innerHTML = `
      <div class="status-stack">
        <div class="status-panel">
          <div class="badge-row" style="margin-bottom:12px;">${badge('ProofLink subdomain', 'good')}${badge(domainCfg.prooflinkSubdomain ? 'Assigned' : 'Missing', domainCfg.prooflinkSubdomain ? 'good' : 'warn')}</div>
          <div class="status-kv">
            <div>Subdomain</div><div class="mono">${esc(domainCfg.prooflinkSubdomain || 'Not configured')}</div>
            <div>Tenant slug</div><div class="mono">${esc(tenant.slug || tenant.id || 'unknown')}</div>
            <div>Routing role</div><div>Default launch hostname controlled by ProofLink.</div>
          </div>
        </div>
        <div class="status-panel">
          <div class="badge-row" style="margin-bottom:12px;">${badge('Custom domain', 'soon')}${badge(titleCase(status), statusTone(status))}</div>
          <div class="status-kv">
            <div>Custom domain</div><div class="mono">${esc(domainCfg.customDomain || 'Not provided')}</div>
            <div>DNS target</div><div class="mono">${esc(domainCfg.dnsTarget || 'Not configured')}</div>
            <div>Registrar</div><div>Managed by the tenant, not by ProofLink.</div>
          </div>
        </div>
      </div>
    `;
    instructionsWrap.innerHTML = `
      <div class="note-list">
        <div class="note-item"><strong>1. Keep the ProofLink subdomain live first.</strong> Launch traffic there before touching a custom domain.</div>
        <div class="note-item"><strong>2. Ask the customer for the exact hostname.</strong> Usually this is the root domain or <span class="mono">www</span> subdomain, not both unless you plan redirects.</div>
        <div class="note-item"><strong>3. DNS change</strong> Point the requested host to <span class="mono">${esc(domainCfg.dnsTarget || 'prooflink.co')}</span> using the record type ProofLink approves for that domain.</div>
        <div class="note-item"><strong>4. Verification</strong> ${esc(domainCfg.verificationNotes || 'Wait until DNS resolves before marking the domain connected.')}</div>
        <div class="note-item"><strong>5. Current implementation</strong> This is operator guidance only. Automated DNS verification and custom-domain provisioning still need backend wiring.</div>
      </div>
    `;
  };

  async function startPlatformCheckout() {
    setPaymentMsg('Creating Stripe Billing checkout…', false);
    const data = await apiPost('/.netlify/functions/stripe-platform-checkout', {
      tenantId: tenant.id || tenant.slug,
      planKey: paymentCfg.platformBilling?.planKey || 'starter',
    });
    setPaymentMsg('Redirecting to Stripe Billing…', false);
    if (data.url) window.location.href = data.url;
  }

  async function startConnectOnboarding() {
    setPaymentMsg('Creating Stripe Connect onboarding link…', false);
    const data = await apiPost('/.netlify/functions/stripe-connect-link', {
      tenantId: tenant.id || tenant.slug,
    });
    setPaymentMsg('Redirecting to Stripe Connect…', false);
    if (data.url) window.location.href = data.url;
  }

  async function createCheckoutForActiveOrder() {
    const runtime = window.PROOFLINK_OPERATOR_RUNTIME || {};
    const state = mergedPaymentState();
    if (!state.onlinePaymentsEligible) throw new Error(state.onlinePaymentsReason || 'Online payments are not eligible yet.');
    const orderId = typeof runtime.getActiveOrderId === 'function' ? runtime.getActiveOrderId() : '';
    if (!orderId) throw new Error('Select an order first. The checkout action uses the active order in the Orders tab.');
    setPaymentMsg('Creating hosted checkout for the active order…', false);
    const data = await apiPost('/.netlify/functions/stripe-order-checkout', {
      tenantId: tenant.id || tenant.slug,
      orderId,
      applicationFeeBps: Number(paymentCfg.commerce?.applicationFeeBps || 0),
    });
    setPaymentMsg('Hosted checkout created. Open the Stripe session in a new tab or send the link to the customer.', false);
    if (data.url) window.open(data.url, '_blank', 'noopener');
    if (typeof runtime.refreshPayments === 'function') runtime.refreshPayments().catch(console.error);
  }

  const HELP_TOPICS = {
    payments: {
      title: 'Payments help',
      body: `
        <p>This section controls two different systems that must stay separate.</p>
        <p><strong>ProofLink billing</strong> is what the tenant pays the platform. <strong>Tenant commerce</strong> is how the tenant gets paid by their own customers.</p>
        <p>Do not treat a success redirect as final payment truth. Subscription activation, payment success, refunds, and account updates should come from Stripe webhooks.</p>
        <ul>
          <li>Common mistake: enabling pay-online before Stripe Connect is actually connected.</li>
          <li>Common mistake: mixing platform subscription status with customer checkout status.</li>
          <li>Rule: billing_status must be active and connect_status must be connect_connected before hosted checkout is allowed.</li>
        </ul>
      `
    },
    domains: {
      title: 'Domain help',
      body: `
        <p>This section explains where a tenant's storefront points on the internet.</p>
        <p>The ProofLink subdomain is the safe default. Custom domains should only be marked connected after DNS actually resolves to the approved target.</p>
        <ul>
          <li>Common mistake: changing DNS before the subdomain launch is stable.</li>
          <li>Common mistake: confusing registrar login ownership with DNS record instructions.</li>
          <li>Data flow: operator entry → review/verification → domain mapping → storefront routing.</li>
        </ul>
      `
    }
  };

  function openHelp(topic) {
    const drawer = $('helpDrawer');
    const title = $('helpDrawerTitle');
    const body = $('helpDrawerBody');
    const payload = HELP_TOPICS[topic] || HELP_TOPICS.payments;
    if (!drawer || !title || !body) return;
    title.textContent = payload.title;
    body.innerHTML = payload.body;
    drawer.classList.remove('hidden');
  }

  function closeHelp() {
    $('helpDrawer')?.classList.add('hidden');
  }

  window.switchTab = function switchTabEnhanced(tab, opts = {}) {
    const nextTab = typeof normalizePanel === 'function' ? normalizePanel(tab) : String(tab || 'dashboard');
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === nextTab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== nextTab));
    if (nextTab === 'money') renderMoney().catch(console.error);
    if (nextTab === 'dashboard') renderDashboard();
    if (nextTab === 'orders') renderOrders();
    if (nextTab === 'customers') renderCustomersList($('customerSearch')?.value || '');
    if (nextTab === 'payments') renderPayments();
    if (nextTab === 'domains') renderDomains();
    if (nextTab === 'guidance') renderGuidance();
    if (opts.updateHash !== false && typeof syncPanelHash === 'function') syncPanelHash(nextTab);
  };

  function bindLaunchUi() {
    document.querySelectorAll('[data-help-topic]').forEach((btn) => {
      btn.addEventListener('click', () => openHelp(btn.dataset.helpTopic));
    });
    $('btnCloseHelp')?.addEventListener('click', closeHelp);
    $('helpDrawer')?.addEventListener('click', (e) => {
      if (e.target.id === 'helpDrawer') closeHelp();
    });
    $('btnRefreshDomains')?.addEventListener('click', () => renderDomains());
    $('btnRefreshPayments')?.addEventListener('click', () => refreshPaymentState().then(() => renderPayments()).catch((err) => setPaymentMsg(err.message || String(err), true)));
    $('btnStartPlatformCheckout')?.addEventListener('click', () => startPlatformCheckout().catch((err) => setPaymentMsg(err.message || String(err), true)));
    $('btnConnectStripe')?.addEventListener('click', () => startConnectOnboarding().catch((err) => setPaymentMsg(err.message || String(err), true)));
    $('btnCreateOrderCheckout')?.addEventListener('click', () => createCheckoutForActiveOrder().catch((err) => setPaymentMsg(err.message || String(err), true)));
  }

  function consumePaymentRedirectState() {
    const params = new URLSearchParams(window.location.search || '');
    const billing = String(params.get('billing') || '').toLowerCase();
    const connect = String(params.get('connect') || '').toLowerCase();
    const order = String(params.get('order_checkout') || '').toLowerCase();
    let message = '';
    let bad = false;

    if (billing === 'success') message = 'ProofLink subscription checkout returned successfully. Final billing state should come from Stripe webhooks.';
    else if (billing === 'cancel') {
      message = 'ProofLink subscription checkout was canceled before completion.';
      bad = true;
    } else if (connect === 'return') {
      message = 'Stripe Connect returned to Payments. Account status will finalize after Stripe updates and webhook events land.';
    } else if (connect === 'refresh') {
      message = 'Stripe Connect asked for a refreshed onboarding link. Start Connect Stripe again to continue.';
      bad = true;
    } else if (order === 'success') {
      message = 'Customer checkout returned successfully. Final payment status should come from Stripe webhooks.';
    } else if (order === 'cancel') {
      message = 'Customer checkout was canceled before completion.';
      bad = true;
    }

    if (!message) return;
    switchTab('payments');
    setPaymentMsg(message, bad);
    params.delete('billing');
    params.delete('connect');
    params.delete('order_checkout');
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || '#payments'}`;
    if (window.history?.replaceState) window.history.replaceState(null, '', nextUrl);
  }

  async function bootLaunchUi() {
    if (helpCfg.enabled === false) {
      document.querySelectorAll('[data-help-topic]').forEach((el) => el.remove());
      $('helpDrawer')?.remove();
    } else {
      bindLaunchUi();
    }

    renderDomains();
    renderPayments();

    try {
      const runtime = window.PROOFLINK_OPERATOR_RUNTIME || {};
      const token = typeof runtime.getAccessToken === 'function' ? await runtime.getAccessToken() : '';
      if (token) {
        await refreshPaymentState();
        renderPayments();
      }
    } catch (err) {
      setPaymentMsg(err.message || String(err), true);
      renderPayments();
    }

    consumePaymentRedirectState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bootLaunchUi().catch(console.error); }, { once: true });
  } else {
    bootLaunchUi().catch(console.error);
  }
})();
