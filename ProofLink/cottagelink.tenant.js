window.COTTAGELINK_TENANT = window.COTTAGELINK_TENANT || {
  id: "",
  slug: "",
  businessName: "Company Name",
  platformName: "ProofLink",
  businessType: "",

  storefront: {
    titleSuffix: "Company Name",
    intro: "",
    orderIntro: "",
    quoteDisclaimer: "",
    deliveryDisclaimer: "",
    complianceNotice: "",
    allergenNotice: "",
  },

  branding: {
    tenantLogoUrl: "/assets/logo.png",
    platformLogoUrl: "/assets/cottagelink-logo.png",
    faviconPng: "/assets/favicon.png",
    faviconIco: "/favicon.ico",
    accent: "#c9a227",
    bg0: "#0b0b0b",
    bg1: "#121212",
    panel: "#161616",
    text: "#f5f2ea",
    muted: "#b8b1a5",
    border: "rgba(255,255,255,.08)",
  },

  cart: {
    storageKey: "prooflink_cart_v2",
    catalogCacheKey: "prooflink_public_catalog_v1",
  },

  fulfillment: {
    freeThresholdCents: 0,
    zipFees: {},
    unavailableMessage: "",
    pickupOnlyMessage: "",
    pickupMessage: "",
  },

  contact: {
    email: "",
    replyToName: "",
    cityState: "",
  },

  backend: {
    tenantColumn: "tenant_id",
    operatorColumn: "operator_id",
    enforceTenantScope: true,
    orderBridgeKey: "prooflink_operator_order_bridge_v1",
  },

  operator: {
    redirectPath: "/operator/",
  },

  payments: {
    platformBilling: {
      planKey: "starter",
      planLabel: "Starter",
      billingInterval: "month",
      checkoutPath: "/.netlify/functions/stripe-platform-checkout",
    },
    commerce: {
      connectPath: "/.netlify/functions/stripe-connect-link",
      applicationFeeBps: 750,
      allowedModes: ["invoice", "checkout"],
      defaultMode: "invoice",
    },
    ledger: {
      livemode: false,
      currency: "usd",
    },
  },

  domains: {
    prooflinkSubdomain: "",
    customDomain: "",
    customDomainStatus: "",
    dnsTarget: "",
  },

  help: {
    enabled: true,
  },
};
