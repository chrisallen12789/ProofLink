(function (global) {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(opts) {
    opts = opts || {};
    var title = opts.title || 'Plan attention required';
    var message = opts.message || 'Your current plan is approaching a governed limit.';
    var severity = opts.severity || 'warning';
    var upgradeTier = opts.upgradeTier || 'growth';

    return ''
      + '<section class="pl-limit-banner pl-limit-banner--' + esc(severity) + '" data-upgrade-tier="' + esc(upgradeTier) + '">'
      + '  <div class="pl-limit-banner__body">'
      + '    <h3>' + esc(title) + '</h3>'
      + '    <p>' + esc(message) + '</p>'
      + '    <div class="pl-limit-banner__actions">'
      + '      <button type="button" class="pl-upgrade-btn" data-open-billing="true">Review plans</button>'
      + '    </div>'
      + '  </div>'
      + '</section>';
  }

  function renderFromHealth(health) {
    if (!health || !Array.isArray(health.resources)) return '';
    var blocked = health.resources.filter(function (item) { return item && item.blocked; });
    var warning = health.resources.filter(function (item) { return item && item.warning; });
    var primary = blocked[0] || warning[0] || null;
    if (!primary) return '';

    var title = primary.blocked ? primary.label : 'Approaching ' + String(primary.key || 'capacity').replace(/_/g, ' ');
    var message = primary.blocked
      ? 'This tenant has used ' + primary.used + ' of ' + primary.limit + ' on ' + String(primary.key || 'this resource').replace(/_/g, ' ') + '. New writes should be blocked until the record set is archived or the plan is upgraded.'
      : 'This tenant is at ' + primary.percentUsed + '% of the allowed ' + String(primary.key || 'resource').replace(/_/g, ' ') + ' capacity. Start upgrade messaging now.';

    return render({
      title: title,
      message: message,
      severity: primary.blocked ? 'blocked' : 'warning',
      upgradeTier: health.recommended_plan_key || 'growth'
    });
  }

  global.ProofLinkLimitBanner = {
    render: render,
    renderFromHealth: renderFromHealth,
  };
})(window);
