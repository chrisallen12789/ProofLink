const CL = window.CottageLink;
const {
  helpers: { escapeHtml, toFiniteCents },
  catalog,
  pricing,
} = CL;

const grid = document.getElementById("productGrid");
const searchInput = document.getElementById("productSearch");
const categoryFilters = document.getElementById("categoryFilters");
const catalogStatus = document.getElementById("catalogStatus");

let PRODUCTS = [];
let ACTIVE_CATEGORY = "All";

function setStatus(msg) {
  if (catalogStatus) catalogStatus.textContent = msg || "";
}

async function fetchProducts() {
  const cached = catalog.loadCache();

  try {
    setStatus("Loading products...");
    PRODUCTS = await catalog.fetch(false);

    buildCategoryFilters();
    renderProducts();
    setStatus(PRODUCTS.length ? "" : "No products available right now.");
  } catch (err) {
    console.error(err);

    if (cached.length) {
      PRODUCTS = cached;
      window.HTC_CATALOG = PRODUCTS;
      buildCategoryFilters();
      renderProducts();
      setStatus("Showing the most recent saved catalog. Live refresh is temporarily unavailable.");
      return;
    }

    setStatus("Storefront temporarily unavailable.");
    if (grid) {
      grid.innerHTML = `<p class="muted">Storefront temporarily unavailable.<br>Please try again in a moment.</p>`;
    }
  }
}

function buildCategoryFilters() {
  if (!categoryFilters) return;

  const categories = ["All", ...Array.from(new Set(PRODUCTS.map((p) => p.category).filter(Boolean))).sort()];
  categoryFilters.innerHTML = "";

  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    if (cat === ACTIVE_CATEGORY) btn.classList.add("active");
    btn.textContent = cat;

    btn.addEventListener("click", () => {
      ACTIVE_CATEGORY = cat;
      buildCategoryFilters();
      renderProducts();
    });

    categoryFilters.appendChild(btn);
  });
}

function renderProducts() {
  if (!grid) return;

  const query = String(searchInput?.value || "").trim().toLowerCase();

  const filtered = PRODUCTS.filter((p) => {
    const matchesCategory = ACTIVE_CATEGORY === "All" || String(p.category || "") === ACTIVE_CATEGORY;
    const haystack = [
      p.name,
      p.description,
      p.category,
      p.ingredients,
    ].filter(Boolean).join(" ").toLowerCase();

    return matchesCategory && (!query || haystack.includes(query));
  });

  if (!filtered.length) {
    grid.innerHTML = `<p class="muted">No matching products found.</p>`;
    return;
  }

  grid.innerHTML = filtered.map((p) => {
    const pricingMode = p.pricing_mode || "quote";
    const sellCents = toFiniteCents(p.sell_price_cents);
    const startCents = toFiniteCents(p.starting_price_cents);
    const trialDiscountPercent = Math.max(0, Math.min(90, Number(p.trial_discount_percent || 0) || 0));
    const ingredients = p.ingredients || "";

    return `
      <div class="product-card${p.is_available === false ? " is-unavailable" : ""}">
        <div class="product-image-wrap">
          ${p.image_url ? `<img class="product-image" src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name || "Product")}">` : ""}
        </div>

        <div class="product-body">
          <div class="product-title">${escapeHtml(p.name || "Product")}</div>

          <div class="product-meta">
            ${p.category ? `<span class="product-category">${escapeHtml(p.category)}</span>` : ""}
          </div>

          ${p.description ? `<div class="product-description">${escapeHtml(p.description)}</div>` : ""}

          ${ingredients ? `<div class="product-ingredients"><strong>Ingredients:</strong><br>${escapeHtml(ingredients)}</div>` : ""}

          <div class="product-footer">
            <div>
              <div class="product-price">${escapeHtml(pricing.priceLabelForProduct(p))}</div>
              <div class="muted small">${escapeHtml(pricing.priceNoteForProduct(p))}</div>
            </div>

            <button
              class="btn btn-primary add-to-cart"
              type="button"
              data-id="${escapeHtml(String(p.id || ""))}"
              data-name="${escapeHtml(p.name || "")}"
              data-image="${escapeHtml(p.image_url || "")}"
              data-pricing-mode="${escapeHtml(pricingMode)}"
              data-price-cents="${sellCents}"
              data-starting-price-cents="${startCents}"
              data-delivery-eligible="${p.delivery_eligible === false ? "false" : "true"}"
              data-trial-product-id="${escapeHtml(p.trial_product_id || "")}"
              data-trial-discount-percent="${trialDiscountPercent}"
              data-trial-product-name="${escapeHtml(p.trial_product_name || "")}"
              data-trial-product-image="${escapeHtml(p.trial_product_image_url || "")}"
              data-trial-product-pricing-mode="${escapeHtml(p.trial_product_pricing_mode || "quote")}"
              data-trial-product-price-cents="${toFiniteCents(p.trial_product_sell_price_cents)}"
              data-trial-product-starting-price-cents="${toFiniteCents(p.trial_product_starting_price_cents)}"
              ${p.is_available === false ? "disabled" : ""}
            >
              ${p.is_available === false ? "Unavailable" : "Add to cart"}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".add-to-cart");
  if (!btn) return;

  const item = CL.cart.sanitizeItem({
    id: String(btn.dataset.id || "").trim(),
    name: btn.dataset.name,
    qty: 1,
    thumb: btn.dataset.image || "",
    pricingMode: btn.dataset.pricingMode || "quote",
    priceCents: toFiniteCents(btn.dataset.priceCents),
    startingPriceCents: toFiniteCents(btn.dataset.startingPriceCents),
    deliveryEligible: btn.dataset.deliveryEligible !== "false",
    trialProductId: String(btn.dataset.trialProductId || "").trim(),
    trialDiscountPercent: Math.max(0, Math.min(90, Number(btn.dataset.trialDiscountPercent || 0) || 0)),
    trialProductName: btn.dataset.trialProductName || "",
    trialProductImage: btn.dataset.trialProductImage || "",
    trialProductPricingMode: btn.dataset.trialProductPricingMode || "quote",
    trialProductPriceCents: toFiniteCents(btn.dataset.trialProductPriceCents),
    trialProductStartingPriceCents: toFiniteCents(btn.dataset.trialProductStartingPriceCents),
    unitCentsOverride: null,
  });

  if (!item?.id) return;

  if (window.HTC_CART && typeof window.HTC_CART.add === "function") {
    window.HTC_CART.add(item);
    if (typeof window.HTC_CART.toast === "function") {
      window.HTC_CART.toast(`${item.name} added to cart`);
    }
  }
});

if (searchInput) {
  searchInput.addEventListener("input", renderProducts);
}

fetchProducts();
