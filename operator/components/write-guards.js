import { canCreateResource } from "../../platform/enforcement-checks.js";
import { renderLimitBanner } from "./limit-banner.js";

export function guardCreateAction({
  resourceKey,
  currentCount,
  tenant,
  mountNode,
  onAllowed,
  onDenied
}) {
  const result = canCreateResource({ resourceKey, currentCount, tenant });

  if (result.ok) {
    if (typeof onAllowed === "function") onAllowed(result);
    return true;
  }

  if (mountNode) {
    mountNode.innerHTML = renderLimitBanner({
      title: `${result.label} limit reached`,
      message: result.message,
      upgradeTier: result.upgradeTier,
      resourceLabel: result.label
    });
  }

  if (typeof onDenied === "function") onDenied(result);
  return false;
}
