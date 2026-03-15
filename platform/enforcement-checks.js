import { enforceLimit, getPlanKey } from "./plan-check.js";
import { buildLimitMessage } from "./enforcement-rules.js";

export function canCreateResource({ resourceKey, currentCount, tenant }) {
  const allowed = enforceLimit(resourceKey, currentCount, tenant);

  if (allowed) {
    return {
      ok: true,
      resourceKey,
      tenantPlan: getPlanKey(tenant)
    };
  }

  return buildLimitMessage({ resourceKey, tenant, currentCount });
}

export function assertCreateResource({ resourceKey, currentCount, tenant }) {
  const result = canCreateResource({ resourceKey, currentCount, tenant });

  if (!result.ok) {
    const err = new Error(result.message);
    err.code = result.code;
    err.context = result;
    throw err;
  }

  return result;
}
