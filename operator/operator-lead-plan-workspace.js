// Request intake and recurring service workflows extracted from operator.js
// so lead conversion and repeat-work operations stay in one domain module.
const PLAN_RENEWAL_REVIEW_CACHE = window.PROOFLINK_PLAN_RENEWAL_REVIEW_CACHE || (window.PROOFLINK_PLAN_RENEWAL_REVIEW_CACHE = {});

function planAiStatusTone(status) {
  if (status === "ready") return "pill-good";
  if (status === "blocked") return "pill-bad";
  return "pill-warn";
}
function planAiPriorityTone(priority) {
  if (priority === "high") return "pill-bad";
  if (priority === "low") return "";
  return "pill-warn";
}
function planAiFormatStatus(value) {
  const normalized = String(value || "review_needed").replace(/_/g, " ").trim();
  if (typeof titleCaseWords === "function") return titleCaseWords(normalized);
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Review needed";
}
function planAiFormatDate(value) {
  if (!value) return "";
  if (typeof formatDateTime === "function") return formatDateTime(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}
function planRenewalPrimaryRef(item = {}) {
  const refs = Array.isArray(item.record_refs) ? item.record_refs : [];
  const preferredTypes = ["plan", "customer", "order"];
  for (const recordType of preferredTypes) {
    const match = refs.find((ref) => ref && ref.record_type === recordType && ref.record_id);
    if (match) return match;
  }
  return refs.find((ref) => ref && ref.record_id) || null;
}
function openPlanRenewalRecordRef(ref) {
  const recordType = String(ref?.record_type || "").trim().toLowerCase();
  const recordId = String(ref?.record_id || "").trim();
  if (!recordType || !recordId) return false;
  if (recordType === "plan") {
    ACTIVE_PLAN_ID = recordId;
    renderPlans(planSearch?.value || "");
    return true;
  }
  if (recordType === "customer") {
    ACTIVE_CUSTOMER_ID = recordId;
    if (typeof switchTab === "function") switchTab("customers");
    const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
    const customer = CUSTOMERS_CACHE.find((row) => row.id === recordId) || null;
    if (typeof customerApi.renderCustomerDetailWorkspace === "function") {
      Promise.resolve(customerApi.renderCustomerDetailWorkspace(recordId, customer)).catch(console.error);
    }
    return true;
  }
  if (recordType === "order") {
    ACTIVE_ORDER_ID = recordId;
    if (typeof renderOrders === "function") renderOrders();
    if (typeof switchTab === "function") switchTab("orders");
    return true;
  }
  return false;
}
function renderPlanRenewalManagerReport(state = null) {
  const report = state?.report || null;
  if (!report) {
    return `<div class="detail-copy">Run the renewal review to separate due-soon plans, plans missing the next run, and recurring accounts that already need schedule recovery.</div>`;
  }
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
  const summary = state?.context_summary || {};
  const generatedAt = report.generated_at || state?.generated_at || "";
  return `
    <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
    <div class="workspace-chip-row u-mt-10">
      <span class="pill ${planAiStatusTone(report.summary_status || "review_needed")}">${escapeHtml(planAiFormatStatus(report.summary_status || "review_needed"))}</span>
      ${summary.active_plans ? `<span class="pill">${escapeHtml(`${summary.active_plans} active`)}</span>` : ""}
      ${summary.due_soon ? `<span class="pill pill-good">${escapeHtml(`${summary.due_soon} due soon`)}</span>` : ""}
      ${summary.missing_next_run ? `<span class="pill pill-warn">${escapeHtml(`${summary.missing_next_run} missing next run`)}</span>` : ""}
      ${summary.reactivation_needed ? `<span class="pill pill-bad">${escapeHtml(`${summary.reactivation_needed} overdue`)}</span>` : ""}
    </div>
    ${blockers.length ? `
      <div class="memory-checklist u-mt-10">
        ${blockers.slice(0, 2).map((item) => `
          <div class="memory-checklist__item memory-checklist__item--warn">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Renewal blocker")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${findings.length ? `
      <div class="memory-checklist u-mt-10">
        ${findings.slice(0, 4).map((item) => {
          const primaryRef = planRenewalPrimaryRef(item);
          return `
            <div class="memory-checklist__item ${item.category === "due_soon" ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}">
              <div class="memory-checklist__title">${escapeHtml(item.title || "Renewal finding")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
              ${primaryRef ? `
                <div class="action-row action-row--wrap u-mt-10">
                  <button type="button" class="btn btn-ghost btn-sm" data-plan-renewal-open-record="${escapeAttr(primaryRef.record_type)}" data-plan-renewal-record-id="${escapeAttr(primaryRef.record_id)}">Open ${escapeHtml(primaryRef.label || primaryRef.record_type)}</button>
                </div>
              ` : ""}
            </div>
          `;
        }).join("")}
      </div>
    ` : ""}
    ${actions.length ? `
      <div class="detail-copy u-mt-10"><strong>Recommended actions</strong></div>
      <div class="workspace-chip-row">
        ${actions.slice(0, 3).map((action) => `<span class="pill ${planAiPriorityTone(action.priority || "medium")}">${escapeHtml(planAiFormatStatus(`${action.priority || "medium"} priority`))}</span>`).join("")}
      </div>
    ` : ""}
    ${generatedAt ? `<div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(planAiFormatDate(generatedAt))}</div>` : ""}
  `;
}
function renderPlanRenewalManagerCard(plan) {
  if (!plan) return "";
  const state = PLAN_RENEWAL_REVIEW_CACHE[String(plan.id || "").trim()] || null;
  const primaryRef = planRenewalPrimaryRef(state?.report?.findings?.[0] || {});
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">AI renewal review</div>
      <div><strong>Service Plan Renewal Manager</strong></div>
      <div class="detail-copy">Keep next-run timing, missing cadence, and overdue recurring accounts visible before repeat work drops out of rhythm.</div>
      <div class="action-row action-row--wrap u-mt-10">
        <button type="button" class="btn btn-ghost btn-sm" id="btnRunPlanRenewalReview">${state?.report ? "Run again" : "Run renewal review"}</button>
        ${primaryRef ? `<button type="button" class="btn btn-ghost btn-sm" id="btnOpenPlanRenewalPrimary">Open first record</button>` : ""}
      </div>
      <div id="planRenewalReviewMsg" class="msg ${state?.error ? "error" : state?.loading ? "" : state?.message ? "ok" : ""} u-mt-10">${escapeHtml(state?.loading ? "Reviewing renewal queue..." : state?.error || state?.message || "")}</div>
      <div id="planRenewalReviewReport" class="u-mt-10">${renderPlanRenewalManagerReport(state)}</div>
    </div>
  `;
}
async function runPlanRenewalManagerReview(plan = currentServicePlan(), options = {}) {
  if (!plan?.id) return null;
  const cacheKey = String(plan.id || "").trim();
  PLAN_RENEWAL_REVIEW_CACHE[cacheKey] = {
    ...(PLAN_RENEWAL_REVIEW_CACHE[cacheKey] || {}),
    loading: true,
    error: "",
    message: "",
  };
  if (options.rerender !== false) renderPlanDetail(plan.id).catch(console.error);
  if (typeof requestOperatorFunction !== "function") {
    PLAN_RENEWAL_REVIEW_CACHE[cacheKey] = {
      ...(PLAN_RENEWAL_REVIEW_CACHE[cacheKey] || {}),
      loading: false,
      error: "Renewal review tools are not ready yet.",
      message: "",
    };
    if (options.rerender !== false) renderPlanDetail(plan.id).catch(console.error);
    return PLAN_RENEWAL_REVIEW_CACHE[cacheKey];
  }
  try {
    const payload = await requestOperatorFunction("ai-agent-report", {
      method: "POST",
      body: {
        agent_key: "service_plan_renewal_manager",
        plan_id: plan.id,
      },
    });
    PLAN_RENEWAL_REVIEW_CACHE[cacheKey] = {
      loading: false,
      error: "",
      message: "Renewal review refreshed.",
      report: payload?.report || null,
      context_summary: payload?.context_summary || null,
      generated_at: payload?.generated_at || payload?.report?.generated_at || "",
    };
    if (options.rerender !== false) renderPlanDetail(plan.id).catch(console.error);
    return PLAN_RENEWAL_REVIEW_CACHE[cacheKey];
  } catch (error) {
    PLAN_RENEWAL_REVIEW_CACHE[cacheKey] = {
      ...(PLAN_RENEWAL_REVIEW_CACHE[cacheKey] || {}),
      loading: false,
      error: error?.message || String(error),
      message: "",
    };
    if (options.rerender !== false) renderPlanDetail(plan.id).catch(console.error);
    return PLAN_RENEWAL_REVIEW_CACHE[cacheKey];
  }
}

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
  const workspaceBlueprint = typeof currentWorkspaceBlueprint === "function"
    ? currentWorkspaceBlueprint()
    : { business: { key: "other", label: "Business", recordFocus: [] } };
  const sharedChecklist = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
  const leadCustomerMemory = linkedCustomer && typeof sharedChecklist === "function"
    ? sharedChecklist(linkedCustomer, workspaceBlueprint).slice(0, 4)
    : (workspaceBlueprint?.business?.recordFocus || []).slice(0, 4).map((item) => ({
      label: item.label,
      note: item.description || "",
      ready: false,
    }));
  leadDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Request summary</div>
      <div><strong>${escapeHtml(lead.contact_name || lead.title || "Request")}</strong></div>
      <div class="detail-copy">${escapeHtml(lead.contact_email || "No email")} | ${escapeHtml(lead.contact_phone || "No phone")}</div>
      <div class="detail-copy">Status: ${escapeHtml(String(lead.status || "new").replace(/_/g, " "))} | Priority: ${escapeHtml(String(lead.priority || "normal"))}</div>
      <div class="detail-copy">Requested service: ${escapeHtml(lead.requested_service_type || "Not specified")}</div>
        <div class="detail-copy">Last activity: ${escapeHtml(formatDateTime(lead.last_activity_at || lead.updated_at || lead.created_at))}</div>
      </div>
    <div class="detail-card detail-card--spaced">
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
    ${leadCustomerMemory.length ? `
      <div class="detail-card detail-card--spaced">
        <div class="kicker">Customer memory</div>
        <div><strong>Keep the trade details attached to the request</strong></div>
        <div class="detail-copy">Capture the property, access, equipment, or emergency context here so the proposal and booked work do not have to depend on memory later.</div>
        <div class="memory-checklist">
          ${leadCustomerMemory.map((item) => `
            <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
              <div class="memory-checklist__label">${escapeHtml(item.label || "Detail")}</div>
              <div class="memory-checklist__note">${escapeHtml(item.note || "Still needs attention before the work moves forward.")}</div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}
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

function planFollowThroughChecklistItems(plan, customer, sourceOrder, lastOrder, dueNow, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const scheduleLabel = servicePlanNextRunLabel(plan) || "No next run scheduled";
  const lastOrderDue = lastOrder ? Number(orderAmountDueCents(lastOrder) || 0) : 0;
  const repeatNote = String(plan?.notes || plan?.summary || sourceOrder?.notes || sourceOrder?.cart_summary || "").trim();
  const hasRepeatNote = !!repeatNote;
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const detail = (label, ready, readyNote, missingNote, tone = "") => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
    tone: tone || (!ready ? "warn" : ""),
  });
  const planCadence = planCadenceInsight(plan, customer);
  const renewalReady = !!String(plan?.next_run_on || "").trim() && (!!lastOrder || !!sourceOrder || dueNow);
  const renewalRiskItem = detail(
    "Renewal risk",
    renewalReady,
    dueNow
      ? "The next recurring visit is due now, so the renewal step is already visible."
      : planCadence?.attachedMessage || `The next recurring move is attached to ${scheduleLabel}.`,
    planCadence?.riskMessage || "This plan is active, but the next visit or first generated work still needs to be attached before the account goes quiet."
  );

  const items = [
    detail(
      "Next work timing",
      !!String(plan?.next_run_on || "").trim(),
      dueNow
        ? "Due now. Generate the next booked work while this repeat visit is still top of mind."
        : planCadence?.attachedMessage || `Next run ${scheduleLabel}. Keep this cadence visible so the work does not slip back into manual follow-up.`,
      planCadence?.riskMessage || "Add the next run date before this repeat work drifts out of sight.",
      dueNow ? "warn" : ""
    ),
    detail(
      "Repeat-work scope",
      hasRepeatNote,
      repeatNote,
      "Capture the repeat scope, seasonal shift, or visit summary so the next order does not have to be rebuilt from memory."
    ),
    detail(
      "Billing follow-through",
      !lastOrder || lastOrderDue <= 0,
      lastOrder
        ? "The most recent recurring order is paid up or ready for the next visit."
        : `No recurring order has been generated yet. Deposit policy is ${Number(plan?.deposit_required_cents || 0) > 0 ? "already attached to the plan." : "still optional."}`,
      lastOrder
        ? `The last generated work still has ${formatUsd(lastOrderDue)} open. Close that gap before this cadence gets harder to collect.`
        : "Generate the first recurring order once the schedule and amount are ready."
    ),
    renewalRiskItem,
  ];

  const tradeItemMap = {
    landscaping: detail(
      "Seasonal follow-through",
      !!firstFilled(customer?.seasonal_notes, customer?.upsell_notes, customer?.follow_up_notes, plan?.notes),
      firstFilled(customer?.seasonal_notes, customer?.upsell_notes, customer?.follow_up_notes, plan?.notes),
      "Capture the next cleanup, mulch, mowing, or seasonal upgrade timing before the property goes cold."
    ),
    property_maintenance: detail(
      "Site follow-through",
      !!firstFilled(customer?.service_schedule, customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      firstFilled(customer?.service_schedule, customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      "Capture the next site walk, turnover, or repeat maintenance note before the property needs to be relearned."
    ),
    pressure_washing: detail(
      "Seasonal follow-through",
      !!firstFilled(customer?.seasonal_notes, customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      firstFilled(customer?.seasonal_notes, customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      "Capture the next wash cycle, before-and-after follow-up, or seasonal timing before the property falls out of rotation."
    ),
    cleaning: detail(
      "Visit prep stays clear",
      !!firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes, plan?.notes),
      firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes, plan?.notes),
      "Lock in access, add-ons, and checklist notes so the next cleaning visit stays easy to schedule and deliver."
    ),
    hvac: detail(
      "System follow-through",
      !!firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes, plan?.notes),
      firstFilled(customer?.parts_follow_up, customer?.maintenance_notes, customer?.warranty_notes, plan?.notes),
      "Capture maintenance-plan timing, parts follow-up, or warranty notes before the next system visit slips."
    ),
    plumbing: detail(
      "Repair follow-through",
      !!firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes, plan?.notes),
      firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes, plan?.notes),
      "Capture restoration, approval, or return-visit notes before the repair history goes quiet."
    ),
  };

  items.push(
    tradeItemMap[businessKey] || detail(
      "Next customer step",
      !!firstFilled(customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      firstFilled(customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      "Capture the next follow-up step so this recurring account stays easy to renew and collect."
    )
  );

  return items;
}

function planCadenceInsight(plan, customer, now = new Date()) {
  const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
  const cadenceInsightForCustomer = typeof customerApi.customerRepeatCadenceInsight === "function"
    ? customerApi.customerRepeatCadenceInsight
    : null;
  const current = now instanceof Date ? now : new Date(now);
  const nextRunValue = String(plan?.next_run_on || "").trim();
  if (nextRunValue) {
    const nextRun = new Date(nextRunValue);
    if (!Number.isNaN(nextRun.getTime()) && !Number.isNaN(current.getTime())) {
      const deltaDays = Math.floor((current.getTime() - nextRun.getTime()) / 86400000);
      if (deltaDays > 0) {
        return {
          overdueDays: deltaDays,
          riskMessage: `This recurring plan is roughly ${deltaDays} day${deltaDays === 1 ? "" : "s"} past the scheduled rhythm, so the next visit should be recovered now.`,
          attachedMessage: `The next recurring move is attached to ${servicePlanNextRunLabel(plan) || nextRunValue}.`,
        };
      }
      return {
        overdueDays: 0,
        riskMessage: null,
        attachedMessage: `The next recurring move is attached to ${servicePlanNextRunLabel(plan) || nextRunValue}, which keeps the schedule in rhythm.`,
      };
    }
  }
  const cadenceInsight = cadenceInsightForCustomer ? cadenceInsightForCustomer(customer, current) : null;
  if (!cadenceInsight) return null;
  return {
    overdueDays: cadenceInsight.overdueDays || 0,
    riskMessage: cadenceInsight.message,
    attachedMessage: `The next recurring move is attached to ${servicePlanNextRunLabel(plan) || "the current plan"}, which stays in step with the usual ${cadenceInsight.cadenceDays}-day rhythm.`,
  };
}

function renderPlanFollowThroughCard(plan, customer, sourceOrder, lastOrder, dueNow, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
  const items = planFollowThroughChecklistItems(plan, customer, sourceOrder, lastOrder, dueNow, blueprint);
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Plan follow-through</div>
      <div><strong>Keep this recurring rhythm healthy</strong></div>
      <div class="detail-copy">Use this checklist to keep repeat work, billing, and the next visit from slipping back into manual follow-up.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Detail")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "Still needs attention before the next repeat visit.")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function planNextMoveItems(plan, customer, sourceOrder, lastOrder, dueNow, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const lastOrderDue = lastOrder ? Number(orderAmountDueCents(lastOrder) || 0) : 0;
  const detail = (label, ready, readyNote, missingNote, tone = "") => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
    tone: tone || (!ready ? "warn" : ""),
  });
  const planCadence = planCadenceInsight(plan, customer);

  const cadenceItem = detail(
    "Next recurring move",
    !!String(plan?.next_run_on || "").trim(),
    dueNow
      ? "Generate the next booked work now so the repeat visit does not fall back into manual follow-up."
      : planCadence?.attachedMessage || `The next run is already set for ${servicePlanNextRunLabel(plan)}.`,
    planCadence?.riskMessage || "Set the next run date before this repeat work falls out of rhythm.",
    dueNow ? "warn" : ""
  );
  const renewalRiskItem = detail(
    "Renewal risk stays visible",
    !!String(plan?.next_run_on || "").trim() && (!!lastOrder || !!sourceOrder || dueNow),
    dueNow
      ? "The next recurring visit is due now, so the renewal step is already in motion."
      : planCadence?.attachedMessage || `The next recurring move is attached to ${servicePlanNextRunLabel(plan) || "the current plan"}.`,
    planCadence?.riskMessage || "Attach the next visit or first generated work before this recurring account drifts back into manual follow-up."
  );

  const moneyItem = detail(
    "Collection stays attached",
    !lastOrder || lastOrderDue <= 0,
    lastOrder
      ? "The last recurring order is paid up, so the next visit can move without a money blind spot."
      : "No recurring order has been generated yet, so nothing is left open behind this plan.",
    `The most recent recurring work still has ${formatUsd(lastOrderDue)} open. Keep the reminder and next visit tied together.`
  );

  const landscaping = [
    cadenceItem,
    renewalRiskItem,
    detail(
      "Seasonal upsell stays visible",
      !!firstFilled(customer?.seasonal_notes, customer?.upsell_notes, plan?.notes, sourceOrder?.notes),
      firstFilled(customer?.seasonal_notes, customer?.upsell_notes, plan?.notes, sourceOrder?.notes),
      "Leave the next cleanup, mulch, mowing, or seasonal upsell note attached before the property needs to be re-sold."
    ),
    moneyItem,
  ];

  const cleaning = [
    cadenceItem,
    renewalRiskItem,
    detail(
      "Visit handoff stays clear",
      !!firstFilled(customer?.checklist_notes, customer?.add_on_notes, customer?.access_notes, plan?.notes),
      firstFilled(customer?.checklist_notes, customer?.add_on_notes, customer?.access_notes, plan?.notes),
      "Keep the checklist, add-ons, and access notes together so the next cleaning visit is easy to book and deliver."
    ),
    moneyItem,
  ];

  const hvac = [
    cadenceItem,
    renewalRiskItem,
    detail(
      "Maintenance follow-through stays visible",
      !!firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes, plan?.notes),
      firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes, plan?.notes),
      "Keep the maintenance, parts, or warranty note attached so the next HVAC visit starts informed."
    ),
    moneyItem,
  ];

  const plumbing = [
    cadenceItem,
    renewalRiskItem,
    detail(
      "Repair follow-through stays visible",
      !!firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes, plan?.notes),
      firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes, plan?.notes),
      "Keep the approval, restoration, or return-visit note attached so the next plumbing step is easy to schedule."
    ),
    moneyItem,
  ];

  const fallback = [
    cadenceItem,
    renewalRiskItem,
    detail(
      "Next customer step",
      !!firstFilled(customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      firstFilled(customer?.follow_up_notes, customer?.service_notes, plan?.notes),
      "Leave one clear next step attached so the plan stays easy to renew and collect."
    ),
    moneyItem,
  ];

  return ({
    landscaping,
    property_maintenance: landscaping,
    pressure_washing: landscaping,
    cleaning,
    hvac,
    plumbing,
  })[businessKey] || fallback;
}

function renderPlanNextMoveCard(plan, customer, sourceOrder, lastOrder, dueNow, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
  const items = planNextMoveItems(plan, customer, sourceOrder, lastOrder, dueNow, blueprint);
  const actions = planReactivationActions(plan, customer, sourceOrder, lastOrder, dueNow, blueprint);
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Best next recurring move</div>
      <div><strong>Keep the next visit, the customer promise, and the money step together</strong></div>
      <div class="detail-copy">Use this to keep recurring work easy to renew, easy to schedule, and easy to collect without rebuilding context each cycle.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible before this repeat work slips.")}</div>
          </div>
        `).join("")}
      </div>
      ${actions.length ? `
        <div class="action-row action-row--wrap u-mt-10">
          ${actions.map((action) => `
            <button type="button" class="${escapeAttr(action.className || "btn btn-ghost")}" data-plan-reactivation-action="${escapeAttr(action.action || "")}">${escapeHtml(action.label || "Take action")}</button>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function planReactivationActions(plan, customer, sourceOrder, lastOrder, dueNow, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const actions = [];
  const hasNextRun = !!String(plan?.next_run_on || "").trim();
  const hasGeneratedWork = !!(lastOrder?.id || plan?.last_generated_order_id);
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
  const repeatSignal = firstFilled(
    customer?.service_schedule,
    customer?.frequency,
    customer?.recurring_notes,
    customer?.service_plan_name,
    customer?.maintenance_notes,
    customer?.seasonal_notes,
    customer?.follow_up_notes,
    customer?.parts_follow_up,
    customer?.warranty_notes,
    customer?.restoration_notes,
    customer?.approval_notes
  );
  const scheduleLabel = typeof customerApi.customerScheduleActionLabel === "function"
    ? customerApi.customerScheduleActionLabel(blueprint)
    : ({
      landscaping: "Schedule next property visit",
      property_maintenance: "Schedule next site visit",
      pressure_washing: "Schedule next wash visit",
      cleaning: "Schedule next cleaning visit",
      hvac: "Schedule next system visit",
      plumbing: "Schedule next follow-up visit",
    })[businessKey] || "Schedule follow-up visit";
  const requestLabel = typeof customerApi.customerRequestActionLabel === "function"
    ? customerApi.customerRequestActionLabel(blueprint)
    : ({
      landscaping: "Draft seasonal follow-up request",
      property_maintenance: "Draft site follow-up request",
      pressure_washing: "Draft wash follow-up request",
      cleaning: "Draft cleaning follow-up request",
      hvac: "Draft maintenance follow-up request",
      plumbing: "Draft repair follow-up request",
    })[businessKey] || "Draft follow-up request";
  const createRequestLabel = typeof customerApi.customerCreateRequestActionLabel === "function"
    ? customerApi.customerCreateRequestActionLabel(blueprint)
    : requestLabel.replace(/^Draft\b/, "Create");

  if (!hasNextRun) {
    actions.push({ label: "Set next visit timing", action: "focus-next-run", className: "btn btn-primary" });
  } else if ((dueNow || !hasGeneratedWork) && String(plan?.status || "").toLowerCase() === "active") {
    actions.push({ label: "Generate next booked work", action: "generate-next-order", className: "btn btn-primary" });
  }

  if (repeatSignal && customer) {
    actions.push({
      label: scheduleLabel,
      action: "schedule-follow-up",
      className: "btn btn-ghost",
    });
    actions.push({
      label: createRequestLabel,
      action: "create-follow-up-request",
      className: "btn btn-ghost",
    });
  }
  if (hasGeneratedWork) {
    actions.push({ label: "Open booked work", action: "open-last-order", className: "btn btn-ghost" });
  }

  return actions;
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
  const workspaceBlueprint = typeof currentWorkspaceBlueprint === "function"
    ? currentWorkspaceBlueprint()
    : { business: { key: "other", label: "Business", recordFocus: [] } };
  const sharedChecklist = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
  const planCustomerMemory = customer && typeof sharedChecklist === "function"
    ? sharedChecklist(customer, workspaceBlueprint).slice(0, 4)
    : (workspaceBlueprint?.business?.recordFocus || []).slice(0, 4).map((item) => ({
      label: item.label,
      note: item.description || "",
      ready: false,
    }));
  planDetailWrap.innerHTML = `
    <div class="detail-card">
      <div class="kicker">Recurring summary</div>
      <div><strong>${escapeHtml(plan.title || "Recurring plan")}</strong></div>
      <div class="detail-copy">${escapeHtml(customer?.name || "No linked customer")} | ${escapeHtml(planCadenceLabel(plan.cadence, plan.custom_interval_days))}</div>
        <div class="detail-copy">Next run: ${escapeHtml(servicePlanNextRunLabel(plan))}${dueNow ? " | Due now" : ""}</div>
        <div class="detail-copy">Amount: ${formatUsd(servicePlanAmountCents(plan))} | Deposit: ${formatUsd(Number(plan.deposit_required_cents || 0))}</div>
      </div>
      <div class="detail-card detail-card--spaced">
        <div class="kicker">Source and automation</div>
        <div class="detail-copy">Source order: ${escapeHtml(sourceOrder?.customer_name || sourceOrder?.cart_summary || "No source order")}</div>
        <div class="detail-copy">Auto-create job: ${plan.auto_create_job !== false ? "On" : "Off"}</div>
        <div class="detail-copy">${escapeHtml(plan.service_address || customer?.service_address || "No service address recorded")}</div>
      </div>
      <div class="detail-card detail-card--spaced">
        <div class="kicker">Last generated work</div>
        <div class="detail-copy">Last order: ${escapeHtml(lastOrder?.customer_name || lastOrder?.cart_summary || "None yet")}</div>
        <div class="detail-copy">${lastOrder ? `${escapeHtml(formatWorkflowPaymentState(orderPaymentState(lastOrder)))} | ${formatUsd(orderAmountDueCents(lastOrder))} due` : "Generate the next order when this plan is ready to create work."}</div>
        <div class="detail-copy">${escapeHtml(plan.notes || "Use notes for site access, seasonal adjustments, and handoff reminders.")}</div>
      </div>
      ${renderPlanFollowThroughCard(plan, customer, sourceOrder, lastOrder, dueNow, workspaceBlueprint)}
      ${renderPlanNextMoveCard(plan, customer, sourceOrder, lastOrder, dueNow, workspaceBlueprint)}
      ${renderPlanRenewalManagerCard(plan)}
      ${planCustomerMemory.length ? `
        <div class="detail-card detail-card--spaced">
          <div class="kicker">Customer memory</div>
          <div><strong>Keep the trade details attached to the recurring rhythm</strong></div>
          <div class="detail-copy">Use this plan to keep the property, access, equipment, or repair context visible before repeat work is generated again.</div>
          <div class="memory-checklist">
            ${planCustomerMemory.map((item) => `
              <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
                <div class="memory-checklist__label">${escapeHtml(item.label || "Detail")}</div>
                <div class="memory-checklist__note">${escapeHtml(item.note || "Still needs attention before the next repeat visit.")}</div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    `;

  planDetailWrap.querySelectorAll("[data-plan-reactivation-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-plan-reactivation-action") || "";
      if (action === "focus-next-run") {
        planNextRunOn?.focus?.();
        planNextRunOn?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        return;
      }
      if (action === "generate-next-order") {
        btnGeneratePlanOrder?.click?.();
        return;
      }
      if (action === "open-last-order" && plan?.last_generated_order_id) {
        ACTIVE_ORDER_ID = plan.last_generated_order_id;
        renderOrders();
        switchTab("orders");
        return;
      }
      if (action === "schedule-follow-up" && customer) {
        const bookingsApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
        const followUpNote = [
          plan?.notes,
          plan?.summary,
          customer?.follow_up_notes,
          customer?.recurring_notes,
        ].find((value) => String(value || "").trim()) || "";
        if (typeof bookingsApi.openBookingDraftForCustomer === "function") {
          bookingsApi.openBookingDraftForCustomer(customer, {
            date: plan.next_run_on || "",
            extraNotes: followUpNote,
          }, workspaceBlueprint);
        } else {
          switchTab("bookings");
        }
        return;
      }
      if (action === "draft-follow-up-request" && customer) {
        const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
        if (typeof customerApi.openCustomerRetentionAction === "function") {
          customerApi.openCustomerRetentionAction("request", customer, workspaceBlueprint, {
            requestOptions: {
              title: `${customer.name || "Customer"} follow-up request`,
              summary: [
                plan?.summary,
                customer?.follow_up_notes,
                customer?.recurring_notes,
              ].find((value) => String(value || "").trim()) || "",
              notes: [
                plan?.notes,
                customer?.maintenance_notes,
                customer?.restoration_notes,
                customer?.approval_notes,
              ].find((value) => String(value || "").trim()) || "",
              message: "Follow-up request draft opened from the recurring plan.",
            },
          });
        }
      }
      if (action === "create-follow-up-request" && customer) {
        const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
        if (typeof customerApi.openCustomerRetentionAction === "function") {
          customerApi.openCustomerRetentionAction("create-request", customer, workspaceBlueprint, {
            requestOptions: {
              title: `${customer.name || "Customer"} follow-up request`,
              summary: [
                plan?.summary,
                customer?.follow_up_notes,
                customer?.recurring_notes,
              ].find((value) => String(value || "").trim()) || "",
              notes: [
                plan?.notes,
                customer?.maintenance_notes,
                customer?.restoration_notes,
                customer?.approval_notes,
              ].find((value) => String(value || "").trim()) || "",
              message: "Follow-up request created from the recurring plan.",
              successMessage: "Follow-up request created from the recurring plan.",
              pendingMessage: "Creating follow-up request from the recurring plan...",
              sourceRecordType: "plan",
              sourceRecordId: plan.id || "",
            },
          });
        }
      }
    });
  });
  planDetailWrap.querySelector("#btnRunPlanRenewalReview")?.addEventListener("click", () => {
    runPlanRenewalManagerReview(plan).catch(console.error);
  });
  planDetailWrap.querySelector("#btnOpenPlanRenewalPrimary")?.addEventListener("click", () => {
    const primaryRef = planRenewalPrimaryRef(PLAN_RENEWAL_REVIEW_CACHE[String(plan.id || "").trim()]?.report?.findings?.[0] || {});
    openPlanRenewalRecordRef(primaryRef);
  });
  planDetailWrap.querySelectorAll("[data-plan-renewal-open-record][data-plan-renewal-record-id]").forEach((button) => {
    button.addEventListener("click", () => {
      openPlanRenewalRecordRef({
        record_type: button.getAttribute("data-plan-renewal-open-record") || "",
        record_id: button.getAttribute("data-plan-renewal-record-id") || "",
        label: button.textContent || "",
      });
    });
  });
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
  runPlanRenewalManagerReview,
  renderPlanRenewalManagerCard,
  renderPlanRenewalManagerReport,
  openPlanRenewalRecordRef,
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
  planFollowThroughChecklistItems,
  renderPlanFollowThroughCard,
  planNextMoveItems,
  planReactivationActions,
  renderPlanNextMoveCard,
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
