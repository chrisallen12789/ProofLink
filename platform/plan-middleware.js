import { canUse, enforceLimit, getPlanKey, limitFor } from "./plan-check.js";

export function guardFeature({ feature, tenant, onDenied }) {
  const allowed = canUse(feature, tenant);

  if (!allowed && typeof onDenied === "function") {
    onDenied({
      feature,
      tenantPlan: getPlanKey(tenant),
      requiredAction: "upgrade"
    });
  }

  return allowed;
}

export function guardLimit({ feature, currentCount, tenant, onDenied }) {
  const allowed = enforceLimit(feature, currentCount, tenant);

  if (!allowed && typeof onDenied === "function") {
    onDenied({
      feature,
      tenantPlan: getPlanKey(tenant),
      currentCount,
      limit: limitFor(feature, tenant),
      requiredAction: "upgrade"
    });
  }

  return allowed;
}

export function withFeatureGate(handler, options) {
  return function gatedHandler(context = {}) {
    const tenant = context.tenant || options?.tenant || null;
    const allowed = guardFeature({
      feature: options.feature,
      tenant,
      onDenied: options.onDenied
    });

    if (!allowed) {
      return {
        ok: false,
        reason: "feature_locked",
        feature: options.feature,
        tenantPlan: getPlanKey(tenant)
      };
    }

    return handler(context);
  };
}
