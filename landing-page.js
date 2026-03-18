(function () {
  const publicUi = window.PROOFLINK_PUBLIC;

  function $(selector) {
    return document.querySelector(selector);
  }

  function renderPricingCards() {
    const root = $('#pricingCards');
    if (!root || !publicUi) return;

    root.innerHTML = publicUi.PLAN_ORDER.map((planKey) => {
      const plan = publicUi.getPlan(planKey);
      const intent = plan.intent || 'buy';
      const badge = plan.recommended
        ? '<div class="pricing-badge">Recommended</div>'
        : '';

      const limits = plan.limits
        .map((item) => `<li>${item}</li>`)
        .join('');
      const highlights = plan.highlights
        .map((item) => `<li>${item}</li>`)
        .join('');

      return `
        <article class="pricing-card${plan.recommended ? ' recommended' : ''}">
          ${badge}
          <div class="pricing-eyebrow">${plan.eyebrow}</div>
          <h3 class="pricing-title">${plan.name}</h3>
          <p class="pricing-best-for">${plan.bestFor}</p>
          <div class="pricing-price">
            <strong>${plan.priceDisplay}</strong>
            <span>${plan.priceSuffix || ''}</span>
          </div>
          <ul class="pricing-list">${limits}</ul>
          <ul class="pricing-highlights">${highlights}</ul>
          <div class="pricing-action">
            <a
              class="btn btn-primary"
              data-plan="${plan.key}"
              data-intent="${intent}"
              data-source="pricing"
              href="${publicUi.buildJoinUrl(plan.key, { intent, source: 'pricing' })}"
            >
              ${plan.ctaLabel}
            </a>
          </div>
        </article>
      `;
    }).join('');
  }

  function wirePlanLinks() {
    if (!publicUi) return;

    document.querySelectorAll('[data-plan]').forEach((node) => {
      const planKey = publicUi.sanitizePlan(node.dataset.plan);
      const intent = node.dataset.intent || publicUi.getPlan(planKey).intent || 'buy';
      const source = node.dataset.source || 'landing';

      node.href = publicUi.buildJoinUrl(planKey, { intent, source });
      node.addEventListener('click', () => {
        publicUi.persistPlanIntent(planKey, { intent, source });
      });
    });
  }

  function wireNav() {
    const toggle = $('#navToggle');
    const links = $('#navLinks');
    if (!toggle || !links) return;

    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    });
  }

  function setFooterYear() {
    const year = $('#footerYear');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function boot() {
    renderPricingCards();
    wirePlanLinks();
    wireNav();
    setFooterYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
