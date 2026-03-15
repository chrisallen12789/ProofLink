(function (global) {
  var RULES = global.ProofLinkPlanRules || {};

  function getPlanKey(tenant) {
    return (tenant && tenant.prooflink_plan_key) || 'starter';
  }

  function getPlanRules(tenant) {
    return RULES[getPlanKey(tenant)] || RULES.starter || {};
  }

  function limitFor(feature, tenant) {
    return getPlanRules(tenant)[feature];
  }

  function canUse(feature, tenant) {
    return !!getPlanRules(tenant)[feature];
  }

  function enforceLimit(feature, currentCount, tenant) {
    var limit = limitFor(feature, tenant);
    if (typeof limit === 'undefined') return true;
    if (limit === Infinity) return true;
    return Number(currentCount || 0) < Number(limit || 0);
  }

  global.ProofLinkPlan = {
    getPlanKey: getPlanKey,
    getPlanRules: getPlanRules,
    limitFor: limitFor,
    canUse: canUse,
    enforceLimit: enforceLimit
  };
})(window);
