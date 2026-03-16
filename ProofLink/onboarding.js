(() => {
  const form = document.getElementById('onboardingForm');
  const msg = document.getElementById('onboardingMsg');
  const startedAt = document.getElementById('startedAt');
  if (!form) return;
  if (startedAt) startedAt.value = String(Date.now());

  function val(id) { return document.getElementById(id)?.value?.trim?.() || ''; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = 'Submitting…';
    const payload = {
      businessName: val('businessName'),
      ownerName: val('ownerName'),
      email: val('email'),
      phone: val('phone'),
      businessCategory: val('businessCategory'),
      selectedPlan: val('selectedPlan'),
      fulfillmentModel: val('fulfillmentModel'),
      serviceArea: val('serviceArea'),
      brandColor: val('brandColor'),
      logoUrl: val('logoUrl'),
      subdomainPreference: val('subdomainPreference'),
      domainPreference: val('domainPreference'),
      notes: val('notes'),
      startedAt: Number(val('startedAt') || Date.now()),
      website: val('website'),
    };

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Unable to submit onboarding.');
      form.reset();
      if (startedAt) startedAt.value = String(Date.now());
      if (msg) msg.textContent = 'Onboarding submitted. ProofLink will review it before activating billing or Stripe Connect.';
    } catch (err) {
      if (msg) msg.textContent = err?.message || String(err);
    }
  });
})();
