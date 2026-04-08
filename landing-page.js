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
      const replaces = (plan.replaces || [])
        .map((item) => `<span class="pricing-chip">${item}</span>`)
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
          <div class="pricing-flat-fee">${plan.feePromise || 'One flat monthly fee for the core operating system.'}</div>
          <ul class="pricing-list">${limits}</ul>
          <ul class="pricing-highlights">${highlights}</ul>
          ${replaces ? `<div class="pricing-replaces"><div class="pricing-replaces__label">Replaces</div><div class="pricing-chip-row">${replaces}</div></div>` : ''}
          <div class="pricing-website-note">${plan.websiteNote || 'Custom website work is optional and separate.'}</div>
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

  function wireBrandCosmos() {
    const cosmos = $('[data-brand-cosmos]');
    if (!cosmos) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const setTilt = (x, y) => {
      cosmos.style.setProperty('--brand-tilt-x', `${x}deg`);
      cosmos.style.setProperty('--brand-tilt-y', `${y}deg`);
    };

    const handlePointerMove = (event) => {
      const rect = cosmos.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const tiltY = clamp((px - 0.5) * 22, -11, 11);
      const tiltX = clamp((0.5 - py) * 18 - 6, -14, 8);
      setTilt(tiltX, tiltY);
    };

    const handlePointerLeave = () => {
      setTilt(-10, 10);
    };

    const mount = () => {
      setTilt(-10, 10);
      cosmos.addEventListener('pointermove', handlePointerMove, { passive: true });
      cosmos.addEventListener('pointerleave', handlePointerLeave, { passive: true });
    };

    const unmount = () => {
      cosmos.removeEventListener('pointermove', handlePointerMove);
      cosmos.removeEventListener('pointerleave', handlePointerLeave);
    };

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          mount();
        } else {
          unmount();
          handlePointerLeave();
        }
      }, { threshold: 0.15 });
      observer.observe(cosmos);
      return;
    }

    mount();
  }

  function setFooterYear() {
    const year = $('#footerYear');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function boot() {
    renderPricingCards();
    wirePlanLinks();
    wireNav();
    wireBrandCosmos();
    setFooterYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
