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
  renderCustomersList(customerSearch?.value || "");
}

function renderCustomersList(filter = "") {
  if (!customersList) return;
  const query = String(filter || "").trim().toLowerCase();
  const ranked = sortedCustomers(CUSTOMERS_CACHE);
  const rows = ranked.filter((customer) => (
    !query || [customer.name, customer.email, customer.phone].some((value) => String(value || "").toLowerCase().includes(query))
  ));

  const emptyMessage = CUSTOMERS_CACHE.length
    ? "No customers match this search."
    : "No customers yet. Create one to start linking work and payments.";
  customersList.innerHTML = rows.length ? "" : `<div class="muted">${emptyMessage}</div>`;

  rows.forEach((customer) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `list-item ${ACTIVE_CUSTOMER_ID === customer.id && !CUSTOMER_CREATING ? "is-active" : ""}`;
    element.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(customer.name || "Unnamed customer")}</div>
        <div class="li-sub muted">${escapeHtml(customer.email || "No email")} &middot; ${escapeHtml(customer.phone || "No phone")}</div>
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
      button.textContent = "Loading…";
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
  return renderCustomerDetailWorkspace(customerIdValue, customer);
}

function customerInputPayload(fields = {}) {
  const name = String(fields.name || "").trim();
  const email = String(fields.email || "").trim();
  const phone = String(fields.phone || "").trim();
  const addressLine1 = String(fields.address_line1 || "").trim();
  const city = String(fields.city || "").trim();
  const state = String(fields.state || "").trim().toUpperCase();
  const zip = String(fields.zip || "").trim();
  return {
    id: fields.id || null,
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
  btnRefreshCustomers?.addEventListener("click", async () => {
    try {
      await Promise.all([fetchCustomers(), fetchCrmOrders(), fetchPayments()]);
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
  initCustomersWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE || {}),
  ...CUSTOMERS_WORKSPACE_HELPERS,
};

Object.assign(window, CUSTOMERS_WORKSPACE_HELPERS);
