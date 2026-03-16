(function (global) {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(currentPlan, context) {
    currentPlan = currentPlan || 'starter';
    context = context || {};
    var headline = context.headline || 'Upgrade readiness';
    var recommendation = context.recommendation || 'Move up before the next operational choke point hits the tenant.';

    return ''
      + '<section class="pl-upgrade-panel">'
      + '  <h3>' + esc(headline) + '</h3>'
      + '  <p>Your current plan is <strong>' + esc(currentPlan) + '</strong>.</p>'
      + '  <p>' + esc(recommendation) + '</p>'
      + '  <div class="pl-upgrade-panel__tiers">'
      + '    <article><h4>Growth</h4><p>Higher operational ceilings for products, customers, seats, and monthly order volume.</p></article>'
      + '    <article><h4>Enterprise</h4><p>Best fit when storage, automation, and admin visibility are becoming the real constraint.</p></article>'
      + '  </div>'
      + '  <button type="button" class="pl-upgrade-btn" data-open-upgrade="true">View plan options</button>'
      + '</section>';
  }

  function renderFromHealth(health) {
    if (!health || !health.mostPressured) return '';
    var pressured = health.mostPressured;
    if (!(pressured.warning || pressured.blocked)) return '';

    return render(health.prooflink_plan_key || 'starter', {
      headline: pressured.blocked ? 'Upgrade is now required' : 'Upgrade path is opening up',
      recommendation: pressured.blocked
        ? 'The tenant is hard stopped on ' + String(pressured.key || 'capacity').replace(/_/g, ' ') + '. Recommend ' + (health.recommended_plan_key || 'growth') + ' immediately.'
        : 'The tenant is at ' + pressured.percentUsed + '% of ' + String(pressured.key || 'capacity').replace(/_/g, ' ') + '. Recommend ' + (health.recommended_plan_key || 'growth') + ' before growth stalls.'
    });
  }

  global.ProofLinkUpgradePanel = {
    render: render,
    renderFromHealth: renderFromHealth,
  };
})(window);
