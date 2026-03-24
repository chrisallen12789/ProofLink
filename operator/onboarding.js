(function () {
  function $(id) { return document.getElementById(id); }

  const BILLING_LABELS = {
    active          : 'Active',
    past_due        : 'Past Due',
    canceled        : 'Canceled',
    trialing        : 'Trial',
    incomplete      : 'Incomplete',
    onboarding      : 'Not yet active',
  };
  const CONNECT_LABELS = {
    connect_connected    : 'Connected',
    connect_not_started  : 'Not connected',
    connect_pending      : 'Pending',
    connect_restricted   : 'Restricted',
  };
  function billingLabel(s) { return BILLING_LABELS[s] || titleCase(s || 'Unknown'); }
  function connectLabel(s) { return CONNECT_LABELS[s] || titleCase(s || 'Unknown'); }

  const state = {
    startContext: null,
    paymentState: null,
    tenantSlug: '',
    tenantId: '',
    planKey: '',
    currentStep: 1,
    firstOfferDone: false,
  };

  function readStartContext() {
    try {
      return JSON.parse(localStorage.getItem('prooflink_start_context') || 'null');
    } catch {
      return null;
    }
  }

  function getTenantFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    return String(params.get('tenant') || '').trim();
  }

  function getPlanFromUrl() {
    const Public = window.PROOFLINK_PUBLIC;
    if (Public && typeof Public.readQueryPlanIntent === 'function') {
      return Public.readQueryPlanIntent(window.location.search || '')?.planKey || '';
    }

    const params = new URLSearchParams(window.location.search || '');
    return String(params.get('plan') || '').trim().toLowerCase();
  }

  function isSelfServeStart() {
    const params = new URLSearchParams(window.location.search || '');
    return String(params.get('selfServe') || '').trim() === '1';
  }

  function setMsg(step, text, tone) {
    const el = $(`msg-step-${step}`);
    if (!el) return;
    el.textContent = text || '';
    el.className = `msg${tone ? ` ${tone}` : ''}`;
  }

  function titleCase(value) {
    const raw = String(value || '').replace(/[_-]+/g, ' ').trim();
    return raw ? raw.replace(/\b\w/g, (m) => m.toUpperCase()) : 'Unknown';
  }

  async function getAccessToken() {
    const runtime = window.PROOFLINK_OPERATOR_RUNTIME || {};
    if (typeof runtime.getAccessToken === 'function') {
      return runtime.getAccessToken();
    }
    return '';
  }

  async function apiPost(path, payload) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Request failed.');
    }
    return data;
  }

  function getPlanKey() {
    return state.planKey || state.startContext?.planKey || 'starter';
  }

  function getStorefrontUrl() {
    const slug = state.tenantSlug || state.startContext?.tenantSlug || '';
    if (!slug) return '/';
    return `https://${slug}.prooflink.co`;
  }

  function renderStaticBusinessContext() {
    const ctx = state.startContext || {};
    const tenantSlug = state.tenantSlug || ctx.tenantSlug || 'unknown';
    const businessName = ctx.businessName || tenantSlug;
    const ownerName = ctx.ownerName || 'Unknown';
    const email = ctx.email || 'Unknown';
    const planKey = state.planKey || ctx.planKey || 'starter';
    const selfServe = isSelfServeStart();

    $('pageTitle').textContent = `Finish setup for ${businessName}`;
    $('pageSub').textContent = selfServe
      ? `Set up the website, billing, and live workflow for ${businessName} without waiting on a manual handoff.`
      : `Complete billing, payouts, and launch for ${businessName}.`;
    const eyebrow = $('onboardingEyebrow');
    if (eyebrow) eyebrow.textContent = selfServe ? 'Self-serve setup' : 'Workspace setup';

    $('businessKv').innerHTML = `
      <div class="k">Business</div><div>${businessName}</div>
      <div class="k">Owner</div><div>${ownerName}</div>
      <div class="k">Email</div><div>${email}</div>
      <div class="k">Storefront URL</div><div>${tenantSlug}.prooflink.co</div>
      <div class="k">Plan</div><div>${titleCase(planKey)}</div>
    `;

    $('subdomainText').textContent = `https://${tenantSlug}.prooflink.co`;
    $('openStorefrontBtn').href = getStorefrontUrl();
  }

  function renderPills() {
    const ps = state.paymentState || {};
    const plan = titleCase(ps.prooflinkPlanKey || getPlanKey());
    const billing = billingLabel(ps.billingStatus || 'onboarding');
    const connect = connectLabel(ps.connectStatus || 'connect_not_started');
    const eligible = ps.onlinePaymentsEligible ? 'Eligible' : 'Blocked';

    $('summaryPills').innerHTML = `
      <div class="pill">Plan: ${plan}</div>
      <div class="pill ${ps.billingStatus === 'active' ? 'good' : 'warn'}">Billing: ${billing}</div>
      <div class="pill ${ps.connectStatus === 'connect_connected' ? 'good' : 'warn'}">Connect: ${connect}</div>
      <div class="pill ${ps.onlinePaymentsEligible ? 'good' : 'warn'}">Checkout: ${eligible}</div>
    `;

    $('livePills').innerHTML = `
      <div class="pill ${ps.billingStatus === 'active' ? 'good' : 'warn'}">Billing ${billing}</div>
      <div class="pill ${ps.connectStatus === 'connect_connected' ? 'good' : 'warn'}">Connect ${connect}</div>
      <div class="pill ${ps.onlinePaymentsEligible ? 'good' : 'warn'}">${ps.onlinePaymentsEligible ? 'Online payments enabled' : 'Online payments blocked'}</div>
    `;

    $('billingStatusText').textContent = billing;
    $('planText').textContent = plan;
    $('connectStatusText').textContent = connect;
    $('eligibilityText').textContent = ps.onlinePaymentsEligible ? 'Eligible' : (ps.onlinePaymentsReason || 'Blocked');
  }

  function computeStep() {
    const ps = state.paymentState || {};
    if (ps.billingStatus !== 'active') return 2;
    if (ps.connectStatus !== 'connect_connected') return 3;
    if (!state.firstOfferDone) return 4;
    return 5;
  }

  function renderStepNav() {
    const current = state.currentStep;
    const doneMap = {
      1: true,
      2: (state.paymentState?.billingStatus === 'active'),
      3: (state.paymentState?.connectStatus === 'connect_connected'),
      4: state.firstOfferDone,
      5: false,
    };

    [1, 2, 3, 4, 5].forEach((n) => {
      const nav = $(`nav-step-${n}`);
      if (!nav) return;
      nav.classList.remove('active', 'done');
      if (doneMap[n]) nav.classList.add('done');
      if (n === current) nav.classList.add('active');
    });

    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
    $(`step-${current}`)?.classList.add('active');
  }

  async function refreshPaymentState() {
    const payload = { tenantId: state.tenantSlug || state.tenantId };
    const data = await apiPost('/.netlify/functions/tenant-payment-status', payload);
    state.paymentState = data.paymentState || null;
    state.tenantSlug = data.tenantSlug || state.tenantSlug;
    state.tenantId = data.tenantId || state.tenantId;
    renderStaticBusinessContext();
    renderPills();
    state.currentStep = computeStep();
    renderStepNav();
  }

  async function startBilling() {
    if (getPlanKey() === 'enterprise') {
      throw new Error('Enterprise billing is finalized through a guided rollout after setup.');
    }

    const params = new URLSearchParams();
    if (state.tenantSlug) params.set('tenant', state.tenantSlug);
    if (getPlanKey()) params.set('plan', getPlanKey());
    const query = params.toString();
    const returnBase = `${window.location.origin}/operator/onboarding.html${query ? `?${query}` : ''}`;
    const joiner = query ? '&' : '?';

    setMsg(2, 'Creating Stripe subscription checkout…', '');
    const data = await apiPost('/.netlify/functions/stripe-platform-checkout', {
      tenantId: state.tenantSlug || state.tenantId,
      planKey: getPlanKey(),
      successUrl: `${returnBase}${joiner}billing=success#payments`,
      cancelUrl: `${returnBase}${joiner}billing=cancel#payments`,
    });
    setMsg(2, 'Redirecting to Stripe…', '');
    if (data.url) window.location.href = data.url;
  }

  async function startConnect() {
    const params = new URLSearchParams();
    if (state.tenantSlug) params.set('tenant', state.tenantSlug);
    if (getPlanKey()) params.set('plan', getPlanKey());
    const query = params.toString();
    const returnBase = `${window.location.origin}/operator/onboarding.html${query ? `?${query}` : ''}`;
    const joiner = query ? '&' : '?';

    setMsg(3, 'Creating Stripe Connect onboarding link…', '');
    const data = await apiPost('/.netlify/functions/stripe-connect-link', {
      tenantId: state.tenantSlug || state.tenantId,
      refreshUrl: `${returnBase}${joiner}connect=refresh#payments`,
      returnUrl: `${returnBase}${joiner}connect=return#payments`,
    });
    setMsg(3, 'Redirecting to Stripe Connect…', '');
    if (data.url) window.location.href = data.url;
  }

  function consumeRedirectFlags() {
    const params = new URLSearchParams(window.location.search || '');
    const billing = String(params.get('billing') || '').toLowerCase();
    const connect = String(params.get('connect') || '').toLowerCase();

    if (billing === 'success') {
      setMsg(2, 'Billing checkout returned successfully. Refresh once if webhook truth has not landed yet.', 'good');
    } else if (billing === 'cancel') {
      setMsg(2, 'Billing checkout was canceled before completion.', 'bad');
    }

    if (connect === 'return') {
      setMsg(3, 'Stripe Connect returned successfully. Refresh once if account truth has not landed yet.', 'good');
    } else if (connect === 'refresh') {
      setMsg(3, 'Stripe asked for a refreshed onboarding link. Start Connect Stripe again.', 'bad');
    }

    params.delete('billing');
    params.delete('connect');
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
    if (window.history?.replaceState) window.history.replaceState(null, '', next);
  }

  function bind() {
    $('goToBillingBtn')?.addEventListener('click', () => startBilling().catch((e) => setMsg(2, e.message || String(e), 'bad')));
    $('startBillingBtn')?.addEventListener('click', () => startBilling().catch((e) => setMsg(2, e.message || String(e), 'bad')));
    $('connectStripeBtn')?.addEventListener('click', () => startConnect().catch((e) => setMsg(3, e.message || String(e), 'bad')));

    $('refreshStateBtn1')?.addEventListener('click', () => refreshPaymentState().catch((e) => setMsg(1, e.message || String(e), 'bad')));
    $('refreshStateBtn2')?.addEventListener('click', () => refreshPaymentState().catch((e) => setMsg(2, e.message || String(e), 'bad')));
    $('refreshStateBtn3')?.addEventListener('click', () => refreshPaymentState().catch((e) => setMsg(3, e.message || String(e), 'bad')));

    $('markProductsDoneBtn')?.addEventListener('click', () => {
      state.firstOfferDone = true;
      localStorage.setItem(`prooflink_first_offer_done:${state.tenantSlug}`, '1');
      state.currentStep = computeStep();
      renderStepNav();
      setMsg(4, 'Marked as done. Move into publish and storefront testing.', 'good');
    });
  }

  async function boot() {
    state.startContext = readStartContext();
    state.tenantSlug = getTenantFromUrl() || state.startContext?.tenantSlug || '';
    state.tenantId = state.startContext?.tenantId || '';
    state.planKey = getPlanFromUrl() || state.startContext?.planKey || 'starter';
    state.firstOfferDone = localStorage.getItem(`prooflink_first_offer_done:${state.tenantSlug}`) === '1';

    if (state.startContext) {
      state.startContext.planKey = state.planKey;
      localStorage.setItem('prooflink_start_context', JSON.stringify(state.startContext));
    }

    renderStaticBusinessContext();
    bind();
    consumeRedirectFlags();

    try {
      await refreshPaymentState();
    } catch (e) {
      setMsg(1, e.message || String(e), 'bad');
      state.currentStep = 1;
      renderStepNav();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot().catch(console.error); }, { once: true });
  } else {
    boot().catch(console.error);
  }
})();
