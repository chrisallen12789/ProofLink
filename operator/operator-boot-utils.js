(function initOperatorBootUtils(globalScope) {
  "use strict";

  function normalizeTenantId(value) {
    return String(value || "").trim();
  }

  function isRealTenantId(value) {
    const normalized = normalizeTenantId(value);
    return !!normalized && normalized.toLowerCase() !== "default";
  }

  function buildTenantQueryParam(tenantId) {
    return isRealTenantId(tenantId)
      ? `tenant_id=${encodeURIComponent(normalizeTenantId(tenantId))}`
      : "";
  }

  function resolveOperatorTenantId(currentTenantId, ...candidates) {
    for (const candidate of candidates) {
      if (isRealTenantId(candidate)) return normalizeTenantId(candidate);
    }
    return isRealTenantId(currentTenantId) ? normalizeTenantId(currentTenantId) : "";
  }

  const api = {
    normalizeTenantId,
    isRealTenantId,
    buildTenantQueryParam,
    resolveOperatorTenantId,
  };

  globalScope.ProofLinkOperatorBootUtils = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
