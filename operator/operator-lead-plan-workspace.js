// Request intake and recurring service workflows extracted from operator.js
// so lead conversion and repeat-work operations stay in one domain module.
async function fetchLeads() {
  if (FETCHING.has("leads")) return;
  FETCHING.add("leads");
  try {
    const { data, error } = await scopeQuery(sb
      .from("leads")
      .select("*"))
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) {
      if (isMissingDatabaseFeatureError(error, ["leads"])) {
        LEADS_CACHE = [];
        return LEADS_CACHE;
      }
      throw error;
    }
    LEADS_CACHE = data || [];
    return LEADS_CACHE;
  } finally {
    FETCHING.delete("leads");
  }
}

async function fetchServicePlans() {
  if (FETCHING.has("service_plans")) return;
  FETCHING.add("service_plans");
  try {
    const { data, error } = await scopeQuery(sb
      .from("service_plans")
      .select("*"))
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) {
      if (isMissingDatabaseFeatureError(error, ["service_plans"])) {
        SERVICE_PLANS_CACHE = [];
        SERVICE_PLANS_FEATURE_READY = false;
        return SERVICE_PLANS_CACHE;
      }
      throw error;
    }
    SERVICE_PLANS_FEATURE_READY = true;
    SERVICE_PLANS_CACHE = data || [];
    return SERVICE_PLANS_CACHE;
  } finally {
    FETCHING.delete("service_plans");
  }
}

function renderLeadCustomerOptions(selectedCustomerId = "") {
  if (!leadCustomerId) return;
  const options = sortedCustomers(CUSTOMERS_CACHE);
  leadCustomerId.innerHTML = `
    <option value="">Create or link later</option>
    ${options.map((customer) => `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || customer.phone || "Customer")}</option>`).join("")}
  `;
  leadCustomerId.value = options.some((customer) => customer.id === selectedCustomerId) ? selectedCustomerId : "";
}

function clearLeadForm() {
  if (leadId) leadId.value = "";
  if (leadStatus) leadStatus.value = "new";
  if (leadPriority) leadPriority.value = "normal";
  renderLeadCustomerOptions("");
  if (leadTitle) leadTitle.value = "";
  if (leadRequestedService) leadRequestedService.value = "";
  if (leadContactName) leadContactName.value = "";
  if (leadContactEmail) leadContactEmail.value = "";
  if (leadContactPhone) leadContactPhone.value = "";
  if (leadPreferredContact) leadPreferredContact.value = "phone";
  if (leadSourceType) leadSourceType.value = "manual";
  if (leadServiceAddress) leadServiceAddress.value = "";
  if (leadSummary) leadSummary.value = "";
  if (leadNotes) leadNotes.value = "";
  setInlineMessage(leadMsg, "");
}

function populateLeadForm(lead) {
  if (!lead) {
    clearLeadForm();
    return;
  }
  if (leadId) leadId.value = lead.id || "";
  if (leadStatus) leadStatus.value = String(lead.status || "new");
  if (leadPriority) leadPriority.value = String(lead.priority || "normal");
  renderLeadCustomerOptions(lead.customer_id || "");
  if (leadTitle) leadTitle.value = lead.title || "";
  if (leadRequestedService) leadRequestedService.value = lead.requested_service_type || "";
  if (leadContactName) leadContactName.value = lead.contact_name || "";
  if (leadContactEmail) leadContactEmail.value = lead.contact_email || "";
  if (leadContactPhone) leadContactPhone.value = lead.contact_phone || "";
  if (leadPreferredContact) leadPreferredContact.value = lead.preferred_contact || "phone";
  if (leadSourceType) leadSourceType.value = lead.source_type || "manual";
  if (leadServiceAddress) leadServiceAddress.value = lead.service_address || "";
  if (leadSummary) leadSummary.value = lead.summary || "";
  if (leadNotes) leadNotes.value = lead.notes || "";
}

async function renderLeadDetail(leadIdValue) {
  if (!leadDetailWrap) return;
  const lead = LEADS_CACHE.find((row) => row.id === leadIdValue) || null;
  populateLeadForm(lead);
  if (!lead) {
    if (btnLeadOpenBid) btnLeadOpenBid.disabled = true;
    leadDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Request intake</div><div><strong>Create or select a request.</strong></div><div class="detail-copy">This record becomes the bridge between the customer conversation and the quote, booked work, and job that follow.</div></div>`;
    return;
  }
  const linkedCustomer = CUSTOMERS_CACHE.find((row) => row.id === lead.customer_id) || null;
  const linkedBid = findBidRecordById(lead.converted_bid_id);
  const linkedOrder = linkedOrderForLead(lead);
  const linkedJob = linkedOrder ? (JOBS_CACHE.find((row) => row.order_id === linkedOrder.id || row.id === linkedOrder.primary_job_id) || null) : null;
  leadDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Request summary</div>
      <div><strong>${escapeHtml(lead.contact_name || lead.title || "Request")}</strong></div>
      <div class="detail-copy">${escapeHtml(lead.contact_email || "No email")} | ${escapeHtml(lead.contact_phone || "No phone")}</div>
      <div class="detail-copy">Status: ${escapeHtml(String(lead.status || "new").replace(/_/g, " "))} | Priority: ${escapeHtml(String(lead.priority || "normal"))}</div>
      <div class="detail-copy">Requested service: ${escapeHtml(lead.requested_service_type || "Not specified")}</div>
      <div class="detail-copy">Last activity: ${escapeHtml(formatDateTime(lead.last_activity_at || lead.updated_at || lead.created_at))}</div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Workflow links</div>
      <div class="detail-copy">Customer: ${escapeHtml(linkedCustomer?.name || "Not linked yet")}</div>
      <div class="detail-copy">Bid: ${escapeHtml(linkedBid?.title || (lead.converted_bid_id ? "Linked record" : "Not created yet"))}</div>
      <div class="detail-copy">Order: ${escapeHtml(linkedOrder?.customer_name || (lead.converted_order_id ? "Linked order" : "Not created yet"))}</div>
      <div class="detail-copy">Job: ${escapeHtml(linkedJob?.title || "Not created yet")}</div>
      <div class="pipeline-next-steps">
        <button id="btnLeadOpenCustomer" class="btn btn-ghost" type="button">${linkedCustomer ? "Open customer" : "Create customer"}</button>
        <button id="btnLeadDraftProposal" class="btn" type="button">${linkedBid ? "Open proposal" : "Draft proposal"}</button>
        <button id="btnLeadOpenPipeline" class="btn btn-ghost" type="button">${linkedOrder ? "Open booked work" : "Open work pipeline"}</button>
        <button id="btnLeadOpenJob" class="btn btn-ghost" type="button">${linkedJob ? "Open active job" : "Open jobs"}</button>
      </div>
    </div>
  `;
  if (btnLeadOpenBid) btnLeadOpenBid.disabled = !lead.converted_bid_id;
  $("btnLeadOpenCustomer")?.addEventListener("click", () => {
    if (linkedCustomer?.id) {
      ACTIVE_CUSTOMER_ID = linkedCustomer.id;
      CUSTOMER_CREATING = false;
      switchTab("customers");
      return;
    }
    startNewCustomer();
    if (customerName) customerName.value = lead.contact_name || "";
    if (customerEmail) customerEmail.value = lead.contact_email || "";
    if (customerPhone) customerPhone.value = lead.contact_phone || "";
    if (customerAddress) customerAddress.value = lead.service_address || "";
    switchTab("customers");
  });
  $("btnLeadDraftProposal")?.addEventListener("click", () => btnLeadCreateBid?.click());
  $("btnLeadOpenPipeline")?.addEventListener("click", () => {
    if (linkedOrder?.id) ACTIVE_ORDER_ID = linkedOrder.id;
    switchTab("orders");
  });
  $("btnLeadOpenJob")?.addEventListener("click", () => {
    if (linkedJob?.id) ACTIVE_JOB_ID = linkedJob.id;
    switchTab("jobs");
  });
}

function sortedLeads(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(LEADS_CACHE || [])].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  if (!needle) return rows;
  return rows.filter((row) => {
    const haystack = [
      row.title,
      row.contact_name,
      row.contact_email,
      row.contact_phone,
      row.requested_service_type,
      row.summary,
      row.service_address,
      row.status,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

function renderLeads(filter = "") {
  if (!leadsList) return;
  renderRequestWorkspace();
  const rows = sortedLeads(filter);
  if (!rows.length) {
    leadsList.innerHTML = `<div class="muted">No requests yet. When customers reach out, they'll appear here.</div>`;
    ACTIVE_LEAD_ID = null;
    renderLeadDetail(null).catch(console.error);
    return;
  }
  if (!ACTIVE_LEAD_ID || !rows.some((row) => row.id === ACTIVE_LEAD_ID)) ACTIVE_LEAD_ID = rows[0].id;
  const active = rows.find((row) => row.id === ACTIVE_LEAD_ID) || rows[0];
  ACTIVE_LEAD_ID = active.id;
  leadsList.innerHTML = rows.map((row) => `
    <button type="button" class="list-item ${row.id === active.id ? "is-active" : ""}" data-lead-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.contact_name || row.title || "Request")}</div>
        <div class="li-sub muted">${escapeHtml(row.requested_service_type || "Service request")} | ${escapeHtml(String(row.status || "new").replace(/_/g, " "))}</div>
        <div class="li-sub muted">${escapeHtml(row.service_address || "No service address")}</div>
      </div>
      <div class="li-meta">
        <span class="pill">${escapeHtml(String(row.priority || "normal"))}</span>
      </div>
    </button>
  `).join("");
  leadsList.querySelectorAll("[data-lead-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_LEAD_ID = btn.getAttribute("data-lead-id");
      renderLeads(filter);
    });
  });
  renderLeadDetail(ACTIVE_LEAD_ID).catch(console.error);
}

function renderPlanCustomerOptions(selectedCustomerId = "") {
  if (!planCustomerId) return;
  const options = [`<option value="">Select customer</option>`];
  sortedCustomers(CUSTOMERS_CACHE).forEach((customer) => {
    options.push(`<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || "Customer")}</option>`);
  });
  planCustomerId.innerHTML = options.join("");
  planCustomerId.value = selectedCustomerId || "";
}

function renderPlanOrderOptions(selectedOrderId = "") {
  if (!planSourceOrderId) return;
  const rows = [...CRM_ORDERS_CACHE].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const options = [`<option value="">Start without a source order</option>`];
  rows.forEach((order) => {
    const label = order.customer_name || order.cart_summary || "Tracked order";
    options.push(`<option value="${escapeAttr(order.id)}">${escapeHtml(label)} - ${escapeHtml(formatUsd(orderTotalCents(order)))}</option>`);
  });
  planSourceOrderId.innerHTML = options.join("");
  planSourceOrderId.value = selectedOrderId || "";
}

function clearPlanForm() {
  if (planId) planId.value = "";
  if (planStatus) planStatus.value = "draft";
  renderPlanCustomerOptions("");
  renderPlanOrderOptions(ACTIVE_ORDER_ID || "");
  if (planTitle) planTitle.value = "";
  if (planServiceAddress) planServiceAddress.value = "";
  if (planCadence) planCadence.value = "monthly";
  if (planIntervalDays) planIntervalDays.value = "";
  if (planNextRunOn) planNextRunOn.value = todayDateValue(30);
  if (planAmount) planAmount.value = "0.00";
  if (planDepositAmount) planDepositAmount.value = "0.00";
  if (planAutoCreateJob) planAutoCreateJob.checked = true;
  if (planScheduleWindow) planScheduleWindow.value = "";
  if (planSummary) planSummary.value = "";
  if (planNotes) planNotes.value = "";
  if (btnGeneratePlanOrder) btnGeneratePlanOrder.disabled = true;
  if (btnOpenPlanOrder) btnOpenPlanOrder.disabled = true;
  setInlineMessage(planMsg, "");
}

function populatePlanForm(plan) {
  if (!plan) {
    clearPlanForm();
    return;
  }
  if (planId) planId.value = plan.id || "";
  if (planStatus) planStatus.value = String(plan.status || "draft");
  renderPlanCustomerOptions(plan.customer_id || "");
  renderPlanOrderOptions(plan.source_order_id || "");
  if (planTitle) planTitle.value = plan.title || "";
  if (planServiceAddress) planServiceAddress.value = plan.service_address || "";
  if (planCadence) planCadence.value = String(plan.cadence || "monthly");
  if (planIntervalDays) planIntervalDays.value = plan.custom_interval_days || "";
  if (planNextRunOn) planNextRunOn.value = plan.next_run_on || "";
  if (planAmount) planAmount.value = money(servicePlanAmountCents(plan));
  if (planDepositAmount) planDepositAmount.value = money(Number(plan.deposit_required_cents || 0));
  if (planAutoCreateJob) planAutoCreateJob.checked = plan.auto_create_job !== false;
  if (planScheduleWindow) planScheduleWindow.value = plan.schedule_window || "";
  if (planSummary) planSummary.value = plan.summary || "";
  if (planNotes) planNotes.value = plan.notes || "";
  if (btnGeneratePlanOrder) btnGeneratePlanOrder.disabled = String(plan.status || "").toLowerCase() !== "active";
  if (btnOpenPlanOrder) btnOpenPlanOrder.disabled = !plan.last_generated_order_id;
}

async function renderPlanDetail(planIdValue) {
  if (!planDetailWrap) return;
  if (!SERVICE_PLANS_FEATURE_READY) {
    if (btnGeneratePlanOrder) btnGeneratePlanOrder.disabled = true;
    if (btnOpenPlanOrder) btnOpenPlanOrder.disabled = true;
    planDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Recurring plans</div><div><strong>Database upgrade required.</strong></div><div class="detail-copy">Run sql/service_recurring_plans.sql in Supabase before using recurring service plans in this workspace.</div></div>`;
    return;
  }
  const plan = SERVICE_PLANS_CACHE.find((row) => row.id === planIdValue) || null;
  populatePlanForm(plan);
  if (!plan) {
    planDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Recurring rhythm</div><div><strong>Create or select a plan.</strong></div><div class="detail-copy">Recurring plans keep repeat work from turning back into manual follow-up and forgotten next steps.</div></div>`;
    return;
  }
  const customer = CUSTOMERS_CACHE.find((row) => row.id === plan.customer_id) || null;
  const sourceOrder = CRM_ORDERS_CACHE.find((row) => row.id === plan.source_order_id) || null;
  const lastOrder = CRM_ORDERS_CACHE.find((row) => row.id === plan.last_generated_order_id) || null;
  const dueNow = dueServicePlans().some((row) => row.id === plan.id);
  planDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Recurring summary</div>
      <div><strong>${escapeHtml(plan.title || "Recurring plan")}</strong></div>
      <div class="detail-copy">${escapeHtml(customer?.name || "No linked customer")} | ${escapeHtml(planCadenceLabel(plan.cadence, plan.custom_interval_days))}</div>
      <div class="detail-copy">Next run: ${escapeHtml(servicePlanNextRunLabel(plan))}${dueNow ? " | Due now" : ""}</div>
      <div class="detail-copy">Amount: ${formatUsd(servicePlanAmountCents(plan))} | Deposit: ${formatUsd(Number(plan.deposit_required_cents || 0))}</div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Source and automation</div>
      <div class="detail-copy">Source order: ${escapeHtml(sourceOrder?.customer_name || sourceOrder?.cart_summary || "No source order")}</div>
      <div class="detail-copy">Auto-create job: ${plan.auto_create_job !== false ? "On" : "Off"}</div>
      <div class="detail-copy">${escapeHtml(plan.service_address || customer?.service_address || "No service address recorded")}</div>
    </div>
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Last generated work</div>
      <div class="detail-copy">Last order: ${escapeHtml(lastOrder?.customer_name || lastOrder?.cart_summary || "None yet")}</div>
      <div class="detail-copy">${lastOrder ? `${escapeHtml(formatWorkflowPaymentState(orderPaymentState(lastOrder)))} | ${formatUsd(orderAmountDueCents(lastOrder))} due` : "Generate the next order when this plan is ready to create work."}</div>
      <div class="detail-copy">${escapeHtml(plan.notes || "Use notes for site access, seasonal adjustments, and handoff reminders.")}</div>
    </div>
  `;
}

function sortedServicePlans(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(SERVICE_PLANS_CACHE || [])].sort((a, b) => {
    const dueDiff = servicePlanNextRunTime(a) - servicePlanNextRunTime(b);
    if (dueDiff) return dueDiff;
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  });
  if (!needle) return rows;
  return rows.filter((plan) => {
    const customer = CUSTOMERS_CACHE.find((row) => row.id === plan.customer_id) || null;
    const haystack = [
      plan.title,
      plan.service_address,
      plan.summary,
      plan.notes,
      plan.status,
      customer?.name,
      customer?.email,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

function renderPlans(filter = "") {
  if (!plansList) return;
  if (!SERVICE_PLANS_FEATURE_READY) {
    plansList.innerHTML = `<div class="muted">Recurring plans are not enabled in this environment yet. Run sql/service_recurring_plans.sql.</div>`;
    ACTIVE_PLAN_ID = null;
    renderPlanDetail(null).catch(console.error);
    return;
  }
  const rows = sortedServicePlans(filter);
  if (!rows.length) {
    plansList.innerHTML = `<div class="muted">No recurring plans yet.</div>`;
    ACTIVE_PLAN_ID = null;
    renderPlanDetail(null).catch(console.error);
    return;
  }
  if (!ACTIVE_PLAN_ID || !rows.some((row) => row.id === ACTIVE_PLAN_ID)) ACTIVE_PLAN_ID = rows[0].id;
  const active = rows.find((row) => row.id === ACTIVE_PLAN_ID) || rows[0];
  ACTIVE_PLAN_ID = active.id;
  plansList.innerHTML = rows.map((plan) => {
    const customer = CUSTOMERS_CACHE.find((row) => row.id === plan.customer_id) || null;
    const dueNow = dueServicePlans().some((row) => row.id === plan.id);
    return `
      <button type="button" class="list-item ${plan.id === active.id ? "is-active" : ""}" data-plan-id="${escapeAttr(plan.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(plan.title || "Recurring plan")}</div>
          <div class="li-sub muted">${escapeHtml(customer?.name || "No linked customer")}</div>
          <div class="li-sub muted">${escapeHtml(planCadenceLabel(plan.cadence, plan.custom_interval_days))} | Next run ${escapeHtml(servicePlanNextRunLabel(plan))}</div>
          <div class="li-sub muted">${escapeHtml(plan.service_address || "No service address")}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${dueNow ? "pill-bad" : (String(plan.status || "").toLowerCase() === "active" ? "pill-on" : "")}">${escapeHtml(dueNow ? "Due now" : titleCaseWords(plan.status || "draft"))}</span>
          <span class="pill">${formatUsd(servicePlanAmountCents(plan))}</span>
        </div>
      </button>
    `;
  }).join("");
  plansList.querySelectorAll("[data-plan-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_PLAN_ID = btn.getAttribute("data-plan-id");
      renderPlans(filter);
    });
  });
  renderPlanDetail(ACTIVE_PLAN_ID).catch(console.error);
}

async function saveServicePlanRecord(fields = {}) {
  const nowIso = new Date().toISOString();
  const existing = currentServicePlan();
  const sourceOrder = CRM_ORDERS_CACHE.find((row) => row.id === (fields.source_order_id || planSourceOrderId?.value || existing?.source_order_id || "")) || null;
  const customerIdValue = fields.customer_id || planCustomerId?.value || sourceOrder?.customer_id || existing?.customer_id || "";
  if (!customerIdValue) throw new Error("Link the recurring plan to a customer before saving it.");
  const cadenceValue = String(fields.cadence || planCadence?.value || existing?.cadence || "monthly").trim().toLowerCase();
  const intervalDays = cadenceValue === "custom_days"
    ? Math.max(1, Number(fields.custom_interval_days || planIntervalDays?.value || existing?.custom_interval_days || 0))
    : null;
  if (cadenceValue === "custom_days" && intervalDays < 7) throw new Error("Custom day cadence must be at least 7 days.");
  const statusValue = String(fields.status || planStatus?.value || existing?.status || "draft").trim().toLowerCase();
  const nextRunValue = String(fields.next_run_on || planNextRunOn?.value || existing?.next_run_on || "").trim();
  if (statusValue === "active" && !nextRunValue) throw new Error("Active recurring plans need a next run date.");
  const titleValue = String(fields.title || planTitle?.value || existing?.title || sourceOrder?.cart_summary || "").trim();
  const amountCents = toCents(fields.amount_dollars ?? planAmount?.value ?? money(servicePlanAmountCents(existing)));
  const depositCents = toCents(fields.deposit_dollars ?? planDepositAmount?.value ?? money(Number(existing?.deposit_required_cents || 0)));
  const lineItems = buildPlanLineItems(sourceOrder, fields.line_items || existing?.line_items, titleValue, amountCents);
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: customerIdValue,
    source_order_id: sourceOrder?.id || null,
    status: statusValue,
    title: titleValue || "Recurring service",
    cadence: cadenceValue,
    custom_interval_days: intervalDays,
    next_run_on: nextRunValue || null,
    auto_create_job: fields.auto_create_job ?? planAutoCreateJob?.checked ?? (existing?.auto_create_job !== false),
    service_address: String(fields.service_address || planServiceAddress?.value || existing?.service_address || sourceOrder?.service_address || "").trim(),
    schedule_window: String(fields.schedule_window || planScheduleWindow?.value || existing?.schedule_window || sourceOrder?.schedule_window || sourceOrder?.scheduled_time || "").trim(),
    summary: String(fields.summary || planSummary?.value || existing?.summary || sourceOrder?.cart_summary || "").trim(),
    notes: String(fields.notes || planNotes?.value || existing?.notes || sourceOrder?.notes || "").trim(),
    line_items: lineItems,
    amount_cents: amountCents,
    deposit_required_cents: depositCents,
    updated_at: nowIso,
  });
  const idValue = fields.id || planId?.value || existing?.id || "";
  const query = idValue
    ? sb.from("service_plans").update(payload).eq("id", idValue).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("service_plans").insert({ ...payload, created_at: nowIso });
  const { data, error } = await query.select("*").single();
  if (error) {
    if (isMissingDatabaseFeatureError(error, ["service_plans"])) {
      throw new Error("Recurring plans need the service_recurring_plans.sql migration before they can be saved.");
    }
    throw error;
  }
  ACTIVE_PLAN_ID = data.id;
  await fetchServicePlans();
  renderPlans(planSearch?.value || "");
  renderDashboard();
  renderGuidance();
  renderMoney().catch(console.error);
  return SERVICE_PLANS_CACHE.find((row) => row.id === data.id) || data;
}

async function createServicePlanFromOrderRecord(order) {
  if (!order?.id) throw new Error("Select an order before creating a recurring plan.");
  const existing = SERVICE_PLANS_CACHE.find((plan) => plan.source_order_id === order.id && String(plan.status || "").toLowerCase() !== "cancelled") || null;
  if (existing) {
    ACTIVE_PLAN_ID = existing.id;
    renderPlans(planSearch?.value || "");
    return { plan: existing, existing: true };
  }
  const customer = CUSTOMERS_CACHE.find((row) => row.id === order.customer_id) || null;
  const plan = await saveServicePlanRecord({
    status: "active",
    customer_id: order.customer_id || customer?.id || "",
    source_order_id: order.id,
    title: order.cart_summary || `${order.customer_name || "Customer"} recurring service`,
    cadence: "monthly",
    next_run_on: order.scheduled_date || todayDateValue(30),
    amount_dollars: money(orderTotalCents(order)),
    deposit_dollars: money(orderDepositRequiredCents(order)),
    auto_create_job: true,
    service_address: order.service_address || customer?.service_address || customer?.billing_address || "",
    schedule_window: order.schedule_window || order.scheduled_time || "",
    summary: order.cart_summary || "",
    notes: order.notes || "",
    line_items: normalizeServicePlanItems(order.items || []),
  });
  return { plan, existing: false };
}

async function runServicePlanRecord(plan, options = {}) {
  if (!plan?.id) throw new Error("Select a recurring plan before generating work.");
  const { data, error } = await sb.rpc("create_order_from_service_plan", {
    p_plan_id: plan.id,
    p_force: options.force === true,
  });
  if (error) {
    if (isMissingDatabaseFeatureError(error, ["create_order_from_service_plan"])) {
      throw new Error("Recurring plan generation needs the service_recurring_plans.sql migration.");
    }
    throw error;
  }
  await Promise.all([fetchServicePlans(), fetchCrmOrders(), fetchJobs(), fetchPayments()]);
  let order = CRM_ORDERS_CACHE.find((row) => row.id === data?.order_id) || null;
  if (order) {
    order = await seedOrderDepositDefaults(order, {
      depositRequiredCents: Number(order.deposit_required_cents || plan.deposit_required_cents || 0),
      depositPolicy: Number(order.deposit_required_cents || plan.deposit_required_cents || 0) > 0 ? "required_before_job" : "optional",
      depositDueDate: order.scheduled_date || order.payment_due_date || plan.next_run_on || null,
    });
    ACTIVE_ORDER_ID = order.id;
  }
  if (data?.job_id) ACTIVE_JOB_ID = data.job_id;
  ACTIVE_PLAN_ID = plan.id;
  renderPlans(planSearch?.value || "");
  renderOrders();
  renderJobs(jobSearch?.value || "");
  renderDashboard();
  renderGuidance();
  renderMoney().catch(console.error);
  return { order, jobId: data?.job_id || null, existing: !!data?.existing };
}

async function runDueServicePlans() {
  const due = dueServicePlans();
  if (!due.length) return { created: 0, existing: 0 };
  const { data, error } = await sb.rpc("generate_due_service_plans", { p_tenant_id: TENANT_ID });
  if (!error) {
    await Promise.all([fetchServicePlans(), fetchCrmOrders(), fetchJobs(), fetchPayments()]);
    const duePlanIds = new Set(due.map((plan) => plan.id));
    await Promise.allSettled(
      SERVICE_PLANS_CACHE
        .filter((plan) => duePlanIds.has(plan.id) && plan.last_generated_order_id)
        .map((plan) => {
          const order = CRM_ORDERS_CACHE.find((row) => row.id === plan.last_generated_order_id) || null;
          if (!order) return null;
          return seedOrderDepositDefaults(order, {
            depositRequiredCents: Number(order.deposit_required_cents || plan.deposit_required_cents || 0),
            depositPolicy: Number(order.deposit_required_cents || plan.deposit_required_cents || 0) > 0 ? "required_before_job" : "optional",
            depositDueDate: order.scheduled_date || order.payment_due_date || plan.next_run_on || null,
          });
        })
        .filter(Boolean)
    );
    renderPlans(planSearch?.value || "");
    renderOrders();
    renderJobs(jobSearch?.value || "");
    renderDashboard();
    renderGuidance();
    renderMoney().catch(console.error);
    return { created: Number(data?.created_count || 0), existing: Number(data?.existing_count || 0) };
  }
  if (!isMissingDatabaseFeatureError(error, ["generate_due_service_plans"])) throw error;
  let created = 0;
  let existing = 0;
  for (const plan of due) {
    const result = await runServicePlanRecord(plan);
    if (result?.existing) existing += 1;
    else created += 1;
  }
  return { created, existing };
}

async function saveLeadRecord(fields = {}) {
  const nowIso = new Date().toISOString();
  const rawCustomerId = fields.customer_id || leadCustomerId?.value || "";
  let resolvedCustomerId = rawCustomerId;
  const contactName = String(fields.contact_name ?? leadContactName?.value ?? "").trim();
  const contactEmail = String(fields.contact_email ?? leadContactEmail?.value ?? "").trim().toLowerCase();
  const contactPhone = String(fields.contact_phone ?? leadContactPhone?.value ?? "").trim();
  if (!resolvedCustomerId && (contactName || contactEmail || contactPhone)) {
    const existing = findExistingCustomerRecord({ name: contactName, email: contactEmail, phone: contactPhone });
    const customer = existing || await saveCustomerRecord({
      name: contactName || fields.title || leadTitle?.value || "Customer",
      email: contactEmail || null,
      phone: contactPhone || null,
      preferred_contact: fields.preferred_contact || leadPreferredContact?.value || "phone",
      notes: fields.notes || leadNotes?.value || "",
    });
    resolvedCustomerId = customer?.id || "";
  }
  if (!resolvedCustomerId && !contactName && !contactEmail && !contactPhone) {
    throw new Error("Link a customer or capture contact details before saving the lead.");
  }
  const payload = withTenantScope({
    operator_id: opId(),
    customer_id: resolvedCustomerId || null,
    status: fields.status || leadStatus?.value || "new",
    priority: fields.priority || leadPriority?.value || "normal",
    source_type: fields.source_type || leadSourceType?.value || "manual",
    title: fields.title || leadTitle?.value?.trim() || "",
    requested_service_type: fields.requested_service_type || leadRequestedService?.value?.trim() || "",
    service_address: fields.service_address || leadServiceAddress?.value?.trim() || "",
    contact_name: contactName || null,
    contact_email: contactEmail || null,
    contact_phone: contactPhone || null,
    preferred_contact: fields.preferred_contact || leadPreferredContact?.value || "phone",
    summary: fields.summary || leadSummary?.value?.trim() || "",
    notes: fields.notes || leadNotes?.value?.trim() || "",
    metadata: {
      submitted_via: "operator_console",
      ...(fields.metadata && typeof fields.metadata === "object" ? fields.metadata : {}),
    },
    last_activity_at: nowIso,
    updated_at: nowIso,
  });
  const id = fields.id || leadId?.value || "";
  const query = id
    ? sb.from("leads").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("leads").insert({ ...payload, created_at: nowIso });
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  ACTIVE_LEAD_ID = data.id;
  await fetchLeads();
  renderLeads(leadSearch?.value || "");
  renderDashboard();
  renderGuidance();
  return data;
}

async function createBidFromLeadRecord(lead, options = {}) {
  if (!lead?.id) throw new Error("Save the lead before creating a bid.");
  if (lead.converted_bid_id) {
    await Promise.all([fetchLeads(), loadPersistedBids()]);
    const existingBid = findBidRecordById(lead.converted_bid_id);
    if (existingBid) {
      ACTIVE_BID_ID = existingBid.id;
      return { bid: existingBid, existing: true };
    }
  }

  const profile = normalizeBidProfile(options.profile || preferredBidProfile());
  const localDraftId = String(options.localDraftId || "").trim();
  const baseLocalDraft = localDraftId
    ? ((BIDS_CACHE || []).find((row) => row.id === localDraftId) || null)
    : null;
  const latestLocalDraftForMerge = () => {
    if (!localDraftId) return null;
    if (currentBid()?.id === localDraftId) {
      try {
        return collectBidFormDraft();
      } catch (_) {}
    }
    return (BIDS_CACHE || []).find((row) => row.id === localDraftId) || baseLocalDraft;
  };
  const { data, error } = await sb.rpc("create_bid_from_lead", {
    p_lead_id: lead.id,
    p_profile: profile,
  });

  if (!error) {
    await Promise.all([fetchLeads(), loadPersistedBids()]);
    let bid = findBidRecordById(data?.bid_id) || BIDS_CACHE[0] || null;
    const localDraft = latestLocalDraftForMerge();
    if (bid && localDraft) {
      const mergedBid = {
        ...cloneJson(bid, {}),
        ...cloneJson(localDraft, {}),
        id: localDraft.id,
        record_id: bid.record_id || data?.bid_id || localDraft.record_id || "",
        metadata: {
          ...(bid.metadata || {}),
          ...(localDraft.metadata || {}),
          local_draft_id: localDraft.id,
        },
        updated_at: localDraft.updated_at || bid.updated_at || new Date().toISOString(),
      };
      BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== mergedBid.id), mergedBid]
        .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
      persistBidDrafts();
      bid = mergedBid;
    }
    if (bid) ACTIVE_BID_ID = bid.id;
    return { bid, existing: !!data?.existing };
  }
  if (!isMissingDatabaseFeatureError(error, ["create_bid_from_lead"])) throw error;

  const nowIso = new Date().toISOString();
  const draft = bidDraftFromLeadRecord(lead, profile, latestLocalDraftForMerge());
  const rowPayload = bidRowFromDraft(draft);
  const { data: bidRow, error: bidError } = await sb.from("bids")
    .insert({ ...rowPayload, created_at: nowIso, updated_at: nowIso })
    .select("*")
    .single();
  if (bidError) throw bidError;

  const { error: leadError } = await sb.from("leads")
    .update({
      converted_bid_id: bidRow.id,
      status: "quoted",
      last_activity_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", lead.id)
    .eq(OPERATOR_COLUMN, opId())
    .eq(TENANT_COLUMN, TENANT_ID);
  if (leadError) throw leadError;

  await Promise.all([fetchLeads(), loadPersistedBids()]);
  let bid = findBidRecordById(bidRow.id) || draftFromBidRow(bidRow);
  const localDraft = latestLocalDraftForMerge();
  if (bid && localDraft) {
    const mergedBid = {
      ...cloneJson(bid, {}),
      ...cloneJson(localDraft, {}),
      id: localDraft.id,
      record_id: bid.record_id || bidRow.id,
      metadata: {
        ...(bid.metadata || {}),
        ...(localDraft.metadata || {}),
        local_draft_id: localDraft.id,
      },
      updated_at: localDraft.updated_at || bid.updated_at || nowIso,
    };
    BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== mergedBid.id), mergedBid]
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    persistBidDrafts();
    bid = mergedBid;
  }
  if (bid) ACTIVE_BID_ID = bid.id;
  return { bid, existing: false };
}

let LEAD_PLAN_WORKSPACE_BOUND = false;
function initLeadPlanWorkspaceBindings() {
  if (LEAD_PLAN_WORKSPACE_BOUND) return;
  LEAD_PLAN_WORKSPACE_BOUND = true;

  leadSearch?.addEventListener("input", debounce(() => renderLeads(leadSearch.value)));
  btnNewLead?.addEventListener("click", () => {
    ACTIVE_LEAD_ID = null;
    clearLeadForm();
    renderLeadDetail(null).catch(console.error);
  });
  leadForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineMessage(leadMsg, "Saving...");
    try {
      await saveLeadRecord();
      markWorkspaceClean("leads");
      setInlineMessage(leadMsg, "Lead saved.", "ok");
    } catch (err) {
      setInlineMessage(leadMsg, err.message || String(err), "error");
    }
  });
  btnLeadCreateBid?.addEventListener("click", async () => {
    try {
      setInlineMessage(leadMsg, "Creating bid...");
      let lead = currentLead();
      if (!lead || !lead.id) lead = await saveLeadRecord();
      setBidWorkspaceBootstrapping(true, "Opening proposal workspace...");
      let localDraft = null;
      if (!lead.converted_bid_id) {
        localDraft = bidDraftFromLeadRecord(lead, preferredBidProfile());
        BIDS_CACHE = [...(BIDS_CACHE || []).filter((row) => row.id !== localDraft.id), localDraft]
          .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
        persistBidDrafts();
        ACTIVE_BID_ID = localDraft.id;
        renderBids(bidSearch?.value || "");
      }
      switchTab("bids", { force: true });
      setInlineMessage(bidMsg, "Opening proposal workspace...");
      const result = await createBidFromLeadRecord(lead, {
        profile: preferredBidProfile(),
        localDraftId: localDraft?.id || "",
      });
      const target = result?.bid || BIDS_CACHE[0] || null;
      if (target) ACTIVE_BID_ID = target.id;
      setBidWorkspaceBootstrapping(false);
      renderBids(bidSearch?.value || "", localDraft ? { preserveForm: true } : {});
      renderLeads(leadSearch?.value || "");
      markWorkspaceClean("leads");
      setInlineMessage(leadMsg, result?.existing ? "Linked bid opened." : "Lead converted into a bid.", "ok");
      const currentBidMessage = String(bidMsg?.textContent || "").trim().toLowerCase();
      if (!currentBidMessage || currentBidMessage.includes("opening proposal workspace")) {
        setInlineMessage(bidMsg, result?.existing ? "Linked proposal opened." : "Proposal draft ready.", "ok");
      }
    } catch (err) {
      setBidWorkspaceBootstrapping(false);
      setInlineMessage(leadMsg, err.message || String(err), "error");
      setInlineMessage(bidMsg, err.message || String(err), "error");
    }
  });
  btnLeadOpenBid?.addEventListener("click", async () => {
    const lead = currentLead();
    if (!lead?.converted_bid_id) return;
    await loadPersistedBids();
    const bid = findBidRecordById(lead.converted_bid_id);
    if (bid) ACTIVE_BID_ID = bid.id;
    renderBids(bidSearch?.value || "");
    switchTab("bids");
  });

  planSearch?.addEventListener("input", debounce(() => renderPlans(planSearch.value)));
  btnNewPlan?.addEventListener("click", () => {
    ACTIVE_PLAN_ID = null;
    clearPlanForm();
    renderPlanDetail(null).catch(console.error);
  });
  planSourceOrderId?.addEventListener("change", () => {
    const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (planSourceOrderId.value || ""));
    const linkedCustomer = CUSTOMERS_CACHE.find((row) => row.id === linkedOrder?.customer_id) || null;
    if (!linkedOrder) return;
    renderPlanCustomerOptions(linkedOrder.customer_id || "");
    if (planTitle && !planTitle.value.trim()) planTitle.value = linkedOrder.cart_summary || linkedOrder.customer_name || "Recurring service";
    if (planServiceAddress && !planServiceAddress.value.trim()) planServiceAddress.value = linkedOrder.service_address || linkedCustomer?.service_address || linkedCustomer?.billing_address || "";
    if (planNextRunOn && !planNextRunOn.value) planNextRunOn.value = linkedOrder.scheduled_date || todayDateValue(30);
    if (planAmount && !planAmount.value.trim()) planAmount.value = money(orderTotalCents(linkedOrder));
    if (planDepositAmount && !planDepositAmount.value.trim()) planDepositAmount.value = money(orderDepositRequiredCents(linkedOrder));
    if (planScheduleWindow && !planScheduleWindow.value.trim()) planScheduleWindow.value = linkedOrder.schedule_window || linkedOrder.scheduled_time || "";
    if (planSummary && !planSummary.value.trim()) planSummary.value = linkedOrder.cart_summary || "";
    if (planNotes && !planNotes.value.trim()) planNotes.value = linkedOrder.notes || "";
  });
  planForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineMessage(planMsg, "Saving...");
    try {
      await saveServicePlanRecord();
      markWorkspaceClean("plans");
      setInlineMessage(planMsg, "Recurring plan saved.", "ok");
    } catch (err) {
      setInlineMessage(planMsg, err.message || String(err), "error");
    }
  });
  btnGeneratePlanOrder?.addEventListener("click", async () => {
    const plan = currentServicePlan();
    if (!plan) return;
    setInlineMessage(planMsg, "Generating next order...");
    try {
      const result = await runServicePlanRecord(plan);
      setInlineMessage(planMsg, result?.existing ? "The next order already existed, so it was reopened." : "Recurring work generated.", "ok");
      if (result?.order?.id) {
        ACTIVE_ORDER_ID = result.order.id;
        switchTab("orders");
      }
    } catch (err) {
      setInlineMessage(planMsg, err.message || String(err), "error");
    }
  });
  btnOpenPlanOrder?.addEventListener("click", () => {
    const plan = currentServicePlan();
    if (!plan?.last_generated_order_id) return;
    ACTIVE_ORDER_ID = plan.last_generated_order_id;
    renderOrders();
    switchTab("orders");
  });
  btnRunDuePlans?.addEventListener("click", async () => {
    setInlineMessage(planMsg, "Generating due recurring work...");
    try {
      const result = await runDueServicePlans();
      setInlineMessage(planMsg, result.created ? `Generated ${result.created} due recurring order${result.created === 1 ? "" : "s"}.` : "No new due recurring orders were needed.", "ok");
    } catch (err) {
      setInlineMessage(planMsg, err.message || String(err), "error");
    }
  });
}

const LEAD_PLAN_WORKSPACE_HELPERS = {
  fetchLeads,
  fetchServicePlans,
  renderLeadCustomerOptions,
  clearLeadForm,
  populateLeadForm,
  renderLeadDetail,
  sortedLeads,
  renderLeads,
  renderPlanCustomerOptions,
  renderPlanOrderOptions,
  clearPlanForm,
  populatePlanForm,
  renderPlanDetail,
  sortedServicePlans,
  renderPlans,
  saveServicePlanRecord,
  createServicePlanFromOrderRecord,
  runServicePlanRecord,
  runDueServicePlans,
  saveLeadRecord,
  createBidFromLeadRecord,
  initLeadPlanWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_LEAD_PLAN_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_LEAD_PLAN_WORKSPACE || {}),
  ...LEAD_PLAN_WORKSPACE_HELPERS,
};

Object.assign(window, LEAD_PLAN_WORKSPACE_HELPERS);
