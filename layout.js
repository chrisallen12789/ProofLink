// layout.js
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  async function inject(id, url) {
    const host = document.getElementById(id);
    if (!host) return;
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    host.innerHTML = await res.text();
  }

  function getTenant() {
    return (window.COTTAGELINK_CONFIG && window.COTTAGELINK_CONFIG.tenant) || {};
  }

  function tenantSlugForPreview() {
    const tenant = getTenant();
    const slug = String(tenant.slug || "").trim();
    if (slug) return slug;
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("tenant") || params.get("slug") || "").trim();
  }

  function shouldUseTenantPreviewRouting() {
    const host = String(window.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "prooflink.co" || host === "www.prooflink.co";
  }

  function rewriteTenantLinks() {
    const slug = tenantSlugForPreview();
    if (!slug || !shouldUseTenantPreviewRouting()) return;

    document.querySelectorAll('a[href]').forEach((anchor) => {
      const rawHref = String(anchor.getAttribute("href") || "").trim();
      if (!rawHref) return;
      if (rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref.startsWith("javascript:")) return;

      let url;
      try {
        url = new URL(rawHref, window.location.href);
      } catch {
        return;
      }

      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/operator")) return;
      if (url.pathname.startsWith("/.netlify/")) return;
      if (!/(\.html)?$/i.test(url.pathname)) return;

      if (/(^\/$|\/index\.html$)/i.test(url.pathname)) {
        url.pathname = "/site-home.html";
      }
      url.searchParams.set("tenant", slug);
      anchor.href = `${url.pathname}${url.search}${url.hash}`;
    });
  }

  function applyWebsiteTheme() {
    const tenant = getTenant();
    const branding = tenant.branding || {};
    const website = tenant.website || {};
    const root = document.documentElement;

    if (branding.bg) root.style.setProperty("--bg", branding.bg);
    if (branding.surface) root.style.setProperty("--surface", branding.surface);
    if (branding.card) root.style.setProperty("--card", branding.card);
    if (branding.text) root.style.setProperty("--text", branding.text);
    if (branding.muted) root.style.setProperty("--muted", branding.muted);
    if (branding.border) root.style.setProperty("--border", branding.border);
    if (branding.accent) root.style.setProperty("--accent", branding.accent);
    if (branding.accentDark) root.style.setProperty("--accent-dark", branding.accentDark);
    if (branding.accentLight) root.style.setProperty("--accent-light", branding.accentLight);
    if (branding.headerBg) root.style.setProperty("--header-bg", branding.headerBg);
    if (branding.fontDisplay) root.style.setProperty("--font-display", branding.fontDisplay);
    if (branding.fontBody) root.style.setProperty("--font-body", branding.fontBody);

    document.body.dataset.siteSurface = website.surfaceStyle || "clean";
    document.body.dataset.siteButtonStyle = website.buttonStyle || "rounded";
    document.body.dataset.siteCardStyle = website.cardStyle || "soft";
    document.body.dataset.siteHeroLayout = website.heroLayout || "split";
    document.body.dataset.siteFontPreset = website.fontPreset || "modern_sans";
    document.body.dataset.sitePublishStatus = website.publishStatus || "draft";
  }

  function applyContentLabels() {
    const tenant = getTenant();
    const storefront = tenant.storefront || {};

    setText("[data-cl-catalog-label]", storefront.catalogLabel || "Products");
    setText("[data-cl-cart-label]", storefront.cartLabel || "Cart");
    setText("[data-cl-order-page-title]", storefront.orderPageTitle || "Order request");
    setText("[data-cl-primary-cta-label]", storefront.primaryCtaLabel || "Request service");
    setText("[data-cl-booking-cta-label]", storefront.bookingCtaLabel || "Book now");
    setText("[data-cl-hours-note]", storefront.hoursNotes || "");
    setText("[data-cl-service-area]", storefront.serviceArea || "");
    setText("[data-cl-about-copy]", storefront.about || "");
    setText("[data-cl-contact-intro]", storefront.contactIntro || "");
  }

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach((el) => {
      el.textContent = String(value || "");
    });
  }

  function applyBranding() {
    const tenant = getTenant();
    const branding = tenant.branding || {};
    const storefront = tenant.storefront || {};

    setText("[data-cl-tenant-name]", tenant.businessName || "Tenant");
    setText("[data-cl-platform-name]", window.COTTAGELINK_CONFIG?.platform?.name || "ProofLink");
    setText("[data-cl-compliance-note]", storefront.complianceNotice || "");
    setText("[data-cl-allergen-note]", storefront.allergenNotice || "");
    setText("[data-cl-storefront-intro]", storefront.intro || "");
    setText("[data-cl-order-intro]", storefront.orderIntro || "");
    setText("[data-cl-quote-disclaimer]", storefront.quoteDisclaimer || "");
    setText("[data-cl-delivery-disclaimer]", storefront.deliveryDisclaimer || "");

    const pngIcon = document.querySelector('link[rel="icon"][type="image/png"]');
    if (pngIcon && branding.faviconPng) pngIcon.href = branding.faviconPng;
    const icoIcon = document.querySelector('link[rel="shortcut icon"]');
    if (icoIcon && branding.faviconIco) icoIcon.href = branding.faviconIco;

    const baseTitle = document.title.split("|")[0].trim();
    const suffix = storefront.titleSuffix || tenant.businessName;
    if (baseTitle && suffix) document.title = `${baseTitle} | ${suffix}`;

    document.querySelectorAll("[data-cl-compliance-note], [data-cl-allergen-note]").forEach((el) => {
      const isCompliance = el.hasAttribute("data-cl-compliance-note");
      const value = isCompliance ? storefront.complianceNotice : storefront.allergenNotice;
      el.hidden = !String(value || "").trim();
    });
  }

  function applyPageMeta() {
    const tenant = getTenant();
    const storefront = tenant.storefront || {};
    const businessName = tenant.businessName || storefront.titleSuffix || "Business";
    const page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    const titles = {
      "site-home.html": `${businessName} | Home`,
      "products.html": `${storefront.catalogLabel || "Products"} | ${businessName}`,
      "order.html": `${storefront.orderPageTitle || "Order request"} | ${businessName}`,
      "contact.html": `Contact | ${businessName}`,
      "about.html": `About | ${businessName}`,
      "how-it-works.html": `How it works | ${businessName}`,
      "thanks.html": `Request received | ${businessName}`,
      "contact-thanks.html": `Message received | ${businessName}`,
      "privacy.html": `Privacy | ${businessName}`,
      "terms.html": `Terms | ${businessName}`,
      "refunds.html": `Refunds and cancellations | ${businessName}`,
      "accessibility.html": `Accessibility | ${businessName}`,
      "success.html": `Payment received | ${businessName}`,
      "cancel.html": `Payment canceled | ${businessName}`,
      "review.html": `Leave a review | ${businessName}`,
    };
    const descriptions = {
      "site-home.html": storefront.heroSubheading || storefront.intro || `Visit ${businessName} online, review available services, and send a tracked request.`,
      "products.html": storefront.intro || `Review available ${String(storefront.catalogLabel || "services").toLowerCase()} and send a tracked request to ${businessName}.`,
      "order.html": storefront.orderIntro || `Send a tracked request to ${businessName} and get the next step confirmed by a real person.`,
      "contact.html": storefront.contactIntro || `Contact ${businessName} directly and keep questions attached to the right customer record.`,
      "about.html": storefront.about || `Learn what ${businessName} does, where they work, and how they handle customer requests.`,
      "how-it-works.html": `See how ${businessName} moves a request from first contact to confirmed work.`,
      "thanks.html": `Your request was received by ${businessName}. Watch for the confirmed next step.`,
      "contact-thanks.html": `Your message was received by ${businessName}.`,
      "privacy.html": `See how ${businessName} handles customer request, contact, and payment information.`,
      "terms.html": `Review the terms for using ${businessName}'s website and request flow.`,
      "refunds.html": `Review how ${businessName} handles cancellations, deposits, and customer concerns.`,
      "accessibility.html": `Accessibility information for ${businessName}'s website.`,
      "success.html": `Payment confirmation for ${businessName}.`,
      "cancel.html": `Payment cancellation page for ${businessName}.`,
      "review.html": `Leave feedback for ${businessName}.`,
    };

    if (titles[page]) document.title = titles[page];

    const desc = descriptions[page];
    if (desc) {
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute("content", desc);
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.setAttribute("content", desc);
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle && titles[page]) ogTitle.setAttribute("content", titles[page]);
    }
  }


  function ensurePwaBranding() {
    const tenant = getTenant();
    const branding = tenant.branding || {};

    let manifest = document.querySelector('link[rel="manifest"]');
    if (!manifest) {
      manifest = document.createElement("link");
      manifest.rel = "manifest";
      manifest.href = "/manifest.webmanifest";
      document.head.appendChild(manifest);
    }

    let theme = document.querySelector('meta[name="theme-color"]');
    if (!theme) {
      theme = document.createElement("meta");
      theme.name = "theme-color";
      document.head.appendChild(theme);
    }
    theme.content = branding.accent || "#c9a227";

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }, { once: true });
    }
  }

  function refreshTenantShell() {
    if (typeof window.COTTAGELINK_REFRESH_CONFIG === "function") {
      window.COTTAGELINK_REFRESH_CONFIG();
    }
    applyWebsiteTheme();
    applyBranding();
    applyContentLabels();
    applyPageMeta();
    rewriteTenantLinks();
    setActiveNav();
  }

  function setActiveNav() {
    const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const map = {
      "index.html": "home",
      "site-home.html": "home",
      "about.html": "about",
      "products.html": "products",
      "how-it-works.html": "how",
      "order.html": "order",
      "contact.html": "contact",
      "thanks.html": "order",
      "contact-thanks.html": "contact",
    };
    const key = map[file];
    if (!key) return;

    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.getAttribute("data-nav") === key) a.classList.add("active");
      else a.classList.remove("active");
    });
  }

  function setYear() {
    document.querySelectorAll("[data-year]").forEach((el) => {
      el.textContent = String(new Date().getFullYear());
    });
  }

  function initMobileNav() {
    const nav = $(".site-nav");
    if (!nav) return;

    const toggle = $(".nav-toggle", nav);
    const list = $("#primary-nav", nav);
    if (!toggle || !list) return;

    const close = () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    };

    const open = () => {
      nav.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
    };

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      expanded ? close() : open();
    });

    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    window.addEventListener("resize", () => {
      if (window.matchMedia("(min-width: 721px)").matches) close();
    });
  }

  function initBackToTop() {
    const button = document.getElementById("backToTop");
    if (!button) return;

    const toggleVisibility = () => {
      if (window.scrollY > 300) button.classList.add("show");
      else button.classList.remove("show");
    };

    window.addEventListener("scroll", toggleVisibility);
    button.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function boot() {
    try {
      if (typeof window.PROOFLINK_WAIT_FOR_TENANT_READY === "function") {
        await window.PROOFLINK_WAIT_FOR_TENANT_READY();
      } else if (window.COTTAGELINK_TENANT_READY && typeof window.COTTAGELINK_TENANT_READY.then === "function") {
        await window.COTTAGELINK_TENANT_READY;
      }
      if (typeof window.COTTAGELINK_REFRESH_CONFIG === "function") {
        window.COTTAGELINK_REFRESH_CONFIG();
      }
      await inject("site-nav", "partials/nav.html");
      await inject("site-footer", "partials/footer.html");
      refreshTenantShell();
      ensurePwaBranding();
      setYear();
      initMobileNav();
      initBackToTop();
    } catch (e) {
      console.warn("[layout]", e);
    }
  }

  document.addEventListener("prooflink:tenant-ready", () => {
    refreshTenantShell();
  });
  document.addEventListener("DOMContentLoaded", boot);
})();
