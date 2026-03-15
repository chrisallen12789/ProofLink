(function (global) {
  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, function (s) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
    });
  }

  function renderServerChecklist(payload) {
    payload = payload || {};
    var steps = Array.isArray(payload.steps) ? payload.steps : [];
    var percent = Number(payload.percent || 0);
    var launchReady = payload.launch_ready === true;

    return ''
      + '<section class="pl-launch-checklist-card" data-tour="launch-checklist">'
      + '  <div class="pl-launch-checklist-card__head">'
      + '    <div>'
      + '      <h3>Launch checklist</h3>'
      + '      <p>' + (launchReady ? 'Core launch tasks are complete.' : 'Drive the business toward a live, trustworthy storefront.') + '</p>'
      + '    </div>'
      + '    <div class="pl-launch-checklist-card__percent">' + percent + '%</div>'
      + '  </div>'
      + '  <div class="pl-launch-checklist-card__bar"><span style="width:' + Math.max(0, Math.min(percent,100)) + '%"></span></div>'
      + '  <ol class="pl-launch-checklist-card__list">'
      + steps.map(function (step) {
          var cta = step && step.cta && step.cta.href
            ? '<a class="pl-launch-checklist-card__cta" href="' + esc(step.cta.href) + '">' + esc(step.cta.label || 'Open') + '</a>'
            : '<span class="pl-launch-checklist-card__cta is-passive">' + (step.complete ? 'Done' : 'Pending') + '</span>';
          return ''
            + '<li class="' + (step.complete ? 'is-complete' : '') + '">'
            + '  <span class="pl-launch-checklist-card__dot">' + (step.complete ? '✓' : '•') + '</span>'
            + '  <div class="pl-launch-checklist-card__copy">'
            + '    <strong>' + esc(step.label) + '</strong>'
            + '    <p>' + esc(step.detail || '') + '</p>'
            + '  </div>'
            + cta
            + '</li>';
        }).join('')
      + '  </ol>'
      + '</section>';
  }

  global.ProofLinkChecklistEngine = { renderServerChecklist: renderServerChecklist };
})(window);
