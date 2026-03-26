// FILE: operator.config.js
(() => {
  const cfg = window.PROOFLINK_CONFIG || {};
  const tenant = cfg.tenant || window.PROOFLINK_TENANT || {};
  const backend = tenant.backend || {};
  window.PROOFLINK_OPERATOR_CONFIG = {
    supabaseUrl: cfg.supabase?.url || "",
    supabaseAnonKey: cfg.supabase?.anonKey || "",
    tenantId: tenant.id || "default",
    tenantSlug: tenant.slug || "default",
    tenantBusinessName: tenant.businessName || "Tenant",
    tenantColumn: backend.tenantColumn || "tenant_id",
    operatorColumn: backend.operatorColumn || "operator_id",
    enforceTenantScope: backend.enforceTenantScope === true,
    redirectPath: tenant.operator?.redirectPath || "/operator/",
  };
})();
