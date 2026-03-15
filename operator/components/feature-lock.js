(function (global) {
  function render(opts) {
    opts = opts || {};
    var title = opts.title || 'Feature Locked';
    var description = opts.description || 'This feature is available on a higher ProofLink tier.';
    var requiredTier = opts.requiredTier || 'growth';

    return ''
      + '<section class="pl-feature-lock" data-required-tier="' + requiredTier + '">'
      + '  <div class="pl-feature-lock__card">'
      + '    <h3>' + title + '</h3>'
      + '    <p>' + description + '</p>'
      + '    <p>Upgrade to unlock this capability for your business.</p>'
      + '    <div class="pl-feature-lock__actions">'
      + '      <button type="button" class="pl-upgrade-btn" data-open-upgrade="true">View plans</button>'
      + '    </div>'
      + '  </div>'
      + '</section>';
  }

  global.ProofLinkFeatureLock = { render: render };
})(window);
