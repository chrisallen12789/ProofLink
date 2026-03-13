(function () {
  function $(id) { return document.getElementById(id); }

  function setMsg(text, tone) {
    const el = $('startMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = `msg${tone ? ` ${tone}` : ''}`;
  }

  function clean(value) {
    return String(value || '').trim();
  }

  function slugify(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function collectPayload() {
    const businessName = clean($('businessName')?.value);
    const ownerName = clean($('ownerName')?.value);
    const email = clean($('email')?.value).toLowerCase();
    const phone = clean($('phone')?.value);
    const businessCategory = clean($('businessCategory')?.value);
    const selectedPlan = clean($('selectedPlan')?.value || 'starter').toLowerCase();
    const fulfillmentModel = clean($('fulfillmentModel')?.value || 'service').toLowerCase();
    const subdomainPreference = clean($('subdomainPreference')?.value) || slugify(businessName);
    const serviceArea = clean($('serviceArea')?.value);
    const notes = clean($('notes')?.value);

    return {
      business_name: businessName,
      owner_name: ownerName,
      email,
      phone,
      business_category: businessCategory,
      selected_plan: selectedPlan,
      fulfillment_model: fulfillmentModel,
      subdomain_preference: subdomainPreference,
      service_area: serviceArea,
      notes,
      platform_name: 'ProofLink'
    };
  }

  function validate(payload) {
    if (!payload.business_name) return 'Business name is required.';
    if (!payload.owner_name) return 'Owner name is required.';
    if (!payload.email) return 'Email is required.';
    if (!payload.phone) return 'Phone is required.';
    if (!payload.business_category) return 'Business category is required.';
    return '';
  }

  async function createTenantBundle(payload) {
    const res = await fetch('/.netlify/functions/create-tenant-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Unable to create business workspace.');
    }

    return data.result || data;
  }

  function persistStartContext(result, payload) {
    const data = {
      createdAt: new Date().toISOString(),
      tenantId: result.tenant_id || '',
      tenantSlug: result.tenant_slug || '',
      operatorId: result.operator_id || '',
      operatorSlug: result.operator_slug || '',
      businessName: payload.business_name || '',
      ownerName: payload.owner_name || '',
      email: payload.email || '',
      planKey: payload.selected_plan || 'starter',
      businessCategory: payload.business_category || '',
      fulfillmentModel: payload.fulfillment_model || 'service'
    };
    localStorage.setItem('prooflink_start_context', JSON.stringify(data));
  }

  function nextUrl(result) {
    const slug = encodeURIComponent(result.tenant_slug || '');
    return `/operator/onboarding.html?tenant=${slug}`;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const btn = $('btnCreate');
    const payload = collectPayload();
    const validationError = validate(payload);

    if (validationError) {
      setMsg(validationError, 'bad');
      return;
    }

    try {
      if (btn) btn.disabled = true;
      setMsg('Creating the business workspace…', '');
      const result = await createTenantBundle(payload);
      persistStartContext(result, payload);
      setMsg('Workspace created. Redirecting to guided onboarding…', 'good');
      window.location.href = nextUrl(result);
    } catch (err) {
      setMsg(err.message || String(err), 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function fillDemo() {
    $('businessName').value = 'Lakeside Lawn Care';
    $('ownerName').value = 'Chris Lane';
    $('email').value = 'chris@example.com';
    $('phone').value = '555-555-5555';
    $('businessCategory').value = 'lawn_care';
    $('selectedPlan').value = 'starter';
    $('fulfillmentModel').value = 'service';
    $('subdomainPreference').value = 'lakeside-lawn-care';
    $('serviceArea').value = 'Livingston County, Michigan';
    $('notes').value = 'Mobile-first service setup.';
  }

  function bind() {
    $('startForm')?.addEventListener('submit', handleSubmit);
    $('btnDemoFill')?.addEventListener('click', fillDemo);

    $('businessName')?.addEventListener('input', () => {
      const current = clean($('subdomainPreference')?.value);
      const business = clean($('businessName')?.value);
      if (!current || current === slugify(current)) {
        $('subdomainPreference').value = slugify(business);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();