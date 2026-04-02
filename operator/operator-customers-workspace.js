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
  if (customerFormTitle) customerFormTitle.textContent = customer?.id ? "Edit customer" : "New customer";
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

function startNewCustomer() {
  CUSTOMER_CREATING = true;
  ACTIVE_CUSTOMER_ID = null;
  populateCustomerForm(null);
  setInlineMessage(customerMsg, "");
  syncCustomerWorkspaceState({ customerId: "", siteId: "", historyMode: "push" });
  renderCustomersList(customerSearch?.value || "");
}

const CUSTOMER_WORKBENCH_FILTERS = {
  all: true,
  active_work: true,
  open_balance: true,
  multi_site: true,
  top_value: true,
  stale: true,
};

let CUSTOMER_LOCATION_COUNTS_READY = false;
let CUSTOMER_LOCATION_COUNTS_FEATURE = true;
let CUSTOMER_LOCATION_COUNTS_LOADING = null;
const CUSTOMER_LOCATION_COUNTS = new Map();

function customerWorkbenchSearchField() {
  return customerSearch || (typeof $ === "function" ? $("customerSearch") : null);
}

function customerWorkbenchFilterField() {
  return typeof $ === "function" ? $("customerWorkbenchFilter") : null;
}

function customerWorkbenchStatsField() {
  return typeof $ === "function" ? $("customerWorkbenchStats") : null;
}

function normalizeCustomerWorkbenchFilter(value) {
  const key = String(value || "all").trim().toLowerCase();
  return CUSTOMER_WORKBENCH_FILTERS[key] ? key : "all";
}

function currentCustomerWorkspaceSiteId() {
  return String(window.CURRENT_CUSTOMER_DETAIL_LOCATION_ID || "").trim();
}

function readCustomerWorkspaceParams() {
  try {
    return new URLSearchParams(window.location?.search || "");
  } catch (_) {
    return null;
  }
}

function applyCustomerWorkspaceStateFromLocation() {
  const params = readCustomerWorkspaceParams();
  if (!params) return;

  const query = params.get("customer_q") || "";
  const filter = normalizeCustomerWorkbenchFilter(params.get("customer_filter") || "all");
  const customerId = String(params.get("customer") || "").trim();
  const siteId = String(params.get("site") || "").trim();

  const searchField = customerWorkbenchSearchField();
  const filterField = customerWorkbenchFilterField();
  if (searchField && searchField.value !== query) searchField.value = query;
  if (filterField) filterField.value = filter;
  if (customerId) {
    ACTIVE_CUSTOMER_ID = customerId;
    CUSTOMER_CREATING = false;
  }
  window.CURRENT_CUSTOMER_DETAIL_LOCATION_ID = siteId;
}

function syncCustomerWorkspaceState(options = {}) {
  const params = readCustomerWorkspaceParams();
  if (!params) return;

  const query = options.query !== undefined
    ? String(options.query || "").trim()
    : String(customerWorkbenchSearchField()?.value || "");
  const filter = options.filter !== undefined
    ? normalizeCustomerWorkbenchFilter(options.filter)
    : normalizeCustomerWorkbenchFilter(customerWorkbenchFilterField()?.value || "all");
  const customerId = options.customerId !== undefined
    ? String(options.customerId || "").trim()
    : (CUSTOMER_CREATING ? "" : String(ACTIVE_CUSTOMER_ID || "").trim());
  const siteId = options.siteId !== undefined
    ? String(options.siteId || "").trim()
    : currentCustomerWorkspaceSiteId();

  if (query) params.set("customer_q", query);
  else params.delete("customer_q");
  if (filter && filter !== "all") params.set("customer_filter", filter);
  else params.delete("customer_filter");
  if (customerId) params.set("customer", customerId);
  else params.delete("customer");
  if (siteId) params.set("site", siteId);
  else params.delete("site");

  const nextSearch = params.toString();
  const nextUrl = `${window.location?.pathname || ""}${nextSearch ? `?${nextSearch}` : ""}${window.location?.hash || ""}`;
  const usePush = options.historyMode === "push" && window.history?.pushState;
  if (usePush) window.history.pushState(null, "", nextUrl);
  else if (window.history?.replaceState) window.history.replaceState(null, "", nextUrl);

  return nextUrl;
}

async function fetchCustomerLocationCounts({ force = false } = {}) {
  if (!CUSTOMER_LOCATION_COUNTS_FEATURE || !sb?.from) return CUSTOMER_LOCATION_COUNTS;
  if (!force && CUSTOMER_LOCATION_COUNTS_READY) return CUSTOMER_LOCATION_COUNTS;
  if (CUSTOMER_LOCATION_COUNTS_LOADING) return CUSTOMER_LOCATION_COUNTS_LOADING;

  CUSTOMER_LOCATION_COUNTS_LOADING = (async () => {
    try {
      const query = scopeQuery(sb.from("customer_locations").select("customer_id"));
      const { data, error } = await query;
      if (error) throw error;
      CUSTOMER_LOCATION_COUNTS.clear();
      (data || []).forEach((row) => {
        const customerId = String(row?.customer_id || "").trim();
        if (!customerId) return;
        CUSTOMER_LOCATION_COUNTS.set(customerId, (CUSTOMER_LOCATION_COUNTS.get(customerId) || 0) + 1);
      });
      CUSTOMER_LOCATION_COUNTS_READY = true;
    } catch (error) {
      const message = String(error?.message || error || "").toLowerCase();
      if (message.includes("customer_locations") || message.includes("relation") || message.includes("does not exist")) {
        CUSTOMER_LOCATION_COUNTS_FEATURE = false;
      }
    } finally {
      CUSTOMER_LOCATION_COUNTS_LOADING = null;
    }
    return CUSTOMER_LOCATION_COUNTS;
  })();

  return CUSTOMER_LOCATION_COUNTS_LOADING;
}

function customerCacheOrders() {
  return typeof CRM_ORDERS_CACHE !== "undefined" && Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];
}

function customerCachePayments() {
  return typeof PAYMENTS_CACHE !== "undefined" && Array.isArray(PAYMENTS_CACHE) ? PAYMENTS_CACHE : [];
}

function customerCacheJobs() {
  return typeof JOBS_CACHE !== "undefined" && Array.isArray(JOBS_CACHE) ? JOBS_CACHE : [];
}

function customerCacheLeads() {
  return typeof LEADS_CACHE !== "undefined" && Array.isArray(LEADS_CACHE) ? LEADS_CACHE : [];
}

function customerCacheBids() {
  return typeof BIDS_CACHE !== "undefined" && Array.isArray(BIDS_CACHE) ? BIDS_CACHE : [];
}

function customerSiteCount(customer = {}) {
  const customerId = String(customer.id || "").trim();
  if (customerId && CUSTOMER_LOCATION_COUNTS.has(customerId)) {
    return Math.max(1, Number(CUSTOMER_LOCATION_COUNTS.get(customerId) || 0));
  }
  const explicit = Number(customer.site_count || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return String(customer.service_address || customer.address_line1 || "").trim() ? 1 : 0;
}

function customerOpenBalanceCents(customer = {}) {
  const customerId = String(customer.id || "").trim();
  if (!customerId) return 0;
  const totalBilled = customerCacheOrders()
    .filter((order) => order.customer_id === customerId)
    .reduce((sum, order) => sum + Number(order.total_cents || 0), 0);
  const totalPaid = customerCachePayments()
    .filter((payment) => payment.customer_id === customerId)
    .reduce((sum, payment) => {
      if (typeof paymentRevenueContributionCents === "function") {
        return sum + Math.max(0, paymentRevenueContributionCents(payment));
      }
      return sum + Number(payment.amount_total || payment.amount_cents || 0);
    }, 0);
  return Math.max(0, totalBilled - totalPaid);
}

function customerActiveWorkCount(customer = {}) {
  const customerId = String(customer.id || "").trim();
  if (!customerId) return 0;
  const isClosed = (value, closedStates) => closedStates.includes(String(value || "").trim().toLowerCase());
  const leads = customerCacheLeads().filter((lead) => lead.customer_id === customerId && !isClosed(lead.status, ["won", "closed", "archived", "cancelled"])).length;
  const bids = customerCacheBids().filter((bid) => bid.customer_id === customerId && !isClosed(bid.status, ["won", "lost", "archived", "rejected"])).length;
  const orders = customerCacheOrders().filter((order) => order.customer_id === customerId && !isClosed(order.status, ["completed", "cancelled", "archived", "paid"])).length;
  const jobs = customerCacheJobs().filter((job) => job.customer_id === customerId && !isClosed(job.status, ["completed", "cancelled", "archived"])).length;
  return leads + bids + orders + jobs;
}

function customerLastTouchAt(customer = {}) {
  return customer.last_contact_at || customer.updated_at || customer.created_at || null;
}

function customerIsStale(customer = {}, days = 45) {
  const touchedAt = customerLastTouchAt(customer);
  if (!touchedAt) return false;
  const ageMs = Date.now() - new Date(touchedAt).getTime();
  return ageMs >= days * 86400000;
}

function topValueCustomerIds(rows = []) {
  const ranked = [...rows].sort((left, right) => (
    customerLifetimeValueCents(right) - customerLifetimeValueCents(left)
  ));
  const limit = Math.min(Math.max(1, Math.ceil(ranked.length * 0.2)), 10);
  return new Set(ranked.slice(0, limit).map((customer) => customer.id));
}

function customerWorkbenchProfile(customer, topValueIds = new Set()) {
  const siteCount = customerSiteCount(customer);
  const openBalanceCents = customerOpenBalanceCents(customer);
  const activeWorkCount = customerActiveWorkCount(customer);
  const stale = customerIsStale(customer);
  return {
    customer,
    siteCount,
    openBalanceCents,
    activeWorkCount,
    isStale: stale,
    isTopValue: topValueIds.has(customer.id),
  };
}

function renderCustomerWorkbenchStats(profiles = [], visibleProfiles = profiles) {
  const stats = customerWorkbenchStatsField();
  if (!stats) return;

  const activeAccounts = visibleProfiles.length;
  const activeWork = visibleProfiles.reduce((sum, profile) => sum + Number(profile.activeWorkCount || 0), 0);
  const openBalance = visibleProfiles.reduce((sum, profile) => sum + Number(profile.openBalanceCents || 0), 0);
  const multiSiteAccounts = visibleProfiles.filter((profile) => profile.siteCount > 1).length;
  const staleAccounts = visibleProfiles.filter((profile) => profile.isStale).length;

  stats.innerHTML = [
    `<span class="pill pill-muted">${escapeHtml(String(activeAccounts))} account${activeAccounts === 1 ? "" : "s"} shown</span>`,
    activeWork ? `<span class="pill pill-on">${escapeHtml(String(activeWork))} active work item${activeWork === 1 ? "" : "s"}</span>` : "",
    openBalance ? `<span class="pill pill-warn">${escapeHtml(formatUsd(openBalance))} open balance</span>` : "",
    multiSiteAccounts ? `<span class="pill">${escapeHtml(String(multiSiteAccounts))} multi-site</span>` : "",
    staleAccounts ? `<span class="pill pill-muted">${escapeHtml(String(staleAccounts))} stale follow-up</span>` : "",
  ].filter(Boolean).join("");
}

function renderCustomersList(filter = "") {
  if (!customersList) return;
  if (!CUSTOMER_LOCATION_COUNTS_READY && !CUSTOMER_LOCATION_COUNTS_LOADING) {
    fetchCustomerLocationCounts().then(() => renderCustomersList(customerWorkbenchSearchField()?.value || "")).catch(() => {});
  }
  const query = String(filter || "").trim().toLowerCase();
  const ranked = sortedCustomers(CUSTOMERS_CACHE);
  const activeFilter = normalizeCustomerWorkbenchFilter(customerWorkbenchFilterField()?.value || "all");
  const topValueIds = topValueCustomerIds(ranked);
  const profiles = ranked
    .filter((customer) => (
      !query || [
        customer.company_name,
        customer.name,
        customer.email,
        customer.phone,
        customer.address_line1,
        customer.city,
        customer.state,
        customer.zip,
        customer.service_address,
        customer.billing_address,
      ].some((value) => String(value || "").toLowerCase().includes(query))
    ))
    .map((customer) => customerWorkbenchProfile(customer, topValueIds));
  const filteredProfiles = profiles.filter((profile) => {
    if (activeFilter === "active_work") return profile.activeWorkCount > 0;
    if (activeFilter === "open_balance") return profile.openBalanceCents > 0;
    if (activeFilter === "multi_site") return profile.siteCount > 1;
    if (activeFilter === "top_value") return profile.isTopValue;
    if (activeFilter === "stale") return profile.isStale;
    return true;
  });
  const rows = filteredProfiles.map((profile) => profile.customer);
  renderCustomerWorkbenchStats(profiles, filteredProfiles);

  const emptyMessage = CUSTOMERS_CACHE.length
    ? "No customers match this search or filter."
    : "No customers yet. Create one to start linking work and payments.";
  customersList.innerHTML = rows.length ? "" : `<div class="muted">${emptyMessage}</div>`;

  filteredProfiles.forEach((profile) => {
    const customer = profile.customer;
    const title = customer.company_name || customer.name || "Unnamed customer";
    const contactMeta = customer.company_name && customer.name
      ? `Primary contact: ${customer.name}`
      : (customer.name || "No primary contact");
    const detailMeta = [customer.email || "No email", customer.phone || "No phone"].join(" \u00b7 ");
    const badges = [
      profile.siteCount > 1 ? `<span class="pill">${escapeHtml(String(profile.siteCount))} sites</span>` : "",
      profile.activeWorkCount > 0 ? `<span class="pill pill-on">${escapeHtml(String(profile.activeWorkCount))} active</span>` : "",
      profile.openBalanceCents > 0 ? `<span class="pill pill-warn">${escapeHtml(formatUsd(profile.openBalanceCents))} open</span>` : "",
      profile.isStale ? `<span class="pill pill-muted">Needs follow-up</span>` : "",
    ].filter(Boolean).join("");
    const element = document.createElement("button");
    element.type = "button";
    element.className = `list-item ${ACTIVE_CUSTOMER_ID === customer.id && !CUSTOMER_CREATING ? "is-active" : ""}`;
    element.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(title)}</div>
        <div class="li-sub muted">${escapeHtml(contactMeta)} \u00b7 ${escapeHtml(detailMeta)}</div>
        ${badges ? `<div class="chip-row chip-row--compact">${badges}</div>` : ""}
      </div>
      <div class="li-meta">
        <span class="pill pill-on">${formatUsd(customerLifetimeValueCents(customer))}</span>
        <span class="pill">${escapeHtml(String(customer.order_count || 0))} orders</span>
      </div>
    `;
    element.addEventListener("click", () => {
      CUSTOMER_CREATING = false;
      ACTIVE_CUSTOMER_ID = customer.id;
      setInlineMessage(customerMsg, "");
      syncCustomerWorkspaceState({ historyMode: "push" });
      renderCustomersList(customerSearch?.value || "");
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
      await fetchCustomerLocationCounts();
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
  syncCustomerWorkspaceState({
    customerId: customer?.id || "",
    siteId: currentCustomerWorkspaceSiteId(),
  });
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
    name: name || companyName || email || phone || "Customer",
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
  await fetchCustomers();
  await fetchCustomerLocationCounts({ force: true });
  syncCustomerWorkspaceState({ customerId: data.id, historyMode: "push" });
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

  applyCustomerWorkspaceStateFromLocation();

  customerSearch?.addEventListener("input", debounce(() => {
    syncCustomerWorkspaceState({ query: customerSearch.value, historyMode: "replace" });
    renderCustomersList(customerSearch.value);
  }));
  customerWorkbenchFilterField()?.addEventListener("change", () => {
    syncCustomerWorkspaceState({ filter: customerWorkbenchFilterField()?.value || "all", historyMode: "replace" });
    renderCustomersList(customerSearch?.value || "");
  });
  btnRefreshCustomers?.addEventListener("click", async () => {
    try {
      await Promise.all([fetchCustomers(), fetchCrmOrders(), fetchPayments(), fetchCustomerLocationCounts({ force: true })]);
      renderCustomersList(customerSearch?.value || "");
    } catch (err) {
      notifyOperator(err.message || String(err));
    }
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
        startNewCustomer();
        setInlineMessage(customerMsg, "Customer saved. Ready for the next one.", "ok");
        customerName?.focus?.();
      } else {
        setInlineMessage(customerMsg, "Customer saved.", "ok");
      }
    } catch (err) {
      setInlineMessage(customerMsg, err.message || String(err), "error");
    }
  });

  btnNewCustomer?.addEventListener("click", startNewCustomer);
  btnSaveAndAddCustomer?.addEventListener("click", () => {
    CUSTOMER_SAVE_ADD_ANOTHER = true;
    customerForm?.requestSubmit?.();
  });
  btnClearCustomerForm?.addEventListener("click", startNewCustomer);
  window.addEventListener?.("popstate", () => {
    applyCustomerWorkspaceStateFromLocation();
    if (document.querySelector(".tab.active")?.dataset.tab === "customers") {
      renderCustomersList(customerWorkbenchSearchField()?.value || "");
    }
  });
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
  startNewCustomer,
  renderCustomersList,
  renderCustomerDetail,
  customerInputPayload,
  saveCustomerRecord,
  syncCustomerWorkspaceState,
  applyCustomerWorkspaceStateFromLocation,
  customerWorkbenchProfile,
  customerOpenBalanceCents,
  customerActiveWorkCount,
  customerSiteCount,
  initCustomersWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE || {}),
  ...CUSTOMERS_WORKSPACE_HELPERS,
};

Object.assign(window, CUSTOMERS_WORKSPACE_HELPERS);
