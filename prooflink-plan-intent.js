(function () {
  const STORAGE_KEY = 'prooflink_plan_intent';
  const PLAN_ORDER = ['starter', 'growth', 'enterprise'];

  const PLANS = {
    starter: {
      key: 'starter',
      name: 'Starter',
      priceDisplay: '$49',
      priceSuffix: '/month',
      eyebrow: 'For the owner-operator',
      bestFor: 'For the small service business that needs leads, customers, bids, jobs, and payment follow-up in one place without paying for a pile of add-ons.',
      limits: ['10 products', '50 customers', '100 monthly orders', '1 operator seat'],
      highlights: [
        'One flat fee for the operating system',
        'Track the job from first contact to payment',
        'No extra charge for quotes, pipeline, or reminders',
      ],
      replaces: ['Text threads', 'Spreadsheets', 'Missed follow-up'],
      feePromise: 'Core operating system on one flat monthly fee.',
      websiteNote: 'Custom websites are optional and priced separately.',
      ctaLabel: 'Start with Starter',
      intent: 'buy',
      checkoutReady: true,
      recommended: false,
    },
    growth: {
      key: 'growth',
      name: 'Growth',
      priceDisplay: '$149',
      priceSuffix: '/month',
      eyebrow: 'For the growing shop',
      bestFor: 'For busy service businesses that need stronger workflow control, more operator capacity, and clearer money visibility before the mess gets expensive.',
      limits: ['100 products', '1,000 customers', '500 monthly orders', '5 operator seats'],
      highlights: [
        'Everything in Starter',
        'Take orders online and run service workflow in one system',
        'See stuck leads, active work, and unpaid money fast',
        'Scale without buying a new app every month',
      ],
      replaces: ['Disconnected CRM', 'Quote builder', 'Manual collections'],
      feePromise: 'Flat monthly fee for the full day-to-day operating stack.',
      websiteNote: 'Custom websites are still separate from software pricing.',
      ctaLabel: 'Get Growth',
      intent: 'buy',
      checkoutReady: true,
      recommended: true,
    },
    enterprise: {
      key: 'enterprise',
      name: 'Enterprise',
      priceDisplay: 'Custom',
      priceSuffix: '',
      eyebrow: 'For multi-team rollout',
      bestFor: 'For businesses that need rollout help, deeper controls, and a more tailored operating setup across teams, locations, or service lines.',
      limits: ['Custom limits', 'Custom rollout support', 'Advanced controls', 'Priority operating support'],
      highlights: [
        'Custom rollout plan',
        'Advanced automation',
        'Custom domains and controls',
      ],
      replaces: ['Patchwork back office', 'Spreadsheet management', 'Fragile handoffs'],
      feePromise: 'Structured around the rollout, not surprise feature tolls.',
      websiteNote: 'Website projects remain a separate engagement.',
      ctaLabel: 'Talk to us',
      intent: 'contact',
      checkoutReady: false,
      recommended: false,
    },
  };

  function sanitizePlan(value, options = {}) {
    const allowEnterprise = options.allowEnterprise !== false;
    const fallback = options.fallback || 'starter';
    const planKey = String(value || '').trim().toLowerCase();
    if (!planKey) return fallback;
    if (!allowEnterprise && planKey === 'enterprise') return fallback;
    return PLANS[planKey] ? planKey : fallback;
  }

  function normalizeIntent(value, planKey) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'buy' || raw === 'contact' || raw === 'learn') return raw;
    return PLANS[planKey]?.intent || 'buy';
  }

  function createPlanIntent(planKey, options = {}) {
    const safePlan = sanitizePlan(planKey, { allowEnterprise: options.allowEnterprise !== false });
    return {
      planKey: safePlan,
      intent: normalizeIntent(options.intent, safePlan),
      source: String(options.source || 'direct').trim() || 'direct',
      createdAt: new Date().toISOString(),
    };
  }

  function persistPlanIntent(planKey, options = {}) {
    const intent = createPlanIntent(planKey, options);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
    } catch (_) {
      // Ignore storage failures in locked-down browsers.
    }
    return intent;
  }

  function readStoredPlanIntent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return createPlanIntent(parsed.planKey, parsed);
    } catch (_) {
      return null;
    }
  }

  function readQueryPlanIntent(search) {
    const params = new URLSearchParams(
      typeof search === 'string' ? search : (window.location.search || '')
    );
    const planKey = params.get('plan');
    if (!planKey) return null;
    return createPlanIntent(planKey, {
      intent: params.get('intent'),
      source: params.get('source') || 'query',
    });
  }

  function resolvePlanIntent(options = {}) {
    const queryIntent = readQueryPlanIntent(options.search);
    if (queryIntent) {
      persistPlanIntent(queryIntent.planKey, queryIntent);
      return queryIntent;
    }
    return readStoredPlanIntent() || createPlanIntent(options.defaultPlan || 'starter', options);
  }

  function buildJoinUrl(planKey, options = {}) {
    const intent = createPlanIntent(planKey, options);
    const params = new URLSearchParams();
    params.set('plan', intent.planKey);
    params.set('intent', intent.intent);
    params.set('source', intent.source);
    return `/join?${params.toString()}`;
  }

  function getPlan(planKey, options = {}) {
    const safePlan = sanitizePlan(planKey, options);
    return PLANS[safePlan];
  }

  function planLabel(planKey, options = {}) {
    return getPlan(planKey, options).name;
  }

  function isCheckoutReady(planKey) {
    return Boolean(getPlan(planKey).checkoutReady);
  }

  window.PROOFLINK_PUBLIC = {
    STORAGE_KEY,
    PLAN_ORDER,
    PLANS,
    sanitizePlan,
    createPlanIntent,
    persistPlanIntent,
    readStoredPlanIntent,
    readQueryPlanIntent,
    resolvePlanIntent,
    buildJoinUrl,
    getPlan,
    planLabel,
    isCheckoutReady,
  };
})();
