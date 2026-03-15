(function () {
  'use strict';

  var currentPlanEl = document.getElementById('currentPlan');
  var planSummaryEl = document.getElementById('planSummary');
  var upgradeMount = document.getElementById('upgradeMount');
  var paymentReadinessMount = document.getElementById('paymentReadinessMount');
  var checkoutMount = document.getElementById('checkoutMount');
  var paymentsMsg = document.getElementById('paymentsMsg');
  var btnRefresh = document.getElementById('refreshPaymentsBtn');
  var planModal = document.getElementById('planModal');
  var changePlanBtn = document.getElementById('changePlanBtn');
  var closeModal = document.getElementById('closeModal');
  var planButtons = Array.prototype.slice.call(document.querySelectorAll('[data-plan]'));

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, function (s) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
    });
  }

  function setMsg(text, type) {
    if (!paymentsMsg) return;
    paymentsMsg.textContent = text || '';
    paymentsMsg.className = 'status-msg' + (type ? ' ' + type : '');
  }

  function openModal() {
    if (planModal) planModal.classList.remove('hidden');
  }

  function hideModal() {
    if (planModal) planModal.classList.add('hidden');
  }

  function readOperatorToken() {
    return sessionStorage.getItem('pl_op_token') || '';
  }

  function derivePlanLabel(key) {
    if (key === 'enterprise') return 'Enterprise';
    if (key === 'growth') return 'Growth';
    return 'Starter';
  }

  function renderCheckout(state, raw) {
    var planKey = (state && state.prooflinkPlanKey) || (raw && raw.prooflink_plan_key) || 'starter';
    var allowed = window.ProofLinkPlan && window.ProofLinkPlan.canUse ? window.ProofLinkPlan.canUse('onlineCheckout', { prooflink_plan_key: planKey }) : false;
    var eligible = !!(state && state.onlinePaymentsEligible);

    if (!allowed) {
      return window.ProofLinkFeatureLock.render({
        title: 'Online checkout locked',
        description: 'Online checkout is part of the Growth plan and above.',
        requiredTier: 'growth'
      }) + window.ProofLinkUpgradePanel.render(planKey);
    }

    return ''
      + '<section class="card">'
      + '<h2>Customer checkout</h2>'
      + '<p>' + (eligible
          ? 'Online checkout is eligible. The tenant has active billing, a connected Stripe account, and payment flow enabled.'
          : 'Checkout is available on this tier, but it is not live yet. Finish billing and Stripe readiness first.') + '</p>'
      + '<div class="status-inline ' + (eligible ? 'ready' : 'pending') + '">' + (eligible ? 'Ready for online checkout' : 'Pending payment readiness') + '</div>'
      + '</section>';
  }

  function renderPlanSummary(state) {
    var planKey = (state && state.prooflinkPlanKey) || 'starter';
    var planRules = window.ProofLinkPlan && window.ProofLinkPlan.getPlanRules ? window.ProofLinkPlan.getPlanRules({ prooflink_plan_key: planKey }) : {};
    var limits = [
      ['Products', planRules.products === Infinity ? 'Unlimited' : planRules.products],
      ['Customers', planRules.customers === Infinity ? 'Unlimited' : planRules.customers],
      ['Orders', planRules.orders === Infinity ? 'Unlimited' : planRules.orders],
      ['Operators', planRules.operators === Infinity ? 'Unlimited' : planRules.operators],
      ['Analytics', planRules.analytics || 'basic']
    ];

    return '<div class="plan-summary-grid">' + limits.map(function (item) {
      return '<div class="plan-summary-item"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>';
    }).join('') + '</div>';
  }

  async function loadPaymentState() {
    var token = readOperatorToken();
    setMsg('Loading payment truth…');

    try {
      var res = await fetch('/.netlify/functions/tenant-payment-status', {
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load payment state.');

      var state = data.paymentState || {};
      var raw = data.raw || {};
      var planLabel = derivePlanLabel(state.prooflinkPlanKey || raw.prooflink_plan_key);

      if (currentPlanEl) currentPlanEl.textContent = planLabel;
      if (planSummaryEl) planSummaryEl.innerHTML = renderPlanSummary(state);
      if (paymentReadinessMount) {
        paymentReadinessMount.innerHTML = window.ProofLinkStripeReadiness.render({
          billing_status: state.billingStatus,
          connect_status: state.connectStatus,
          payouts_enabled: raw.payouts_enabled,
          details_submitted: raw.details_submitted,
          onlinePaymentsEligible: state.onlinePaymentsEligible
        });
      }
      if (checkoutMount) checkoutMount.innerHTML = renderCheckout(state, raw);

      var summary = [];
      summary.push('Billing: ' + esc(state.billingStatus || 'unknown'));
      summary.push('Connect: ' + esc(state.connectStatus || 'unknown'));
      summary.push('Payments enabled: ' + (state.paymentsEnabled ? 'yes' : 'no'));
      summary.push('Online eligible: ' + (state.onlinePaymentsEligible ? 'yes' : 'no'));
      setMsg(summary.join(' • '), state.onlinePaymentsEligible ? 'ready' : 'pending');
    } catch (err) {
      if (paymentReadinessMount) paymentReadinessMount.innerHTML = '<section class="card"><h2>Payment readiness</h2><p>Unable to load tenant payment state.</p></section>';
      if (checkoutMount) checkoutMount.innerHTML = '';
      if (planSummaryEl) planSummaryEl.innerHTML = '';
      if (upgradeMount) upgradeMount.innerHTML = window.ProofLinkUpgradePanel.render('starter');
      setMsg(err.message || 'Failed to load payment state.', 'error');
    }
  }

  if (changePlanBtn) changePlanBtn.addEventListener('click', openModal);
  if (closeModal) closeModal.addEventListener('click', hideModal);
  if (btnRefresh) btnRefresh.addEventListener('click', loadPaymentState);
  planButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setMsg('Plan selection captured: ' + btn.getAttribute('data-plan') + '. Wire this button into your billing flow next.', 'pending');
      hideModal();
    });
  });

  loadPaymentState();
})();
