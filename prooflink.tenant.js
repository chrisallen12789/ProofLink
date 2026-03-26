window.PROOFLINK_TENANT = window.PROOFLINK_TENANT || {
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
    heroHeading: "",
    heroSubheading: "",
    about: "",
    primaryCtaLabel: "Request service",
    bookingCtaLabel: "Book now",
    reviewPlatformLabel: "",
    reviewLinkUrl: "",
    serviceArea: "",
    hoursNotes: "",
    catalogLabel: "Products",
    cartLabel: "Cart",
    orderPageTitle: "Order request",
  },

  branding: {
    tenantLogoUrl: "/assets/logo.png",
    platformLogoUrl: "/assets/cottagelink-logo.png",
    faviconPng: "/assets/favicon.png",
    faviconIco: "/favicon.ico",
    accent: "#c9a227",
    accentDark: "#7a3a1f",
    accentLight: "rgba(168,81,45,.08)",
    bg: "#f8f5f0",
    surface: "#fffdf8",
    card: "#ffffff",
    text: "#2f2a22",
    muted: "#6a5f55",
    border: "rgba(47,42,34,.12)",
    headerBg: "#3a2418",
    bg0: "#0b0b0b",
    bg1: "#121212",
    panel: "#161616",
    fontDisplay: "'Google Sans', ui-sans-serif, system-ui, sans-serif",
    fontBody: "'Google Sans Text', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
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
    phone: "",
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

  website: {
    fontPreset: "modern_sans",
    surfaceStyle: "clean",
    buttonStyle: "rounded",
    cardStyle: "soft",
    heroLayout: "split",
    publishStatus: "draft",
    publishedAt: "",
    showPrices: true,
    allowCustomRequests: true,
    bookingPageEnabled: true,
  },

  help: {
    enabled: true,
  },
};

(function () {
  function clean(value) {
    return String(value || "").trim();
  }

  function deepMerge(target, source) {
    Object.keys(source || {}).forEach((key) => {
      const src = source[key];
      if (src && typeof src === "object" && !Array.isArray(src)) {
        if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
        deepMerge(target[key], src);
      } else if (src !== undefined) {
        target[key] = src;
      }
    });
    return target;
  }

  function tenantSelector() {
    const params = new URLSearchParams(window.location.search || "");
    const queryTenant = clean(params.get("tenant") || params.get("slug"));
    if (queryTenant) return `slug=${encodeURIComponent(queryTenant)}`;

    try {
      const startContext = JSON.parse(localStorage.getItem("prooflink_start_context") || "null");
      const slug = clean(startContext?.tenantSlug || "");
      if (slug) return `slug=${encodeURIComponent(slug)}`;
    } catch {}

    return "";
  }

  function waitForTenantReady(timeoutMs = 4000) {
    if (window.PROOFLINK_TENANT_READY && typeof window.PROOFLINK_TENANT_READY.then === "function") {
      return window.PROOFLINK_TENANT_READY;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        document.removeEventListener("prooflink:tenant-ready", finish);
        resolve(window.PROOFLINK_TENANT);
      };
      const timeoutId = window.setTimeout(finish, timeoutMs);
      document.addEventListener("prooflink:tenant-ready", finish, { once: true });
      window.setTimeout(() => {
        if (window.PROOFLINK_TENANT_READY && typeof window.PROOFLINK_TENANT_READY.then === "function") {
          Promise.resolve(window.PROOFLINK_TENANT_READY).then(finish).catch(finish);
        }
      }, 0);
    });
  }

  async function hydrateTenant() {
    const selector = tenantSelector();
    if (!selector && /^(prooflink\.co|www\.prooflink\.co|127\.0\.0\.1|localhost)$/i.test(window.location.hostname || "")) {
      return window.PROOFLINK_TENANT;
    }

    try {
      const res = await fetch(`/.netlify/functions/get-public-tenant-info${selector ? `?${selector}` : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.tenant) return window.PROOFLINK_TENANT;
      deepMerge(window.PROOFLINK_TENANT, data.tenant);
      if (typeof window.PROOFLINK_REFRESH_CONFIG === "function") {
        window.PROOFLINK_REFRESH_CONFIG();
      }
      document.dispatchEvent(new CustomEvent("prooflink:tenant-ready", { detail: window.PROOFLINK_TENANT }));
      return window.PROOFLINK_TENANT;
    } catch (error) {
      console.warn("[tenant]", error?.message || error);
      return window.PROOFLINK_TENANT;
    }
  }

  window.PROOFLINK_TENANT_READY = hydrateTenant();
  window.PROOFLINK_WAIT_FOR_TENANT_READY = waitForTenantReady;
})();
