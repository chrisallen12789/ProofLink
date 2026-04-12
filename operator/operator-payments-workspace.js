// Payments workspace extracted from operator.js to keep the manual collection
// flow in one domain-specific module.
(function attachOperatorPaymentsWorkspace(global) {
  const COLLECTIONS_AGENT_STATE = global.PROOFLINK_COLLECTIONS_AGENT_STATE || (global.PROOFLINK_COLLECTIONS_AGENT_STATE = {
    report: null,
    context_summary: null,
    generated_at: "",
  });

  function resolvePaymentContext(options = {}) {
    const customerId = options.customerId ?? paymentCustomerId?.value ?? ACTIVE_CUSTOMER_ID ?? "";
    const orderId = options.orderId ?? paymentOrderId?.value ?? ACTIVE_ORDER_ID ?? "";
    const jobId = options.jobId ?? paymentJobId?.value ?? "";
    const order = CRM_ORDERS_CACHE.find((row) => row.id === orderId) || CRM_ORDERS_CACHE.find((row) => row.customer_id === customerId) || null;
    const customer = CUSTOMERS_CACHE.find((row) => row.id === customerId)
      || CUSTOMERS_CACHE.find((row) => row.id === order?.customer_id)
      || null;
    const job = JOBS_CACHE.find((row) => row.id === jobId) || JOBS_CACHE.find((row) => row.order_id === order?.id) || null;
    return { customer, order, job };
  }

  function buildPaymentContextMessage(options = {}) {
    const blueprint = typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } };
    const { customer, order, job } = resolvePaymentContext(options);
    if (!customer && !order && !job) return "";

    const sharedChecklist = global.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
    const focus = customer && typeof sharedChecklist === "function"
      ? sharedChecklist(customer, blueprint).slice(0, 2).map((item) => `${item.label}: ${item.note}`)
      : [];
    const customerName = customer?.name || order?.customer_name || "this customer";

    const followThrough = buildPaymentFollowThroughMessage({ customer, order, job, blueprint });

    if (focus.length) {
      return `Recording payment for ${customerName}. Keep the follow-through tied to ${focus.join(" | ")}. ${followThrough}`;
    }

    if (order?.payment_due_date) {
      return `Recording payment for ${customerName}. This balance is tied to work due ${formatDateOnly(order.payment_due_date)}. ${followThrough}`;
    }

    if (job?.service_address || job?.address) {
      return `Recording payment for ${customerName}. Keep the service context attached to ${(job.service_address || job.address)} while you follow through. ${followThrough}`;
    }

    return `Recording payment for ${customerName}. ${followThrough}`;
  }

  function buildPaymentFollowThroughMessage({ customer = null, order = null, job = null, blueprint = { business: { key: "service_business" } } } = {}) {
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const dueCents = order ? Number(orderAmountDueCents(order) || 0) : 0;
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";

    if (dueCents > 0) {
      return `If this does not close the full ${formatUsd(dueCents)} balance, keep the next reminder tied to the same order before it ages out.`;
    }

    const tradeMap = {
      landscaping: firstFilled(customer?.seasonal_notes, customer?.follow_up_notes)
        ? `Once this is paid, carry the next property follow-up forward: ${firstFilled(customer?.seasonal_notes, customer?.follow_up_notes)}.`
        : "Once this is paid, turn the next move into the next property visit or seasonal follow-up instead of leaving the account cold.",
      cleaning: firstFilled(customer?.recurring_notes, customer?.add_on_notes)
        ? `Once this is paid, keep the next cleaning visit clear: ${firstFilled(customer?.recurring_notes, customer?.add_on_notes)}.`
        : "Once this is paid, keep the next cleaning cadence or add-on visible so repeat work stays easy.",
      hvac: firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes)
        ? `Once this is paid, keep the next system follow-up visible: ${firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes)}.`
        : "Once this is paid, move the conversation back to maintenance, warranty, or parts follow-through instead of collections.",
      plumbing: firstFilled(customer?.restoration_notes, customer?.follow_up_notes, customer?.approval_notes)
        ? `Once this is paid, keep the repair follow-through visible: ${firstFilled(customer?.restoration_notes, customer?.follow_up_notes, customer?.approval_notes)}.`
        : "Once this is paid, make the next move about repair follow-through, restoration, or the return visit instead of the balance.",
    };

    if (job?.service_address || job?.address) {
      return tradeMap[businessKey] || "Once this is paid, keep the next service step tied to the same job and customer record.";
    }
    return tradeMap[businessKey] || "Once this is paid, keep the next service step tied to the same customer and work record.";
  }

  function buildPaymentSavedMessage(options = {}) {
    const blueprint = options.blueprint || (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } });
    const { customer, order, job } = resolvePaymentContext(options);
    const customerName = customer?.name || order?.customer_name || "this customer";
    const dueCents = order ? Number(orderAmountDueCents(order) || 0) : 0;
    const followThrough = buildPaymentFollowThroughMessage({ customer, order, job, blueprint });
    const bookingsApi = global.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
    const timingInsight = customer && typeof bookingsApi.bookingDraftTimingInsight === "function"
      ? bookingsApi.bookingDraftTimingInsight(customer, {}, blueprint)
      : null;
    if (dueCents > 0) {
      return `Payment saved for ${customerName}. ${formatUsd(dueCents)} still due on this order. ${followThrough}`;
    }
    const nextVisitReason = timingInsight?.reason
      ? ` ${timingInsight.reason}${timingInsight.bookingDate ? ` Suggested next visit: ${timingInsight.bookingDate}.` : ""}`
      : "";
    return `Payment saved for ${customerName}. ${followThrough}${nextVisitReason}`;
  }

  function buildPaymentOutstandingActions(options = {}) {
    const { customer, order } = resolvePaymentContext(options);
    const orderDueCents = order ? Number(orderAmountDueCents(order) || 0) : 0;
    if (!order || orderDueCents <= 0) return [];

    return [
      { label: "Open order balance", action: "open-outstanding-order", className: "btn btn-primary btn-sm" },
      ...(customer ? [{ label: "Open customer", action: "open-reactivation-customer", className: "btn btn-ghost btn-sm" }] : []),
    ];
  }

  function buildPaymentReactivationActions(options = {}) {
    const blueprint = options.blueprint || (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } });
    const { customer, order } = resolvePaymentContext(options);
    if (!customer) return [];

    const orderDueCents = order ? Number(orderAmountDueCents(order) || 0) : 0;
    if (orderDueCents > 0) return [];

    const activeOrderCount = (CRM_ORDERS_CACHE || []).filter((row) => {
      if ((row.customer_id || "") !== customer.id) return false;
      const status = String(row.status || "").trim().toLowerCase();
      return !["cancelled", "completed", "paid", "fulfilled"].includes(status);
    }).length;
    const activeJobCount = (JOBS_CACHE || []).filter((row) => {
      if ((row.customer_id || "") !== customer.id) return false;
      const status = String(row.status || "").trim().toLowerCase();
      return !["cancelled", "completed"].includes(status);
    }).length;
    if (activeOrderCount > 0 || activeJobCount > 0) return [];
    const customerApi = global.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
    if (typeof customerApi.customerRetentionWorkflowActions === "function") {
      return customerApi.customerRetentionWorkflowActions({
        customer,
        blueprint,
        includeSchedule: true,
        includeRequest: true,
        requestAction: "create-request",
        requestLabel: typeof customerApi.customerCreateRequestActionLabel === "function"
          ? customerApi.customerCreateRequestActionLabel(blueprint)
          : undefined,
        includeOpenCustomer: true,
        primaryClassName: "btn btn-primary btn-sm",
        secondaryClassName: "btn btn-ghost btn-sm",
      });
    }
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const scheduleLabelMap = {
      landscaping: "Schedule next property visit",
      property_maintenance: "Schedule next site visit",
      pressure_washing: "Schedule next wash visit",
      cleaning: "Schedule next cleaning visit",
      hvac: "Schedule next system visit",
      plumbing: "Schedule next follow-up visit",
    };
    const requestLabelMap = {
      landscaping: "Draft seasonal follow-up request",
      property_maintenance: "Draft site follow-up request",
      pressure_washing: "Draft wash follow-up request",
      cleaning: "Draft cleaning follow-up request",
      hvac: "Draft maintenance follow-up request",
      plumbing: "Draft repair follow-up request",
    };
    return [
      { label: scheduleLabelMap[businessKey] || "Schedule next visit", action: "reactivate-repeat", className: "btn btn-primary btn-sm" },
      { label: (requestLabelMap[businessKey] || "Create follow-up request").replace(/^Draft\b/, "Create"), action: "create-request", className: "btn btn-ghost btn-sm" },
      { label: "Open customer", action: "open-reactivation-customer", className: "btn btn-ghost btn-sm" },
    ];
  }

  function ensurePaymentNextActionsHost() {
    if (!paymentMsg || typeof document === "undefined") return null;
    const parent = paymentMsg.parentElement;
    if (!parent) return null;
    let host = parent.querySelector?.("#paymentNextActions") || null;
    if (!host && typeof document.createElement === "function") {
      host = document.createElement("div");
      host.id = "paymentNextActions";
      host.className = "action-row action-row--wrap u-mt-10 hidden";
      if (typeof paymentMsg.insertAdjacentElement === "function") {
        paymentMsg.insertAdjacentElement("afterend", host);
      } else if (typeof parent.appendChild === "function") {
        parent.appendChild(host);
      }
    }
    return host;
  }

  function clearPaymentNextActions() {
    const host = ensurePaymentNextActionsHost();
    if (!host) return;
    host.innerHTML = "";
    host.className = "action-row action-row--wrap u-mt-10 hidden";
  }

  function renderPaymentNextActions(options = {}) {
    const host = ensurePaymentNextActionsHost();
    if (!host) return;
    const blueprint = options.blueprint || (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } });
    const outstandingActions = buildPaymentOutstandingActions(options);
    const actions = outstandingActions.length ? outstandingActions : buildPaymentReactivationActions(options);
    const { customer, order } = resolvePaymentContext(options);
    const orderDueCents = order ? Number(orderAmountDueCents(order) || 0) : 0;
    const bookingsApi = global.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
    const timingInsight = customer && typeof bookingsApi.bookingDraftTimingInsight === "function"
      ? bookingsApi.bookingDraftTimingInsight(customer, {}, blueprint)
      : null;
    if (!actions.length) {
      clearPaymentNextActions();
      return;
    }
    host.className = "action-row action-row--wrap u-mt-10";
    host.innerHTML = `
      ${orderDueCents > 0 ? `<div class="detail-copy u-flex-full">${escapeHtml(`Balance still open: ${formatUsd(orderDueCents)} due on this order.`)}</div>` : ""}
      ${timingInsight?.reason ? `<div class="detail-copy u-flex-full">${escapeHtml(`Why now: ${timingInsight.reason}${timingInsight.bookingDate ? ` Suggested next visit: ${timingInsight.bookingDate}.` : ""}`)}</div>` : ""}
      ${actions.map((action) => `
      <button type="button" class="${escapeAttr(action.className || "btn btn-ghost btn-sm")}" data-payment-reactivation-action="${escapeAttr(action.action || "")}">
        ${escapeHtml(action.label || "Take action")}
      </button>
      `).join("")}
    `;

    host.querySelectorAll?.("[data-payment-reactivation-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-payment-reactivation-action");
        const { customer, order, job } = resolvePaymentContext(options);

        if (action === "open-outstanding-order") {
          if (!order?.id) return;
          ACTIVE_ORDER_ID = order.id;
          if (typeof renderOrders === "function") renderOrders();
          if (typeof switchTab === "function") switchTab("orders");
          return;
        }

        if (!customer) return;

        if (action === "open-reactivation-customer" || action === "reactivate-repeat" || action === "request" || action === "create-request" || action === "generate-next-order") {
          const customerApi = global.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
          if (typeof customerApi.openCustomerRetentionAction === "function") {
            customerApi.openCustomerRetentionAction(action, customer, blueprint, {
              requestOptions: {
                message: action === "create-request" ? "Follow-up request created from the payment flow." : "Follow-up request draft opened from the payment flow.",
                successMessage: "Follow-up request created from the payment flow.",
                pendingMessage: "Creating follow-up request from the payment flow...",
                sourceRecordType: "payment",
                sourceRecordId: order?.id || job?.id || customer.id || "",
              },
            });
            if (action === "open-reactivation-customer") {
              renderCustomerDetail(customer.id).catch(console.error);
            }
            return;
          }
          if (action === "open-reactivation-customer") {
            ACTIVE_CUSTOMER_ID = customer.id;
            switchTab("customers");
            renderCustomerDetail(customer.id).catch(console.error);
            return;
          }
          if (action === "reactivate-repeat") {
            const bookingsApi = global.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
            if (typeof bookingsApi.openBookingDraftForCustomer === "function") {
              bookingsApi.openBookingDraftForCustomer(customer, {}, blueprint);
              return;
            }
            ACTIVE_CUSTOMER_ID = customer.id;
            switchTab("bookings");
          }
        }
      });
    });
  }

  function paymentAgentStatusTone(status) {
    if (status === "ready") return "pill-good";
    if (status === "blocked") return "pill-bad";
    return "pill-warn";
  }

  function paymentAgentPriorityTone(priority) {
    if (priority === "high") return "pill-bad";
    if (priority === "low") return "";
    return "pill-warn";
  }

  function collectionsQueueRecordRef(item = {}, recordType = "") {
    return (Array.isArray(item.record_refs) ? item.record_refs : []).find((ref) => ref && ref.record_type === recordType && ref.record_id) || null;
  }

  function openCollectionsQueueOrder(orderId) {
    if (!orderId) return;
    ACTIVE_ORDER_ID = orderId;
    if (typeof renderOrders === "function") renderOrders();
    if (typeof switchTab === "function") switchTab("orders");
  }

  function openCollectionsQueueCustomer(customerId) {
    if (!customerId) return;
    ACTIVE_CUSTOMER_ID = customerId;
    if (typeof switchTab === "function") switchTab("customers");
    if (typeof renderCustomerDetail === "function") {
      renderCustomerDetail(customerId).catch?.(console.error);
    }
  }

  function seedPaymentFormFromCollectionsQueue(orderId = "", customerId = "") {
    ACTIVE_ORDER_ID = orderId || ACTIVE_ORDER_ID || "";
    ACTIVE_CUSTOMER_ID = customerId || ACTIVE_CUSTOMER_ID || "";
    clearPaymentForm({
      customerId: customerId || "",
      orderId: orderId || "",
      title: "Record payment",
    });
    applyPaymentContextMessage({
      customerId: customerId || "",
      orderId: orderId || "",
      jobId: paymentJobId?.value || "",
    });
  }

  function renderCollectionsFollowUpReport(state = COLLECTIONS_AGENT_STATE) {
    const report = state?.report || null;
    if (!report) {
      return `<div class="detail-copy">Run the collections review to separate genuinely overdue balances from general open balances, then work from grounded order and invoice records instead of guesswork.</div>`;
    }

    const findings = Array.isArray(report.findings) ? report.findings : [];
    const blockers = Array.isArray(report.blockers) ? report.blockers : [];
    const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
    const missingData = Array.isArray(report.missing_data) ? report.missing_data : [];
    const dataUsed = Array.isArray(report.data_used) ? report.data_used.filter((item) => item && item.count > 0) : [];
    const contextSummary = state?.context_summary || {};
    const generatedAt = report.generated_at || state?.generated_at || new Date().toISOString();

    return `
      <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
      <div class="workspace-chip-row u-mt-10">
        <span class="pill ${paymentAgentStatusTone(report.summary_status || "review_needed")}">${escapeHtml(titleCaseWords(String(report.summary_status || "review needed").replace(/_/g, " ")))}</span>
        ${contextSummary.queue_length ? `<span class="pill ${contextSummary.overdue_count ? "pill-warn" : "pill-good"}">${escapeHtml(`${contextSummary.queue_length} in queue`)}</span>` : ""}
        ${contextSummary.overdue_count ? `<span class="pill pill-bad">${escapeHtml(`${contextSummary.overdue_count} overdue`)}</span>` : ""}
        ${contextSummary.missing_due_dates ? `<span class="pill pill-warn">${escapeHtml(`${contextSummary.missing_due_dates} missing due date${contextSummary.missing_due_dates === 1 ? "" : "s"}`)}</span>` : ""}
        ${report.confidence?.label ? `<span class="pill">${escapeHtml(`Confidence ${report.confidence.label}`)}</span>` : ""}
      </div>
      ${blockers.length ? `
        <div class="memory-checklist u-mt-10">
          ${blockers.slice(0, 2).map((item) => `
            <div class="memory-checklist__item memory-checklist__item--warn">
              <div class="memory-checklist__title">${escapeHtml(item.title || "Collections blocker")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
            </div>
          `).join("")}
        </div>
      ` : `<div class="detail-copy u-mt-10">No overdue blocker is currently open in this review.</div>`}
      ${findings.length ? `
        <div class="detail-copy u-mt-10"><strong>Collections queue</strong></div>
        <div class="memory-checklist u-mt-10">
          ${findings.slice(0, 6).map((item) => {
            const orderRef = collectionsQueueRecordRef(item, "order");
            const customerRef = collectionsQueueRecordRef(item, "customer");
            return `
              <div class="memory-checklist__item ${item.severity === "critical" || item.severity === "warning" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
                <div class="memory-checklist__title">${escapeHtml(item.title || "Queue item")}</div>
                <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
                <div class="action-row action-row--wrap u-mt-10">
                  ${orderRef?.record_id ? `<button type="button" class="btn btn-primary btn-sm" data-collections-record-payment="${escapeAttr(orderRef.record_id)}" data-collections-customer-id="${escapeAttr(customerRef?.record_id || "")}">Record payment</button>` : ``}
                  ${orderRef?.record_id ? `<button type="button" class="btn btn-ghost btn-sm" data-collections-open-order="${escapeAttr(orderRef.record_id)}">Open order</button>` : ``}
                  ${customerRef?.record_id ? `<button type="button" class="btn btn-ghost btn-sm" data-collections-open-customer="${escapeAttr(customerRef.record_id)}">Open customer</button>` : ``}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      ` : ""}
      ${actions.length ? `
        <div class="detail-copy u-mt-10"><strong>Recommended actions</strong></div>
        <div class="workspace-chip-row">
          ${actions.slice(0, 3).map((action) => `<span class="pill ${paymentAgentPriorityTone(action.priority || "medium")}">${escapeHtml(titleCaseWords(String(action.priority || "medium")))} priority</span>`).join("")}
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
      ${missingData.length ? `
        <div class="detail-copy u-mt-10"><strong>Missing data</strong></div>
        <div class="detail-copy">${escapeHtml(missingData.slice(0, 3).map((item) => item.label || item.detail || "").join(" | "))}</div>
      ` : ""}
      ${dataUsed.length ? `
        <div class="detail-copy u-mt-10"><strong>Data used</strong></div>
        <div class="workspace-chip-row">
          ${dataUsed.slice(0, 4).map((item) => `<span class="pill">${escapeHtml(`${item.label}: ${item.count}`)}</span>`).join("")}
        </div>
      ` : ""}
      <div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(formatDateTime(generatedAt))}</div>
    `;
  }

  function bindCollectionsQueueActions() {
    paymentsList.querySelectorAll?.("[data-collections-open-order]").forEach((button) => {
      button.addEventListener("click", () => openCollectionsQueueOrder(button.getAttribute("data-collections-open-order") || ""));
    });
    paymentsList.querySelectorAll?.("[data-collections-open-customer]").forEach((button) => {
      button.addEventListener("click", () => openCollectionsQueueCustomer(button.getAttribute("data-collections-open-customer") || ""));
    });
    paymentsList.querySelectorAll?.("[data-collections-record-payment]").forEach((button) => {
      button.addEventListener("click", () => {
        seedPaymentFormFromCollectionsQueue(
          button.getAttribute("data-collections-record-payment") || "",
          button.getAttribute("data-collections-customer-id") || ""
        );
      });
    });
    paymentsList.querySelector?.("#btnRunCollectionsReview")?.addEventListener("click", async () => {
      const statusEl = paymentsList.querySelector?.("#paymentsCollectionsAgentMsg") || null;
      setInlineMessage(statusEl, "Reviewing collections queue...");
      try {
        const payload = await requestOperatorFunction("ai-agent-report", {
          method: "POST",
          body: {
            agent_key: "collections_followup_assistant",
          },
        });
        COLLECTIONS_AGENT_STATE.report = payload?.report || null;
        COLLECTIONS_AGENT_STATE.context_summary = payload?.context_summary || null;
        COLLECTIONS_AGENT_STATE.generated_at = payload?.generated_at || payload?.report?.generated_at || "";
        renderPayments();
        const freshStatusEl = paymentsList.querySelector?.("#paymentsCollectionsAgentMsg") || null;
        setInlineMessage(
          freshStatusEl,
          COLLECTIONS_AGENT_STATE.context_summary?.overdue_count
            ? "Collections review refreshed."
            : "Collections review refreshed with no overdue balances flagged.",
          COLLECTIONS_AGENT_STATE.context_summary?.overdue_count ? "warn" : "ok"
        );
      } catch (error) {
        setInlineMessage(statusEl, error.message || String(error), "error");
      }
    });
    paymentsList.querySelector?.("#btnOpenCollectionsFirst")?.addEventListener("click", () => {
      const firstFinding = COLLECTIONS_AGENT_STATE.report?.findings?.[0] || null;
      const orderRef = collectionsQueueRecordRef(firstFinding || {}, "order");
      const customerRef = collectionsQueueRecordRef(firstFinding || {}, "customer");
      if (orderRef?.record_id) {
        seedPaymentFormFromCollectionsQueue(orderRef.record_id, customerRef?.record_id || "");
      }
    });
  }

  function applyPaymentContextMessage(options = {}) {
    const message = buildPaymentContextMessage(options);
    if (!message) {
      setInlineMessage(paymentMsg, "");
      return;
    }
    setInlineMessage(paymentMsg, message);
  }

  function renderPaymentCustomerOptions(selectedCustomerId = "") {
    if (!paymentCustomerId) return;
    const options = sortedCustomers(CUSTOMERS_CACHE);
    paymentCustomerId.innerHTML = `
      <option value="">No linked customer yet</option>
      ${options.map((customer) => `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || customer.phone || "Customer")}</option>`).join("")}
    `;
    paymentCustomerId.value = options.some((customer) => customer.id === selectedCustomerId) ? selectedCustomerId : "";
  }

  function renderPaymentOrderOptions(selectedCustomerId = "", selectedOrderId = "") {
    if (!paymentOrderId) return;
    const rows = [...CRM_ORDERS_CACHE]
      .filter((order) => !selectedCustomerId || order.customer_id === selectedCustomerId)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    paymentOrderId.innerHTML = `
      <option value="">No linked order</option>
      ${rows.map((order) => {
        const customer = CUSTOMERS_CACHE.find((row) => row.id === order.customer_id);
        const scheduled = order.scheduled_date || getScheduledDateFromOrder(order) || "No date";
        const label = `${customer?.name || order.customer_name || "Customer"} | ${String(order.status || "new")} | ${String(scheduled)}`;
        return `<option value="${escapeAttr(order.id)}">${escapeHtml(label)}</option>`;
      }).join("")}
    `;
    paymentOrderId.value = rows.some((order) => order.id === selectedOrderId) ? selectedOrderId : "";
  }

  function clearPaymentForm(options = {}) {
    const preferredOrder = CRM_ORDERS_CACHE.find((row) => row.id === (options.orderId || ACTIVE_ORDER_ID)) || null;
    const defaultCustomerId = options.customerId ?? ACTIVE_CUSTOMER_ID ?? preferredOrder?.customer_id ?? "";
    const defaultOrderId = options.orderId ?? (preferredOrder?.customer_id === defaultCustomerId ? preferredOrder?.id || "" : "");

    ACTIVE_PAYMENT_ID = null;
    if (paymentFormTitle) paymentFormTitle.textContent = options.title || "Record payment";
    if (paymentId) paymentId.value = "";
    if (paymentJobId) paymentJobId.value = options.jobId || "";
    renderPaymentCustomerOptions(defaultCustomerId);
    renderPaymentOrderOptions(defaultCustomerId, defaultOrderId);
    if (paymentMode) paymentMode.value = options.mode || "cash";
    if (paymentStatus) paymentStatus.value = options.status || "paid";
    if (paymentAmount) paymentAmount.value = options.amount || "";
    if (paymentPaidAt) paymentPaidAt.value = options.paidAt || toDateTimeLocalValue(new Date().toISOString());
    if (paymentReference) paymentReference.value = options.reference || "";
    if (paymentNote) paymentNote.value = options.note || "";
    clearPaymentNextActions();
    applyPaymentContextMessage({
      customerId: defaultCustomerId,
      orderId: defaultOrderId,
      jobId: options.jobId || "",
    });
  }

  function loadPaymentIntoForm(payment) {
    if (!payment || !isManualPaymentRecord(payment)) return;
    ACTIVE_PAYMENT_ID = payment.id;
    if (paymentFormTitle) paymentFormTitle.textContent = "Edit manual payment";
    if (paymentId) paymentId.value = payment.id || "";
    if (paymentJobId) paymentJobId.value = payment.job_id || "";
    renderPaymentCustomerOptions(payment.customer_id || "");
    renderPaymentOrderOptions(payment.customer_id || "", payment.order_id || "");
    if (paymentMode) paymentMode.value = payment.payment_mode || "cash";
    if (paymentStatus) paymentStatus.value = payment.status || "paid";
    if (paymentAmount) paymentAmount.value = money(paymentAmountCents(payment));
    if (paymentPaidAt) paymentPaidAt.value = toDateTimeLocalValue(payment.paid_at || payment.created_at || payment.updated_at);
    if (paymentReference) paymentReference.value = payment.metadata?.reference || "";
    if (paymentNote) paymentNote.value = payment.metadata?.note || "";
    applyPaymentContextMessage({
      customerId: payment.customer_id || "",
      orderId: payment.order_id || "",
      jobId: payment.job_id || "",
    });
    renderPaymentNextActions({
      customerId: payment.customer_id || "",
      orderId: payment.order_id || "",
      jobId: payment.job_id || "",
    });
  }

  function renderPayments() {
    if (!paymentsList) return;
    renderMoneyWorkspace();
    if (paymentId?.value) {
      renderPaymentCustomerOptions(paymentCustomerId?.value || "");
      renderPaymentOrderOptions(paymentCustomerId?.value || "", paymentOrderId?.value || "");
    } else {
      clearPaymentForm({ customerId: paymentCustomerId?.value || ACTIVE_CUSTOMER_ID || "" });
    }

    const rows = sortedPayments(PAYMENTS_CACHE);
    paymentsList.innerHTML = `
      <div class="detail-card detail-card--spaced">
        <div class="kicker">Collections review</div>
        <div><strong>Collections / Follow-up Assistant</strong></div>
        <div class="action-row action-row--wrap u-mt-10">
          <button type="button" class="btn btn-ghost btn-sm" id="btnRunCollectionsReview">${COLLECTIONS_AGENT_STATE.report ? "Refresh collections review" : "Run collections review"}</button>
          ${COLLECTIONS_AGENT_STATE.report?.findings?.length ? `<button type="button" class="btn btn-ghost btn-sm" id="btnOpenCollectionsFirst">Load first balance into payment form</button>` : ``}
        </div>
        <div id="paymentsCollectionsAgentMsg" class="msg u-mt-10"></div>
        <div id="paymentsCollectionsAgentReport" class="u-mt-10">
          ${renderCollectionsFollowUpReport(COLLECTIONS_AGENT_STATE)}
        </div>
      </div>
      ${rows.length ? "" : `<div class="muted">No payments recorded yet. Record a deposit, final payment, or manual collection to see it here.</div>`}
    `;

    rows.forEach((p) => {
      const customer = CUSTOMERS_CACHE.find((c) => c.id === p.customer_id);
      const order = CRM_ORDERS_CACHE.find((o) => o.id === p.order_id);
      const ref = p.metadata?.reference ? ` | Ref ${String(p.metadata.reference)}` : "";

      const el = document.createElement("button");
      el.type = "button";
      el.className = `list-item ${ACTIVE_PAYMENT_ID === p.id ? "is-active" : ""}`;
      el.innerHTML = `
        <div class="li-main">
          <div class="li-title">${escapeHtml(customer?.name || "Unlinked payment")}</div>
          <div class="li-sub muted">${escapeHtml(formatPaymentMode(p.payment_mode))} &middot; ${escapeHtml(formatDateTime(p.paid_at || p.created_at || p.updated_at))}${escapeHtml(ref)}</div>
          <div class="li-sub muted">${escapeHtml(order ? `Order ${String(order.status || "new")}` : "No linked order")} &middot; ${escapeHtml(String(p.source || "manual"))}</div>
        </div>
        <div class="li-meta">
          <span class="pill">${escapeHtml(String(p.status || "pending"))}</span>
          <span class="pill pill-on">${formatUsd(paymentAmountCents(p))}</span>
        </div>
      `;
      el.addEventListener("click", () => {
        if (!isManualPaymentRecord(p)) {
          ACTIVE_PAYMENT_ID = null;
          renderPayments();
          setInlineMessage(paymentMsg, "Online payments stay read-only here. Use this form for cash, check, or other manual collections.", "error");
          return;
        }

        loadPaymentIntoForm(p);
        renderPayments();
      });
      paymentsList.appendChild(el);
    });
    bindCollectionsQueueActions();
  }

  paymentCustomerId?.addEventListener("change", () => {
    renderPaymentOrderOptions(paymentCustomerId.value || "", paymentOrderId?.value || "");
    applyPaymentContextMessage({
      customerId: paymentCustomerId.value || "",
      orderId: paymentOrderId?.value || "",
      jobId: paymentJobId?.value || "",
    });
  });

  paymentOrderId?.addEventListener("change", () => {
    const order = CRM_ORDERS_CACHE.find((row) => row.id === paymentOrderId.value);
    if (order?.customer_id) {
      renderPaymentCustomerOptions(order.customer_id);
      if (paymentCustomerId) paymentCustomerId.value = order.customer_id;
      renderPaymentOrderOptions(order.customer_id, order.id);
    }
    applyPaymentContextMessage({
      customerId: paymentCustomerId?.value || order?.customer_id || "",
      orderId: paymentOrderId.value || "",
      jobId: paymentJobId?.value || "",
    });
  });

  btnNewPayment?.addEventListener("click", () => {
    clearPaymentForm();
    renderPayments();
  });

  paymentForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setInlineMessage(paymentMsg, "Saving...");

    const id = paymentId?.value || null;
    const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (paymentOrderId?.value || ""));
    const resolvedCustomerId = paymentCustomerId?.value || linkedOrder?.customer_id || null;
    const amountCents = toCents(paymentAmount?.value || 0);
    if (!amountCents) {
      setInlineMessage(paymentMsg, "Enter a payment amount greater than zero.", "error");
      return;
    }

    // Warn if amount exceeds the amount still due on the linked order
    if (linkedOrder && !id) {
      const dueCents = orderAmountDueCents(linkedOrder);
      if (dueCents > 0 && amountCents > dueCents) {
        const due = formatCurrency(dueCents / 100);
        const entered = formatCurrency(amountCents / 100);
        const confirmed = window.confirm(`The entered amount (${entered}) exceeds the amount due (${due}). Record this payment anyway?`);
        if (!confirmed) return;
      }
    }

    const nowIso = new Date().toISOString();
    const payload = withTenantScope({
      operator_id: opId(),
      customer_id: resolvedCustomerId,
      order_id: paymentOrderId?.value || null,
      job_id: paymentJobId?.value || null,
      payment_mode: paymentMode?.value || "manual_other",
      status: paymentStatus?.value || "paid",
      amount_subtotal: amountCents,
      amount_total: amountCents,
      currency: "usd",
      source: "manual",
      metadata: {
        reference: paymentReference?.value?.trim() || null,
        note: paymentNote?.value?.trim() || null,
        recorded_via: "operator_console",
      },
      paid_at: toIsoDateTime(paymentPaidAt?.value) || null,
      updated_at: nowIso,
    });

    try {
      if (id) {
        const existing = PAYMENTS_CACHE.find((row) => row.id === id);
        if (!isManualPaymentRecord(existing)) throw new Error("Only manual payment records can be edited here.");
      }

      const query = id
        ? sb.from("payments").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
        : sb.from("payments").insert({ ...payload, created_at: nowIso });

      const { data, error } = await query.select("*").single();
      if (error) throw error;

      ACTIVE_PAYMENT_ID = data.id;
      await Promise.all([
        fetchPayments({ refresh: true }),
        fetchCustomers({ refresh: true }),
        fetchCrmOrders({ refresh: true }),
        fetchJobs({ refresh: true }),
      ]);
      const fresh = PAYMENTS_CACHE.find((row) => row.id === data.id) || data;
      loadPaymentIntoForm(fresh);

      // Sync payment totals/state to the database so record views stay aligned
      const syncOrderId = data.order_id || payload.order_id;
      if (syncOrderId) {
        const freshOrder = CRM_ORDERS_CACHE.find((o) => o.id === syncOrderId);
        if (freshOrder) {
          const computedPaid = PAYMENTS_CACHE
            .filter((payment) => payment.order_id === syncOrderId)
            .reduce((sum, payment) => sum + Math.max(0, paymentRevenueContributionCents(payment)), 0);
          const computedDue = Math.max(orderTotalCents(freshOrder) - computedPaid, 0);
          let newState = "unpaid";
          if (computedDue <= 0 && computedPaid > 0) newState = "paid";
          else if (computedPaid > 0 && computedDue > 0) newState = "partially_paid";
          else {
            const dueDate = freshOrder?.payment_due_date ? new Date(freshOrder.payment_due_date) : null;
            if (computedDue > 0 && dueDate && !Number.isNaN(dueDate.getTime()) && dueDate < new Date()) {
              newState = "overdue";
            }
          }
          try {
            const { error: paymentStateError } = await sb.from("orders")
              .update({
                payment_state: newState,
                amount_paid_cents: computedPaid,
                amount_due_cents: computedDue,
                updated_at: new Date().toISOString(),
              })
              .eq("id", syncOrderId)
              .eq(TENANT_COLUMN, TENANT_ID);
            if (paymentStateError) {
              console.warn("[payments] order payment sync failed:", paymentStateError.message);
            } else {
              CRM_ORDERS_CACHE = (CRM_ORDERS_CACHE || []).map((order) => (
                order?.id === syncOrderId
                  ? {
                      ...order,
                      payment_state: newState,
                      amount_paid_cents: computedPaid,
                      amount_due_cents: computedDue,
                      updated_at: new Date().toISOString(),
                    }
                  : order
              ));
              JOBS_CACHE = (JOBS_CACHE || []).map((job) => (
                job?.order_id === syncOrderId
                  ? {
                      ...job,
                      payment_state: newState,
                      amount_paid_cents: computedPaid,
                      amount_due_cents: computedDue,
                      updated_at: new Date().toISOString(),
                    }
                  : job
              ));
              await Promise.allSettled([
                sb.from("jobs")
                  .update({
                    payment_state: newState,
                    amount_paid_cents: computedPaid,
                    amount_due_cents: computedDue,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("order_id", syncOrderId)
                  .eq(TENANT_COLUMN, TENANT_ID),
              ]);
              await Promise.all([
                fetchCrmOrders({ refresh: true }),
                fetchJobs({ refresh: true }),
              ]);
            }
          } catch (e) {
            console.warn("[payments] order payment sync failed:", e.message);
          }
        }
      }

      renderPayments();
      renderOrders();
      renderJobs(jobSearch?.value || "");
      renderCustomersList(customerSearch?.value || "");
      renderDashboard();
      renderMoney().catch(console.error);
      renderGuidance();
      if (ACTIVE_CUSTOMER_ID) renderCustomerDetail(ACTIVE_CUSTOMER_ID).catch(console.error);
      markWorkspaceClean("payments");
      const savedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (data.order_id || payload.order_id || "")) || null;
      const savedCustomer = CUSTOMERS_CACHE.find((row) => row.id === (data.customer_id || payload.customer_id || savedOrder?.customer_id || "")) || null;
      const savedJob = JOBS_CACHE.find((row) => row.id === (data.job_id || payload.job_id || "")) || JOBS_CACHE.find((row) => row.order_id === savedOrder?.id) || null;
      setInlineMessage(paymentMsg, buildPaymentSavedMessage({
        customerId: savedCustomer?.id || "",
        orderId: savedOrder?.id || "",
        jobId: savedJob?.id || "",
        blueprint: typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } },
      }), "ok");
      renderPaymentNextActions({
        customerId: savedCustomer?.id || "",
        orderId: savedOrder?.id || "",
        jobId: savedJob?.id || "",
        blueprint: typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } },
      });
    } catch (err) {
      clearPaymentNextActions();
      setInlineMessage(paymentMsg, err.message || String(err), "error");
    }
  });

  const helpers = {
    resolvePaymentContext,
    buildPaymentContextMessage,
    buildPaymentFollowThroughMessage,
    buildPaymentSavedMessage,
    buildPaymentOutstandingActions,
    buildPaymentReactivationActions,
    renderCollectionsFollowUpReport,
    applyPaymentContextMessage,
    renderPaymentNextActions,
    renderPaymentCustomerOptions,
    renderPaymentOrderOptions,
    clearPaymentForm,
    loadPaymentIntoForm,
    renderPayments,
  };

  global.PROOFLINK_OPERATOR_PAYMENTS = {
    ...(global.PROOFLINK_OPERATOR_PAYMENTS || {}),
    ...helpers,
  };
  Object.assign(global, helpers);
})(window);
