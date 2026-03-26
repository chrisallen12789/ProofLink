(() => {
  function buildConfig() {
    const tenant = window.PROOFLINK_TENANT || {};
    const storefront = tenant.storefront || {};
    const branding = tenant.branding || {};
    const cart = tenant.cart || {};
    const fulfillment = tenant.fulfillment || {};
    const backend = tenant.backend || {};
    const contact = tenant.contact || {};
    const payments = tenant.payments || {};
    const domains = tenant.domains || {};
    const help = tenant.help || {};
    const website = tenant.website || {};

    window.PROOFLINK_CONFIG = window.PROOFLINK_CONFIG || {};
    window.PROOFLINK_CONFIG.platform = {
      name: tenant.platformName || "ProofLink",
      version: "phase4.0",
    };
    window.PROOFLINK_CONFIG.tenant = {
      id: tenant.id || "default",
      slug: tenant.slug || "default",
      businessName: tenant.businessName || "Tenant",
      businessType: tenant.businessType || "service_business",
      storefront,
      branding,
      contact,
      payments,
      domains,
      website,
      help,
      backend: {
        tenantColumn: backend.tenantColumn || "tenant_id",
        operatorColumn: backend.operatorColumn || "operator_id",
        enforceTenantScope: backend.enforceTenantScope === true,
        orderBridgeKey: backend.orderBridgeKey || `prooflink_operator_order_bridge_v1_${tenant.slug || "default"}`,
      },
      operator: tenant.operator || {},
    };
    window.PROOFLINK_CONFIG.supabase = {
      url: "https://ygfpawksbqfbgohztisv.supabase.co",
      anonKey: "sb_publishable_bcILNxLX87f-G2zq_SbDGA_Vvs62biB",
      publicCatalogRpc: "get_public_catalog_by_tenant",
      catalogFetchTimeoutMs: 8000,
    };
    window.PROOFLINK_CONFIG.storefront = {
      cart: {
        storageKey: cart.storageKey || "cl_cart_v1",
        catalogCacheKey: cart.catalogCacheKey || `cl_public_catalog_${tenant.slug || "default"}`,
      },
      delivery: {
        freeThresholdCents: Number.isFinite(+fulfillment.freeThresholdCents) ? Math.max(0, Math.round(+fulfillment.freeThresholdCents)) : 0,
        zipFees: fulfillment.zipFees || {},
        unavailableMessage: fulfillment.unavailableMessage || "Delivery is unavailable for the selected ZIP code.",
        pickupOnlyMessage: fulfillment.pickupOnlyMessage || "One or more items in this cart are pickup only.",
        zipFeeMessage: fulfillment.zipFeeMessage || "Delivery fee is based on your ZIP code.",
        freeMessage: fulfillment.freeMessage || "Delivery is free on qualifying orders.",
        pickupMessage: fulfillment.pickupMessage || "Pickup selected.",
        pickupLabel: fulfillment.pickupLabel || "Pickup",
        deliveryLabel: fulfillment.deliveryLabel || "Delivery",
      },
      pricing: {
        fixedLabel: "Fixed price.",
        startsAtLabel: "Scope may change final price.",
        quoteLabel: "Final price confirmed after review.",
        quoteDisplay: storefront.quoteDisclaimer || "Contact for quote",
      },
    };
    return window.PROOFLINK_CONFIG;
  }

  window.PROOFLINK_REFRESH_CONFIG = buildConfig;
  buildConfig();
})();
