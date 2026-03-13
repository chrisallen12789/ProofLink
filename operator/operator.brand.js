// FILE: operator.brand.js
(() => {
  const tenant = window.COTTAGELINK_TENANT || {};
  const branding = tenant.branding || {};
  window.COTTAGELINK_BRAND = {
    productName: tenant.platformName || "ProofLink",
    tenantName: tenant.businessName || "Tenant",
    tenantLogoUrl: branding.tenantLogoUrl || "/assets/logo.png",
    platformLogoUrl: branding.platformLogoUrl || "/assets/cottagelink-logo.png",
    accent: branding.accent || "#c9a227",
    bg0: branding.bg0 || "#0b0b0b",
    bg1: branding.bg1 || "#121212",
    panel: branding.panel || "#161616",
    text: branding.text || "#f5f2ea",
    muted: branding.muted || "#b8b1a5",
    border: branding.border || "rgba(255,255,255,.08)",
  };
})();
