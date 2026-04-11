(() => {
  const config = window.PROOFLINK_CONFIG || {};
  const supabase = config.supabase || {};
  const storefront = config.storefront || {};
  const pricingConfig = storefront.pricing || {};
  const deliveryConfig = storefront.delivery || {};
  const cartConfig = storefront.cart || {};

  function safeParse(json) {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[m]));
  }

  function toFiniteCents(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function formatCents(cents) {
    const n = Number.isFinite(+cents) ? Math.max(0, Math.round(+cents)) : 0;
    return `$${(n / 100).toFixed(2)}`;
  }

  function clampQty(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(99, n)) : 1;
  }

  function normalizeZip(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 5);
  }

  function normalizeIngredients(value) {
    if (!value) return "";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "string") return value;
    return "";
  }

  function normalizePricingMode(value, sellCents = 0, startCents = 0) {
    const mode = String(value || "").trim().toLowerCase();
    const sell = toFiniteCents(sellCents);
    const start = toFiniteCents(startCents);

    if (mode === "fixed" && sell > 0) return "fixed";
    if (mode === "starts_at" && start > 0) return "starts_at";
    if (mode === "quote" && sell <= 0 && start <= 0) return "quote";
    if (sell > 0) return "fixed";
    if (start > 0) return "starts_at";
    return "quote";
  }

  function priceLabelForProduct(product) {
    const mode = normalizePricingMode(product?.pricing_mode, product?.sell_price_cents, product?.starting_price_cents);
    if (mode === "fixed") return formatCents(product?.sell_price_cents || 0);
    if (mode === "starts_at") return `Starts at ${formatCents(product?.starting_price_cents || 0)}`;
    return pricingConfig.quoteDisplay || "Contact for quote";
  }

  function priceNoteForProduct(product) {
    const mode = normalizePricingMode(product?.pricing_mode, product?.sell_price_cents, product?.starting_price_cents);
    if (mode === "fixed") return pricingConfig.fixedLabel || "Fixed product price.";
    if (mode === "starts_at") return pricingConfig.startsAtLabel || "Customization may increase final price.";
    return pricingConfig.quoteLabel || "Final price confirmed after review.";
  }

  function normalizeCatalogProduct(row) {
    if (!row || typeof row !== "object") return null;
    const sell = toFiniteCents(row.sell_price_cents);
    const start = toFiniteCents(row.starting_price_cents);
    const trialSell = toFiniteCents(row.trial_product_sell_price_cents);
    const trialStart = toFiniteCents(row.trial_product_starting_price_cents);

    return {
      ...row,
      id: String(row.id || "").trim(),
      name: String(row.name || "").trim(),
      category: String(row.category || "").trim(),
      description: String(row.description || "").trim(),
      ingredients: normalizeIngredients(row.ingredients),
      image_url: String(row.image_url || "").trim(),
      pricing_mode: normalizePricingMode(row.pricing_mode, sell, start),
      sell_price_cents: sell,
      starting_price_cents: start,
      delivery_eligible: row.delivery_eligible !== false,
      is_available: row.is_available !== false,
      trial_product_id: String(row.trial_product_id || "").trim(),
      trial_discount_percent: Number.isFinite(+row.trial_discount_percent)
        ? Math.max(0, Math.min(90, Math.round(+row.trial_discount_percent)))
        : 0,
      trial_product_name: String(row.trial_product_name || "").trim(),
      trial_product_image_url: String(row.trial_product_image_url || "").trim(),
      trial_product_pricing_mode: normalizePricingMode(row.trial_product_pricing_mode, trialSell, trialStart),
      trial_product_sell_price_cents: trialSell,
      trial_product_starting_price_cents: trialStart,
    };
  }

  function sanitizeCartItem(x) {
    if (!x || x.id === null || x.id === undefined) return null;
    const id = String(x.id || "").trim();
    if (!id) return null;

    const priceCents = toFiniteCents(x.priceCents);
    const startingPriceCents = toFiniteCents(x.startingPriceCents);
    const trialProductPriceCents = toFiniteCents(x.trialProductPriceCents);
    const trialProductStartingPriceCents = toFiniteCents(x.trialProductStartingPriceCents);
    const unitCentsOverride =
      x.unitCentsOverride === null || x.unitCentsOverride === undefined
        ? null
        : (Number.isFinite(+x.unitCentsOverride) && +x.unitCentsOverride >= 0 ? Math.round(+x.unitCentsOverride) : null);

    return {
      id,
      name: typeof x.name === "string" ? x.name : id,
      qty: clampQty(x.qty),
      thumb: typeof x.thumb === "string" ? x.thumb : "",
      pricingMode: normalizePricingMode(x.pricingMode, priceCents, startingPriceCents),
      priceCents,
      startingPriceCents,
      deliveryEligible: x.deliveryEligible !== false,
      variantId: typeof x.variantId === "string" ? x.variantId : "",
      variantLabel: typeof x.variantLabel === "string" ? x.variantLabel : "",
      trialProductId: typeof x.trialProductId === "string" ? x.trialProductId : "",
      trialDiscountPercent: Number.isFinite(+x.trialDiscountPercent)
        ? Math.max(0, Math.min(90, Math.round(+x.trialDiscountPercent)))
        : 0,
      trialProductName: typeof x.trialProductName === "string" ? x.trialProductName : "",
      trialProductImage: typeof x.trialProductImage === "string" ? x.trialProductImage : "",
      trialProductPricingMode: normalizePricingMode(
        x.trialProductPricingMode,
        trialProductPriceCents,
        trialProductStartingPriceCents
      ),
      trialProductPriceCents,
      trialProductStartingPriceCents,
      unitCentsOverride,
      lineBadge: typeof x.lineBadge === "string" ? x.lineBadge : "",
    };
  }

  function loadCatalogCache(storage = window.sessionStorage) {
    const parsed = safeParse(storage.getItem(cartConfig.catalogCacheKey || "prooflink_public_catalog_v1") || "[]");
    const rows = Array.isArray(parsed) ? parsed.map(normalizeCatalogProduct).filter((x) => x && x.id) : [];
    return rows;
  }

  function saveCatalogCache(rows, storage = window.sessionStorage) {
    try {
      storage.setItem(cartConfig.catalogCacheKey || "prooflink_public_catalog_v1", JSON.stringify(rows || []));
    } catch {
      // Ignore storage failures.
    }
  }

  function buildCatalogIndex(rows) {
    return new Map((rows || []).map((p) => [String(p?.id || ""), p]).filter((entry) => entry[0]));
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs || 8000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  let catalogFetchPromise = null;

  async function fetchCatalog(includeUnavailable = false) {
    if (!includeUnavailable && catalogFetchPromise) {
      return catalogFetchPromise;
    }

    const run = (async () => {
      if (typeof window.PROOFLINK_WAIT_FOR_TENANT_READY === "function") {
        await window.PROOFLINK_WAIT_FOR_TENANT_READY().catch(() => null);
      } else if (window.PROOFLINK_TENANT_READY && typeof window.PROOFLINK_TENANT_READY.then === "function") {
        await window.PROOFLINK_TENANT_READY.catch(() => null);
      }
      if (typeof window.PROOFLINK_REFRESH_CONFIG === "function") {
        window.PROOFLINK_REFRESH_CONFIG();
      }
      const tenantSlug =
        window.PROOFLINK_CONFIG?.tenant?.slug ||
        window.ProofLink?.config?.tenant?.slug ||
        "honest-to-crust";
      let rows = [];

      if (!tenantSlug || tenantSlug === "default" || tenantSlug === "honest-to-crust") {
        saveCatalogCache(rows);
        window.HTC_CATALOG = rows;
        return rows;
      }

      try {
        const fnRes = await fetchJsonWithTimeout(`/.netlify/functions/get-public-catalog?slug=${encodeURIComponent(tenantSlug)}&include_unavailable=${includeUnavailable ? "true" : "false"}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        }, supabase.catalogFetchTimeoutMs || 8000);

        if (fnRes.ok) {
          const fnData = await fnRes.json().catch(() => ({}));
          rows = (Array.isArray(fnData?.products) ? fnData.products : []).map(normalizeCatalogProduct).filter((x) => x && x.id);
        } else {
          throw new Error(`Public catalog function failed (${fnRes.status})`);
        }
      } catch {
        const supabaseBaseUrl = String(supabase.url || "").replace(/\/+$/, "");
        const rpcName = String(supabase.publicCatalogRpc || "get_public_catalog_by_tenant").trim();
        const url = `${supabaseBaseUrl}/rest/v1/rpc/${rpcName}`;

        const res = await fetchJsonWithTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabase.anonKey,
            Authorization: `Bearer ${supabase.anonKey}`,
          },
          body: JSON.stringify({
            tenant_slug: tenantSlug,
            include_unavailable: !!includeUnavailable,
          }),
        }, supabase.catalogFetchTimeoutMs || 8000);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Catalog request failed (${res.status}): ${text}`);
        }

        const data = await res.json();
        rows = (Array.isArray(data) ? data : []).map(normalizeCatalogProduct).filter((x) => x && x.id);
      }

      saveCatalogCache(rows);
      window.HTC_CATALOG = rows;
      return rows;
    })();

    if (!includeUnavailable) {
      catalogFetchPromise = run;
      try {
        return await run;
      } catch (err) {
        catalogFetchPromise = null;
        throw err;
      }
    }

    return run;
  }

  function hydrateCartItemFromCatalog(item, catalogById) {
    if (!item || !item.id) return item;
    const catalogProduct = catalogById.get(String(item.id || ""));
    if (!catalogProduct) return item;

    return sanitizeCartItem({
      ...item,
      name: catalogProduct.name || item.name,
      thumb: catalogProduct.image_url || item.thumb || "",
      pricingMode: catalogProduct.pricing_mode,
      priceCents: catalogProduct.sell_price_cents,
      startingPriceCents: catalogProduct.starting_price_cents,
      deliveryEligible: catalogProduct.delivery_eligible !== false,
      trialProductId: String(catalogProduct.trial_product_id || item.trialProductId || ""),
      trialDiscountPercent: catalogProduct.trial_discount_percent,
      trialProductName: catalogProduct.trial_product_name || item.trialProductName || "",
      trialProductImage: catalogProduct.trial_product_image_url || item.trialProductImage || "",
      trialProductPricingMode: catalogProduct.trial_product_pricing_mode || item.trialProductPricingMode || "quote",
      trialProductPriceCents: catalogProduct.trial_product_sell_price_cents || item.trialProductPriceCents || 0,
      trialProductStartingPriceCents: catalogProduct.trial_product_starting_price_cents || item.trialProductStartingPriceCents || 0,
    });
  }

  function itemMode(item) {
    return normalizePricingMode(item?.pricingMode, item?.priceCents, item?.startingPriceCents);
  }

  function unitEstimateCents(item) {
    if (item?.unitCentsOverride !== null && Number.isFinite(+item?.unitCentsOverride)) {
      return Math.max(0, Math.round(+item.unitCentsOverride));
    }
    const mode = itemMode(item);
    if (mode === "fixed") return toFiniteCents(item?.priceCents);
    if (mode === "starts_at") return toFiniteCents(item?.startingPriceCents);
    return null;
  }

  function itemDisplayPrice(item) {
    const override = item?.unitCentsOverride !== null && Number.isFinite(+item?.unitCentsOverride)
      ? Math.max(0, Math.round(+item.unitCentsOverride))
      : null;
    if (override !== null) return formatCents(override);

    const mode = itemMode(item);
    if (mode === "fixed") return formatCents(item?.priceCents || 0);
    if (mode === "starts_at") return `Starts at ${formatCents(item?.startingPriceCents || 0)}`;
    return pricingConfig.quoteDisplay || "Contact for quote";
  }

  function itemPriceNote(item) {
    if (item?.lineBadge) return item.lineBadge;
    const mode = itemMode(item);
    if (mode === "fixed") return "Fixed price";
    if (mode === "starts_at") return "Customization may increase final price";
    return "Final price confirmed after review";
  }

  function estimateCartTotals(items) {
    let subtotalCents = 0;
    let unpricedCount = 0;
    const safeItems = Array.isArray(items) ? items.map(sanitizeCartItem).filter(Boolean) : [];

    safeItems.forEach((item) => {
      const unit = unitEstimateCents(item);
      if (unit === null || !Number.isFinite(unit)) {
        unpricedCount += 1;
        return;
      }
      subtotalCents += unit * clampQty(item.qty);
    });

    return {
      subtotalCents,
      unpricedCount,
      itemCount: safeItems.length,
    };
  }

  function deliveryContext({ items, fulfillment, zip }) {
    const safeItems = Array.isArray(items) ? items.map(sanitizeCartItem).filter(Boolean) : [];
    const normalizedFulfillment = fulfillment === "delivery" ? "delivery" : "pickup";
    const normalizedZip = normalizeZip(zip);
    const totals = estimateCartTotals(safeItems);

    if (normalizedFulfillment !== "delivery") {
      return {
        fulfillment: normalizedFulfillment,
        zip: normalizedZip,
        feeCents: 0,
        originalFeeCents: 0,
        free: false,
        valid: true,
        message: deliveryConfig.pickupMessage || "Pickup selected.",
      };
    }

    if (!safeItems.every((item) => item.deliveryEligible !== false)) {
      return {
        fulfillment: normalizedFulfillment,
        zip: normalizedZip,
        feeCents: 0,
        originalFeeCents: 0,
        free: false,
        valid: false,
        message: deliveryConfig.pickupOnlyMessage || "One or more items in this cart are pickup only.",
      };
    }

    const zoneFee = toFiniteCents((deliveryConfig.zipFees || {})[normalizedZip]);
    if (!zoneFee) {
      return {
        fulfillment: normalizedFulfillment,
        zip: normalizedZip,
        feeCents: 0,
        originalFeeCents: 0,
        free: false,
        valid: false,
        message: deliveryConfig.unavailableMessage || "Delivery is currently available only in Livingston County ZIP codes we service.",
      };
    }

    const freeThreshold = toFiniteCents(deliveryConfig.freeThresholdCents);
    if (freeThreshold > 0 && totals.subtotalCents >= freeThreshold) {
      return {
        fulfillment: normalizedFulfillment,
        zip: normalizedZip,
        feeCents: 0,
        originalFeeCents: zoneFee,
        free: true,
        valid: true,
        message: deliveryConfig.freeMessage || "Delivery is free on orders of $100 or more.",
      };
    }

    return {
      fulfillment: normalizedFulfillment,
      zip: normalizedZip,
      feeCents: zoneFee,
      originalFeeCents: zoneFee,
      free: false,
      valid: true,
      message: deliveryConfig.zipFeeMessage || "Delivery fee is based on your ZIP code.",
    };
  }

  window.ProofLink = {
    config,
    helpers: {
      safeParse,
      escapeHtml,
      toFiniteCents,
      formatCents,
      clampQty,
      normalizeZip,
      normalizeIngredients,
      normalizePricingMode,
    },
    catalog: {
      normalizeProduct: normalizeCatalogProduct,
      loadCache: loadCatalogCache,
      saveCache: saveCatalogCache,
      buildIndex: buildCatalogIndex,
      fetch: fetchCatalog,
    },
    pricing: {
      priceLabelForProduct,
      priceNoteForProduct,
      itemMode,
      unitEstimateCents,
      itemDisplayPrice,
      itemPriceNote,
      estimateCartTotals,
    },
    cart: {
      sanitizeItem: sanitizeCartItem,
      hydrateItemFromCatalog: hydrateCartItemFromCatalog,
      deliveryContext,
    },
  };
})();
