(function () {
  const STORAGE_KEY = 'prooflink_plan_intent';
  const PLAN_ORDER = ['starter', 'growth', 'enterprise'];

  const PLANS = {
    starter: {
      key: 'starter',
      name: 'Starter',
      priceDisplay: '$49',
      priceSuffix: '/month',
      eyebrow: 'Fix the basics',
      bestFor: 'For owners who need one place to stop losing track of offers, customers, orders, and payments.',
      limits: ['10 products', '50 customers', '100 monthly orders', '1 operator seat'],
      highlights: [
        'Stop quoting from memory',
        'Track every customer and order',
        'See what is paid and what is pending',
      ],
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
      eyebrow: 'For busy businesses',
      bestFor: 'For businesses with real volume that need checkout, more capacity, and better visibility before chaos compounds.',
      limits: ['100 products', '1,000 customers', '500 monthly orders', '5 operator seats'],
      highlights: [
        'Everything in Starter',
        'Take orders online',
        'See what is working and where work stalls',
      ],
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
      eyebrow: 'For custom rollouts',
      bestFor: 'For businesses that need advanced controls, rollout support, and a tighter operating system across the team.',
      limits: ['Custom limits', 'Custom rollout support', 'Advanced controls', 'Priority operating support'],
      highlights: [
        'Custom rollout plan',
        'Advanced automation',
        'Custom domains and controls',
      ],
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
