// Money and follow-through workspace extracted from operator.js so expenses,
// collections, and reviews live together in one domain module.
let EXPENSES_FETCHED = false;
async function fetchExpenses() {
  if (FETCHING.has('expenses')) return;
  FETCHING.add('expenses');
  try {
    const { data, error } = await scopeQuery(sb
      .from("expenses")
      .select("*"))
      .abortSignal(_tabAbortController?.signal)
      .order("date", { ascending: false })
      .limit(250);
    if (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) return;
      console.error('[fetchExpenses]', error);
      return;
    }
    EXPENSES_CACHE = data || [];
    EXPENSES_FETCHED = true;
    return EXPENSES_CACHE;
  } finally {
    FETCHING.delete('expenses');
  }
}
function renderExpenseCustomerOptions(selectedCustomerId = "") {
  if (!expenseCustomerId) return;
  const options = [`<option value="">No customer link</option>`];
  sortedCustomers(CUSTOMERS_CACHE).forEach((customer) => {
    options.push(`<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || "Customer")}</option>`);
  });
  expenseCustomerId.innerHTML = options.join("");
  expenseCustomerId.value = selectedCustomerId || "";
}
function renderExpenseOrderOptions(selectedOrderId = "") {
  if (!expenseOrderId) return;
  const options = [`<option value="">No order link</option>`];
  [...CRM_ORDERS_CACHE]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
    .forEach((order) => {
      const label = order.customer_name || order.cart_summary || "Tracked order";
      options.push(`<option value="${escapeAttr(order.id)}">${escapeHtml(label)} - ${escapeHtml(formatUsd(orderTotalCents(order)))}</option>`);
    });
  expenseOrderId.innerHTML = options.join("");
  expenseOrderId.value = selectedOrderId || "";
}
function renderExpenseJobOptions(selectedJobId = "") {
  if (!expenseJobId) return;
  const options = [`<option value="">No job link</option>`];
  [...JOBS_CACHE]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
    .forEach((job) => {
      const customerName = customerById(job.customer_id)?.name || linkedOrderForJob(job)?.customer_name || "Job";
      options.push(`<option value="${escapeAttr(job.id)}">${escapeHtml(job.title || customerName)} - ${escapeHtml(String(job.status || "scheduled").replace(/_/g, " "))}</option>`);
    });
  expenseJobId.innerHTML = options.join("");
  expenseJobId.value = selectedJobId || "";
}
function updateExpenseTypeVisibility() {
  const type = normalizeExpenseType(expenseType?.value || "overhead");
  const doc = typeof document !== "undefined" ? document : null;
  const laborFields = typeof expenseLaborFields !== "undefined" ? expenseLaborFields : doc?.getElementById?.("expenseLaborFields");
  const materialFields = typeof expenseMaterialFields !== "undefined" ? expenseMaterialFields : doc?.getElementById?.("expenseMaterialFields");
  const materialNotesFields = typeof expenseMaterialNotesFields !== "undefined" ? expenseMaterialNotesFields : doc?.getElementById?.("expenseMaterialNotesFields");
  const changeOrderFields = typeof expenseChangeOrderFields !== "undefined" ? expenseChangeOrderFields : doc?.getElementById?.("expenseChangeOrderFields");
  if (laborFields) laborFields.classList.toggle("hidden", type !== "labor");
  const showMaterial = ["material", "job_cost", "vendor_bill"].includes(type);
  if (materialFields) materialFields.classList.toggle("hidden", !showMaterial);
  if (materialNotesFields) materialNotesFields.classList.toggle("hidden", !showMaterial);
  const showChangeOrder = !!expenseChangeOrder?.checked;
  if (changeOrderFields) changeOrderFields.classList.toggle("hidden", !showChangeOrder);
}
function syncExpenseLaborAmount() {
  const doc = typeof document !== "undefined" ? document : null;
  const amountField = typeof expenseAmount !== "undefined" ? expenseAmount : doc?.getElementById?.("expenseAmount");
  if (!amountField || normalizeExpenseType(expenseType?.value || "") !== "labor") return;
  const hours = Number(expenseLaborHours?.value || 0);
  const rate = Number(expenseLaborRate?.value || 0);
  if (hours > 0 && rate > 0) {
    amountField.value = String((hours * rate).toFixed(2));
  }
}
function clearExpenseForm(defaults = {}) {
  expenseId.value = "";
  expenseDate.value = defaults.date || "";
  expenseCategory.value = "";
  expenseVendor.value = "";
  if (expenseType) expenseType.value = normalizeExpenseType(defaults.expense_type || "overhead");
  expenseDescription.value = "";
  if (expenseNotes) expenseNotes.value = "";
  expenseAmount.value = "";
  renderExpenseCustomerOptions(defaults.customer_id || "");
  renderExpenseOrderOptions(defaults.order_id || "");
  renderExpenseJobOptions(defaults.job_id || "");
  if (expenseBillable) expenseBillable.checked = !!defaults.billable;
  if (expenseReimbursable) expenseReimbursable.checked = !!defaults.reimbursable;
  if (expenseChangeOrder) expenseChangeOrder.checked = !!defaults.change_order;
  if (expenseLaborRole) expenseLaborRole.value = "";
  if (expenseLaborHours) expenseLaborHours.value = "";
  if (expenseLaborRate) expenseLaborRate.value = "";
  if (expenseMaterialName) expenseMaterialName.value = "";
  if (expenseMaterialQuantity) expenseMaterialQuantity.value = "";
  if (expenseChangeOrderLabel) expenseChangeOrderLabel.value = "";
  if (expenseChangeOrderNote) expenseChangeOrderNote.value = "";
  if (expenseLeftoverNote) expenseLeftoverNote.value = "";
  if (expenseWasteNote) expenseWasteNote.value = "";
  updateExpenseTypeVisibility();
  if (expenseMsg) expenseMsg.textContent = "";
  if (expenseFormTitle) expenseFormTitle.textContent = defaults.job_id || defaults.order_id ? "Log job cost" : "New expense";
}
function loadExpenseIntoForm(r) {
  const labor = expenseLaborItem(r);
  const material = expenseMaterialItems(r)[0] || null;
  const changeOrder = expenseChangeOrderItem(r);
  expenseId.value = r.id;
  expenseDate.value = r.date || r.expense_date || "";
  expenseCategory.value = r.category || "";
  expenseVendor.value = r.vendor || "";
  if (expenseType) expenseType.value = normalizeExpenseType(r.expense_type || "overhead");
  expenseDescription.value = r.description || r.notes || "";
  if (expenseNotes) expenseNotes.value = r.notes || "";
  expenseAmount.value = money(r.amount_cents);
  renderExpenseCustomerOptions(r.customer_id || "");
  renderExpenseOrderOptions(r.order_id || "");
  renderExpenseJobOptions(r.job_id || "");
  if (expenseBillable) expenseBillable.checked = !!r.billable;
  if (expenseReimbursable) expenseReimbursable.checked = !!r.reimbursable;
  if (expenseChangeOrder) expenseChangeOrder.checked = !!changeOrder;
  if (expenseLaborRole) expenseLaborRole.value = labor?.role || "";
  if (expenseLaborHours) expenseLaborHours.value = labor?.hours || "";
  if (expenseLaborRate) expenseLaborRate.value = labor?.rate_cents ? money(labor.rate_cents) : "";
  if (expenseMaterialName) expenseMaterialName.value = material?.name || "";
  if (expenseMaterialQuantity) expenseMaterialQuantity.value = material?.quantity || "";
  if (expenseChangeOrderLabel) expenseChangeOrderLabel.value = changeOrder?.label || "";
  if (expenseChangeOrderNote) expenseChangeOrderNote.value = changeOrder?.note || "";
  if (expenseLeftoverNote) expenseLeftoverNote.value = material?.leftover_note || "";
  if (expenseWasteNote) expenseWasteNote.value = material?.waste_note || "";
  updateExpenseTypeVisibility();
  if (expenseMsg) expenseMsg.textContent = "";
  if (expenseFormTitle) expenseFormTitle.textContent = "Edit expense";
}
function openExpenseForJob(job) {
  const order = linkedOrderForJob(job);
  const defaults = {
    date: todayDateValue(0),
    expense_type: "job_cost",
    customer_id: job?.customer_id || order?.customer_id || "",
    order_id: order?.id || job?.order_id || "",
    job_id: job?.id || "",
  };
  clearExpenseForm(defaults);
  switchTab("expenses");
}
function renderExpenses(rows) {
  if (!expensesList) return;
  expensesList.innerHTML = "";
  if (!rows.length) {
    expensesList.innerHTML = `<div class="muted">No expenses yet.</div>`;
    return;
  }

  rows.forEach((r) => {
    const linkedJob = JOBS_CACHE.find((job) => job.id === r.job_id) || null;
    const linkedOrder = CRM_ORDERS_CACHE.find((order) => order.id === r.order_id) || null;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "list-item";
    el.innerHTML = `
      <div class="li-main">
        <div class="li-title">${escapeHtml(r.category || "Expense")} - $${money(r.amount_cents)}</div>
        <div class="li-sub muted">${escapeHtml(r.date || r.expense_date || "")}  |  ${escapeHtml(r.vendor || "")}</div>
        <div class="li-sub muted">${escapeHtml(costItemSummary(r))}${linkedJob ? ` | ${escapeHtml(linkedJob.title || "Job cost")}` : (linkedOrder ? ` | ${escapeHtml(linkedOrder.customer_name || linkedOrder.cart_summary || "Order cost")}` : "")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${expenseIsChangeOrder(r) ? "pill-warn" : ""}">${escapeHtml(r.description || r.notes || "")}</span>
      </div>
    `;
    el.addEventListener("click", () => loadExpenseIntoForm(r));
    expensesList.appendChild(el);
  });
}
btnNewExpense?.addEventListener("click", clearExpenseForm);
btnRefreshExpenses?.addEventListener("click", async () => {
  try {
    renderExpenses(await fetchExpenses());
    await refreshPicklists();
    renderStartupChecklist();
  } catch (err) {
    notifyOperator(err.message || String(err));
  }
});
expenseForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const amountCents = toCents(expenseAmount.value);
  if (!amountCents || amountCents <= 0) {
    if (expenseMsg) expenseMsg.textContent = "Enter an expense amount greater than zero.";
    expenseAmount?.focus();
    return;
  }
  if (!expenseDate.value) {
    if (expenseMsg) expenseMsg.textContent = "Select a date for this expense.";
    expenseDate?.focus();
    return;
  }

  if (expenseMsg) expenseMsg.textContent = "Saving...";

  const id = expenseId.value || null;
  const selectedJob = JOBS_CACHE.find((row) => row.id === expenseJobId?.value) || null;
  const selectedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (expenseOrderId?.value || selectedJob?.order_id || "")) || null;
  const selectedCustomerId = expenseCustomerId?.value || selectedJob?.customer_id || selectedOrder?.customer_id || "";
  const payload = withTenantScope({
    operator_id: opId(),
    date: expenseDate.value,
    expense_date: expenseDate.value,
    category: preferExisting(expenseCategory.value, PICK_EXPENSE_CATEGORIES),
    vendor: preferExisting(expenseVendor.value, PICK_VENDORS),
    expense_type: normalizeExpenseType(expenseType?.value || "overhead"),
    customer_id: selectedCustomerId || null,
    order_id: selectedOrder?.id || null,
    job_id: selectedJob?.id || null,
    billable: !!expenseBillable?.checked,
    reimbursable: !!expenseReimbursable?.checked,
    used_materials: buildExpenseSupplementalItems(),
    description: expenseDescription.value.trim(),
    notes: expenseNotes?.value?.trim() || expenseDescription.value.trim(),
    amount_cents: amountCents,
    updated_at: new Date().toISOString(),
  });

  try {
    const q = id
      ? sb.from("expenses").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
      : sb.from("expenses").insert({ ...payload, created_at: new Date().toISOString() });

    const { error } = await q;
      if (error) throw error;

      if (expenseMsg) expenseMsg.textContent = "Saved.";
      markWorkspaceClean("expenses");
      renderExpenses(await fetchExpenses());
    await refreshPicklists();
    renderStartupChecklist();
    renderJobs(jobSearch?.value || "");
    renderMoney().catch(console.error);
  } catch (err) {
    if (expenseMsg) expenseMsg.textContent = err.message || String(err);
  }
});
btnDeleteExpense?.addEventListener("click", async () => {
  if (!expenseId.value) return;
  try {
    const { error } = await sb.from("expenses").delete().eq("id", expenseId.value).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);
    if (error) throw error;
    clearExpenseForm();
    renderExpenses(await fetchExpenses());
    await refreshPicklists();
    renderStartupChecklist();
    renderJobs(jobSearch?.value || "");
    renderMoney().catch(console.error);
  } catch (err) {
    if (expenseMsg) expenseMsg.textContent = err.message || String(err);
  }
});
expenseOrderId?.addEventListener("change", () => {
  const order = CRM_ORDERS_CACHE.find((row) => row.id === expenseOrderId.value) || null;
  if (!order) return;
  renderExpenseCustomerOptions(order.customer_id || "");
});
expenseJobId?.addEventListener("change", () => {
  const job = JOBS_CACHE.find((row) => row.id === expenseJobId.value) || null;
  const order = linkedOrderForJob(job);
  if (!job) return;
  renderExpenseOrderOptions(order?.id || job.order_id || "");
  renderExpenseCustomerOptions(job.customer_id || order?.customer_id || "");
});
expenseType?.addEventListener("change", () => {
  updateExpenseTypeVisibility();
  syncExpenseLaborAmount();
});
expenseChangeOrder?.addEventListener("change", updateExpenseTypeVisibility);
[expenseLaborHours, expenseLaborRate].forEach((el) => {
  el?.addEventListener("input", syncExpenseLaborAmount);
});
function buildMoneyCollectionGuidance({ outstandingBalance, overdueBalance, duePlansCount, openDepositCount, unpaidCompletedCount }) {
  if (overdueBalance > 0) {
    return {
      title: "Start with the overdue balances",
      description: "This is the money most likely to turn into drag on the business. Clear the oldest follow-up first, then work forward from there.",
      chips: [
        `${formatUsd(overdueBalance)} overdue`,
        `${formatUsd(outstandingBalance)} still open`,
      ],
    };
  }
  if (openDepositCount > 0) {
    return {
      title: "Collect the open deposits next",
      description: "Deposits are still the cleanest way to protect the schedule before more work moves into the field.",
      chips: [
        `${openDepositCount} deposit${openDepositCount === 1 ? "" : "s"} open`,
        duePlansCount > 0 ? `${duePlansCount} recurring visit${duePlansCount === 1 ? "" : "s"} due` : "No recurring work due",
      ],
    };
  }
  if (unpaidCompletedCount > 0) {
    return {
      title: "Completed work still needs collection",
      description: "The work is done. Keep invoice delivery and reminder follow-through attached until the finished jobs are fully collected.",
      chips: [
        `${unpaidCompletedCount} completed job${unpaidCompletedCount === 1 ? "" : "s"} unpaid`,
        `${formatUsd(outstandingBalance)} still open`,
      ],
    };
  }
  if (outstandingBalance > 0) {
    return {
      title: "Keep the open balances moving",
      description: "Nothing is overdue yet, so this is the right window to send the invoice, confirm timing, and keep collection easy.",
      chips: [
        `${formatUsd(outstandingBalance)} still open`,
        "No overdue balances",
      ],
    };
  }
  return {
    title: "Money follow-through is in a good place",
    description: "Nothing urgent is waiting here right now. Use this breathing room to tighten pricing, profit visibility, or repeat-work follow-through.",
    chips: [
      "No overdue balances",
      "Nothing urgent to collect",
    ],
  };
}

function priorityCollectionOrder() {
  return [...CRM_ORDERS_CACHE]
    .filter((row) => orderAmountDueCents(row) > 0)
    .sort((a, b) => {
      const overdueA = orderPaymentState(a) === "overdue" ? 1 : 0;
      const overdueB = orderPaymentState(b) === "overdue" ? 1 : 0;
      if (overdueA !== overdueB) return overdueB - overdueA;

      const depositA = typeof orderDepositGapCents === "function" ? orderDepositGapCents(a) : 0;
      const depositB = typeof orderDepositGapCents === "function" ? orderDepositGapCents(b) : 0;
      if (depositA !== depositB) return depositB - depositA;

      const completedA = ["completed", "fulfilled"].includes(String(a.status || "").toLowerCase()) ? 1 : 0;
      const completedB = ["completed", "fulfilled"].includes(String(b.status || "").toLowerCase()) ? 1 : 0;
      if (completedA !== completedB) return completedB - completedA;

      return orderAmountDueCents(b) - orderAmountDueCents(a);
    })[0] || null;
}

function buildMoneyCollectionMemory(blueprint = currentWorkspaceBlueprint()) {
  const order = priorityCollectionOrder();
  if (!order) return null;

  const customer = customerById(order.customer_id) || null;
  const sharedChecklist = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
  const focus = customer && typeof sharedChecklist === "function"
    ? sharedChecklist(customer, blueprint)
    : [];
  const customerName = customer?.name || order.customer_name || "this customer";
  const items = [];

  if (focus.length) {
    focus.slice(0, 2).forEach((item) => {
      items.push(`${item.label}: ${item.note}`);
    });
  }

  if (!items.length && order.payment_due_date) {
    items.push(`Payment timing: due ${formatDateOnly(order.payment_due_date)}.`);
  }
  if (!items.length && order.cart_summary) {
    items.push(`Work in motion: ${order.cart_summary}`);
  }
  if (!items.length) {
    items.push("Keep the customer record, work summary, and payment timing aligned while you follow up.");
  }

  const paymentState = orderPaymentState(order);
  const depositGap = typeof orderDepositGapCents === "function" ? orderDepositGapCents(order) : 0;
  const description = paymentState === "overdue"
    ? `${customerName} is the clearest collection risk right now. Keep the follow-through tied to what this account actually needs.`
    : depositGap > 0
      ? `${customerName} still has money missing before the work is fully protected. Keep the deposit ask tied to the job context.`
      : `Use the details already attached to ${customerName} so payment follow-through stays specific and easy to trust.`;

  return {
    customerName,
    description,
    items,
  };
}

function buildMoneyCollectionNextStep(blueprint = currentWorkspaceBlueprint()) {
  const order = priorityCollectionOrder();
  if (!order) return null;

  const customer = customerById(order.customer_id) || null;
  const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
  const customerName = customer?.name || order.customer_name || "this customer";
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const items = [];
  const bookingsApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
  const timingInsight = customer && typeof bookingsApi.bookingDraftTimingInsight === "function"
    ? bookingsApi.bookingDraftTimingInsight(customer, {}, blueprint)
    : null;
  const repeatSignal = [
    customer?.service_schedule,
    customer?.frequency,
    customer?.recurring_notes,
    customer?.service_plan_name,
    customer?.maintenance_notes,
    customer?.seasonal_notes,
    customer?.parts_follow_up,
    customer?.warranty_notes,
    customer?.restoration_notes,
    customer?.approval_notes,
  ].some((value) => String(value || "").trim());
  const nextTouch = firstFilled(customer?.next_service_on, customer?.follow_up_notes, customer?.service_plan_name);

  if (["landscaping", "property_maintenance", "pressure_washing"].includes(businessKey)) {
    items.push(firstFilled(customer?.seasonal_notes, customer?.follow_up_notes, customer?.service_schedule)
      ? `Carry the next property touch forward: ${firstFilled(customer?.seasonal_notes, customer?.follow_up_notes, customer?.service_schedule)}`
      : "Turn the next move back into the next property visit or seasonal follow-up.");
  } else if (businessKey === "cleaning") {
    items.push(firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes)
      ? `Keep the next cleaning visit clear: ${firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes)}`
      : "Turn the next move back into visit cadence, checklist follow-through, or add-ons.");
  } else if (businessKey === "hvac") {
    items.push(firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes)
      ? `Move back to system follow-through: ${firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes)}`
      : "Once the balance closes, move back to maintenance, parts, or warranty follow-through.");
  } else if (businessKey === "plumbing") {
    items.push(firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes)
      ? `Keep the repair follow-through visible: ${firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes)}`
      : "Once the balance closes, keep the next repair, restoration, or return-visit step visible.");
  } else {
    items.push("Once this balance closes, keep the next service step attached to the same customer and work record.");
  }

  if (order.payment_due_date) {
    items.push(`Keep the timing visible too: this balance is tied to work due ${formatDateOnly(order.payment_due_date)}.`);
  } else if (order.cart_summary) {
    items.push(`Keep the work context attached: ${order.cart_summary}.`);
  }
  if (repeatSignal && !nextTouch) {
    items.push(`Reactivation move: put ${customerName} back onto the calendar before this repeat account cools off.`);
    if (timingInsight?.reason) {
      items.push(`Why now: ${timingInsight.reason}${timingInsight.bookingDate ? ` Suggested next visit: ${formatDateOnly(timingInsight.bookingDate)}.` : ""}`);
    }
  }

  const actions = repeatSignal && !nextTouch
    ? (typeof customerApi.customerRetentionWorkflowActions === "function"
        ? customerApi.customerRetentionWorkflowActions({
            customer,
            blueprint,
            includeGenerateWork: true,
            includeSchedule: true,
            includeRequest: true,
            requestAction: "create-request",
            requestLabel: typeof customerApi.customerCreateRequestActionLabel === "function"
              ? customerApi.customerCreateRequestActionLabel(blueprint)
              : undefined,
            includeOpenCustomer: true,
            primaryClassName: "btn btn-primary btn-sm",
            secondaryClassName: "btn btn-ghost btn-sm",
          })
        : [
            { label: typeof customerApi.customerScheduleActionLabel === "function" ? customerApi.customerScheduleActionLabel(blueprint) : ({
              landscaping: "Schedule next property visit",
              property_maintenance: "Schedule next site visit",
              pressure_washing: "Schedule next wash visit",
              cleaning: "Schedule next cleaning visit",
              hvac: "Schedule next system visit",
              plumbing: "Schedule next follow-up visit",
            })[businessKey] || "Schedule next visit", action: "reactivate-repeat", className: "btn btn-primary btn-sm" },
            { label: typeof customerApi.customerCreateRequestActionLabel === "function" ? customerApi.customerCreateRequestActionLabel(blueprint) : ({
              landscaping: "Draft seasonal follow-up request",
              property_maintenance: "Draft site follow-up request",
              pressure_washing: "Draft wash follow-up request",
              cleaning: "Draft cleaning follow-up request",
              hvac: "Draft maintenance follow-up request",
              plumbing: "Draft repair follow-up request",
            })[businessKey]?.replace(/^Draft\b/, "Create") || "Create follow-up request", action: "create-request", className: "btn btn-ghost btn-sm" },
            { label: "Open customer", action: "open-reactivation-customer", className: "btn btn-ghost btn-sm" },
          ])
    : [];

  return {
    customerId: customer?.id || order.customer_id || "",
    customerName,
    title: "After this balance is handled",
    description: `When ${customerName} is paid up, the next move should go back to service follow-through instead of chasing the same money twice.`,
    items,
    actions,
  };
}

const BILLING_BLOCKER_AGENT_STATE = window.PROOFLINK_BILLING_BLOCKER_AGENT_STATE || (window.PROOFLINK_BILLING_BLOCKER_AGENT_STATE = {
  report: null,
  context_summary: null,
  generated_at: "",
});

function moneyAgentStatusTone(status) {
  if (status === "ready") return "pill-good";
  if (status === "blocked") return "pill-bad";
  return "pill-warn";
}

function moneyAgentPriorityTone(priority) {
  if (priority === "high") return "pill-bad";
  if (priority === "low") return "";
  return "pill-warn";
}

function moneyAgentTimestamp(value) {
  if (typeof formatDateTime === "function") return formatDateTime(value || new Date().toISOString());
  return String(value || "");
}

function moneyBillingQueuePrimaryRef(item = {}) {
  return (Array.isArray(item.record_refs) ? item.record_refs : []).find((ref) => ref && ref.record_type === "job" && ref.record_id) || null;
}

function openBillingBlockerJob(jobId) {
  if (!jobId) return;
  ACTIVE_JOB_ID = jobId;
  if (typeof switchTab === "function") switchTab("jobs");
}

function renderBillingBlockerQueueReport(state = BILLING_BLOCKER_AGENT_STATE) {
  const report = state?.report || null;
  if (!report) {
    return `<div class="detail-copy">Run the billing blocker review to build a grounded queue of jobs that still need proof, invoice cleanup, or billing reconciliation before they age into collections work.</div>`;
  }

  const findings = Array.isArray(report.findings) ? report.findings : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
  const dataUsed = Array.isArray(report.data_used) ? report.data_used.filter((item) => item && item.count > 0) : [];
  const queueCount = Number(state?.context_summary?.queued_jobs || findings.length || 0);
  const candidateCount = Number(state?.context_summary?.candidate_jobs || 0);

  return `
    <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
    <div class="workspace-chip-row u-mt-10">
      <span class="pill ${moneyAgentStatusTone(report.summary_status || "review_needed")}">${escapeHtml(titleCaseWords(String(report.summary_status || "review needed").replace(/_/g, " ")))}</span>
      <span class="pill ${queueCount ? "pill-warn" : "pill-good"}">${escapeHtml(`${queueCount} queued`)}</span>
      ${candidateCount ? `<span class="pill">${escapeHtml(`${candidateCount} reviewed`)}</span>` : ""}
      ${report.confidence?.label ? `<span class="pill">${escapeHtml(`Confidence ${report.confidence.label}`)}</span>` : ""}
    </div>
    ${blockers.length ? `
      <div class="detail-copy u-mt-10"><strong>Top blocker</strong></div>
      <div class="memory-checklist u-mt-10">
        ${blockers.slice(0, 2).map((item) => `
          <div class="memory-checklist__item memory-checklist__item--warn">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Billing blocker")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : `<div class="detail-copy u-mt-10">No active billing blockers were returned in this pass.</div>`}
    ${findings.length ? `
      <div class="detail-copy u-mt-10"><strong>Queue</strong></div>
      <div class="memory-checklist u-mt-10">
        ${findings.slice(0, 6).map((item) => {
          const ref = moneyBillingQueuePrimaryRef(item);
          return `
            <div class="memory-checklist__item ${item.severity === "critical" ? "memory-checklist__item--warn" : ""}">
              <div class="memory-checklist__title">${escapeHtml(item.title || "Queue item")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
              ${ref?.record_id ? `
                <div class="action-row action-row--wrap u-mt-10">
                  <button type="button" class="btn btn-ghost btn-sm" data-billing-blocker-open-job="${escapeAttr(ref.record_id)}">Open job</button>
                </div>
              ` : ``}
            </div>
          `;
        }).join("")}
      </div>
    ` : ""}
    ${actions.length ? `
      <div class="detail-copy u-mt-10"><strong>Recommended actions</strong></div>
      <div class="workspace-chip-row">
        ${actions.slice(0, 3).map((action) => `<span class="pill ${moneyAgentPriorityTone(action.priority || "medium")}">${escapeHtml(titleCaseWords(String(action.priority || "medium")))} priority</span>`).join("")}
      </div>
      <div class="memory-checklist u-mt-10">
        ${actions.slice(0, 3).map((action) => `
          <div class="memory-checklist__item ${action.priority === "high" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
            <div class="memory-checklist__title">${escapeHtml(action.title || "Recommended action")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(action.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${dataUsed.length ? `
      <div class="detail-copy u-mt-10"><strong>Data used</strong></div>
      <div class="workspace-chip-row">
        ${dataUsed.slice(0, 4).map((item) => `<span class="pill">${escapeHtml(`${item.label}: ${item.count}`)}</span>`).join("")}
      </div>
    ` : ""}
    <div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(moneyAgentTimestamp(report.generated_at || state?.generated_at || new Date().toISOString()))}</div>
  `;
}

function renderMoneyWorkspaceSignalBand({
  outstandingBalance = 0,
  overdueBalance = 0,
  openDepositCount = 0,
  duePlansCount = 0,
  queueCount = 0,
} = {}) {
  return `
    <div class="workspace-signal-band">
      <div class="workspace-signal-band__item ${overdueBalance > 0 ? "workspace-signal-band__item--danger" : outstandingBalance > 0 ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Outstanding balance</span>
        <strong>${escapeHtml(formatUsd(outstandingBalance))}</strong>
        <small>${escapeHtml(overdueBalance > 0 ? `${formatUsd(overdueBalance)} is already overdue and needs priority follow-through.` : outstandingBalance > 0 ? "Money is still open, but it has not aged into overdue drag yet." : "No open balance is waiting here right now.")}</small>
      </div>
      <div class="workspace-signal-band__item ${openDepositCount > 0 ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Open deposits</span>
        <strong>${escapeHtml(String(openDepositCount))}</strong>
        <small>${escapeHtml(openDepositCount > 0 ? "Protect the schedule before more work moves into the field." : "No deposits are still open across the current work set.")}</small>
      </div>
      <div class="workspace-signal-band__item ${duePlansCount > 0 ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Recurring due</span>
        <strong>${escapeHtml(String(duePlansCount))}</strong>
        <small>${escapeHtml(duePlansCount > 0 ? "Repeat work is due soon and needs clean billing follow-through." : "No recurring work is due right now.")}</small>
      </div>
      <div class="workspace-signal-band__item ${queueCount > 0 ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Billing blockers</span>
        <strong>${escapeHtml(String(queueCount))}</strong>
        <small>${escapeHtml(queueCount > 0 ? "Jobs are still waiting on proof or billing cleanup before invoicing." : "No billing blockers are sitting in the queue right now.")}</small>
      </div>
    </div>
  `;
}

function renderMoneyWorkspaceActionCard({
  collectionGuidance = null,
  collectionMemory = null,
  collectionNextStep = null,
  outstandingBalance = 0,
  overdueBalance = 0,
  activePlansCount = 0,
  duePlansCount = 0,
  topCustomer = null,
} = {}) {
  return `
    <div class="detail-card detail-card--spaced workspace-focus-card">
      <div class="workspace-focus-card__head">
        <div>
          <div class="kicker">Money focus</div>
          <div><strong>${escapeHtml(collectionGuidance?.title || "Keep cash and margin moving")}</strong></div>
        </div>
        <span class="pill ${overdueBalance > 0 ? "pill-bad" : outstandingBalance > 0 ? "pill-warn" : "pill-on"}">${escapeHtml(overdueBalance > 0 ? "Overdue first" : outstandingBalance > 0 ? "Collection in motion" : "Caught up")}</span>
      </div>
      <div class="detail-copy">${escapeHtml(collectionGuidance?.description || "Use this rail to jump into the exact workspace that clears the next money problem without breaking customer context.")}</div>
      <div class="workspace-focus-card__meta">
        <div class="workspace-focus-card__item ${overdueBalance > 0 ? "workspace-focus-card__item--danger" : outstandingBalance > 0 ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good"}">
          <span>Collection pressure</span>
          <strong>${escapeHtml(formatUsd(overdueBalance > 0 ? overdueBalance : outstandingBalance))}</strong>
          <small>${escapeHtml(overdueBalance > 0 ? "Start with the overdue balances before the easier work distracts the team." : outstandingBalance > 0 ? "This is still open money that should stay visible." : "Nothing urgent is waiting on collection.")}</small>
        </div>
        <div class="workspace-focus-card__item ${duePlansCount > 0 ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good"}">
          <span>Recurring pipeline</span>
          <strong>${escapeHtml(`${activePlansCount} active / ${duePlansCount} due`)}</strong>
          <small>${escapeHtml(duePlansCount > 0 ? "Recurring work is close enough to billing pressure that it should stay visible here too." : "The recurring pipeline is not creating immediate money pressure.")}</small>
        </div>
        <div class="workspace-focus-card__item ${collectionMemory ? "workspace-focus-card__item--good" : ""}">
          <span>Customer context</span>
          <strong>${escapeHtml(collectionMemory?.customerName || topCustomer?.name || topCustomer?.email || "No top account yet")}</strong>
          <small>${escapeHtml(collectionMemory?.description || "The top-value account will show up here once customer value and open work start stacking together.")}</small>
        </div>
        <div class="workspace-focus-card__item ${collectionNextStep?.actions?.length ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good"}">
          <span>After collection</span>
          <strong>${escapeHtml(collectionNextStep?.title || "Keep service moving")}</strong>
          <small>${escapeHtml(collectionNextStep?.description || "Once money clears, ProofLink should point the operator back to the next service move, not just a blank ledger.")}</small>
        </div>
      </div>
      <div class="workspace-focus-card__buttons">
        <button type="button" class="btn btn-primary" data-money-workspace-action="expenses">Log expense</button>
        <button type="button" class="btn btn-ghost" data-money-workspace-action="jobs">Open jobs</button>
        <button type="button" class="btn btn-ghost" data-money-workspace-action="customers">Open customers</button>
        <button type="button" class="btn btn-ghost" data-money-workspace-action="products">Open catalog</button>
        <button type="button" class="btn btn-ghost" data-money-workspace-action="plans">Open recurring plans</button>
      </div>
    </div>
  `;
}

async function renderMoney() {
  if (!moneyWrap) return;

  const blueprint = currentWorkspaceBlueprint();
  const pricingRows = await fetchPricing();
  const topCustomer = sortedCustomers(CUSTOMERS_CACHE)[0] || null;
  const expByMonth = new Map();
  EXPENSES_CACHE.forEach((e) => {
    const mk = monthKeyFromDate(e.date || e.expense_date);
    if (mk) expByMonth.set(mk, (expByMonth.get(mk) || 0) + Number(e.amount_cents || 0));
  });
  const jobEconomics = jobsWithTrackedEconomics()
    .sort((a, b) => b.grossProfitCents - a.grossProfitCents);
  const weightedMargin = weightedAverageJobMarginRatio();
  const totalTrackedJobCost = jobEconomics.reduce((sum, row) => sum + row.costCents, 0);
  const totalGrossProfit = jobEconomics.reduce((sum, row) => sum + row.grossProfitCents, 0);
  const profitableJobs = jobEconomics.filter((row) => row.grossProfitCents > 0).length;
  const weakestJobs = [...jobEconomics]
    .sort((a, b) => a.grossProfitCents - b.grossProfitCents)
    .slice(0, 5);
  const strongestJobs = jobEconomics.slice(0, 5);
  const costBreakdown = costBreakdownForJobs(jobEconomics);

  const productsMissingPrice = PRODUCTS_CACHE.filter((p) => {
    const mode = String(p.pricing_mode || "").trim().toLowerCase();
    const sell = Number(p.sell_price_cents || 0);
    const start = Number(p.starting_price_cents || 0);

    if (sell > 0) return false;
    if (start > 0) return false;
    if (mode === "quote") return false;

    return true;
  }).length;

  const months = Array.from(expByMonth.keys()).sort().reverse();
  const duePlans = dueServicePlans();
  const activePlans = SERVICE_PLANS_CACHE.filter((row) => String(row.status || "").toLowerCase() === "active");
  const outstandingBalance = outstandingBalanceCents();
  const overdueBalance = overdueBalanceCents();
  const openDepositOrders = ordersMissingDeposits();
  const unpaidCompletedCount = CRM_ORDERS_CACHE.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return ["completed", "fulfilled"].includes(status) && orderAmountDueCents(row) > 0;
  }).length;
  const collectionGuidance = buildMoneyCollectionGuidance({
    outstandingBalance,
    overdueBalance,
    duePlansCount: duePlans.length,
    openDepositCount: openDepositOrders.length,
    unpaidCompletedCount,
  });
  const collectionMemory = buildMoneyCollectionMemory(blueprint);
  const collectionNextStep = buildMoneyCollectionNextStep(blueprint);
  const billingQueueCount = Number(BILLING_BLOCKER_AGENT_STATE.context_summary?.queued_jobs || BILLING_BLOCKER_AGENT_STATE.report?.findings?.length || 0);

  moneyWrap.innerHTML = `
    <div class="workspace-command-center">
      <div class="workspace-command-center__top">
        <div class="workspace-command-center__hero">
          ${renderRecordHeroCard({
            eyebrow: "Money command center",
            title: overdueBalance > 0 ? "Overdue balances need attention first" : "Keep cash and margin moving together",
            badges: [
              { label: `${CRM_ORDERS_CACHE.length} work item${CRM_ORDERS_CACHE.length === 1 ? "" : "s"} in money view` },
              { label: `${activePlans.length} active plan${activePlans.length === 1 ? "" : "s"}` },
              overdueBalance > 0
                ? { label: `${formatUsd(overdueBalance)} overdue`, tone: "pill-bad" }
                : outstandingBalance > 0
                  ? { label: `${formatUsd(outstandingBalance)} open`, tone: "pill-warn" }
                  : { label: "Balances clear", tone: "pill-on" },
            ],
            meta: [
              topCustomer ? `Top customer value ${formatUsd(customerLifetimeValueCents(topCustomer))}` : "No customer value leader yet",
              jobEconomics.length ? `${jobEconomics.length} tracked job${jobEconomics.length === 1 ? "" : "s"} with margin data` : "Tracked job economics will show here once cost logging is active",
            ],
            description: "Use one calm surface to handle collections, blocker cleanup, and margin visibility without bouncing between ledgers, jobs, and customers.",
            summary: [
              { label: "Outstanding balance", value: formatUsd(outstandingBalance), note: overdueBalance > 0 ? `${formatUsd(overdueBalance)} is already overdue` : "Open receivables across booked work" },
              { label: "Gross profit", value: formatUsd(totalGrossProfit), note: jobEconomics.length ? "Revenue minus linked job cost" : "No tracked economics yet" },
              { label: "Average job margin", value: formatPercent(weightedMargin), note: jobEconomics.length ? `${profitableJobs} profitable tracked jobs` : "Margin appears once jobs have linked cost" },
              { label: "Recurring work due", value: String(duePlans.length), note: activePlans.length ? `${activePlans.length} active plans in flight` : "No active recurring plans yet" },
            ],
            actionsHtml: renderMoneyWorkspaceSignalBand({
              outstandingBalance,
              overdueBalance,
              openDepositCount: openDepositOrders.length,
              duePlansCount: duePlans.length,
              queueCount: billingQueueCount,
            }),
          })}
        </div>
        <div class="workspace-command-center__sidebar">
          ${renderMoneyWorkspaceActionCard({
            collectionGuidance,
            collectionMemory,
            collectionNextStep,
            outstandingBalance,
            overdueBalance,
            activePlansCount: activePlans.length,
            duePlansCount: duePlans.length,
            topCustomer,
          })}
        </div>
      </div>
      <div class="workspace-command-center__main">
    <div class="cards">
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Customers</div>
          <div class="money">${CUSTOMERS_CACHE.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">CRM orders</div>
          <div class="money">${CRM_ORDERS_CACHE.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Top customer value</div>
          <div class="money">${formatUsd(topCustomer ? customerLifetimeValueCents(topCustomer) : 0)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Active recurring plans</div>
          <div class="money">${activePlans.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Recurring work due</div>
          <div class="money">${duePlans.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Tracked job cost</div>
          <div class="money">${formatUsd(totalTrackedJobCost)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Gross profit</div>
          <div class="money">${formatUsd(totalGrossProfit)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Average job margin</div>
          <div class="money">${formatPercent(weightedMargin)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Tracked labor</div>
          <div class="money">${costBreakdown.laborHours ? `${Number(costBreakdown.laborHours.toFixed(2))}h` : "-"}</div>
        </div>
      </div>
    </div>

    <div class="card money-focus-card">
      <div class="card-hd">
        <strong>Collection focus</strong>
        <span class="muted">The clearest next money move</span>
      </div>
      <div class="card-bd">
        <div class="money-focus-title">${escapeHtml(collectionGuidance.title)}</div>
        <div class="detail-copy money-focus-copy">${escapeHtml(collectionGuidance.description)}</div>
        <div class="workspace-chip-row money-focus-chips">
          ${collectionGuidance.chips.map((chip) => `<span class="pill">${escapeHtml(chip)}</span>`).join("")}
        </div>
        ${collectionMemory ? `
          <div class="detail-copy money-focus-section-title"><strong>Keep the follow-through tied to ${escapeHtml(collectionMemory.customerName)}</strong></div>
          <div class="detail-copy money-focus-copy">${escapeHtml(collectionMemory.description)}</div>
          <div class="memory-checklist money-focus-checklist">
            ${collectionMemory.items.map((item) => `
              <div class="memory-checklist__item memory-checklist__item--ready">
                <div class="detail-copy memory-checklist__note">${escapeHtml(item)}</div>
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${collectionNextStep ? `
          <div class="detail-copy money-focus-section-title"><strong>${escapeHtml(collectionNextStep.title)}</strong></div>
          <div class="detail-copy money-focus-copy">${escapeHtml(collectionNextStep.description)}</div>
          <div class="memory-checklist money-focus-checklist">
            ${collectionNextStep.items.map((item) => `
              <div class="memory-checklist__item memory-checklist__item--ready">
                <div class="detail-copy memory-checklist__note">${escapeHtml(item)}</div>
              </div>
            `).join("")}
          </div>
          ${collectionNextStep.actions?.length ? `
            <div class="action-row action-row--wrap u-mt-10">
              ${collectionNextStep.actions.map((action) => `
                <button type="button" class="${escapeAttr(action.className || "btn btn-ghost btn-sm")}" data-money-reactivation-action="${escapeAttr(action.action || "")}">${escapeHtml(action.label || "Take action")}</button>
              `).join("")}
            </div>
          ` : ""}
        ` : ""}
      </div>
    </div>

    <div class="card money-focus-card">
      <div class="card-hd">
        <strong>Billing blocker queue</strong>
        <span class="muted">What still needs proof or billing cleanup before invoicing</span>
      </div>
      <div class="card-bd">
        <div class="action-row action-row--wrap">
          <button type="button" class="btn btn-ghost btn-sm" id="btnRunBillingBlockerQueue">${BILLING_BLOCKER_AGENT_STATE.report ? "Refresh queue" : "Run blocker review"}</button>
          ${BILLING_BLOCKER_AGENT_STATE.report?.findings?.length ? `<button type="button" class="btn btn-ghost btn-sm" id="btnOpenBillingBlockerFirst">Open first job</button>` : ""}
        </div>
        <div id="moneyBillingBlockerMsg" class="msg u-mt-10"></div>
        <div id="moneyBillingBlockerReport" class="u-mt-10">
          ${renderBillingBlockerQueueReport(BILLING_BLOCKER_AGENT_STATE)}
        </div>
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">
        <h3>${escapeHtml(workspaceUsesServiceCatalog(blueprint) ? "Service catalog health" : (isBookingWorkspace(blueprint) || isEventWorkspace(blueprint) ? "Package health" : "Catalog health"))}</h3>
        <p>${escapeHtml(workspaceUsesServiceCatalog(blueprint) ? "Missing price anchor" : "Missing sell price")}: <strong>${productsMissingPrice}</strong></p>
        <p>${escapeHtml(workspaceUsesServiceCatalog(blueprint) ? "Missing image or proof" : "Missing image")}: <strong>${PRODUCTS_CACHE.filter((p) => !String(p.image_url || "").trim()).length}</strong></p>
      </div>
      <div class="insight">
        <h3>Customer value</h3>
        <p>The system now ranks customers by value and ties money back to real people instead of isolated receipts.</p>
      </div>
      <div class="insight">
        <h3>${escapeHtml(titleCaseWords(workspaceOrderLabelLower(blueprint)))} economics</h3>
        <p>${jobEconomics.length ? `ProofLink is now measuring ${jobEconomics.length} tracked job${jobEconomics.length === 1 ? "" : "s"} with real revenue and linked cost.` : "Link expenses to jobs or orders so this page can show real gross profit instead of just expense totals."}</p>
      </div>
      <div class="insight">
        <h3>Profit signal</h3>
        <p>${jobEconomics.length ? `${profitableJobs} of ${jobEconomics.length} tracked jobs are currently above zero gross profit. Weighted average margin is ${formatPercent(weightedMargin)}.` : "Once jobs have linked costs, this screen will show which work is healthy and which work is leaking margin."}</p>
      </div>
      <div class="insight">
        <h3>Cost mix</h3>
        <p>${jobEconomics.length ? `Labor: ${formatUsd(costBreakdown.laborCostCents)}. Materials: ${formatUsd(costBreakdown.materialCostCents)}.${costBreakdown.changeOrderCostCents > 0 ? ` Change-order cost: ${formatUsd(costBreakdown.changeOrderCostCents)}.` : ""}` : "As you log labor and material usage, this view will show what is actually eating margin."}</p>
      </div>
    </div>

    ${months.length ? `
      <div class="table" style="margin-top:14px;">
        <div class="tr th">
          <div>Month</div>
          <div class="right">Expenses</div>
        </div>
        ${months.map((m) => `
          <div class="tr">
            <div>${escapeHtml(m)}</div>
            <div class="right">${formatUsd(expByMonth.get(m) || 0)}</div>
          </div>
        `).join("")}
      </div>
    ` : `<div class="muted" style="margin-top:14px;">No expenses logged yet.</div>`}

    <div class="grid two" style="margin-top:14px;">
      <div class="card">
        <div class="card-hd">
          <strong>Strongest tracked jobs</strong>
          <span class="muted">Highest gross profit right now</span>
        </div>
        <div class="card-bd">
          ${strongestJobs.length ? `
            <div class="table">
              ${strongestJobs.map((row) => `
                <div class="tr">
                  <div>
                    <div><strong>${escapeHtml(row.job.title || row.order?.customer_name || "Job")}</strong></div>
                    <div class="muted" style="margin-top:4px;">Revenue ${escapeHtml(formatUsd(row.revenueCents))} | Cost ${escapeHtml(formatUsd(row.costCents))}</div>
                  </div>
                  <div class="right"><span class="pill ${grossProfitToneClass(row.grossProfitCents)}">${escapeHtml(formatUsd(row.grossProfitCents))} - ${escapeHtml(formatPercent(row.marginRatio))}</span></div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No tracked job economics yet.</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-hd">
          <strong>Weakest tracked jobs</strong>
          <span class="muted">Where margin needs attention</span>
        </div>
        <div class="card-bd">
          ${weakestJobs.length ? `
            <div class="table">
              ${weakestJobs.map((row) => `
                <div class="tr">
                  <div>
                    <div><strong>${escapeHtml(row.job.title || row.order?.customer_name || "Job")}</strong></div>
                    <div class="muted" style="margin-top:4px;">Revenue ${escapeHtml(formatUsd(row.revenueCents))} | Cost ${escapeHtml(formatUsd(row.costCents))}</div>
                  </div>
                  <div class="right"><span class="pill ${grossProfitToneClass(row.grossProfitCents)}">${escapeHtml(formatUsd(row.grossProfitCents))} - ${escapeHtml(formatPercent(row.marginRatio))}</span></div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No tracked job economics yet.</div>`}
        </div>
      </div>
    </div>

    ${(costBreakdown.leftoverNotes.length || costBreakdown.wasteNotes.length) ? `
      <div class="grid two" style="margin-top:14px;">
        <div class="card">
          <div class="card-hd">
            <strong>Leftover materials</strong>
            <span class="muted">What can be returned to stock or reused</span>
          </div>
          <div class="card-bd">
            ${costBreakdown.leftoverNotes.length ? `<div class="note-list">${costBreakdown.leftoverNotes.map((note) => `<div class="note-item">${escapeHtml(note)}</div>`).join("")}</div>` : `<div class="muted">No leftover notes logged yet.</div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-hd">
            <strong>Waste and overage</strong>
            <span class="muted">What is getting used up or lost</span>
          </div>
          <div class="card-bd">
            ${costBreakdown.wasteNotes.length ? `<div class="note-list">${costBreakdown.wasteNotes.map((note) => `<div class="note-item">${escapeHtml(note)}</div>`).join("")}</div>` : `<div class="muted">No waste or overage notes logged yet.</div>`}
          </div>
        </div>
      </div>
    ` : ``}
      </div>
    </div>
  `;

  moneyWrap.querySelectorAll("[data-money-reactivation-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-money-reactivation-action") || "";
      const nextStep = buildMoneyCollectionNextStep(currentWorkspaceBlueprint());
      if (!nextStep?.customerId) return;
      if (action === "open-reactivation-customer") {
        ACTIVE_CUSTOMER_ID = nextStep.customerId;
        switchTab("customers");
        return;
      }
      if (action === "reactivate-repeat" || action === "generate-next-order") {
        const customer = customerById(nextStep.customerId) || null;
        const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
        if (customer && typeof customerApi.openCustomerRetentionAction === "function") {
          customerApi.openCustomerRetentionAction(action, customer, currentWorkspaceBlueprint());
        } else {
          const bookingsApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
          if (customer && typeof bookingsApi.openBookingDraftForCustomer === "function") {
            bookingsApi.openBookingDraftForCustomer(customer, {}, currentWorkspaceBlueprint());
          } else {
            switchTab("bookings");
          }
        }
        return;
      }
      if (action === "request" || action === "create-request") {
        const customer = customerById(nextStep.customerId) || null;
        const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
        if (customer && typeof customerApi.openCustomerRetentionAction === "function") {
          customerApi.openCustomerRetentionAction(action === "create-request" ? "create-request" : "request", customer, currentWorkspaceBlueprint(), {
            requestOptions: {
              message: action === "create-request" ? "Follow-up request created from Money." : "Follow-up request draft opened from Money.",
              successMessage: "Follow-up request created from Money.",
              pendingMessage: "Creating follow-up request from Money...",
              sourceRecordType: "money",
              sourceRecordId: nextStep.customerId,
            },
          });
        }
      }
    });
  });

  moneyWrap.querySelectorAll("[data-money-workspace-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-money-workspace-action") || "";
      if (action === "expenses") {
        switchTab("expenses");
        return;
      }
      if (action === "jobs") {
        switchTab("jobs");
        return;
      }
      if (action === "customers") {
        switchTab("customers");
        return;
      }
      if (action === "products") {
        switchTab("products");
        return;
      }
      if (action === "plans") {
        switchTab("plans");
      }
    });
  });

  const bindBillingBlockerQueueActions = () => {
    moneyWrap.querySelectorAll("[data-billing-blocker-open-job]").forEach((button) => {
      button.addEventListener("click", () => openBillingBlockerJob(button.getAttribute("data-billing-blocker-open-job") || ""));
    });
    moneyWrap.querySelector("#btnOpenBillingBlockerFirst")?.addEventListener("click", () => {
      const firstFinding = BILLING_BLOCKER_AGENT_STATE.report?.findings?.[0] || null;
      const firstRef = moneyBillingQueuePrimaryRef(firstFinding || {});
      if (firstRef?.record_id) openBillingBlockerJob(firstRef.record_id);
    });
  };

  const billingQueueMsg = moneyWrap.querySelector("#moneyBillingBlockerMsg");
  const billingQueueHost = moneyWrap.querySelector("#moneyBillingBlockerReport");
  moneyWrap.querySelector("#btnRunBillingBlockerQueue")?.addEventListener("click", async () => {
    if (!billingQueueHost) return;
    if (typeof setInlineMessage === "function") {
      setInlineMessage(billingQueueMsg, "Reviewing billing blockers...");
    } else if (billingQueueMsg) {
      billingQueueMsg.textContent = "Reviewing billing blockers...";
    }
    try {
      const payload = await requestOperatorFunction("ai-agent-report", {
        method: "POST",
        body: {
          agent_key: "billing_blocker_detector",
          limit: 8,
        },
      });
      BILLING_BLOCKER_AGENT_STATE.report = payload?.report || null;
      BILLING_BLOCKER_AGENT_STATE.context_summary = payload?.context_summary || null;
      BILLING_BLOCKER_AGENT_STATE.generated_at = payload?.generated_at || BILLING_BLOCKER_AGENT_STATE.report?.generated_at || "";
      billingQueueHost.innerHTML = renderBillingBlockerQueueReport(BILLING_BLOCKER_AGENT_STATE);
      bindBillingBlockerQueueActions();
      if (typeof setInlineMessage === "function") {
        setInlineMessage(
          billingQueueMsg,
          BILLING_BLOCKER_AGENT_STATE.report?.findings?.length
            ? "Billing blocker queue refreshed."
            : "No billing blockers found in the current review set.",
          BILLING_BLOCKER_AGENT_STATE.report?.findings?.length ? "ok" : "warn"
        );
      } else if (billingQueueMsg) {
        billingQueueMsg.textContent = BILLING_BLOCKER_AGENT_STATE.report?.findings?.length
          ? "Billing blocker queue refreshed."
          : "No billing blockers found in the current review set.";
      }
    } catch (error) {
      if (typeof setInlineMessage === "function") {
        setInlineMessage(billingQueueMsg, error.message || String(error), "error");
      } else if (billingQueueMsg) {
        billingQueueMsg.textContent = error.message || String(error);
      }
    }
  });
  bindBillingBlockerQueueActions();

  // AR aging
  const arEl = $("arAgingContent");
  if (arEl) {
    const now = Date.now();
    const buckets = { current: {count:0,cents:0}, d30: {count:0,cents:0}, d60: {count:0,cents:0}, d90: {count:0,cents:0} };
    CRM_ORDERS_CACHE
      .filter(o => !o.is_deleted && orderPaymentState(o) !== 'paid' && orderPaymentState(o) !== 'void')
      .forEach(o => {
        const due = o.payment_due_date ? new Date(o.payment_due_date).getTime() : null;
        const days = due ? Math.floor((now - due) / 86400000) : 0;
        const amt  = Number(o.total_cents || 0) - Number(o.amount_paid_cents || 0);
        const key  = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : 'd90';
        buckets[key].count++;
        buckets[key].cents += amt;
      });
    const rows = [
      ['Current', buckets.current],
      ['1-30 days overdue', buckets.d30],
      ['31-60 days overdue', buckets.d60],
      ['61+ days overdue', buckets.d90],
    ];
    const total = Object.values(buckets).reduce((s, b) => s + b.cents, 0);
    if (total > 0) {
      arEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
          ${rows.map(([label, b]) => b.count ? `<tr>
            <td style="padding:7px 0;color:rgba(255,255,255,.6);">${label}</td>
            <td style="padding:7px 0;text-align:right;color:${label.includes('61') ? '#f87171' : label.includes('31') ? '#fb923c' : '#e8e9eb'};font-weight:600;">${money(b.cents/100)}</td>
            <td style="padding:7px 0;text-align:right;color:rgba(255,255,255,.35);padding-left:12px;">${b.count} order${b.count>1?'s':''}</td>
          </tr>` : '').join('')}
          <tr style="border-top:1px solid rgba(255,255,255,.08);">
            <td style="padding:7px 0;font-weight:700;color:#e8e9eb;">Total AR</td>
            <td style="padding:7px 0;text-align:right;font-weight:700;color:#e8e9eb;">${money(total/100)}</td>
            <td></td>
          </tr>
        </table>`;
    } else {
      arEl.innerHTML = '<div class="muted" style="font-size:.85rem;">No outstanding receivables.</div>';
    }
  }
  renderHydrovacInvoiceWorkbench();
}

// Setup wizard
async function maybeShowSetupWizard() {
  if (localStorage.getItem('pl_wizard_dismissed')) return;
  const cfg = SETUP_STATE?.config || {};
  // First time if: no logo, no business hours configured, no customers yet
  const isFirstTime = !cfg.logo_url && (!CUSTOMERS_CACHE || CUSTOMERS_CACHE.length === 0);
  if (!isFirstTime) return;
  showSetupWizard();
}

function showSetupWizard() {
  const existing = document.getElementById('setupWizardModal');
  if (existing) return;
  const modal = document.createElement('div');
  modal.id = 'setupWizardModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:480px;">
    <h2 style="margin:0 0 8px;font-size:1.2rem;">Welcome to ProofLink</h2>
    <p style="color:rgba(255,255,255,.65);margin:0 0 20px;font-size:.9rem;">Let's get your business ready in 3 quick steps so customers can start booking with confidence.</p>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;">
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('setup');" style="text-align:left;padding:14px 16px;">
        <div style="font-weight:600;">1. Set up your business profile</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.55);font-weight:400;">Name, logo, timezone, contact info</div>
      </button>
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('availability');" style="text-align:left;padding:14px 16px;">
        <div style="font-weight:600;">2. Set your availability</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.55);font-weight:400;">Business hours and lead time</div>
      </button>
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('bookings');" style="text-align:left;padding:14px 16px;">
        <div style="font-weight:600;">3. Share your booking link</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.55);font-weight:400;">Get your first customer booked</div>
      </button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <button class="btn btn-ghost" style="font-size:.8rem;" onclick="localStorage.setItem('pl_wizard_dismissed','1');document.getElementById('setupWizardModal')?.remove();">Skip setup</button>
      <button class="btn btn-primary" onclick="document.getElementById('setupWizardModal')?.remove(); switchTab('setup');">Get started</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function boot() {
  if (BOOTING) return;
  if (pendingAuthCallback) return; // Auth callback will handle this
  BOOTING = true;
  window.PROOFLINK_BOOT_READY = false;

  try {
    const user = await refreshSession();
    if (!user) return;

    await requireOperatorContext();

    await Promise.all([
      fetchProducts(),
      fetchCustomers(),
      fetchLeads(),
      fetchCrmOrders(),
      fetchPayments(),
      fetchJobs(),
    ]);
    loadBidDrafts();
    await loadPersistedBids();

    showApp(user);
    applyWorkspaceBlueprint();

    renderProductsList("");
    renderAvailability();
    renderBookings();
    renderExpenses(EXPENSES_CACHE);
    renderPricing([]);
    renderStartupChecklist();
    applyWorkspaceBlueprint();
    renderDashboard();
    renderLeads("");
    renderOrders();
    renderBids("");
    renderJobs("");
    renderPlans("");
    renderCustomersList("");
    renderPayments();
    renderGuidance();
    switchTab(panelFromLocation(), { updateHash: false });

    window.PROOFLINK_BOOT_READY = true;
    startRealtime();
    registerPushNotifications();

    Promise.allSettled([
      fetchExpenses(),
      fetchServicePlans(),
      fetchAvailability(),
      fetchPricing(),
      refreshPicklists(),
      fetchDashboardLaunchChecklist(),
      fetchDashboardPaymentState(),
      fetchOperatorSetup(),
      fetchReviews(),
    ]).then(async (results) => {
      const pricingData = results[3];
      if (pricingData?.status === "fulfilled") {
        renderPricing(pricingData.value || []);
      }
      renderAvailability();
      renderBookings();
      renderExpenses(EXPENSES_CACHE);
      renderStartupChecklist();
      applyWorkspaceBlueprint();
      renderDashboard();
      renderPlans(planSearch?.value || "");
      renderGuidance();
      renderReviews();
      await renderMoney();
      const activeTab = panelFromLocation();
      if (activeTab === "setup") {
        renderSetupPreviewActions?.();
      }
    }).catch(console.warn);
  } catch (err) {
    console.error(err);
    CURRENT_OPERATOR = null;
    window.PROOFLINK_BOOT_READY = false;
    showLogin(err?.message || String(err));
  } finally {
    BOOTING = false;
  }
}

// Invoice PDF

function generateInvoicePDF(order) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) { notifyOperator("The PDF tool is not loaded yet. Refresh and try again."); return; }

  const doc  = new jsPDF({ unit: "pt", format: "letter" });
  const W    = doc.internal.pageSize.getWidth();
  const red  = [200, 75, 47];
  const dark = [26, 26, 26];
  const grey = [100, 100, 100];

  const fmt  = (v) => isNaN(Number(v)) ? "-" : "$" + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const now  = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Header bar
  doc.setFillColor(...red);
  doc.rect(0, 0, W, 48, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("INVOICE", 40, 31);

  // Business name
  const bizName = (CURRENT_OPERATOR?.business_name || CURRENT_OPERATOR?.name || "ProofLink Business").slice(0, 50);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(bizName, W - 40, 28, { align: "right" });

  // Invoice meta
  doc.setTextColor(...dark);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Invoice #", 40, 80);
  doc.text("Date", 40, 96);
  doc.text("Status", 40, 112);

  doc.setFont("helvetica", "normal");
  doc.text(String(order.id || "").slice(0, 8).toUpperCase(), 140, 80);
  doc.text(now, 140, 96);
  doc.text(String(order.status || "new").toUpperCase(), 140, 112);

  // Bill To
  doc.setFont("helvetica", "bold");
  doc.text("Bill To", W - 200, 80);
  doc.setFont("helvetica", "normal");
  doc.text(String(order.customer_name || "-"), W - 200, 96);
  if (order.customer_email) doc.text(order.customer_email, W - 200, 112);

  // Divider
  doc.setDrawColor(220, 220, 210);
  doc.line(40, 130, W - 40, 130);

  // Order title / description
  let y = 152;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...dark);
  doc.text(String(order.title || "Service"), 40, y);
  y += 18;

  if (order.description) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...grey);
    const lines = doc.splitTextToSize(String(order.description), W - 80);
    lines.slice(0, 6).forEach((line) => { doc.text(line, 40, y); y += 13; });
    y += 6;
  }

  // Line items table header
  y += 10;
  doc.setFillColor(244, 241, 236);
  doc.rect(40, y - 13, W - 80, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...dark);
  doc.text("Description", 48, y);
  doc.text("Qty", W - 200, y, { align: "right" });
  doc.text("Unit Price", W - 130, y, { align: "right" });
  doc.text("Amount", W - 40, y, { align: "right" });
  y += 18;

  // Line items
  doc.setFont("helvetica", "normal");
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  if (lineItems.length === 0) {
    doc.text(String(order.title || "Service"), 48, y);
    doc.text("1", W - 200, y, { align: "right" });
    doc.text(fmt(order.total_amount || 0), W - 130, y, { align: "right" });
    doc.text(fmt(order.total_amount || 0), W - 40, y, { align: "right" });
    y += 16;
  } else {
    lineItems.forEach((item) => {
      const qty   = Number(item.quantity || 1);
      const price = Number(item.unit_price || item.price || 0);
      doc.text(String(item.name || item.description || "Item").slice(0, 48), 48, y);
      doc.text(String(qty), W - 200, y, { align: "right" });
      doc.text(fmt(price), W - 130, y, { align: "right" });
      doc.text(fmt(qty * price), W - 40, y, { align: "right" });
      y += 16;
    });
  }

  // Totals
  y += 8;
  doc.setDrawColor(220, 220, 210);
  doc.line(W - 220, y, W - 40, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Total Due", W - 220, y);
  doc.setTextColor(...red);
  doc.text(fmt(order.total_amount || 0), W - 40, y, { align: "right" });

  // Footer
  doc.setTextColor(...grey);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Generated by ProofLink - prooflink.co", W / 2, doc.internal.pageSize.getHeight() - 24, { align: "center" });

  const filename = `invoice-${String(order.id || "order").slice(0, 8)}-${now.replace(/\s/g, "-")}.pdf`;
  doc.save(filename);
}

// Reviews


async function fetchReviews() {
  if (FETCHING.has('reviews')) return;
  FETCHING.add('reviews');
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/get-reviews", {
      headers: { "Authorization": `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { console.warn('[reviews] fetch error:', res.status, d.error); return []; }
    REVIEWS_CACHE = d.reviews || [];
    return REVIEWS_CACHE;
  } catch (e) {
    console.warn("[reviews] fetch failed:", e.message);
    return [];
  } finally {
    FETCHING.delete('reviews');
  }
}

function renderReviews(reviews) {
  const el = $("reviewsList");
  if (!el) return;
  const rows = reviews || REVIEWS_CACHE;
  if (!rows.length) {
    el.innerHTML = `<div class="muted">No reviews yet. Reviews are collected when customers click the review link in their completion email.</div>`;
    return;
  }
  const avgRating = rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length;
  const stars = (n) => "*".repeat(Math.round(n)) + "o".repeat(5 - Math.round(n));
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);">
      <div style="font-size:2rem;color:#fbbf24;">${stars(avgRating)}</div>
      <div>
        <div style="font-size:1.1rem;font-weight:700;">${avgRating.toFixed(1)} average</div>
        <div class="muted" style="font-size:.82rem;">${rows.length} review${rows.length === 1 ? "" : "s"}</div>
      </div>
    </div>
    <div class="list">
      ${rows.map((r) => `
        <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:4px;">
          <div style="display:flex;align-items:center;gap:10px;width:100%;">
            <span style="color:#fbbf24;font-size:1rem;">${stars(Number(r.rating || 0))}</span>
            <strong style="flex:1;">${escapeHtml(r.customer_name || "Anonymous")}</strong>
            <span class="muted" style="font-size:.75rem;">${formatDateOnly(r.created_at)}</span>
          </div>
          ${(r.review_text || r.comment) ? `<div style="font-size:.85rem;color:var(--muted);padding-left:2px;">${escapeHtml(r.review_text || r.comment)}</div>` : ""}
          ${r.order_id ? `<div style="font-size:.75rem;color:var(--muted);">Order: ${escapeHtml(String(r.order_id).slice(0, 8))}</div>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

async function fetchAndRenderReviews() {
  await fetchReviews();
  renderReviews();
}
let MONEY_WORKSPACE_BOUND = false;

function initMoneyWorkspaceBindings() {
  if (MONEY_WORKSPACE_BOUND) return;
  MONEY_WORKSPACE_BOUND = true;

  btnNewExpense?.addEventListener("click", clearExpenseForm);
  btnRefreshExpenses?.addEventListener("click", async () => {
    try {
      renderExpenses(await fetchExpenses());
      await refreshPicklists();
      renderStartupChecklist();
    } catch (err) {
      notifyOperator(err.message || String(err));
    }
  });

  expenseForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (expenseMsg) expenseMsg.textContent = "Saving...";

    const id = expenseId.value || null;
    const selectedJob = JOBS_CACHE.find((row) => row.id === expenseJobId?.value) || null;
    const selectedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (expenseOrderId?.value || selectedJob?.order_id || "")) || null;
    const selectedCustomerId = expenseCustomerId?.value || selectedJob?.customer_id || selectedOrder?.customer_id || "";
    const payload = withTenantScope({
      operator_id: opId(),
      date: expenseDate.value,
      expense_date: expenseDate.value,
      category: preferExisting(expenseCategory.value, PICK_EXPENSE_CATEGORIES),
      vendor: preferExisting(expenseVendor.value, PICK_VENDORS),
      expense_type: normalizeExpenseType(expenseType?.value || "overhead"),
      customer_id: selectedCustomerId || null,
      order_id: selectedOrder?.id || null,
      job_id: selectedJob?.id || null,
      billable: !!expenseBillable?.checked,
      reimbursable: !!expenseReimbursable?.checked,
      used_materials: buildExpenseSupplementalItems(),
      description: expenseDescription.value.trim(),
      notes: expenseNotes?.value?.trim() || expenseDescription.value.trim(),
      amount_cents: toCents(expenseAmount.value),
      updated_at: new Date().toISOString(),
    });

    try {
      const q = id
        ? sb.from("expenses").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
        : sb.from("expenses").insert({ ...payload, created_at: new Date().toISOString() });

      const { error } = await q;
      if (error) throw error;

      if (expenseMsg) expenseMsg.textContent = "Saved.";
      markWorkspaceClean("expenses");
      renderExpenses(await fetchExpenses());
      await refreshPicklists();
      renderStartupChecklist();
      renderJobs(jobSearch?.value || "");
      renderMoney().catch(console.error);
    } catch (err) {
      if (expenseMsg) expenseMsg.textContent = err.message || String(err);
    }
  });

  btnDeleteExpense?.addEventListener("click", async () => {
    if (!expenseId.value) return;
    try {
      const { error } = await sb.from("expenses").delete().eq("id", expenseId.value).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);
      if (error) throw error;
      clearExpenseForm();
      renderExpenses(await fetchExpenses());
      await refreshPicklists();
      renderStartupChecklist();
      renderJobs(jobSearch?.value || "");
      renderMoney().catch(console.error);
    } catch (err) {
      if (expenseMsg) expenseMsg.textContent = err.message || String(err);
    }
  });

  expenseOrderId?.addEventListener("change", () => {
    const order = CRM_ORDERS_CACHE.find((row) => row.id === expenseOrderId.value) || null;
    if (!order) return;
    renderExpenseCustomerOptions(order.customer_id || "");
  });

  expenseJobId?.addEventListener("change", () => {
    const job = JOBS_CACHE.find((row) => row.id === expenseJobId.value) || null;
    const order = linkedOrderForJob(job);
    if (!job) return;
    renderExpenseOrderOptions(order?.id || job.order_id || "");
    renderExpenseCustomerOptions(job.customer_id || order?.customer_id || "");
  });

  expenseType?.addEventListener("change", () => {
    updateExpenseTypeVisibility();
    syncExpenseLaborAmount();
  });

  expenseChangeOrder?.addEventListener("change", updateExpenseTypeVisibility);
  [expenseLaborHours, expenseLaborRate].forEach((el) => {
    el?.addEventListener("input", syncExpenseLaborAmount);
  });

  btnRefreshMoney?.addEventListener("click", () => renderMoney().catch(console.error));
  $("btnRefreshReviews")?.addEventListener("click", () => fetchAndRenderReviews().catch(console.error));
}

const MONEY_WORKSPACE_HELPERS = {
  fetchExpenses,
  buildMoneyCollectionGuidance,
  priorityCollectionOrder,
  buildMoneyCollectionMemory,
  buildMoneyCollectionNextStep,
  renderBillingBlockerQueueReport,
  renderExpenseCustomerOptions,
  renderExpenseOrderOptions,
  renderExpenseJobOptions,
  clearExpenseForm,
  loadExpenseIntoForm,
  openExpenseForJob,
  renderExpenses,
  renderMoney,
  fetchReviews,
  renderReviews,
  fetchAndRenderReviews,
  initMoneyWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_MONEY_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_MONEY_WORKSPACE || {}),
  ...MONEY_WORKSPACE_HELPERS,
};

Object.assign(window, MONEY_WORKSPACE_HELPERS);
