'use strict';

(function () {
  const SITE_URL = window.SITE_URL || '';

  function byId(id) {
    return document.getElementById(id);
  }

  function getTenantSlug() {
    const params = new URLSearchParams(window.location.search);
    return params.get('slug') || params.get('tenant') || sessionStorage.getItem('pl_tenant_slug') || '';
  }

  function getTenantId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('tenant_id') || '';
  }

  function show(id) {
    byId(id)?.classList.remove('is-hidden');
  }

  function hide(id) {
    byId(id)?.classList.add('is-hidden');
  }

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function showError(message) {
    hide('loading-state');
    hide('main-content');
    const errorMsg = byId('error-msg');
    if (errorMsg) errorMsg.textContent = message;
    show('error-state');
  }

  function renderChecklist(data) {
    hide('loading-state');
    hide('error-state');

    if (data.tenant_slug) sessionStorage.setItem('pl_tenant_slug', data.tenant_slug);

    const launchTitle = byId('launch-title');
    if (data.tenant_name && launchTitle) {
      launchTitle.textContent = `Build momentum for ${data.tenant_name}.`;
    }

    const welcomePill = byId('welcome-pill');
    if (welcomePill) welcomePill.textContent = data.launch_ready ? 'Up and running' : 'Ready to start';

    const launchSub = byId('launch-sub');
    if (launchSub) {
      launchSub.textContent = data.launch_ready
        ? 'The account, workflow, and public-facing details are in place.'
        : `Complete these steps to get the first real wins inside the system. You've finished ${data.completed} of ${data.total}.`;
    }

    const pct = Number(data.percent || 0);
    const progressLabel = byId('progress-label');
    if (progressLabel) progressLabel.textContent = `${data.completed} of ${data.total} steps complete`;
    const progressPct = byId('progress-pct');
    if (progressPct) progressPct.textContent = `${pct}%`;
    const fill = byId('progress-fill');
    if (fill) {
      fill.classList.toggle('complete', data.launch_ready);
      setTimeout(() => {
        fill.style.width = `${pct}%`;
      }, 50);
    }

    const nextIdx = Array.isArray(data.steps) ? data.steps.findIndex((step) => !step.complete) : -1;
    const stepsContainer = byId('steps-container');
    if (stepsContainer) {
      stepsContainer.innerHTML = (data.steps || []).map((step, index) => {
        const isNext = index === nextIdx;
        const indicatorClass = step.complete ? 'done' : isNext ? 'next' : 'pending';
        const indicatorContent = step.complete ? 'OK' : String(index + 1);
        return `
          <div class="step ${step.complete ? 'complete' : ''} ${isNext ? 'active-step' : ''}">
            <div class="step-indicator ${indicatorClass}">${esc(indicatorContent)}</div>
            <div class="step-content">
              <div class="step-title">${esc(step.label)}</div>
              <div class="step-detail">${esc(step.detail || '')}</div>
              ${step.complete
                ? '<div class="step-badge-done">Complete</div>'
                : step.cta
                  ? `<a href="${esc(step.cta.href)}" class="step-cta">${esc(step.cta.label)}</a>`
                  : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    const allDone = byId('all-done');
    if (allDone) {
      if (data.launch_ready) {
        allDone.classList.add('visible');
        const slug = data.tenant_slug;
        const websiteUrl = slug ? (SITE_URL ? `${SITE_URL}/${slug}` : `/${slug}`) : '/';
        const websiteLink = byId('storefront-link');
        if (websiteLink) {
          websiteLink.href = websiteUrl;
          websiteLink.textContent = `Open ${data.tenant_name || 'my website'}`;
        }
      } else {
        allDone.classList.remove('visible');
      }
    }

    show('main-content');
  }

  async function loadChecklist() {
    show('loading-state');
    hide('error-state');
    hide('main-content');

    const slug = getTenantSlug();
    const tenantId = getTenantId();
    if (!slug && !tenantId) {
      showError('No tenant identifier found. Please use the link from your welcome email.');
      return;
    }

    const qs = tenantId ? `tenant_id=${tenantId}` : `slug=${slug}`;
    try {
      const response = await fetch(`/.netlify/functions/get-launch-checklist?${qs}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Request failed');
      }
      const data = await response.json();
      renderChecklist(data);
    } catch (error) {
      showError(error?.message || 'Could not load your next steps.');
    }
  }

  window.loadChecklist = loadChecklist;
  loadChecklist();
})();
