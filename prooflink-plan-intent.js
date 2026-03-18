(function () {
  const STORAGE_KEY = 'prooflink_plan_intent';
  const PLAN_ORDER = ['starter', 'growth', 'enterprise'];

  const PLANS = {
    starter: {
      key: 'starter',
      name: 'Starter',
      priceDisplay: '$49',
      priceSuffix: '/month',
      eyebrow: 'For a single operator',
      bestFor: 'Best for owners who need one system for products, customers, pricing, orders, and payments.',
      limits: ['10 products', '50 customers', '100 monthly orders', '1 operator seat'],
      highlights: [
        'Core business workspace',
        'Customer and order tracking',
        'Pricing and payment visibility',
      ],
      ctaLabel: 'Buy Starter',
      intent: 'buy',
      checkoutReady: true,
      recommended: false,
    },
    growth: {
      key: 'growth',
      name: 'Growth',
      priceDisplay: '$149',
      priceSuffix: '/month',
      eyebrow: 'Recommended for active operators',
      bestFor: 'Best for businesses that need more capacity, online checkout, and stronger operational visibility.',
      limits: ['100 products', '1,000 customers', '500 monthly orders', '5 operator seats'],
      highlights: [
        'Everything in Starter',
        'Online checkout',
        'Advanced analytics',
      ],
      ctaLabel: 'Buy Growth',
      intent: 'buy',
      checkoutReady: true,
      recommended: true,
    },
    enterprise: {
      key: 'enterprise',
      name: 'Enterprise',
      priceDisplay: 'Custom',
      priceSuffix: '',
      eyebrow: 'For tailored rollouts',
      bestFor: 'Best for businesses that need automation, advanced controls, and a guided implementation path.',
      limits: ['Custom limits', 'Custom rollout support', 'Advanced controls', 'Priority operating support'],
      highlights: [
        'Everything in Growth',
        'Automation rules',
        'Custom domains',
      ],
      ctaLabel: 'Request Enterprise',
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
