(function () {
  'use strict';

  var STORAGE_KEY = 'prooflink_tour_completed_v2';
  var TOUR = null;
  var AUTO_STARTED = false;

  function isLoggedIn() {
<<<<<<< HEAD
    var app = document.getElementById('viewApp');
=======
    const app = document.getElementById('viewApp');
>>>>>>> 16eea6c0f5a9409dd72cf5f924f250af6996ce89
    return !!sessionStorage.getItem('pl_op_token') || !!(app && !app.classList.contains('hidden'));
  }

  function isCompleted() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function markCompleted() {
    localStorage.setItem(STORAGE_KEY, '1');
  }

  function clearCompleted() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function q(sel) {
    return document.querySelector(sel);
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function panelButton(tab) {
    return q('.tab[data-tab="' + tab + '"]');
  }

  async function switchTo(tab) {
    if (window.location.hash !== '#' + tab && typeof window.PROOFLINK_OPERATOR_RUNTIME !== 'undefined') {
      var btn = panelButton(tab);
      if (btn) btn.click();
    } else {
      var btn2 = panelButton(tab);
      if (btn2 && !btn2.classList.contains('active')) btn2.click();
    }
    await wait(280);
  }

  function currentStepConfig() {
    return [
      {
        selector: '[data-tour="checklist"]',
        title: 'Startup progress',
        body: 'This is your launch checklist. Each item should move the operator toward a live storefront. Every row is clickable, so the user can jump straight to the place that needs work.',
        tab: 'dashboard',
        placement: 'right'
      },
      {
        selector: '[data-tour-tab="products"]',
        title: 'Products comes first',
        body: 'A new operator needs something to sell before the rest of the workflow makes sense. This is where they create the first product or service.',
        tab: 'dashboard',
        placement: 'right'
      },
      {
        selector: '[data-tour="new-product"]',
        title: 'Create the first product',
        body: 'Use this button to start a product record. Product setup is the earliest high-value action in the system, so the tour should drive people here fast.',
        tab: 'products',
        placement: 'left'
      },
      {
        selector: '[data-tour="product-image-upload"]',
        title: 'Add product media',
        body: 'This is where the operator uploads product imagery. Product photos affect trust and conversion, so the UI should keep this obvious.',
        tab: 'products',
        placement: 'left'
      },
      {
        selector: '[data-tour-tab="setup"]',
        title: 'Business Setup',
        body: 'This page is for branding, storefront media, and public profile upkeep. It is not where they rewrite application or account-record data.',
        tab: 'products',
        placement: 'right'
      },
      {
        selector: '[data-tour="verified-record"]',
        title: 'Protected business record',
        body: 'These values stay visible but locked. Operators can see their approved record, but they cannot manipulate protected onboarding or compliance fields from this workspace.',
        tab: 'setup',
        placement: 'left'
      },
      {
        selector: '[data-tour="branding-form"]',
        title: 'Branding and public profile',
        body: 'This is the editable part of setup. Operators can manage logos, hero images, copy, contact details, and customer-facing profile information here.',
        tab: 'setup',
        placement: 'left'
      },
      {
        selector: '[data-tour="stripe-connect"]',
        title: 'Payments and payouts',
        body: 'This section tells the operator whether payouts and online checkout are truly ready. Keep this explicit so nobody assumes payments are live when they are not.',
        tab: 'payments',
        placement: 'left'
      },
      {
        selector: '[data-tour="domains-card"]',
        title: 'Domains and launch readiness',
        body: 'This is where the operator sees DNS and routing instructions. That keeps domain work clear and separated from general branding tasks.',
        tab: 'domains',
        placement: 'left'
      },
      {
        selector: '[data-tour="customers-list"]',
        title: 'CRM history',
        body: 'Once orders start coming in, this area becomes the customer memory of the business. It is where operators build repeatability instead of relying on memory.',
        tab: 'customers',
        placement: 'left'
      },
      {
        selector: '[data-tour="orders-list"]',
        title: 'Tracked orders',
        body: 'This is where requests become managed work. The user should understand that orders are not just notes; they are operational records.',
        tab: 'orders',
        placement: 'left'
      },
      {
        selector: '[data-tour="guidance-wrap"]',
        title: 'Guidance and restartability',
        body: 'This area can reinforce what to do next. The user can also restart the tour from the Start tour button in the header whenever they need another pass.',
        tab: 'guidance',
        placement: 'left'
      }
    ];
  }

  function buildStyles() {
    if (q('#pl-tour-styles')) return;
    var style = document.createElement('style');
    style.id = 'pl-tour-styles';
    style.textContent = '' +
      '.pl-tour-overlay{position:fixed;inset:0;z-index:10000;pointer-events:none;}' +
      '.pl-tour-dim{position:absolute;inset:0;background:rgba(0,0,0,.62);}' +
      '.pl-tour-hole{position:absolute;border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.62),0 0 0 2px rgba(255,255,255,.14),0 0 0 6px rgba(200,75,47,.24);transition:all .22s ease;}' +
      '.pl-tour-target{position:relative !important;z-index:10001 !important;}' +
      '.pl-tour-card{position:fixed;z-index:10002;max-width:360px;width:min(360px,calc(100vw - 32px));background:#171717;color:#f5f2ea;border:1px solid rgba(255,255,255,.10);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:18px;pointer-events:auto;transition:all .22s ease;}' +
      '.pl-tour-kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#b8b1a5;margin-bottom:6px;font-weight:700;}' +
      '.pl-tour-title{font-size:22px;line-height:1.15;font-weight:800;margin:0 0 8px;}' +
      '.pl-tour-body{font-size:14px;line-height:1.6;color:#ddd6ca;}' +
      '.pl-tour-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;}' +
      '.pl-tour-progress{font-size:12px;color:#b8b1a5;}' +
      '.pl-tour-btns{display:flex;gap:8px;}' +
      '.pl-tour-btn{appearance:none;border-radius:999px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.14);background:#252525;color:#f5f2ea;}' +
      '.pl-tour-btn:hover{border-color:rgba(255,255,255,.28);}' +
      '.pl-tour-btn.primary{background:#c84b2f;border-color:#c84b2f;color:#fff;}' +
      '.pl-tour-btn.ghost{background:transparent;color:#ddd6ca;}' +
      '@media (max-width: 900px){.pl-tour-card{left:16px !important;right:16px !important;bottom:16px !important;top:auto !important;width:auto;max-width:none;}}';
    document.head.appendChild(style);
  }

  function destroy() {
    var overlay = q('#pl-tour-overlay');
    if (overlay) overlay.remove();
    document.querySelectorAll('.pl-tour-target').forEach(function (el) { el.classList.remove('pl-tour-target'); });
    TOUR = null;
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'pl-tour-overlay';
    overlay.className = 'pl-tour-overlay';
    overlay.innerHTML = '<div class="pl-tour-dim"></div><div class="pl-tour-hole"></div><div class="pl-tour-card"><div class="pl-tour-kicker">Operator guided tour</div><h3 class="pl-tour-title"></h3><div class="pl-tour-body"></div><div class="pl-tour-actions"><div class="pl-tour-progress"></div><div class="pl-tour-btns"><button class="pl-tour-btn ghost" data-tour-exit type="button">Exit</button><button class="pl-tour-btn" data-tour-back type="button">Back</button><button class="pl-tour-btn primary" data-tour-next type="button">Next</button></div></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-tour-exit]').addEventListener('click', function () { destroy(); markCompleted(); });
    overlay.querySelector('[data-tour-back]').addEventListener('click', function () { if (TOUR) TOUR.prev(); });
    overlay.querySelector('[data-tour-next]').addEventListener('click', function () { if (TOUR) TOUR.next(); });
    return overlay;
  }

  function targetRect(el) {
    var r = el.getBoundingClientRect();
    return {
      top: Math.max(8, r.top - 8),
      left: Math.max(8, r.left - 8),
      width: Math.max(40, r.width + 16),
      height: Math.max(40, r.height + 16)
    };
  }

  function placeCard(card, rect, placement) {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var margin = 16;
    var desiredTop = rect.top;
    var desiredLeft = rect.left + rect.width + 18;

    if (placement === 'left') desiredLeft = rect.left - card.offsetWidth - 18;
    if (placement === 'bottom') {
      desiredTop = rect.top + rect.height + 18;
      desiredLeft = rect.left;
    }
    if (placement === 'top') {
      desiredTop = rect.top - card.offsetHeight - 18;
      desiredLeft = rect.left;
    }

    if (desiredLeft + card.offsetWidth > vw - margin) desiredLeft = vw - card.offsetWidth - margin;
    if (desiredLeft < margin) desiredLeft = margin;
    if (desiredTop + card.offsetHeight > vh - margin) desiredTop = vh - card.offsetHeight - margin;
    if (desiredTop < margin) desiredTop = margin;

    card.style.left = desiredLeft + 'px';
    card.style.top = desiredTop + 'px';
    card.style.right = 'auto';
    card.style.bottom = 'auto';
  }

  async function renderStep(tour) {
    var step = tour.steps[tour.index];
    await switchTo(step.tab);
    var target = q(step.selector);
    if (!target) {
      tour.next();
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await wait(260);

    document.querySelectorAll('.pl-tour-target').forEach(function (el) { el.classList.remove('pl-tour-target'); });
    target.classList.add('pl-tour-target');

    var overlay = q('#pl-tour-overlay') || createOverlay();
    var hole = overlay.querySelector('.pl-tour-hole');
    var card = overlay.querySelector('.pl-tour-card');
    var title = overlay.querySelector('.pl-tour-title');
    var body = overlay.querySelector('.pl-tour-body');
    var progress = overlay.querySelector('.pl-tour-progress');
    var back = overlay.querySelector('[data-tour-back]');
    var next = overlay.querySelector('[data-tour-next]');

    var rect = targetRect(target);
    hole.style.top = rect.top + 'px';
    hole.style.left = rect.left + 'px';
    hole.style.width = rect.width + 'px';
    hole.style.height = rect.height + 'px';

    title.textContent = step.title;
    body.textContent = step.body;
    progress.textContent = 'Step ' + (tour.index + 1) + ' of ' + tour.steps.length;
    back.style.visibility = tour.index === 0 ? 'hidden' : 'visible';
    next.textContent = tour.index === tour.steps.length - 1 ? 'Finish' : 'Next';

    placeCard(card, rect, step.placement || 'right');
  }

  function buildTour() {
    buildStyles();
    return {
      steps: currentStepConfig(),
      index: 0,
      async start(options) {
        options = options || {};
        if (!isLoggedIn()) return;
        if (!options.force && isCompleted()) return;
        if (options.force) clearCompleted();
        this.index = 0;
        TOUR = this;
        await renderStep(this);
      },
      async next() {
        if (this.index >= this.steps.length - 1) {
          markCompleted();
          destroy();
          return;
        }
        this.index += 1;
        await renderStep(this);
      },
      async prev() {
        if (this.index <= 0) return;
        this.index -= 1;
        await renderStep(this);
      }
    };
  }

  function bootTour(force) {
    if (!isLoggedIn()) return;
    if (!force && isCompleted()) return;
    if (!TOUR) TOUR = buildTour();
    TOUR.start({ force: !!force });
  }

  function tryAutoStart() {
    if (AUTO_STARTED) return;
    if (!isLoggedIn()) return;
    AUTO_STARTED = true;
    bootTour(false);
  }

  window.PROOFLINK_WALKTHROUGH = {
    start: function (opts) { bootTour(!!(opts && opts.force)); },
    restart: function () { bootTour(true); },
    clear: clearCompleted
  };

  window.addEventListener('resize', function () {
    if (TOUR) renderStep(TOUR);
  });
  window.addEventListener('hashchange', function () {
    if (TOUR) setTimeout(function () { renderStep(TOUR); }, 180);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryAutoStart, 1400); });
  } else {
    setTimeout(tryAutoStart, 1400);
  }

  var originalSetItem = sessionStorage.setItem.bind(sessionStorage);
  sessionStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (key === 'pl_op_token' && value) {
      setTimeout(tryAutoStart, 450);
    }
  };
})();
