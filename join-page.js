(function () {
  const Public = window.PROOFLINK_PUBLIC;

  if (!Public) {
    console.error('ProofLink public plan config is missing.');
    return;
  }

  const state = {
    step: 1,
    planIntent: Public.resolvePlanIntent({ defaultPlan: 'growth' }),
    businessType: '',
    businessName: '',
    cityState: '',
    requestedSubdomain: '',
    ownerName: '',
    ownerEmail: '',
    phone: '',
  };

  const typeLabels = {
    bakery: 'Bakery / Food',
    contractor: 'Contractor',
    lawn_care: 'Lawn Care',
    cleaning: 'Cleaning',
    photography: 'Photography',
    pet_services: 'Pet Services',
    events: 'Events',
    handyman: 'Handyman',
    other: 'Other',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function showNotify(text, tone) {
    const el = $('notify');
    if (!el) return;
    el.textContent = text || '';
    el.className = `notify ${tone || 'info'} visible`;
  }

  function hideNotify() {
    const el = $('notify');
    if (!el) return;
    el.className = 'notify';
    el.textContent = '';
  }

  function showError(id, message) {
    const el = $(id);
    if (!el) return;
    if (message) el.textContent = message;
    el.classList.add('visible');
  }

  function hideError(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('visible');
  }

  function setFieldError(fieldId, errId, isVisible) {
    const field = $(fieldId);
    if (field) field.classList.toggle('error', Boolean(isVisible));
    if (isVisible) showError(errId);
    else hideError(errId);
  }

  function selectedPlan() {
    return Public.getPlan(state.planIntent.planKey);
  }

  function planSubmissionNote(plan) {
    if (plan.key === 'enterprise') {
      return 'Enterprise requests go through a guided rollout. We confirm scope, controls, and implementation before billing starts.';
    }

    return `You are locking in the ${plan.name} plan now. You are not paying today. Billing for ${plan.name} starts after the workspace is approved, provisioned, and moved into onboarding.`;
  }

  function syncQueryString() {
    const params = new URLSearchParams(window.location.search || '');
    params.set('plan', state.planIntent.planKey);
    params.set('intent', state.planIntent.intent);
    params.set('source', state.planIntent.source || 'join');
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', next);
  }

  function renderPlanChoices() {
    const container = $('planChoiceGrid');
    if (!container) return;

    container.innerHTML = Public.PLAN_ORDER.map((planKey) => {
      const plan = Public.getPlan(planKey);
      const classes = ['plan-choice'];
      if (plan.recommended) classes.push('recommended');
      if (plan.key === state.planIntent.planKey) classes.push('selected');
      return `
        <button
          class="${classes.join(' ')}"
          type="button"
          data-plan-choice="${plan.key}"
          role="radio"
          aria-checked="${plan.key === state.planIntent.planKey ? 'true' : 'false'}"
        >
          ${plan.recommended ? '<span class="plan-choice-badge">Recommended</span>' : ''}
          <h3>${plan.name}</h3>
          <div class="plan-price">
            <strong>${plan.priceDisplay}</strong>
            <span>${plan.priceSuffix || '&nbsp;'}</span>
          </div>
          <p>${plan.bestFor}</p>
          <ul>
            ${plan.highlights.map((item) => `<li>${item}</li>`).join('')}
          </ul>
        </button>
      `;
    }).join('');

    container.querySelectorAll('[data-plan-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        const planKey = button.getAttribute('data-plan-choice');
        state.planIntent = Public.persistPlanIntent(planKey, {
          intent: Public.getPlan(planKey).intent,
          source: 'join-plan-picker',
        });
        renderPlanContext();
        renderPlanChoices();
        syncQueryString();
      });
    });
  }

  function renderPlanContext() {
    const plan = selectedPlan();
    $('selectedPlanTitle').textContent = `${plan.name} ${plan.priceSuffix ? `${plan.priceDisplay}${plan.priceSuffix}` : plan.priceDisplay}`;
    $('selectedPlanSummary').textContent = plan.bestFor;
    $('planIntentNote').textContent = planSubmissionNote(plan);
    $('reviewPlanNote').textContent = planSubmissionNote(plan);
    const submitBtn = $('submit-btn');
    if (submitBtn) {
      submitBtn.textContent = plan.key === 'enterprise' ? 'Submit enterprise request' : `Apply for ${plan.name}`;
    }
  }

  function updateProgress(step) {
    for (let i = 1; i <= 4; i += 1) {
      const el = $(`step-ind-${i}`);
      if (!el) continue;
      el.className = 'progress-step';
      if (i < step) el.classList.add('complete');
      if (i === step) el.classList.add('active');
    }
  }

  function showSection(step) {
    document.querySelectorAll('.form-section').forEach((section) => {
      section.classList.remove('visible');
    });
    $(`section-${step}`)?.classList.add('visible');
    state.step = step;
    updateProgress(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validateStep1() {
    if (!state.businessType) {
      showError('err-type');
      return false;
    }
    hideError('err-type');
    return true;
  }

  function validateStep2() {
    const name = $('business_name')?.value.trim() || '';
    if (!name) {
      setFieldError('business_name', 'err-business_name', true);
      return false;
    }

    setFieldError('business_name', 'err-business_name', false);
    state.businessName = name;
    state.cityState = $('city_state')?.value.trim() || '';
    state.requestedSubdomain = $('requested_subdomain')?.value.trim() || '';
    return true;
  }

  function validateStep3() {
    const ownerName = $('owner_name')?.value.trim() || '';
    const ownerEmail = ($('owner_email')?.value || '').trim().toLowerCase();
    let valid = true;

    if (!ownerName) {
      setFieldError('owner_name', 'err-owner_name', true);
      valid = false;
    } else {
      setFieldError('owner_name', 'err-owner_name', false);
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!ownerEmail || !emailRe.test(ownerEmail)) {
      setFieldError('owner_email', 'err-owner_email', true);
      valid = false;
    } else {
      setFieldError('owner_email', 'err-owner_email', false);
    }

    if (!valid) return false;

    state.ownerName = ownerName;
    state.ownerEmail = ownerEmail;
    state.phone = $('phone')?.value.trim() || '';
    return true;
  }

  function populateReview() {
    const plan = selectedPlan();
    $('rev-plan').textContent = `${plan.name} ${plan.priceSuffix ? `${plan.priceDisplay}${plan.priceSuffix}` : plan.priceDisplay}`;
    $('rev-business_type').textContent = typeLabels[state.businessType] || '—';
    $('rev-business_name').textContent = state.businessName || '—';
    $('rev-city_state').textContent = state.cityState || '—';
    $('rev-subdomain').textContent = state.requestedSubdomain || '(auto-generated)';
    $('rev-owner_name').textContent = state.ownerName || '—';
    $('rev-owner_email').textContent = state.ownerEmail || '—';
    $('rev-phone').textContent = state.phone || '—';
  }

  function buildPayload() {
    return {
      business_name: state.businessName,
      owner_name: state.ownerName,
      owner_email: state.ownerEmail,
      phone: state.phone || undefined,
      business_type: state.businessType || undefined,
      city_state: state.cityState || undefined,
      requested_subdomain: state.requestedSubdomain || undefined,
      seed_template_key: state.businessType || 'default',
      selected_plan: state.planIntent.planKey,
    };
  }

  async function submitForm() {
    hideNotify();
    const submitBtn = $('submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
    }

    try {
      const response = await fetch('/.netlify/functions/submit-onboarding-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      Public.persistPlanIntent(state.planIntent.planKey, {
        intent: state.planIntent.intent,
        source: 'join-submitted',
      });

      $('progressBar').style.display = 'none';
      document.querySelectorAll('.form-section').forEach((section) => {
        section.classList.remove('visible');
      });

      const plan = selectedPlan();
      $('success-screen').style.display = 'block';
      $('success-email').textContent = state.ownerEmail;
      $('successPlanText').textContent = plan.key === 'enterprise'
        ? 'Your Enterprise request is queued for rollout planning before billing begins.'
        : `Your ${plan.name} plan is saved. We will use it to provision the right workspace, then start billing during guided onboarding.`;
      if (data.request_id) {
        $('success-ref').textContent = `Reference ID: ${data.request_id}`;
      }
    } catch (error) {
      showNotify(`Something went wrong: ${error.message}`, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }

  function bindSlugChecker() {
    const input = $('requested_subdomain');
    const status = $('slug-status');
    const preview = $('slug-preview-text');
    if (!input || !status || !preview) return;

    let timer = null;
    let lastChecked = '';
    let controller = null;

    async function checkSlug(slug) {
      if (controller) controller.abort();
      controller = new AbortController();

      try {
        const res = await fetch(`/.netlify/functions/check-slug?slug=${encodeURIComponent(slug)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        lastChecked = slug;

        if (data.available) {
          status.innerHTML = '<span style="color:var(--success);font-weight:700;">Available</span>';
        } else {
          const reason = data.reason === 'reserved'
            ? 'This name is reserved.'
            : data.reason === 'taken'
              ? 'Already taken. Try another.'
              : data.reason === 'pending'
                ? 'Already requested by another business.'
                : 'Not available.';
          status.innerHTML = `<span style="color:var(--danger);font-weight:700;">${reason}</span>`;
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          status.innerHTML = '';
        }
      }
    }

    input.addEventListener('input', () => {
      const slug = slugify(input.value);
      preview.textContent = slug ? `prooflink.co/${slug}` : 'prooflink.co/your-handle';

      if (!slug) {
        status.innerHTML = '';
        return;
      }
      if (slug === lastChecked) return;

      clearTimeout(timer);
      status.innerHTML = '<span style="color:var(--muted);">Checking availability…</span>';
      timer = window.setTimeout(() => checkSlug(slug), 450);
    });

    $('business_name')?.addEventListener('input', () => {
      if ((input.value || '').trim()) return;
      const generated = slugify($('business_name')?.value || '');
      preview.textContent = generated ? `prooflink.co/${generated}` : 'prooflink.co/your-handle';
    });
  }

  function bindBusinessTypes() {
    document.querySelectorAll('.type-chip[data-value]').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.type-chip[data-value]').forEach((item) => {
          item.classList.remove('selected');
        });
        chip.classList.add('selected');
        state.businessType = chip.getAttribute('data-value') || '';
        $('business_type').value = state.businessType;
        hideError('err-type');
      });
    });
  }

  function bindNavigation() {
    $('nextFromStep1')?.addEventListener('click', () => {
      if (validateStep1()) showSection(2);
    });

    $('backFromStep2')?.addEventListener('click', () => showSection(1));
    $('nextFromStep2')?.addEventListener('click', () => {
      if (validateStep2()) showSection(3);
    });

    $('backFromStep3')?.addEventListener('click', () => showSection(2));
    $('nextFromStep3')?.addEventListener('click', () => {
      if (validateStep3()) {
        populateReview();
        showSection(4);
      }
    });

    $('backFromStep4')?.addEventListener('click', () => showSection(3));
    $('submit-btn')?.addEventListener('click', submitForm);
  }

  function boot() {
    renderPlanContext();
    renderPlanChoices();
    syncQueryString();
    bindBusinessTypes();
    bindSlugChecker();
    bindNavigation();
    updateProgress(1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
