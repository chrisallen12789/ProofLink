// FILE: operator.brand.js
(() => {
  const tenant = window.PROOFLINK_TENANT || {};
  const branding = tenant.branding || {};
  window.PROOFLINK_BRAND = {
    productName: tenant.platformName || "ProofLink",
    tenantName: tenant.businessName || "Tenant",
    tenantLogoUrl: branding.tenantLogoUrl || "/assets/logo.png",
    platformLogoUrl: branding.platformLogoUrl || "/assets/prooflink-logo.png",
    accent: branding.accent || "#c9a227",
    // Keep the operator console readable and stable even when the tenant
    // website uses dramatic brand colors that work poorly for internal tools.
    bg0: "#1b1713",
    bg1: "#241f1a",
    panel: "#312a24",
    text: "#f7f3ec",
    muted: "#d6cab9",
    border: "rgba(255,255,255,.16)",
  };
})();
