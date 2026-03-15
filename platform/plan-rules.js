(function (global) {
  var RULES = {
    starter: {
      products: 10,
      customers: 50,
      orders: 100,
      operators: 1,
      onlineCheckout: false,
      analytics: 'basic',
      advancedExports: false,
      customDomain: false,
      automationRules: false
    },
    growth: {
      products: Infinity,
      customers: Infinity,
      orders: Infinity,
      operators: 5,
      onlineCheckout: true,
      analytics: 'standard',
      advancedExports: false,
      customDomain: true,
      automationRules: false
    },
    enterprise: {
      products: Infinity,
      customers: Infinity,
      orders: Infinity,
      operators: Infinity,
      onlineCheckout: true,
      analytics: 'advanced',
      advancedExports: true,
      customDomain: true,
      automationRules: true
    }
  };

  global.ProofLinkPlanRules = RULES;
})(window);
