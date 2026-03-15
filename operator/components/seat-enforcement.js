import { canCreateResource } from "../../platform/enforcement-checks.js";

export function canInviteOperator({ currentSeatCount, tenant }) {
  return canCreateResource({
    resourceKey: "operators",
    currentCount: currentSeatCount,
    tenant
  });
}
