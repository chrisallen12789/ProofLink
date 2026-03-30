(() => {
  const CL = window.ProofLink;
  if (!CL) return;

  const {
    catalog,
    pricing,
    helpers: { escapeHtml },
  } = CL;

  const featuredGrid = document.getElementById("siteHomeFeaturedGrid");
  const heading = document.getElementById("siteHomeHeading");
  const subheading = document.getElementById("siteHomeSubheading");
  const reviewCard = document.getElementById("siteHomeReviewCard");
  const reviewLabel = document.getElementById("siteHomeReviewLabel");
  const reviewLink = document.getElementById("siteHomeReviewLink");
  const catalogLead = document.getElementById("siteHomeCatalogLead");

  function getTenant() {
    return window.PROOFLINK_CONFIG?.tenant || {};
  }

  function renderHero() {
    const tenant = getTenant();
    const storefront = tenant.storefront || {};
    if (heading) heading.textContent = storefront.heroHeading || tenant.businessName || "Professional work with a clear next step.";
    if (subheading) subheading.textContent = storefront.heroSubheading || storefront.intro || "Send a request and get the next step confirmed clearly.";
    if (catalogLead) {
      catalogLead.textContent = storefront.intro || `Review available ${String(storefront.catalogLabel || "services").toLowerCase()} and send the details through one tracked request.`;
    }

    const reviewUrl = String(storefront.reviewLinkUrl || "").trim();
    if (reviewCard) reviewCard.hidden = !reviewUrl;
    if (reviewLabel) reviewLabel.textContent = storefront.reviewPlatformLabel || "Review page";
    if (reviewLink && reviewUrl) reviewLink.href = reviewUrl;
  }

  function renderFeatured(products) {
    if (!featuredGrid) return;
    const rows = Array.isArray(products) ? products.filter((row) => row && row.is_available !== false).slice(0, 3) : [];
    if (!rows.length) {
      const label = String(getTenant().storefront?.catalogLabel || "services").toLowerCase();
      featuredGrid.innerHTML = `<p class="muted">No featured ${escapeHtml(label)} are live yet. Check back soon or send a direct request.</p>`;
      return;
    }

    featuredGrid.innerHTML = rows.map((p) => {
      const priceLabel = pricing.priceLabelForProduct(p);
      const note = pricing.priceNoteForProduct(p);
      return `
        <article class="product-card">
          <div class="product-image-wrap">
            ${p.image_url ? `<img class="product-image" src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name || "Offer")}">` : ""}
          </div>
          <div class="product-body">
            <div class="product-title">${escapeHtml(p.name || "Offer")}</div>
            ${p.category ? `<div class="product-meta"><span class="product-category">${escapeHtml(p.category)}</span></div>` : ""}
            ${p.description ? `<div class="product-description">${escapeHtml(p.description)}</div>` : ""}
            <div class="product-footer">
              <div>
                <div class="product-price">${escapeHtml(priceLabel)}</div>
                <div class="muted small">${escapeHtml(note)}</div>
              </div>
              <a class="btn btn-primary" href="order.html">${escapeHtml(getTenant().storefront?.primaryCtaLabel || "Request service")}</a>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  async function boot() {
    try {
      if (typeof window.PROOFLINK_WAIT_FOR_TENANT_READY === "function") {
        await window.PROOFLINK_WAIT_FOR_TENANT_READY();
      }
      if (typeof window.PROOFLINK_REFRESH_CONFIG === "function") {
        window.PROOFLINK_REFRESH_CONFIG();
      }
      renderHero();
      const products = await catalog.fetch(false);
      renderFeatured(products);
    } catch (error) {
      console.warn("[site-home]", error?.message || error);
      renderHero();
      renderFeatured([]);
    }
  }

  document.addEventListener("prooflink:tenant-ready", renderHero);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
