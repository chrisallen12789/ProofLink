(function (global) {
  function deriveState(tenant) {
    tenant = tenant || {};
    var manualMode = tenant.manualMode === true || tenant.billing_status === 'manual' || tenant.billingStatus === 'manual' || tenant.billing_status === 'manual_active' || tenant.billingStatus === 'manual_active';
    var billingActive = manualMode || tenant.billing_status === 'active' || tenant.billingStatus === 'active';
    var connectReady = manualMode || tenant.connect_status === 'connect_connected' || tenant.connectStatus === 'connect_connected';
    var payoutsReady = manualMode || tenant.payouts_enabled === true || tenant.payoutsReady === true;
    var detailsSubmitted = manualMode || tenant.details_submitted === true || tenant.detailsSubmitted === true;
    var onlineCheckoutReady = tenant.online_payments_enabled === true || tenant.onlinePaymentsEligible === true || (!manualMode && billingActive && connectReady);
    return {
      manualMode: manualMode,
      billingActive: billingActive,
      connectReady: connectReady,
      payoutsReady: payoutsReady,
      detailsSubmitted: detailsSubmitted,
      onlineCheckoutReady: onlineCheckoutReady
    };
  }

  function render(tenant) {
    var state = deriveState(tenant);
    var rows = [
      ['Manual billing active', state.billingActive],
      ['Manual collections configured', state.connectReady],
      ['Collection guidance visible', state.detailsSubmitted],
      ['Operator payment tracking enabled', state.payoutsReady],
      ['Online checkout', state.onlineCheckoutReady]
    ];
    return ''
      + '<section class="pl-stripe-readiness" data-tour="stripe-connect">'
      + '  <h2>Payment readiness</h2>'
      + '  <ul>'
      + rows.map(function (row) {
          return '<li class="' + (row[1] ? 'is-ready' : 'is-pending') + '"><span>' + (row[1] ? '✓' : '•') + '</span><strong>' + row[0] + '</strong><em>' + (row[1] ? 'Ready' : 'Pending') + '</em></li>';
        }).join('')
      + '  </ul>'
      + '</section>';
  }

  global.ProofLinkStripeReadiness = { deriveState: deriveState, render: render };
})(window);
