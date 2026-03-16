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

  function setText(selector, value) {
    if (!value) return;
    document.querySelectorAll(selector).forEach((el) => {
      el.textContent = String(value);
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

  function setActiveNav() {
    const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const map = {
      "index.html": "home",
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
      await inject("site-nav", "partials/nav.html");
      await inject("site-footer", "partials/footer.html");
      applyBranding();
      ensurePwaBranding();
      setActiveNav();
      setYear();
      initMobileNav();
      initBackToTop();
    } catch (e) {
      console.warn("[layout]", e);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
