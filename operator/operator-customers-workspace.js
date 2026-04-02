// Customer workspace extracted from operator.js so CRM list state, customer
// saves, and interaction logging live with the customer detail workspace.
async function fetchCustomers() {
  if (FETCHING.has("customers")) return;
  FETCHING.add("customers");
  try {
    const { count, error: countError } = await scopeQuery(sb
      .from("customers")
      .select("*", { count: "exact", head: true }))
      .eq("is_deleted", false);
    if (countError) {
      if (countError.name === "AbortError" || countError.message?.includes("abort")) return;
      console.error("[fetchCustomers count]", countError);
    } else {
      CUSTOMERS_TOTAL_COUNT = count || 0;
    }

    const { data, error } = await scopeQuery(sb
      .from("customers")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .eq("is_deleted", false)
      .order("lifetime_value_cents", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(FETCH_OFFSETS.customers, FETCH_OFFSETS.customers + PAGE_SIZE - 1);

    if (error) {
      if (error.name === "AbortError" || error.message?.includes("abort")) return;
      console.error("[fetchCustomers]", error);
      return;
    }
    if (FETCH_OFFSETS.customers === 0) {
      CUSTOMERS_CACHE = data || [];
    } else {
      CUSTOMERS_CACHE = [...CUSTOMERS_CACHE, ...(data || [])];
    }
    TABS_LOADED.delete("customers");
    return CUSTOMERS_CACHE;
  } finally {
    FETCHING.delete("customers");
  }
}

async function fetchCustomerInteractions(customerId) {
  const { data, error } = await scopeQuery(sb
    .from("customer_interactions")
    .select("*"))
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

async function logCustomerInteraction(customerId, type, summary, metadata = {}) {
  if (!customerId) throw new Error("Customer id is required.");
  const nowIso = new Date().toISOString();
  const { error } = await sb.from("customer_interactions").insert(withTenantScope({
    operator_id: opId(),
    customer_id: customerId,
    type,
    summary,
    metadata,
    created_at: nowIso,
  }));
  if (error) throw error;

  const { error: customerError } = await sb.from("customers")
    .update({ last_contact_at: nowIso, updated_at: nowIso })
    .eq("id", customerId)
    .eq(OPERATOR_COLUMN, opId())
    .eq(TENANT_COLUMN, TENANT_ID);
  if (customerError) throw customerError;
  return nowIso;
}

const CUSTOMER_INTERACTION_OPTIONS = [
  { value: "note", label: "General note", placeholder: "What happened with this customer?" },
  { value: "call", label: "Phone call", placeholder: "What was discussed on the call?" },
  { value: "text", label: "Text message", placeholder: "What did you text or learn by text?" },
  { value: "email", label: "Email", placeholder: "What was sent or answered by email?" },
  { value: "voicemail", label: "Voicemail", placeholder: "What message was left or received?" },
  { value: "onsite", label: "On-site visit", placeholder: "What happened at the property or visit?" },
  { value: "quote", label: "Quote or bid", placeholder: "What changed with the quote or bid?" },
  { value: "follow_up", label: "Follow-up", placeholder: "What follow-up happened or is needed next?" },
  { value: "issue", label: "Issue or complaint", placeholder: "What problem or concern came up?" },
  { value: "payment", label: "Payment", placeholder: "What happened with payment or collection?" },
  { value: "order", label: "Order or job", placeholder: "What changed on the order or job?" },
  { value: "internal", label: "Internal note", placeholder: "What should the team remember internally?" },
];

function customerInteractionLabel(type) {
  const match = CUSTOMER_INTERACTION_OPTIONS.find((option) => option.value === String(type || "").trim());
  if (match) return match.label;
  return String(type || "note")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function customerInteractionPlaceholder(type) {
  return CUSTOMER_INTERACTION_OPTIONS.find((option) => option.value === String(type || "").trim())?.placeholder
    || "What happened with this customer?";
}

function customerInteractionOptionsMarkup(selected = "note") {
  return CUSTOMER_INTERACTION_OPTIONS.map((option) => (
    `<option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
}

function findExistingCustomerRecord(row) {
  const email = String(row?.email || "").trim().toLowerCase();
  const phone = String(row?.phone || "").trim();
  return CUSTOMERS_CACHE.find((customer) => (
    (email && String(customer.email || "").trim().toLowerCase() === email)
    || (phone && String(customer.phone || "").trim() === phone)
  )) || null;
}

async function upsertCrmCustomerFromBridge(row) {
  const existing = findExistingCustomerRecord(row);
  if (existing) return existing;

  const payload = withTenantScope({
    operator_id: opId(),
    company_name: row.company_name || row.companyName || row.business_name || row.businessName || null,
    name: row.name || "Customer",
    email: row.email || null,
    phone: row.phone || null,
    preferred_contact: row.preferred || row.preferredContact || "email",
    notes: row.notes || "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_contact_at: new Date().toISOString(),
  });

  const { data, error } = await sb.from("customers").insert(payload).select("*").single();
  if (error) throw error;
  CUSTOMERS_CACHE.unshift(data);
  return data;
}

async function orderExistsForBridgeId(bridgeId) {
  const { data, error } = await scopeQuery(sb
    .from("orders")
    .select("id"))
    .eq("source_type", "bridge")
    .eq("source_ref", bridgeId)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function importBridgeOrdersToCrm() {
  const rows = readBridgeOrders();
  if (!rows.length) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    if (await orderExistsForBridgeId(row.id)) {
      skipped += 1;
      continue;
    }

    const customer = await upsertCrmCustomerFromBridge(row);
    const scheduledDate = getScheduledDateFromOrder(row);
    const totalCents = Number(row.estimatedTotalCents || 0);

    const { data: orderData, error: orderError } = await sb.from("orders").insert(withTenantScope({
      operator_id: opId(),
      customer_id: customer.id,
      status: row.status === "reviewed" ? "quoted" : "draft",
      scheduled_date: scheduledDate || null,
      scheduled_time: row.pickupWindow || null,
      items: Array.isArray(row.items) ? row.items : [],
      subtotal_cents: totalCents,
      total_cents: totalCents,
      notes: row.notes || row.cartSummary || "",
      source_type: "bridge",
      source_ref: row.id,
      created_at: row.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).select("*").single();

    if (orderError) throw orderError;
    CRM_ORDERS_CACHE.unshift(orderData);

    await sb.from("customer_interactions").insert(withTenantScope({
      operator_id: opId(),
      customer_id: customer.id,
      type: "order_imported",
      summary: `Imported storefront request for ${formatUsd(totalCents)}`,
      metadata: { bridge_id: row.id, pickup_window: row.pickupWindow || null },
      source_type: "bridge",
      source_ref: row.id,
      created_at: new Date().toISOString(),
    }));

    const existingValue = Number(customer.lifetime_value_cents || 0);
    const existingCount = Number(customer.order_count || 0);
    const { data: updatedCustomer, error: customerError } = await sb.from("customers")
      .update({
        lifetime_value_cents: existingValue + totalCents,
        order_count: existingCount + 1,
        updated_at: new Date().toISOString(),
        last_contact_at: new Date().toISOString(),
      })
      .eq("id", customer.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();
    if (customerError) throw customerError;
    CUSTOMERS_CACHE = CUSTOMERS_CACHE.map((entry) => entry.id === customer.id ? updatedCustomer : entry);
    imported += 1;
  }

  await Promise.all([fetchCustomers(), fetchCrmOrders(), fetchPayments()]);
  return { imported, skipped };
}

function populateCustomerForm(customer = null) {
  if (customerFormTitle) customerFormTitle.textContent = customer?.id ? "Edit customer details" : "New customer";
  if (customerId) customerId.value = customer?.id || "";
  if (customerCompanyName) customerCompanyName.value = customer?.company_name || "";
  if (customerName) customerName.value = customer?.name || "";
  if (customerEmail) customerEmail.value = customer?.email || "";
  if (customerPhone) customerPhone.value = customer?.phone || "";
  if (customerPreferredContact) customerPreferredContact.value = customer?.preferred_contact || "email";
  if (customerNotes) customerNotes.value = customer?.notes || "";
  if (customerAddress1) customerAddress1.value = customer?.address_line1 || "";
  if (customerCity) customerCity.value = customer?.city || "";
  if (customerState) customerState.value = customer?.state || "";
  if (customerZip) customerZip.value = customer?.zip || "";
  if (btnClearCustomerForm) btnClearCustomerForm.textContent = customer?.id ? "New customer" : "Clear form";
}

function customerWorkbenchNode(id) {
  return typeof document !== "undefined" && document && typeof document.getElementById === "function"
    ? document.getElementById(id)
    : null;
}

function customerWorkbenchFilterEl() {
  return customerWorkbenchNode("customerWorkbenchFilter");
}

function customerWorkbenchStatsEl() {
  return customerWorkbenchNode("customerWorkbenchStats");
}

function customerWorkbenchTitleEl() {
  return customerWorkbenchNode("customerWorkbenchTitle");
}

function customerWorkbenchSubtitleEl() {
  return customerWorkbenchNode("customerWorkbenchSubtitle");
}

function customerEditorCardEl() {
  return customerWorkbenchNode("customerEditorCard");
}

function btnCustomerPrevEl() {
  return customerWorkbenchNode("btnCustomerPrev");
}

function btnCustomerNextEl() {
  return customerWorkbenchNode("btnCustomerNext");
}

function btnCustomerEditEl() {
  return customerWorkbenchNode("btnCustomerEdit");
}

function btnCloseCustomerEditorEl() {
  return customerWorkbenchNode("btnCloseCustomerEditor");
}

function currentCustomerWorkbenchFilter() {
  return customerWorkbenchFilterEl()?.value || "all";
}

function customerDisplayTitle(customer = null) {
  return customer?.company_name || customer?.name || "Unnamed customer";
}

function customerDisplayContactLine(customer = null) {
  const parts = [];
  if (customer?.company_name && customer?.name) parts.push(customer.name);
  if (customer?.email) parts.push(customer.email);
  if (customer?.phone) parts.push(customer.phone);
  return parts.length ? parts.join(" | ") : "No contact details on file";
}

function customerKnownAddressesForWorkbench(customerIdValue, customer = null) {
  if (typeof customerKnownAddresses === "function") return customerKnownAddresses(customerIdValue, customer);
  const known = new Set();
  const addAddress = (value) => {
    const normalized = String(value || "").trim();
    if (normalized) known.add(normalized);
  };
  addAddress(customer?.service_address);
  addAddress(customer?.address_line1);
  addAddress(customer?.billing_address);
  LEADS_CACHE.filter((row) => row.customer_id === customerIdValue).forEach((row) => addAddress(row.service_address));
  BIDS_CACHE.filter((row) => row.customer_id === customerIdValue).forEach((row) => addAddress(row.service_address));
  CRM_ORDERS_CACHE.filter((row) => row.customer_id === customerIdValue && !row.is_deleted).forEach((row) => addAddress(row.service_address));
  JOBS_CACHE.filter((row) => row.customer_id === customerIdValue && !row.is_deleted).forEach((row) => addAddress(row.service_address));
  return [...known];
}

function customerWorkbenchMetrics(customer = null) {
  if (!customer?.id) {
    return {
      balance: 0,
      billed: 0,
      paid: 0,
      openRequestsCount: 0,
      openProposalCount: 0,
      activeOrderCount: 0,
      activeJobCount: 0,
      activeRelationshipCount: 0,
      siteCount: 0,
      lastTouchAt: "",
      staleDays: null,
      addresses: [],
    };
  }

  const customerIdValue = customer.id;
  const orders = CRM_ORDERS_CACHE.filter((row) => row.customer_id === customerIdValue && !row.is_deleted);
  const payments = PAYMENTS_CACHE.filter((row) => row.customer_id === customerIdValue);
  const openRequestsCount = LEADS_CACHE.filter((row) => (
    row.customer_id === customerIdValue
    && !["won", "closed", "archived", "cancelled"].includes(String(row.status || "").toLowerCase())
  )).length;
  const openProposalCount = BIDS_CACHE.filter((row) => (
    row.customer_id === customerIdValue
    && !["won", "lost", "archived", "rejected"].includes(String(row.status || "").toLowerCase())
  )).length;
  const activeOrderCount = orders.filter((row) => !["completed", "cancelled", "archived"].includes(String(row.status || "").toLowerCase())).length;
  const activeJobCount = JOBS_CACHE.filter((row) => (
    row.customer_id === customerIdValue
    && !["completed", "cancelled", "archived"].includes(String(row.status || "").toLowerCase())
  )).length;
  const billed = orders.reduce((sum, row) => sum + Number(row.total_cents || 0), 0);
  const paid = payments.reduce((sum, row) => sum + Math.max(0, paymentRevenueContributionCents(row)), 0);
  const balance = Math.max(0, billed - paid);
  const lastTouchAt = customer.last_contact_at || customer.updated_at || customer.created_at || "";
  const staleDays = lastTouchAt
    ? Math.floor((Date.now() - new Date(lastTouchAt).getTime()) / 86400000)
    : null;
  const addresses = customerKnownAddressesForWorkbench(customerIdValue, customer);

  return {
    balance,
    billed,
    paid,
    openRequestsCount,
    openProposalCount,
    activeOrderCount,
    activeJobCount,
    activeRelationshipCount: openRequestsCount + openProposalCount + activeOrderCount + activeJobCount,
    siteCount: addresses.length,
    lastTouchAt,
    staleDays,
    addresses,
  };
}

function buildCustomerWorkbenchState(filter = "") {
  const query = String(filter || "").trim().toLowerCase();
  const filterValue = currentCustomerWorkbenchFilter();
  const ranked = sortedCustomers(CUSTOMERS_CACHE);
  const metricsMap = new Map(ranked.map((customer) => [customer.id, customerWorkbenchMetrics(customer)]));
  const topIds = new Set(
    ranked.slice(0, Math.min(ranked.length, Math.max(10, Math.ceil(ranked.length * 0.2)))).map((customer) => customer.id)
  );
  const rows = ranked.filter((customer) => {
    const metrics = metricsMap.get(customer.id) || customerWorkbenchMetrics(customer);
    const haystack = [
      customer.company_name,
      customer.name,
      customer.email,
      customer.phone,
      customer.lead_source,
      customer.address_line1,
      customer.city,
      customer.state,
      customer.zip,
      ...(metrics.addresses || []),
    ].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;

    if (filterValue === "active_work") return metrics.activeRelationshipCount > 0;
    if (filterValue === "open_balance") return metrics.balance > 0;
    if (filterValue === "multi_site") return metrics.siteCount > 1;
    if (filterValue === "top_value") return topIds.has(customer.id);
    if (filterValue === "stale") return metrics.staleDays !== null && metrics.staleDays >= 30;
    return true;
  });
  return { rows, metricsMap };
}

function focusCustomerWorkbench({ force = false } = {}) {
  if (!force && window.innerWidth > 980) return;
  document.querySelector(".customer-workbench-card")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function isCustomerEditorVisible() {
  return !!customerEditorCardEl() && !customerEditorCardEl().classList.contains("u-hidden");
}

function toggleCustomerEditor(visible, { focusFieldId = "" } = {}) {
  const card = customerEditorCardEl();
  if (!card) return;
  card.classList.toggle("u-hidden", !visible);
  if (visible && focusFieldId) document.getElementById(focusFieldId)?.focus?.();
}

function setCustomerWorkbenchContext(customer = null, rows = buildCustomerWorkbenchState(customerSearch?.value || "").rows) {
  const titleEl = customerWorkbenchTitleEl();
  const subtitleEl = customerWorkbenchSubtitleEl();
  const prevButton = btnCustomerPrevEl();
  const nextButton = btnCustomerNextEl();
  const editButton = btnCustomerEditEl();
  const closeButton = btnCloseCustomerEditorEl();
  const activeIndex = customer?.id ? rows.findIndex((row) => row.id === customer.id) : -1;
  const metrics = customer ? customerWorkbenchMetrics(customer) : null;

  if (titleEl) {
    titleEl.textContent = customer
      ? `${customerDisplayTitle(customer)} workbench`
      : (CUSTOMER_CREATING ? "Customer intake" : "Customer workbench");
  }
  if (subtitleEl) {
    if (customer && metrics) {
      const balanceLabel = metrics.balance > 0 ? `${formatUsd(metrics.balance)} still open` : "No balance due";
      const footprintLabel = metrics.siteCount > 1 ? `${metrics.siteCount} known sites` : "1 known site";
      subtitleEl.textContent = `${metrics.activeRelationshipCount} active relationship items | ${balanceLabel} | ${footprintLabel}`;
    } else if (CUSTOMER_CREATING) {
      subtitleEl.textContent = "Create the account first, then keep requests, proposals, jobs, money, and notes tied to the same record.";
    } else {
      subtitleEl.textContent = "Select a customer to inspect requests, proposals, work, payments, and relationship history.";
    }
  }
  if (prevButton) prevButton.disabled = activeIndex <= 0;
  if (nextButton) nextButton.disabled = activeIndex === -1 || activeIndex >= rows.length - 1;
  if (editButton) {
    editButton.disabled = !customer && !CUSTOMER_CREATING;
    editButton.textContent = customer
      ? (isCustomerEditorVisible() ? "Hide editor" : "Edit details")
      : (CUSTOMER_CREATING ? "Hide editor" : "New customer");
  }
  if (closeButton) closeButton.disabled = !isCustomerEditorVisible();
}

function renderCustomerWorkbenchStats() {
  const container = customerWorkbenchStatsEl();
  if (!container) return;
  const customers = sortedCustomers(CUSTOMERS_CACHE);
  const activeCount = customers.filter((customer) => customerWorkbenchMetrics(customer).activeRelationshipCount > 0).length;
  const staleCount = customers.filter((customer) => {
    const metrics = customerWorkbenchMetrics(customer);
    return metrics.staleDays !== null && metrics.staleDays >= 30;
  }).length;
  const multiSiteCount = customers.filter((customer) => customerWorkbenchMetrics(customer).siteCount > 1).length;
  const openBalanceCustomers = customers.filter((customer) => customerWorkbenchMetrics(customer).balance > 0);
  const openBalanceTotal = openBalanceCustomers.reduce((sum, customer) => sum + customerWorkbenchMetrics(customer).balance, 0);
  const activeFilter = currentCustomerWorkbenchFilter();
  const cards = [
    {
      filter: "all",
      label: "Customers",
      value: String(customers.length),
      note: customers.length ? "All customer records in this workspace" : "Create the first record to start the CRM",
    },
    {
      filter: "active_work",
      label: "Active work",
      value: String(activeCount),
      note: activeCount ? "Requests, proposals, work, or jobs still moving" : "No customer has active pipeline work",
    },
    {
      filter: "open_balance",
      label: "Open balance",
      value: formatUsd(openBalanceTotal),
      note: openBalanceCustomers.length ? `${openBalanceCustomers.length} customer${openBalanceCustomers.length === 1 ? "" : "s"} still collectible` : "Nothing outstanding right now",
    },
    {
      filter: "stale",
      label: "Needs follow-up",
      value: String(staleCount),
      note: staleCount ? "30+ days since the last recorded touch" : "No stale relationships detected",
    },
    {
      filter: "multi_site",
      label: "Multi-site",
      value: String(multiSiteCount),
      note: multiSiteCount ? "Accounts with more than one known address" : "No multi-site accounts identified yet",
    },
    {
      filter: "top_value",
      label: "Top value",
      value: formatUsd(customers.slice(0, Math.min(customers.length, 10)).reduce((sum, customer) => sum + customerLifetimeValueCents(customer), 0)),
      note: customers.length ? "Top ten customers by lifetime value" : "Value starts appearing as work gets paid",
    },
  ];

  container.innerHTML = cards.map((card) => `
    <button type="button" class="workspace-summary-card customer-stat-card ${activeFilter === card.filter ? "is-active" : ""}" data-customer-filter="${escapeAttr(card.filter)}">
      <span class="customer-stat-card__label">${escapeHtml(card.label)}</span>
      <strong class="customer-stat-card__value">${escapeHtml(card.value)}</strong>
      <span class="customer-stat-card__note">${escapeHtml(card.note)}</span>
    </button>
  `).join("");

  container.querySelectorAll("[data-customer-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextFilter = button.getAttribute("data-customer-filter") || "all";
      if (customerWorkbenchFilterEl()) customerWorkbenchFilterEl().value = nextFilter;
      renderCustomersList(customerSearch?.value || "");
    });
  });
}

function openCustomerRecord(customerIdValue, options = {}) {
  if (!customerIdValue) return;
  CUSTOMER_CREATING = false;
  ACTIVE_CUSTOMER_ID = customerIdValue;
  setInlineMessage(customerMsg, "");
  toggleCustomerEditor(!!options.openEditor, { focusFieldId: options.focusFieldId || "" });
  renderCustomersList(customerSearch?.value || "");
  focusCustomerWorkbench({ force: !!options.scrollIntoView });
}

function moveCustomerWorkbenchSelection(direction = 1) {
  const rows = buildCustomerWorkbenchState(customerSearch?.value || "").rows;
  if (!rows.length) return;
  const activeIndex = Math.max(0, rows.findIndex((row) => row.id === ACTIVE_CUSTOMER_ID));
  const nextIndex = Math.min(rows.length - 1, Math.max(0, activeIndex + direction));
  const nextCustomer = rows[nextIndex];
  if (!nextCustomer || nextCustomer.id === ACTIVE_CUSTOMER_ID) return;
  openCustomerRecord(nextCustomer.id);
}

function startNewCustomer(options = {}) {
  CUSTOMER_CREATING = true;
  ACTIVE_CUSTOMER_ID = null;
  populateCustomerForm(null);
  setInlineMessage(customerMsg, "");
  toggleCustomerEditor(true, { focusFieldId: options.focusFieldId || "customerCompanyName" });
  renderCustomersList(customerSearch?.value || "");
  focusCustomerWorkbench({ force: options.scrollIntoView !== false });
}

function renderCustomersList(filter = "") {
  if (!customersList) return;
  const { rows, metricsMap } = buildCustomerWorkbenchState(filter);
  renderCustomerWorkbenchStats();

  if (ACTIVE_CUSTOMER_ID && !rows.some((customer) => customer.id === ACTIVE_CUSTOMER_ID) && !CUSTOMER_CREATING) {
    ACTIVE_CUSTOMER_ID = rows[0]?.id || null;
  }

  const emptyMessage = CUSTOMERS_CACHE.length
    ? "No customers match this search or filter."
    : "No customers yet. Create one to start linking work and payments.";
  customersList.innerHTML = rows.length ? "" : `<div class="muted">${emptyMessage}</div>`;

  rows.forEach((customer) => {
    const metrics = metricsMap.get(customer.id) || customerWorkbenchMetrics(customer);
    const primaryAddress = typeof customerDisplayAddress === "function"
      ? customerDisplayAddress(customer)
      : [customer.address_line1, [customer.city, customer.state, customer.zip].filter(Boolean).join(" ").trim()].filter(Boolean).join(", ");
    const supportBits = [
      metrics.lastTouchAt ? `Last touch ${formatDateTime(metrics.lastTouchAt)}` : "No touch logged yet",
      metrics.siteCount > 1 ? `${metrics.siteCount} known service sites` : (primaryAddress || "No service address yet"),
    ];
    const element = document.createElement("button");
    element.type = "button";
    element.className = `list-item list-item--top customer-list-item ${ACTIVE_CUSTOMER_ID === customer.id && !CUSTOMER_CREATING ? "is-active" : ""}`;
    element.innerHTML = `
      <div class="customer-list-item__main">
        <div>
          ${customer.company_name ? `<div class="customer-list-item__eyebrow">${escapeHtml(customer.name || "Primary contact not set")}</div>` : ""}
          <div class="li-title">${escapeHtml(customerDisplayTitle(customer))}</div>
        </div>
        <div class="customer-list-item__contact">${escapeHtml(customerDisplayContactLine(customer))}</div>
        <div class="customer-list-item__support">${escapeHtml(supportBits.join(" | "))}</div>
      </div>
      <div class="customer-list-item__meta">
        <div class="customer-list-item__badges">
          <span class="pill pill-on">${formatUsd(customerLifetimeValueCents(customer))}</span>
          <span class="pill">${escapeHtml(String(customer.order_count || 0))} orders</span>
          ${metrics.activeRelationshipCount ? `<span class="pill">${escapeHtml(String(metrics.activeRelationshipCount))} active</span>` : ""}
          ${metrics.balance > 0 ? `<span class="pill pill-bad">${escapeHtml(formatUsd(metrics.balance))} open</span>` : ""}
          ${metrics.siteCount > 1 ? `<span class="pill">${escapeHtml(String(metrics.siteCount))} sites</span>` : ""}
          ${metrics.staleDays !== null && metrics.staleDays >= 30 ? `<span class="pill pill-warn">${escapeHtml(String(metrics.staleDays))}d quiet</span>` : ""}
        </div>
        <div class="customer-list-item__submetrics">
          <span>${escapeHtml(String(metrics.openRequestsCount + metrics.openProposalCount))} pipeline items</span>
          <span>${escapeHtml(String(metrics.activeOrderCount + metrics.activeJobCount))} booked / active work</span>
        </div>
      </div>
    `;
    element.addEventListener("click", () => {
      openCustomerRecord(customer.id, { scrollIntoView: window.innerWidth < 980 });
    });
    customersList.appendChild(element);
  });

  if (CUSTOMERS_CACHE.length < CUSTOMERS_TOTAL_COUNT) {
    const remaining = CUSTOMERS_TOTAL_COUNT - CUSTOMERS_CACHE.length;
    const button = document.createElement("button");
    button.className = "btn btn-ghost";
    button.style.cssText = "width:100%;margin-top:12px;";
    button.textContent = `Load ${Math.min(PAGE_SIZE, remaining)} more (${CUSTOMERS_CACHE.length} of ${CUSTOMERS_TOTAL_COUNT} shown)`;
    button.addEventListener("click", async () => {
      FETCH_OFFSETS.customers += PAGE_SIZE;
      button.disabled = true;
      button.textContent = "Loading...";
      await fetchCustomers();
      renderCustomersList(customerSearch?.value || "");
    });
    customersList.appendChild(button);
  }

  if (!rows.length) {
    if (!CUSTOMERS_CACHE.length) {
      CUSTOMER_CREATING = true;
      ACTIVE_CUSTOMER_ID = null;
      renderCustomerDetail(null).catch(console.error);
      return;
    }
    renderCustomerDetail(CUSTOMER_CREATING ? null : ACTIVE_CUSTOMER_ID).catch(console.error);
    return;
  }

  if (!ACTIVE_CUSTOMER_ID && !CUSTOMER_CREATING && rows[0]) ACTIVE_CUSTOMER_ID = rows[0].id;
  if (ACTIVE_CUSTOMER_ID) CUSTOMER_CREATING = false;
  renderCustomerDetail(CUSTOMER_CREATING ? null : ACTIVE_CUSTOMER_ID).catch(console.error);
}

async function renderCustomerDetail(customerIdValue) {
  if (!customerDetailWrap) return;
  const customer = CUSTOMERS_CACHE.find((entry) => entry.id === customerIdValue) || null;
  populateCustomerForm(customer);
  setCustomerWorkbenchContext(customer);
  return renderCustomerDetailWorkspace(customerIdValue, customer);
}

function customerInputPayload(fields = {}) {
  const companyName = String(fields.company_name || "").trim();
  const name = String(fields.name || "").trim();
  const email = String(fields.email || "").trim();
  const phone = String(fields.phone || "").trim();
  const addressLine1 = String(fields.address_line1 || "").trim();
  const city = String(fields.city || "").trim();
  const state = String(fields.state || "").trim().toUpperCase();
  const zip = String(fields.zip || "").trim();
  return {
    id: fields.id || null,
    company_name: companyName || null,
    name: name || email || phone || "Customer",
    email: email || null,
    phone: phone || null,
    preferred_contact: fields.preferred_contact || "email",
    notes: String(fields.notes || "").trim(),
    address_line1: addressLine1 || null,
    city: city || null,
    state: state || null,
    zip: zip || null,
  };
}

async function saveCustomerRecord(fields = {}) {
  const input = customerInputPayload(fields);
  const nowIso = new Date().toISOString();
  const payload = withTenantScope({
    operator_id: opId(),
    company_name: input.company_name,
    name: input.name,
    email: input.email,
    phone: input.phone,
    preferred_contact: input.preferred_contact,
    notes: input.notes,
    address_line1: input.address_line1,
    city: input.city,
    state: input.state,
    zip: input.zip,
    updated_at: nowIso,
  });

  const query = input.id
    ? sb.from("customers").update(payload).eq("id", input.id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("customers").insert({ ...payload, created_at: nowIso });

  const { data, error } = await query.select("*").single();
  if (error) throw error;

  CUSTOMER_CREATING = false;
  ACTIVE_CUSTOMER_ID = data.id;
  toggleCustomerEditor(false);
  await fetchCustomers();
  renderCustomersList(customerSearch?.value || "");
  renderPayments();
  renderDashboard();
  renderMoney().catch(console.error);
  return data;
}

let CUSTOMERS_WORKSPACE_BOUND = false;
function initCustomersWorkspaceBindings() {
  if (CUSTOMERS_WORKSPACE_BOUND) return;
  CUSTOMERS_WORKSPACE_BOUND = true;

  customerSearch?.addEventListener("input", debounce(() => renderCustomersList(customerSearch.value)));
  customerWorkbenchFilterEl()?.addEventListener("change", () => renderCustomersList(customerSearch?.value || ""));
  btnRefreshCustomers?.addEventListener("click", async () => {
    try {
      await Promise.all([fetchCustomers(), fetchCrmOrders(), fetchPayments()]);
      renderCustomersList(customerSearch?.value || "");
    } catch (err) {
      notifyOperator(err.message || String(err));
    }
  });
  btnCustomerPrevEl()?.addEventListener("click", () => moveCustomerWorkbenchSelection(-1));
  btnCustomerNextEl()?.addEventListener("click", () => moveCustomerWorkbenchSelection(1));
  btnCustomerEditEl()?.addEventListener("click", () => {
    const activeCustomer = CUSTOMERS_CACHE.find((entry) => entry.id === ACTIVE_CUSTOMER_ID) || null;
    const customerDetailApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
    if (!activeCustomer && !CUSTOMER_CREATING) {
      startNewCustomer({ scrollIntoView: true });
      return;
    }
    if (activeCustomer && !CUSTOMER_CREATING && typeof customerDetailApi.openCustomerWorkbenchApp === "function") {
      customerDetailApi.openCustomerWorkbenchApp("profile", {
        customer: activeCustomer,
        customerIdValue: activeCustomer.id,
      });
      return;
    }
    if (isCustomerEditorVisible()) {
      toggleCustomerEditor(false);
      setCustomerWorkbenchContext(activeCustomer);
      return;
    }
    toggleCustomerEditor(true, { focusFieldId: activeCustomer?.company_name ? "customerName" : "customerCompanyName" });
    setCustomerWorkbenchContext(activeCustomer);
    focusCustomerWorkbench({ force: true });
  });
  btnCloseCustomerEditorEl()?.addEventListener("click", () => {
    toggleCustomerEditor(false);
    setCustomerWorkbenchContext(CUSTOMERS_CACHE.find((entry) => entry.id === ACTIVE_CUSTOMER_ID) || null);
  });

  customerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineMessage(customerMsg, "Saving...");
    const shouldAddAnother = CUSTOMER_SAVE_ADD_ANOTHER;
    CUSTOMER_SAVE_ADD_ANOTHER = false;

    const emailValue = (customerEmail?.value || "").trim().toLowerCase();
    const customerRecordId = customerId?.value || null;
    if (emailValue) {
      const duplicate = CUSTOMERS_CACHE.find((customer) => customer.email?.toLowerCase() === emailValue && customer.id !== customerRecordId);
      if (duplicate) {
        setInlineMessage(customerMsg, `A customer with email ${emailValue} already exists: ${duplicate.name || "unnamed"}. Open their record instead.`, "error");
        return;
      }
      // DB-level check: cache is paginated so a duplicate may not be loaded
      try {
        let dbQuery = sb.from("customers").select("id, name").eq("email", emailValue).eq(TENANT_COLUMN, TENANT_ID).limit(1).maybeSingle();
        if (customerRecordId) dbQuery = sb.from("customers").select("id, name").eq("email", emailValue).eq(TENANT_COLUMN, TENANT_ID).neq("id", customerRecordId).limit(1).maybeSingle();
        const { data: dbDup } = await dbQuery;
        if (dbDup) {
          setInlineMessage(customerMsg, `A customer with email ${emailValue} already exists: ${dbDup.name || "unnamed"}. Open their record instead.`, "error");
          return;
        }
      } catch (_) { /* non-fatal: proceed if DB check fails */ }
    }

    try {
      await saveCustomerRecord({
        id: customerId?.value || null,
        company_name: customerCompanyName?.value,
        name: customerName?.value,
        email: customerEmail?.value,
        phone: customerPhone?.value,
        preferred_contact: customerPreferredContact?.value,
        notes: customerNotes?.value,
        address_line1: customerAddress1?.value || undefined,
        city: customerCity?.value || undefined,
        state: customerState?.value || undefined,
        zip: customerZip?.value || undefined,
      });
      markWorkspaceClean("customers");
      if (shouldAddAnother) {
        startNewCustomer({ focusFieldId: "customerCompanyName", scrollIntoView: false });
        setInlineMessage(customerMsg, "Customer saved. Ready for the next one.", "ok");
        customerCompanyName?.focus?.();
      } else {
        showToast("Customer saved.");
      }
    } catch (err) {
      setInlineMessage(customerMsg, err.message || String(err), "error");
    }
  });

  btnNewCustomer?.addEventListener("click", () => startNewCustomer({ scrollIntoView: true }));
  btnSaveAndAddCustomer?.addEventListener("click", () => {
    CUSTOMER_SAVE_ADD_ANOTHER = true;
    customerForm?.requestSubmit?.();
  });
  btnClearCustomerForm?.addEventListener("click", () => startNewCustomer({ scrollIntoView: false }));
}

const CUSTOMERS_WORKSPACE_HELPERS = {
  fetchCustomers,
  fetchCustomerInteractions,
  logCustomerInteraction,
  CUSTOMER_INTERACTION_OPTIONS,
  customerInteractionLabel,
  customerInteractionPlaceholder,
  customerInteractionOptionsMarkup,
  findExistingCustomerRecord,
  upsertCrmCustomerFromBridge,
  orderExistsForBridgeId,
  importBridgeOrdersToCrm,
  populateCustomerForm,
  customerWorkbenchMetrics,
  renderCustomerWorkbenchStats,
  openCustomerRecord,
  moveCustomerWorkbenchSelection,
  startNewCustomer,
  renderCustomersList,
  renderCustomerDetail,
  customerInputPayload,
  saveCustomerRecord,
  initCustomersWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE || {}),
  ...CUSTOMERS_WORKSPACE_HELPERS,
};

Object.assign(window, CUSTOMERS_WORKSPACE_HELPERS);
