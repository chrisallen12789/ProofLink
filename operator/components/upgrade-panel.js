(function (global) {
  function render(currentPlan) {
    currentPlan = currentPlan || 'starter';
    return ''
      + '<section class="pl-upgrade-panel">'
      + '  <h2>Upgrade ProofLink</h2>'
      + '  <p>Your current plan is <strong>' + currentPlan + '</strong>.</p>'
      + '  <div class="pl-upgrade-panel__tiers">'
      + '    <article><h3>Growth</h3><p>Online payments, stronger analytics, and more scale.</p></article>'
      + '    <article><h3>Enterprise</h3><p>Automation, advanced reporting, premium controls, and deepest visibility.</p></article>'
      + '  </div>'
      + '  <button type="button" class="pl-upgrade-btn" data-open-upgrade="true">Upgrade now</button>'
      + '</section>';
  }

  global.ProofLinkUpgradePanel = { render: render };
})(window);
