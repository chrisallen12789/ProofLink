(() => {
  const CL = window.ProofLink;
  const {
    config,
    helpers: { safeParse, escapeHtml, clampQty, formatCents, normalizeZip },
    catalog,
    pricing,
    cart,
  } = CL;

  const STORAGE_KEY = config?.storefront?.cart?.storageKey || "prooflink_cart_v2";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let CATALOG_CACHE = catalog.loadCache();
  let CATALOG_BY_ID = catalog.buildIndex(CATALOG_CACHE);
  let SYNC_IN_FLIGHT = null;
  const MAX_TOASTS = 3;
  let MEMORY_CART_STATE = { items: [] };

  function fulfillmentCopy() {
    const deliveryCfg = config?.storefront?.delivery || {};
    return {
      pickupLabel: deliveryCfg.pickupLabel || "Pickup",
      deliveryLabel: deliveryCfg.deliveryLabel || "Delivery",
      pickupMessage: deliveryCfg.pickupMessage || "Pickup selected.",
    };
  }

  function syncFulfillmentLabels() {
    const labels = fulfillmentCopy();
    const fulfillmentSelect = $("#orderFulfillment");
    if (fulfillmentSelect) {
      const pickupOption = fulfillmentSelect.querySelector('option[value="pickup"]');
      const deliveryOption = fulfillmentSelect.querySelector('option[value="delivery"]');
      if (pickupOption) pickupOption.textContent = labels.pickupLabel;
      if (deliveryOption) deliveryOption.textContent = labels.deliveryLabel;
    }
    const deliveryValueLabel = document.querySelector('[data-cl-fulfillment-label]');
    if (deliveryValueLabel) deliveryValueLabel.textContent = `${labels.pickupLabel} or ${labels.deliveryLabel}`;
  }

  function read() {
    let raw = "";
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      raw = "";
    }
    const parsed = raw ? safeParse(raw) : null;
    if (!parsed || !Array.isArray(parsed.items)) {
      return {
        items: Array.isArray(MEMORY_CART_STATE.items)
          ? MEMORY_CART_STATE.items.map(cart.sanitizeItem).filter(Boolean)
          : [],
      };
    }

    const nextState = {
      items: parsed.items.map(cart.sanitizeItem).filter(Boolean),
    };
    MEMORY_CART_STATE = nextState;
    return nextState;
  }

  function write(state) {
    const items = Array.isArray(state?.items)
      ? state.items.map(cart.sanitizeItem).filter(Boolean)
      : [];
    MEMORY_CART_STATE = { items };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }));
    } catch (_) {}
  }

  function keyFor(item) {
    return `${item.id}__${item.variantId || "base"}`;
  }

  function loadCatalogRows(rows) {
    CATALOG_CACHE = Array.isArray(rows) ? rows.map(catalog.normalizeProduct).filter(Boolean) : [];
    CATALOG_BY_ID = catalog.buildIndex(CATALOG_CACHE);
    window.PROOFLINK_CATALOG = CATALOG_CACHE;
  }

  async function syncCartWithCatalog() {
    if (SYNC_IN_FLIGHT) return SYNC_IN_FLIGHT;

    SYNC_IN_FLIGHT = (async () => {
      try {
        if (CATALOG_CACHE.length) {
          loadCatalogRows(CATALOG_CACHE);
        } else {
          loadCatalogRows(await catalog.fetch(false));
        }

        const state = read();
        if (!state.items.length) return;

        let changed = false;
        const nextItems = state.items.map((item) => {
          if (item.unitCentsOverride !== null && Number.isFinite(+item.unitCentsOverride)) {
            return item;
          }

          const nextItem = cart.hydrateItemFromCatalog(item, CATALOG_BY_ID);
          if (JSON.stringify(nextItem) !== JSON.stringify(item)) changed = true;
          return nextItem;
        });

        if (changed) write({ items: nextItems });
      } catch (err) {
        console.error("Cart catalog sync failed:", err);
        if (!CATALOG_CACHE.length) {
          loadCatalogRows(catalog.loadCache());
        }
      } finally {
        SYNC_IN_FLIGHT = null;
      }
    })();

    return SYNC_IN_FLIGHT;
  }

  function add(item) {
    const state = read();
    const incoming = cart.sanitizeItem(item);
    if (!incoming?.id) return;

    const k = keyFor(incoming);
    const existing = state.items.find((x) => keyFor(x) === k);

    if (existing) {
      existing.qty = clampQty(existing.qty + incoming.qty);
      if (!existing.thumb && incoming.thumb) existing.thumb = incoming.thumb;
      existing.name = incoming.name || existing.name;
      if (existing.unitCentsOverride === null || !Number.isFinite(+existing.unitCentsOverride)) {
        existing.pricingMode = incoming.pricingMode;
        existing.priceCents = incoming.priceCents;
        existing.startingPriceCents = incoming.startingPriceCents;
        existing.deliveryEligible = incoming.deliveryEligible;
      }
    } else {
      state.items.push(incoming);
    }

    write(state);
    notify();
    syncCartWithCatalog().then(() => notify()).catch(console.error);
  }

  function setQty(id, variantId, qty) {
    const state = read();
    const k = `${id}__${variantId || "base"}`;
    const it = state.items.find((x) => keyFor(x) === k);
    if (!it) return;
    it.qty = clampQty(qty);
    write(state);
    notify();
  }

  function remove(id, variantId) {
    const state = read();
    const k = `${id}__${variantId || "base"}`;
    state.items = state.items.filter((x) => keyFor(x) !== k);
    write(state);
    notify();
  }

  function clear() {
    write({ items: [] });
    notify();
  }

  function count() {
    return read().items.reduce((sum, x) => sum + clampQty(x.qty), 0);
  }

  function selectedFulfillment() {
    return $("#orderFulfillment")?.value || "pickup";
  }

  function selectedZip() {
    return normalizeZip($("#orderDeliveryZip")?.value || "");
  }

  function estimatedTotals() {
    return pricing.estimateCartTotals(read().items);
  }

  function deliveryContext() {
    return cart.deliveryContext({
      items: read().items,
      fulfillment: selectedFulfillment(),
      zip: selectedZip(),
    });
  }

  function checkoutContext() {
    const items = read().items;
    const totals = pricing.estimateCartTotals(items);
    const delivery = cart.deliveryContext({
      items,
      fulfillment: selectedFulfillment(),
      zip: selectedZip(),
    });

    return {
      items,
      subtotalCents: totals.subtotalCents,
      unpricedCount: totals.unpricedCount,
      itemCount: totals.itemCount,
      fulfillment: delivery.fulfillment,
      deliveryZip: delivery.zip,
      deliveryFeeCents: delivery.feeCents,
      deliveryFeeOriginalCents: delivery.originalFeeCents,
      deliveryFree: delivery.free,
      deliveryValid: delivery.valid,
      deliveryMessage: delivery.message,
      totalCents: totals.subtotalCents + (delivery.valid ? delivery.feeCents : 0),
      requestedDate: $("#orderRequestedDate")?.value || "",
      requestedTime: $("#orderRequestedTime")?.value || "",
    };
  }

  function toSummaryText() {
    const state = read();
    const context = checkoutContext();

    const lines = state.items.map((x) => {
      const linePrice = pricing.itemDisplayPrice(x);
      const variant = x.variantLabel ? ` (${x.variantLabel})` : "";
      return `${x.qty} x ${x.name}${variant} — ${linePrice}`;
    });

    lines.push(`Estimated subtotal: ${formatCents(context.subtotalCents)}`);

    if (context.fulfillment === "delivery") {
      if (context.deliveryFree && context.deliveryFeeOriginalCents > 0) {
        lines.push(`Delivery: Free (normally ${formatCents(context.deliveryFeeOriginalCents)})`);
      } else if (context.deliveryValid) {
        lines.push(`Delivery: ${formatCents(context.deliveryFeeCents)}`);
      } else {
        lines.push("Delivery: unavailable for selected ZIP");
      }
    } else {
      lines.push(`Fulfillment: ${fulfillmentCopy().pickupLabel}`);
    }

    if (context.unpricedCount > 0) {
      lines.push(`Quoted items: ${context.unpricedCount}`);
    }

    lines.push(`Estimated total: ${formatCents(context.totalCents)}`);
    return lines.join("\n");
  }

  function updateCountBadges() {
    const c = count();
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = String(c);
      el.toggleAttribute('hidden', c === 0);
    });
  }

  function renderTrialSuggestion() {
    const host = $("#trialSuggestion");
    if (!host) return;

    const state = read();
    if (!state.items.length) {
      host.innerHTML = "";
      return;
    }

    const itemIds = new Set(state.items.map((x) => x.id));
    const source = state.items.find(
      (x) => x.trialProductId && x.trialDiscountPercent > 0 && !itemIds.has(x.trialProductId)
    );

    if (!source) {
      host.innerHTML = "";
      return;
    }

    const mode = pricing.itemMode({
      pricingMode: source.trialProductPricingMode,
      priceCents: source.trialProductPriceCents,
      startingPriceCents: source.trialProductStartingPriceCents,
    });

    const baseCents =
      mode === "starts_at"
        ? Math.max(0, Math.round(source.trialProductStartingPriceCents || 0))
        : Math.max(0, Math.round(source.trialProductPriceCents || 0));

    if (!baseCents || !source.trialProductName) {
      host.innerHTML = "";
      return;
    }

    const discount = Math.max(1, Math.min(90, Number(source.trialDiscountPercent || 0)));
    const discountedCents = Math.max(0, Math.round((baseCents * (100 - discount)) / 100));

    host.innerHTML = `
      <div style="border:1px solid rgba(0,0,0,.08); border-radius:18px; padding:16px; margin-top:18px; background:#fff;">
        <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
          ${source.trialProductImage ? `<img src="${escapeHtml(source.trialProductImage)}" alt="${escapeHtml(source.trialProductName)}" style="width:84px;height:84px;object-fit:cover;border-radius:14px;">` : ""}
          <div style="flex:1; min-width:220px;">
            <div style="font-weight:800; font-size:1.05rem;">Try this with your order</div>
            <div style="margin-top:4px;">${escapeHtml(source.trialProductName)}</div>
            <div class="muted small" style="margin-top:4px;">
              Normally ${formatCents(baseCents)} · add today for ${formatCents(discountedCents)} (${discount}% off)
            </div>
          </div>
          <button id="btnAddTrialProduct" class="btn btn--secondary" type="button">Add trial offer</button>
        </div>
      </div>
    `;

    $("#btnAddTrialProduct")?.addEventListener("click", () => {
      add({
        id: source.trialProductId,
        name: source.trialProductName,
        qty: 1,
        thumb: source.trialProductImage,
        pricingMode: "fixed",
        priceCents: discountedCents,
        startingPriceCents: 0,
        deliveryEligible: true,
        variantId: `trial-${source.id}`,
        variantLabel: "Trial offer",
        unitCentsOverride: discountedCents,
        lineBadge: `${discount}% off trial offer`,
      });

      toast(`${source.trialProductName} added as a trial offer`);
    });
  }

  function updateOrderTotalsUI() {
    const subtotalField = $("#cartSubtotalField");
    const deliveryField = $("#cartDeliveryField");
    const totalField = $("#cartTotalField");
    const summaryField = $("#cartSummaryField");
    const quoteField = $("#cartQuoteField");
    const deliveryMessageField = $("#cartDeliveryMessage");
    const zipWrap = $("#deliveryZipWrap");

    const totals = estimatedTotals();
    const delivery = deliveryContext();

    if (summaryField) {
      summaryField.textContent = `${formatCents(totals.subtotalCents)}${totals.unpricedCount > 0 ? " + quoted items" : ""}`;
    }

    if (subtotalField) subtotalField.textContent = formatCents(totals.subtotalCents);

    if (deliveryField) {
      if (delivery.fulfillment !== "delivery") {
        deliveryField.textContent = fulfillmentCopy().pickupLabel;
      } else if (delivery.free && delivery.originalFeeCents > 0) {
        deliveryField.innerHTML = `<span style="text-decoration:line-through;opacity:.6;margin-right:6px;">${formatCents(delivery.originalFeeCents)}</span>Free`;
      } else if (delivery.valid) {
        deliveryField.textContent = formatCents(delivery.feeCents);
      } else {
        deliveryField.textContent = "Unavailable";
      }
    }

    if (totalField) {
      totalField.textContent = formatCents(totals.subtotalCents + (delivery.valid ? delivery.feeCents : 0));
    }

    if (quoteField) {
      quoteField.textContent =
        totals.unpricedCount > 0
          ? `${totals.unpricedCount} item(s) still require confirmation pricing.`
          : "All items in this cart have visible pricing.";
    }

    if (deliveryMessageField) {
      deliveryMessageField.textContent = delivery.message;
    }

    if (zipWrap) {
      zipWrap.style.display = selectedFulfillment() === "delivery" ? "block" : "none";
    }

    renderTrialSuggestion();
  }

  function renderOrderCart() {
    const wrap = $("#cartItems");
    const empty = $("#cartEmpty");
    if (!wrap) return;

    const state = read();

    if (!state.items.length) {
      wrap.innerHTML = "";
      if (empty) {
        empty.style.display = "block";
        if (document.activeElement === document.body || document.activeElement === wrap) {
          empty.focus();
        }
      }
      updateOrderTotalsUI();
      renderTrialSuggestion();
      return;
    }

    if (empty) empty.style.display = "none";

    wrap.innerHTML = state.items.map((x) => {
      const unit = pricing.unitEstimateCents(x);
      const lineTotal = unit !== null && Number.isFinite(unit)
        ? formatCents(unit * clampQty(x.qty))
        : "Quoted at confirmation";

      return `
        <div style="border:1px solid rgba(0,0,0,.08); border-radius:18px; padding:16px; background:#fff; display:grid; gap:14px;">
          <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
            <div style="width:96px; height:96px; border-radius:16px; overflow:hidden; background:#f4efe9; flex:0 0 auto;">
              ${x.thumb ? `<img src="${escapeHtml(x.thumb)}" alt="${escapeHtml(x.name)}" style="width:100%;height:100%;object-fit:cover;">` : ""}
            </div>

            <div style="flex:1; min-width:220px;">
              <div style="display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap;">
                <div>
                  <div style="font-weight:800; font-size:1.08rem;">${escapeHtml(x.name)}</div>
                  ${x.variantLabel ? `<div class="muted small" style="margin-top:4px;">${escapeHtml(x.variantLabel)}</div>` : ""}
                  <div style="margin-top:6px; font-weight:700;">${escapeHtml(pricing.itemDisplayPrice(x))}</div>
                  <div class="muted small" style="margin-top:4px;">${escapeHtml(pricing.itemPriceNote(x))}</div>
                </div>
                <div style="font-weight:800; font-size:1.05rem;">${lineTotal}</div>
              </div>

              <div style="display:flex; gap:10px; align-items:center; margin-top:14px; flex-wrap:wrap;">
                <button class="qty-btn" type="button" data-cart-minus="${escapeHtml(x.id)}" data-cart-variant="${escapeHtml(x.variantId)}" aria-label="Decrease quantity">−</button>
                <input
                  class="qty-input"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  step="1"
                  value="${x.qty}"
                  data-cart-qty="${escapeHtml(x.id)}"
                  data-cart-variant="${escapeHtml(x.variantId)}"
                  aria-label="Quantity"
                  style="max-width:80px;"
                />
                <button class="qty-btn" type="button" data-cart-plus="${escapeHtml(x.id)}" data-cart-variant="${escapeHtml(x.variantId)}" aria-label="Increase quantity">+</button>
                <button class="btn btn-secondary cart-remove" type="button" data-cart-remove="${escapeHtml(x.id)}" data-cart-variant="${escapeHtml(x.variantId)}">Remove</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    updateOrderTotalsUI();

    $$('[data-cart-minus]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.cartMinus;
        const variantId = b.dataset.cartVariant || '';
        const input = document.querySelector(
          `[data-cart-qty="${CSS.escape(id)}"][data-cart-variant="${CSS.escape(variantId)}"]`
        );
        const current = clampQty(input ? input.value : '1');
        setQty(id, variantId, Math.max(1, current - 1));
      });
    });

    $$('[data-cart-plus]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.cartPlus;
        const variantId = b.dataset.cartVariant || '';
        const input = document.querySelector(
          `[data-cart-qty="${CSS.escape(id)}"][data-cart-variant="${CSS.escape(variantId)}"]`
        );
        const current = clampQty(input ? input.value : '1');
        setQty(id, variantId, Math.min(99, current + 1));
      });
    });

    $$('[data-cart-remove]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.cartRemove;
        const variantId = b.dataset.cartVariant || '';
        remove(id, variantId);
        toast('Removed from cart.');
      });
    });

    $$('[data-cart-qty]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.dataset.cartQty;
        const variantId = input.dataset.cartVariant || '';
        setQty(id, variantId, input.value);
      });
    });
  }

  function notify() {
    updateCountBadges();
    renderOrderCart();
  }

  function toast(message) {
    const host = $("#toastHost");
    if (!host) return;
    while (host.children.length >= MAX_TOASTS) {
      host.firstElementChild?.remove();
    }

    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    host.appendChild(el);

    requestAnimationFrame(() => el.classList.add("show"));

    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 200);
    }, 1800);
  }

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.closest("[data-cart-clear]")) {
      clear();
      toast("Cart cleared.");
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target && (e.target.id === "orderFulfillment" || e.target.id === "orderDeliveryZip")) {
      updateOrderTotalsUI();
    }
  });

  loadCatalogRows(CATALOG_CACHE);
  const requestedDateInput = $("#orderRequestedDate");
  if (requestedDateInput) {
    const today = new Date();
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
    requestedDateInput.min = localDate;
  }
  syncFulfillmentLabels();
  updateCountBadges();
  renderOrderCart();
  syncCartWithCatalog().then(() => notify()).catch(console.error);

  window.PROOFLINK_CART = {
    add,
    setQty,
    remove,
    clear,
    read,
    count,
    toSummaryText,
    getCheckoutContext: checkoutContext,
    toast,
    syncWithCatalog: syncCartWithCatalog,
  };
})();
