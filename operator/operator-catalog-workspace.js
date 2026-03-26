// Catalog workspace extracted from operator.js so products, pricing, and
// availability stay together in one owner-facing module.
async function fetchProducts() {
  if (FETCHING.has('products')) return;
  FETCHING.add('products');
  try {
    const { data, error } = await scopeQuery(sb
      .from("products")
      .select("*"))
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;
    PRODUCTS_CACHE = data || [];
    return PRODUCTS_CACHE;
  } finally {
    FETCHING.delete('products');
  }
}
function renderProductsList(filter = "") {
  const q = String(filter || "").trim().toLowerCase();
  const rows = PRODUCTS_CACHE.filter((p) =>
    !q ||
    String(p.name || "").toLowerCase().includes(q) ||
    String(p.slug || "").toLowerCase().includes(q) ||
    String(p.category || "").toLowerCase().includes(q)
  );

  if (!productsList) return;
  productsList.innerHTML = rows.length ? "" : `<div class="muted">No products.</div>`;

  rows.forEach((p) => {
    const pricingRow = currentPricingRow(p.id) || {
      product_id: p.id,
      product_name: p.name || "",
      unit_label: "job",
      pricing_mode: normalizePricingModeForUi(p),
      sell_price_cents: Number(p.sell_price_cents || 0),
      starting_price_cents: Number(p.starting_price_cents || 0),
    };
    const el = document.createElement("div");
    el.className = "list-item";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(p.name)}</div>
        <div class="li-sub muted">${escapeHtml(p.category || "-")}  |  ${escapeHtml(p.slug)}  |  ${escapeHtml(pricingSummaryForRow(pricingRow))}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${p.is_active ? "pill-on" : ""}">${p.is_active ? "On site" : "Hidden"}</span>
        <span class="pill ${p.is_available ? "pill-on" : ""}">${p.is_available ? "Available" : "Unavailable"}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-edit-product-id="${escapeAttr(p.id)}">Edit</button>
        <button class="btn btn-primary btn-sm" type="button" data-price-product-id="${escapeAttr(p.id)}">Price</button>
      </div>
    `;
    el.addEventListener("click", () => openPricingForProduct(p.id));
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPricingForProduct(p.id);
      }
    });
    productsList.appendChild(el);
  });

  productsList.querySelectorAll("[data-edit-product-id]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const row = PRODUCTS_CACHE.find((product) => product.id === btn.getAttribute("data-edit-product-id"));
      if (row) loadProductIntoForm(row);
    });
  });

  productsList.querySelectorAll("[data-price-product-id]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await openPricingForProduct(btn.getAttribute("data-price-product-id"));
    });
  });
}
function clearProductForm() {
  productId.value = "";
  productName.value = "";
  productSlug.value = "";
  productCategory.value = "";
  productDescription.value = "";
  productTags.value = "";
  productImageUrl.value = "";
  if (productImageFile) productImageFile.value = "";
  if (productImageStatus) productImageStatus.textContent = "";
  if (productIsActive) productIsActive.checked = true;
  if (productIsAvailable) productIsAvailable.checked = true;
  if (productSort) productSort.value = "0";
  if (productMsg) productMsg.textContent = "";
  if (productFormTitle) productFormTitle.textContent = "New product";
}
function loadProductIntoForm(p) {
  productId.value = p.id || "";
  productName.value = p.name || "";
  productSlug.value = p.slug || "";
  productCategory.value = p.category || "";
  productDescription.value = p.description || "";
  productTags.value = Array.isArray(p.ingredients) ? p.ingredients.join(", ") : "";
  productImageUrl.value = p.image_url || "";
  if (productImageFile) productImageFile.value = "";
  if (productImageStatus) productImageStatus.textContent = "";
  if (productIsActive) productIsActive.checked = !!p.is_active;
  if (productIsAvailable) productIsAvailable.checked = !!p.is_available;
  if (productSort) productSort.value = String(p.sort_order ?? 0);
  if (productMsg) productMsg.textContent = "";
  if (productFormTitle) productFormTitle.textContent = `Edit: ${p.name}`;
}
async function openPricingForProduct(productId) {
  if (!productId) return;
  const product = PRODUCTS_CACHE.find((row) => row.id === productId) || null;
  const hydrovacTemplate = hydrovacTemplateForProduct(product);
  ACTIVE_PRICING_PRODUCT_ID = productId;
  renderPricing(await fetchPricing());
  switchTab("pricing");
  if (hydrovacTemplate && !ACTIVE_JOB_ID) {
    applyHydrovacJobTemplate(hydrovacTemplate.key, {
      preserveExisting: true,
      announce: false,
    });
    showToast(`${hydrovacTemplate.label} is ready in Jobs too.`);
  }
}

function presetProductPayload(item, sortOrder) {
  const pricingMode = String(item.pricing_mode || "quote");
  return withTenantScope({
    operator_id: opId(),
    name: item.name,
    slug: item.slug || slugify(item.name),
    category: item.category || "Services",
    description: item.description || "",
    ingredients: [],
    image_url: null,
    is_active: true,
    is_available: true,
    sort_order: sortOrder,
    pricing_mode: pricingMode,
    sell_price_cents: pricingMode === "fixed" ? presetAmountCents(item) : 0,
    starting_price_cents: pricingMode === "starts_at" ? presetAmountCents(item) : 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function loadRecommendedServicePack() {
  const preset = currentServicePreset();
  if (!preset?.items?.length) {
    notifyOperator("No recommended services are configured for this business yet.");
    return;
  }

  if (productMsg) productMsg.textContent = "Loading recommended services...";

  const existingBySlug = new Map((PRODUCTS_CACHE || []).map((row) => [String(row.slug || "").trim().toLowerCase(), row]));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, item] of preset.items.entries()) {
    const slug = slugify(item.name);
    const existing = existingBySlug.get(slug);
    let productIdValue = existing?.id || "";

    if (!existing) {
      const { data, error } = await sb.from("products")
        .insert(presetProductPayload(item, index))
        .select("id")
        .single();
      if (error) throw error;
      productIdValue = data?.id || "";
      inserted += 1;
    } else {
      const shouldHydrateExisting = Number(existing.sell_price_cents || existing.starting_price_cents || 0) <= 0;
      if (shouldHydrateExisting || !String(existing.description || "").trim()) {
        const patch = {
          category: existing.category || item.category || "Services",
          description: String(existing.description || "").trim() || item.description || "",
          pricing_mode: shouldHydrateExisting ? item.pricing_mode : existing.pricing_mode,
          sell_price_cents: shouldHydrateExisting && item.pricing_mode === "fixed" ? presetAmountCents(item) : Number(existing.sell_price_cents || 0),
          starting_price_cents: shouldHydrateExisting && item.pricing_mode === "starts_at" ? presetAmountCents(item) : Number(existing.starting_price_cents || 0),
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from("products")
          .update(patch)
          .eq("id", existing.id)
          .eq(OPERATOR_COLUMN, opId())
          .eq(TENANT_COLUMN, TENANT_ID);
        if (error) throw error;
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    if (!productIdValue) continue;
    await ensurePricingRow(productIdValue);

    const pricingPatch = {
      unit_label: item.unit_label || "job",
      notes: item.notes || "",
      updated_at: new Date().toISOString(),
    };
    const { error: pricingError } = await sb.from("pricing")
      .update(pricingPatch)
      .eq("product_id", productIdValue)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID);
    if (pricingError) throw pricingError;
  }

  await fetchProducts();
  renderProductsList(productSearch?.value || "");
  renderPricing(await fetchPricing());
  renderServicePresetPicker();
  renderBidCatalogStarters(currentBid());
  renderStartupChecklist();

  const summary = `${inserted} added, ${updated} filled in, ${skipped} left alone.`;
  if (productMsg) productMsg.textContent = `Recommended services loaded. ${summary}`;
  if (productPresetNotice) {
    productPresetNotice.innerHTML += `<div class="workspace-panel-notice__copy" style="margin-top:8px;">Latest load: ${escapeHtml(summary)}</div>`;
  }
}
async function ensurePricingRow(productRowId) {
  const { data, error } = await sb
    .from("pricing")
    .select("product_id")
    
    .eq("product_id", productRowId)
    .limit(1);

  if (error) throw error;
  if (Array.isArray(data) && data.length) return;

  const { error: insertError } = await sb.from("pricing").insert(withTenantScope({
    operator_id: opId(),
    product_id: productRowId,
    unit_label: "each",
    sell_price_cents: 0,
    cost_ingredients_cents: 0,
    cost_packaging_cents: 0,
    labor_minutes: 0,
    notes: "",
    updated_at: new Date().toISOString(),
  }));
  if (insertError) throw insertError;
}

function normalizePricingForSave(mode, amountCents) {
  const cents = Math.max(0, Number(amountCents || 0));

  if (mode === "fixed") {
    return {
      pricing_mode: "fixed",
      sell_price_cents: cents,
      starting_price_cents: 0,
    };
  }

  if (mode === "starts_at") {
    return {
      pricing_mode: "starts_at",
      sell_price_cents: 0,
      starting_price_cents: cents,
    };
  }

  return {
    pricing_mode: "quote",
    sell_price_cents: 0,
    starting_price_cents: 0,
  };
}

function normalizePricingModeForUi(productRow) {
  const sell = Number(productRow?.sell_price_cents || 0);
  const start = Number(productRow?.starting_price_cents || 0);
  const raw = String(productRow?.pricing_mode || "").trim().toLowerCase();

  if (sell > 0) return "fixed";
  if (start > 0) return "starts_at";
  if (raw === "fixed" || raw === "starts_at" || raw === "quote") return raw;
  return "quote";
}

function pricingAmountForUi(productRow) {
  const mode = normalizePricingModeForUi(productRow);
  if (mode === "fixed") return Number(productRow?.sell_price_cents || 0);
  if (mode === "starts_at") return Number(productRow?.starting_price_cents || 0);
  return 0;
}

async function uploadProductImage(file) {
  const key = `products/${opId()}/${Date.now()}_${safeFilename(file.name)}`;
  const { error: upErr } = await sb.storage.from("product-images").upload(key, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/png",
  });
  if (upErr) throw upErr;
  const { data } = sb.storage.from("product-images").getPublicUrl(key);
  if (!data?.publicUrl) throw new Error("Upload succeeded but no public URL returned.");
  return data.publicUrl;
}
btnUploadProductImage?.addEventListener("click", async () => {
  const file = productImageFile?.files?.[0];
  if (!file) {
    if (productImageStatus) productImageStatus.textContent = "Choose a file first.";
    return;
  }
  try {
    if (productImageStatus) productImageStatus.textContent = "Uploading...";
    productImageUrl.value = await uploadProductImage(file);
    if (productImageStatus) productImageStatus.textContent = "Uploaded. Click Save to store URL.";
  } catch (err) {
    if (productImageStatus) productImageStatus.textContent = err.message || String(err);
  }
});

async function fetchPricing() {
  const [productsRes, pricingRes] = await Promise.all([
    scopeQuery(sb
      .from("products")
      .select("id, name, category, pricing_mode, sell_price_cents, starting_price_cents"))
            .order("name", { ascending: true }),
    scopeQuery(sb
      .from("pricing")
      .select("*"))
            .order("product_id", { ascending: true }),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (pricingRes.error) throw pricingRes.error;

  const pricingByProductId = new Map((pricingRes.data || []).map((r) => [r.product_id, r]));

  PRICING_CACHE = (productsRes.data || []).map((product) => {
    const pricingRow = pricingByProductId.get(product.id) || null;
    return {
      product_id: product.id,
      product_name: product.name || "",
      product_category: product.category || "",
      pricing_mode: normalizePricingModeForUi(product),
      sell_price_cents: Number(product.sell_price_cents || 0),
      starting_price_cents: Number(product.starting_price_cents || 0),
      unit_label: pricingRow?.unit_label || "each",
      cost_ingredients_cents: Number(pricingRow?.cost_ingredients_cents || 0),
      cost_packaging_cents: Number(pricingRow?.cost_packaging_cents || 0),
      labor_minutes: Number(pricingRow?.labor_minutes || 0),
      notes: pricingRow?.notes || "",
      has_cost_row: !!pricingRow,
    };
  });
  return PRICING_CACHE;
}
function totalCostCents(row) {
  return Number(row.cost_ingredients_cents || 0) + Number(row.cost_packaging_cents || 0);
}
function renderPricing(rows) {
  if (!pricingList) return;

  PRICING_CACHE = Array.isArray(rows) ? rows : [];
  pricingList.innerHTML = "";
  if (!rows.length) {
    pricingList.innerHTML = `<div class="muted">No products yet.</div>`;
    return;
  }

  rows.forEach((r) => {
    const mode = normalizePricingModeForUi(r);
    const amountCents = pricingAmountForUi(r);

    const el = document.createElement("div");
    el.className = "list-item";
    if (r.product_id === ACTIVE_PRICING_PRODUCT_ID) el.classList.add("is-active");
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(r.product_name || r.product_id)}</div>
        <div class="li-sub muted">${escapeHtml(r.product_category || "")}  |  ${escapeHtml(r.unit_label || "each")}</div>
      </div>
      <div class="li-meta" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
        <label class="inline">
          <span class="muted">Mode</span>
          <select data-pricing-mode data-product-id="${escapeAttr(r.product_id)}" class="input sm">
            <option value="quote" ${mode === "quote" ? "selected" : ""}>Quote</option>
            <option value="fixed" ${mode === "fixed" ? "selected" : ""}>Fixed price</option>
            <option value="starts_at" ${mode === "starts_at" ? "selected" : ""}>Starts at</option>
          </select>
        </label>

        <label class="inline">
          <span class="muted">Amount</span>
          <input
            data-pricing-amount
            data-product-id="${escapeAttr(r.product_id)}"
            class="input sm"
            type="number"
            step="0.01"
            min="0"
            value="${money(amountCents)}"
            ${mode === "quote" ? "disabled" : ""}
          />
        </label>

        <label class="inline">
          <span class="muted">Cost</span>
          <input
            data-pricing-cost
            data-product-id="${escapeAttr(r.product_id)}"
            class="input sm"
            type="number"
            step="0.01"
            min="0"
            value="${money(totalCostCents(r))}"
          />
        </label>
      </div>
    `;
    pricingList.appendChild(el);
  });

  if (ACTIVE_PRICING_PRODUCT_ID) {
    const activeRow = pricingList.querySelector(`.list-item.is-active`);
    activeRow?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  pricingList.querySelectorAll("select[data-pricing-mode]").forEach((selectEl) => {
    selectEl.addEventListener("change", async () => {
      const productIdValue = selectEl.getAttribute("data-product-id");
      const amountEl = pricingList.querySelector(`input[data-pricing-amount][data-product-id="${CSS.escape(productIdValue)}"]`);
      const mode = selectEl.value;

      if (amountEl) {
        amountEl.disabled = mode === "quote";
        if (mode === "quote") amountEl.value = "0.00";
      }

      const cents = toCents(amountEl?.value || 0);
      const productPatch = {
        ...normalizePricingForSave(mode, cents),
        updated_at: new Date().toISOString(),
      };

      try {
        const { error } = await sb
          .from("products")
          .update(productPatch)
          .eq("id", productIdValue)
          .eq(OPERATOR_COLUMN, opId());
        if (error) throw error;

        await fetchProducts();
        renderPricing(await fetchPricing());
      } catch (err) {
        notifyOperator(err.message || String(err));
      }
    });
  });

  pricingList.querySelectorAll("input[data-pricing-amount]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const productIdValue = inp.getAttribute("data-product-id");
      const modeEl = pricingList.querySelector(`select[data-pricing-mode][data-product-id="${CSS.escape(productIdValue)}"]`);
      const mode = modeEl?.value || "quote";
      const cents = toCents(inp.value);

      const productPatch = {
        ...normalizePricingForSave(mode, cents),
        updated_at: new Date().toISOString(),
      };

      try {
        const { error } = await sb
          .from("products")
          .update(productPatch)
          .eq("id", productIdValue)
          .eq(OPERATOR_COLUMN, opId());
        if (error) throw error;

        await fetchProducts();
        renderPricing(await fetchPricing());
      } catch (err) {
        notifyOperator(err.message || String(err));
      }
    });
  });

  pricingList.querySelectorAll("input[data-pricing-cost]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const productIdValue = inp.getAttribute("data-product-id");
      const cents = toCents(inp.value);

      try {
        await ensurePricingRow(productIdValue);

        const patch = {
          cost_ingredients_cents: cents,
          cost_packaging_cents: 0,
          updated_at: new Date().toISOString(),
        };

        const { error } = await sb
          .from("pricing")
          .update(patch)
          .eq("product_id", productIdValue)
          .eq(OPERATOR_COLUMN, opId());

        if (error) throw error;

        renderPricing(await fetchPricing());
      } catch (err) {
        notifyOperator(err.message || String(err));
      }
    });
  });
}

function updateAvailabilitySummaryFromForm() {
  const summaryEl = $("availabilitySummaryText");
  if (!summaryEl) return;
  try {
    summaryEl.textContent = availabilitySummaryText(collectAvailabilityFromForm());
  } catch {
    summaryEl.textContent = "Finish any invalid schedule fields to see the summary update.";
  }
}
function renderAvailability() {
  if (!availabilityWrap || !AVAILABILITY) return;

  const rules = AVAILABILITY.rules || [];
  const summaryText = availabilitySummaryText(AVAILABILITY);
  const maxOrdersEnabled = Number(AVAILABILITY.max_orders_per_day || 0) > 0;
  const calendarCells = buildAvailabilityCalendarCells(AVAILABILITY, 28);
  const prepOutlook = buildPrepOutlook(14);

  availabilityWrap.innerHTML = `
    <div class="availability-ui form">
      <div class="card" style="margin-bottom:14px;">
        <div class="card-hd">
          <strong>Availability summary</strong>
          <span class="muted">A plain-language view of what customers can request.</span>
        </div>
        <div class="card-bd">
          <div id="availabilitySummaryText" style="line-height:1.65;font-size:15px;color:var(--text);">${escapeHtml(summaryText)}</div>
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <div class="card-hd">
            <strong>Business schedule</strong>
            <span class="muted">Choose when orders are allowed.</span>
          </div>
          <div class="card-bd form">
            <label>Timezone
              <select id="availabilityTimezone">
                ${AVAILABILITY_TIMEZONES.map((tz) => `
                  <option value="${escapeAttr(tz.value)}" ${tz.value === AVAILABILITY.timezone ? "selected" : ""}>${escapeHtml(tz.label)}</option>
                `).join("")}
              </select>
            </label>

            <div class="grid two">
              <label>Lead time required
                <select id="availabilityLeadTime">
                  ${AVAILABILITY_LEAD_TIMES.map((o) => `
                    <option value="${o.value}" ${Number(o.value) === Number(AVAILABILITY.lead_time_hours) ? "selected" : ""}>${escapeHtml(o.label)}</option>
                  `).join("")}
                </select>
              </label>

              <div>
                <label class="inline" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;">
                  <input id="availabilityLimitToggle" type="checkbox" ${maxOrdersEnabled ? "checked" : ""} style="width:18px;height:18px;margin:0;" />
                  <span>Limit orders per day</span>
                </label>
                <input id="availabilityMaxOrders" type="number" min="1" step="1" value="${escapeAttr(maxOrdersEnabled ? AVAILABILITY.max_orders_per_day : 6)}" ${maxOrdersEnabled ? "" : "disabled"} />
              </div>
            </div>

            <label>Schedule notes
              <textarea id="availabilityNotes" rows="4" placeholder="Example: Custom cakes need at least 72 hours notice.">${escapeHtml(AVAILABILITY.notes || "")}</textarea>
            </label>
          </div>
        </div>

        <div class="card">
          <div class="card-hd">
            <strong>Closed or blackout dates</strong>
            <span class="muted">Add specific dates customers cannot book.</span>
          </div>
          <div class="card-bd form">
            <div class="row" style="align-items:end;gap:10px;">
              <label style="flex:1;">Closed date
                <input id="availabilityBlackoutDatePicker" type="date" />
              </label>
              <button id="btnAddAvailabilityBlackout" class="btn btn-ghost" type="button">Add date</button>
            </div>

            <input id="availabilityBlackoutDatesData" type="hidden" value="${escapeAttr(JSON.stringify(AVAILABILITY.blackout_dates || []))}" />
            <div id="availabilityBlackoutList" style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">${renderBlackoutDateItems(AVAILABILITY.blackout_dates || [])}</div>
            <div class="muted" style="font-size:12px;line-height:1.5;margin-top:8px;">Add holidays, vacations, or planned shutdown days.</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px;">
        <div class="card-hd" style="align-items:flex-start;gap:14px;flex-wrap:wrap;">
          <div>
            <strong>Order days and hours</strong>
            <div class="muted" style="margin-top:4px;">Turn days on or off, then set the order window.</div>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap;">
            <button id="btnCopyMondayToWeekdays" class="btn btn-ghost" type="button">Copy Monday to weekdays</button>
            <button id="btnSetWeekdaysStandard" class="btn btn-ghost" type="button">Set weekdays 8-5</button>
            <button id="btnCopyWeekdaysToWeekend" class="btn btn-ghost" type="button">Copy Friday to weekend</button>
            <button id="btnClearWeekend" class="btn btn-ghost" type="button">Close weekend</button>
          </div>
        </div>

        <div class="card-bd" style="display:flex;flex-direction:column;gap:12px;">
          ${rules.map((rule) => `
            <div style="display:grid;grid-template-columns:180px 1fr;gap:16px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:16px;background:rgba(0,0,0,.18);">
              <label class="inline" style="font-size:14px;color:var(--text);font-weight:700;">
                <input type="checkbox" class="availability-day-enabled" data-day="${escapeAttr(rule.day)}" ${rule.enabled ? "checked" : ""} style="width:18px;height:18px;margin:0;" />
                <span>${escapeHtml(prettifyDay(rule.day))}</span>
              </label>

              <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 220px));gap:12px;">
                <label>
                  <span class="muted">Start</span>
                  <input type="time" class="availability-day-start" data-day="${escapeAttr(rule.day)}" value="${escapeAttr(rule.start || "08:00")}" ${rule.enabled ? "" : "disabled"} />
                </label>
                <label>
                  <span class="muted">End</span>
                  <input type="time" class="availability-day-end" data-day="${escapeAttr(rule.day)}" value="${escapeAttr(rule.end || "17:00")}" ${rule.enabled ? "" : "disabled"} />
                </label>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="grid two" style="margin-top:14px;">
        <div class="card">
          <div class="card-hd">
            <strong>Next 28 days</strong>
            <span class="muted">Open, closed, full, and booked days at a glance.</span>
          </div>
          <div class="card-bd">
            <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">
              ${calendarCells.map((cell) => `
                <div style="border:1px solid var(--border);border-radius:14px;padding:10px;background:${cell.blackout ? "rgba(160,40,40,.15)" : cell.full ? "rgba(180,120,0,.15)" : cell.open ? "rgba(40,120,60,.12)" : "rgba(255,255,255,.03)"};">
                  <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">
                    <strong>${escapeHtml(cell.label)}</strong>
                    <span class="muted">${escapeHtml(cell.weekday)}</span>
                  </div>
                  <div class="muted" style="font-size:12px;">${escapeHtml(cell.stateLabel)}</div>
                  <div style="font-size:12px;margin-top:6px;">${cell.open && cell.start && cell.end ? `${escapeHtml(formatTime12(cell.start))}-${escapeHtml(formatTime12(cell.end))}` : "-"}</div>
                  <div style="font-size:12px;margin-top:6px;">Orders: <strong>${cell.count}</strong></div>
                  <div style="font-size:12px;margin-top:4px;">Value: <strong>${formatUsd(cell.revenueCents || 0)}</strong></div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-hd">
            <strong>Prep outlook</strong>
            <span class="muted">Use upcoming scheduled requests to spot load and ingredient pressure.</span>
          </div>
          <div class="card-bd">
            <div style="margin-bottom:12px;">
              <div class="muted" style="margin-bottom:6px;">Upcoming scheduled orders</div>
              ${prepOutlook.upcoming.length ? `
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${prepOutlook.upcoming.slice(0, 8).map((row) => `
                    <div style="border:1px solid var(--border);border-radius:12px;padding:8px 10px;background:rgba(255,255,255,.03);">
                      <div style="display:flex;justify-content:space-between;gap:8px;">
                        <strong>${escapeHtml(row.scheduledDate)}</strong>
                        <span>${escapeHtml(row.name || "Customer")}</span>
                      </div>
                      <div class="muted" style="font-size:12px;margin-top:4px;">
                        ${escapeHtml(row.pickupWindow || row.occasion || "Scheduled request")}  |  ${formatUsd(row.estimatedTotalCents || 0)}
                      </div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div class="muted">No upcoming orders with a readable scheduled date yet.</div>`}
            </div>

            <div style="margin-bottom:12px;">
              <div class="muted" style="margin-bottom:6px;">Top upcoming items</div>
              ${prepOutlook.topItems.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${prepOutlook.topItems.map(([name, qty]) => `<span class="pill pill-on">${escapeHtml(name)} x ${escapeHtml(String(qty))}</span>`).join("")}
                </div>
              ` : `<div class="muted">No item-level counts available yet.</div>`}
            </div>

            <div style="margin-bottom:12px;">
              <div class="muted" style="margin-bottom:6px;">Ingredient watchlist</div>
              ${prepOutlook.topIngredients.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                  ${prepOutlook.topIngredients.map(([name, qty]) => `<span class="pill">${escapeHtml(name)} x ${escapeHtml(String(qty))}</span>`).join("")}
                </div>
              ` : `<div class="muted">Ingredient forecasting becomes stronger as product ingredients and dated orders fill in.</div>`}
            </div>

            ${prepOutlook.unscheduled.length ? `
              <div>
                <div class="muted" style="margin-bottom:6px;">Requests missing a usable date</div>
                <div class="muted" style="font-size:12px;line-height:1.55;">${escapeHtml(String(prepOutlook.unscheduled.length))} request(s) do not yet include a readable date in the pickup/delivery window.</div>
              </div>
            ` : ""}
          </div>
        </div>
      </div>
    </div>
  `;

  syncBlackoutDateUi(AVAILABILITY.blackout_dates || []);

  availabilityWrap.querySelectorAll(".availability-day-enabled").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const day = checkbox.getAttribute("data-day");
      const start = availabilityWrap.querySelector(`.availability-day-start[data-day="${day}"]`);
      const end = availabilityWrap.querySelector(`.availability-day-end[data-day="${day}"]`);
      if (start) start.disabled = !checkbox.checked;
      if (end) end.disabled = !checkbox.checked;
      updateAvailabilitySummaryFromForm();
    });
  });

  availabilityWrap.querySelectorAll("#availabilityTimezone,#availabilityLeadTime,#availabilityNotes,.availability-day-start,.availability-day-end").forEach((el) => {
    el.addEventListener("change", updateAvailabilitySummaryFromForm);
    el.addEventListener("input", updateAvailabilitySummaryFromForm);
  });

  $("availabilityLimitToggle")?.addEventListener("change", (e) => {
    const input = $("availabilityMaxOrders");
    if (input) {
      input.disabled = !e.target.checked;
      if (!e.target.checked) input.value = "6";
    }
    updateAvailabilitySummaryFromForm();
  });

  $("availabilityMaxOrders")?.addEventListener("input", updateAvailabilitySummaryFromForm);

  $("btnAddAvailabilityBlackout")?.addEventListener("click", () => {
    const value = $("availabilityBlackoutDatePicker")?.value?.trim();
    if (!value) return;
    syncBlackoutDateUi(Array.from(new Set([...getAvailabilityBlackoutDatesFromUi(), value])).sort());
    if ($("availabilityBlackoutDatePicker")) $("availabilityBlackoutDatePicker").value = "";
    updateAvailabilitySummaryFromForm();
  });

  $("btnCopyMondayToWeekdays")?.addEventListener("click", () => copyDaySchedule("monday", ["tuesday", "wednesday", "thursday", "friday"]));
  $("btnSetWeekdaysStandard")?.addEventListener("click", () => {
    ["monday", "tuesday", "wednesday", "thursday", "friday"].forEach((day) => setAvailabilityDay(day, { enabled: true, start: "08:00", end: "17:00" }));
    updateAvailabilitySummaryFromForm();
  });
  $("btnCopyWeekdaysToWeekend")?.addEventListener("click", () => copyDaySchedule("friday", ["saturday", "sunday"]));
  $("btnClearWeekend")?.addEventListener("click", () => {
    ["saturday", "sunday"].forEach((day) => setAvailabilityDay(day, { enabled: false, start: "08:00", end: "17:00" }));
    updateAvailabilitySummaryFromForm();
  });
}
function collectAvailabilityFromForm() {
  const limitEnabled = !!$("availabilityLimitToggle")?.checked;
  const rules = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => ({
    day,
    enabled: !!document.querySelector(`.availability-day-enabled[data-day="${day}"]`)?.checked,
    start: document.querySelector(`.availability-day-start[data-day="${day}"]`)?.value || "08:00",
    end: document.querySelector(`.availability-day-end[data-day="${day}"]`)?.value || "17:00",
  }));

  for (const rule of rules) {
    if (rule.enabled && rule.start >= rule.end) {
      throw new Error(`${prettifyDay(rule.day)} has an end time that must be later than the start time.`);
    }
  }

  const maxOrdersPerDay = limitEnabled ? Number($("availabilityMaxOrders")?.value || 0) : 0;
  if (limitEnabled && maxOrdersPerDay < 1) throw new Error("Daily order limit must be at least 1 when enabled.");

  return normalizeAvailability({
    operator_id: opId(),
    timezone: $("availabilityTimezone")?.value || "America/New_York",
    lead_time_hours: Number($("availabilityLeadTime")?.value || 24),
    max_orders_per_day: maxOrdersPerDay,
    notes: $("availabilityNotes")?.value?.trim() || "",
    blackout_dates: getAvailabilityBlackoutDatesFromUi(),
    rules,
    updated_at: new Date().toISOString(),
  });
}

let CATALOG_WORKSPACE_BOUND = false;

function initCatalogWorkspaceBindings() {
  if (CATALOG_WORKSPACE_BOUND) return;
  CATALOG_WORKSPACE_BOUND = true;

  productName?.addEventListener("input", () => {
    if (!productId.value) productSlug.value = slugify(productName.value);
  });

  productSearch?.addEventListener("input", debounce(() => renderProductsList(productSearch.value)));
  servicePresetPack?.addEventListener("change", renderServicePresetPicker);

  btnLoadRecommendedServices?.addEventListener("click", async () => {
    try {
      await loadRecommendedServicePack();
    } catch (err) {
      if (productMsg) productMsg.textContent = err.message || String(err);
      else notifyOperator(err.message || String(err));
    }
  });

  btnRefreshProducts?.addEventListener("click", async () => {
    try {
      await fetchProducts();
      await fetchPricing();
      renderProductsList(productSearch.value);
      renderServicePresetPicker();
      renderBidCatalogStarters(currentBid());
      await refreshPicklists();
      renderStartupChecklist();
    } catch (err) {
      notifyOperator(err.message || String(err));
    }
  });

  btnNewProduct?.addEventListener("click", clearProductForm);

  productForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (productMsg) productMsg.textContent = "Saving...";

    const id = productId.value || null;
    const payload = withTenantScope({
      operator_id: opId(),
      name: productName.value.trim(),
      slug: productSlug.value.trim(),
      category: preferExisting(productCategory.value, PICK_PRODUCT_CATEGORIES),
      description: productDescription.value.trim(),
      ingredients: String(productTags.value || "").split(",").map((s) => normalizePick(s)).filter(Boolean),
      image_url: productImageUrl.value.trim() || null,
      is_active: !!productIsActive.checked,
      is_available: !!productIsAvailable.checked,
      sort_order: Number(productSort.value || 0),
      updated_at: new Date().toISOString(),
    });

    try {
      let savedId = id;
      if (id) {
        const { error } = await sb.from("products").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("products")
          .insert({
            ...payload,
            pricing_mode: "quote",
            sell_price_cents: 0,
            starting_price_cents: 0,
            created_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error) throw error;
        savedId = data?.id || null;
        if (savedId) productId.value = savedId;
      }

      if (savedId) await ensurePricingRow(savedId);

      if (productMsg) productMsg.textContent = "Saved.";
      markWorkspaceClean("products");
      await fetchProducts();
      await fetchPricing();
      renderProductsList(productSearch.value);
      renderServicePresetPicker();
      renderBidCatalogStarters(currentBid());
      await refreshPicklists();
      renderStartupChecklist();
      const current = PRODUCTS_CACHE.find((p) => p.id === savedId);
      if (current) loadProductIntoForm(current);
    } catch (err) {
      if (productMsg) productMsg.textContent = err.message || String(err);
    }
  });

  btnArchiveProduct?.addEventListener("click", async () => {
    if (!productId.value) return;
    try {
      const { error } = await sb
        .from("products")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", productId.value)
        .eq(OPERATOR_COLUMN, opId());
      if (error) throw error;
      if (productMsg) productMsg.textContent = "Archived.";
      await fetchProducts();
      await fetchPricing();
      renderProductsList(productSearch.value);
      renderServicePresetPicker();
      renderBidCatalogStarters(currentBid());
      renderStartupChecklist();
    } catch (err) {
      if (productMsg) productMsg.textContent = err.message || String(err);
    }
  });

  btnUploadProductImage?.addEventListener("click", async () => {
    const file = productImageFile?.files?.[0];
    if (!file) {
      if (productImageStatus) productImageStatus.textContent = "Choose a file first.";
      return;
    }
    try {
      if (productImageStatus) productImageStatus.textContent = "Uploading...";
      productImageUrl.value = await uploadProductImage(file);
      if (productImageStatus) productImageStatus.textContent = "Uploaded. Click Save to store URL.";
    } catch (err) {
      if (productImageStatus) productImageStatus.textContent = err.message || String(err);
    }
  });

  btnRefreshPricing?.addEventListener("click", async () => {
    try {
      await fetchProducts();
      renderPricing(await fetchPricing());
      renderBidCatalogStarters(currentBid());
    } catch (err) {
      notifyOperator(err.message || String(err));
    }
  });

  btnRefreshAvailability?.addEventListener("click", async () => {
    try {
      await fetchAvailability();
      renderAvailability();
      if (availabilityMsg) availabilityMsg.textContent = "";
    } catch (err) {
      if (availabilityMsg) availabilityMsg.textContent = err.message || String(err);
    }
  });

  btnSaveAvailability?.addEventListener("click", async () => {
    try {
      if (availabilityMsg) availabilityMsg.textContent = "Saving...";
      const payload = collectAvailabilityFromForm();
      const { error } = await sb.from("availability").upsert(payload, { onConflict: `${TENANT_COLUMN},${OPERATOR_COLUMN}` });
      if (error) throw error;
      AVAILABILITY = normalizeAvailability(payload);
      renderAvailability();
      markWorkspaceClean("availability");
      if (availabilityMsg) availabilityMsg.textContent = "Availability saved.";
    } catch (err) {
      if (availabilityMsg) availabilityMsg.textContent = err.message || String(err);
    }
  });
}

const CATALOG_WORKSPACE_HELPERS = {
  fetchProducts,
  renderProductsList,
  clearProductForm,
  loadProductIntoForm,
  openPricingForProduct,
  presetProductPayload,
  loadRecommendedServicePack,
  ensurePricingRow,
  normalizePricingForSave,
  normalizePricingModeForUi,
  pricingAmountForUi,
  uploadProductImage,
  fetchPricing,
  totalCostCents,
  renderPricing,
  updateAvailabilitySummaryFromForm,
  renderAvailability,
  collectAvailabilityFromForm,
  initCatalogWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_CATALOG_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_CATALOG_WORKSPACE || {}),
  ...CATALOG_WORKSPACE_HELPERS,
};

Object.assign(window, CATALOG_WORKSPACE_HELPERS);
