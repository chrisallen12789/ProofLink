// Payments workspace extracted from operator.js to keep the manual collection
// flow in one domain-specific module.
(function attachOperatorPaymentsWorkspace(global) {
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
    const followThrough = buildPaymentFollowThroughMessage({ customer, order, job, blueprint });
    return `Payment saved for ${customerName}. ${followThrough}`;
  }

  function buildPaymentReactivationActions(options = {}) {
    const blueprint = options.blueprint || (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } });
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const { customer, order } = resolvePaymentContext(options);
    if (!customer) return [];

    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const repeatSignal = firstFilled(
      customer?.service_schedule,
      customer?.frequency,
      customer?.recurring_notes,
      customer?.service_plan_name,
      customer?.maintenance_notes,
      customer?.seasonal_notes,
      customer?.follow_up_notes
    );
    if (!repeatSignal) return [];

    const nextTouch = firstFilled(
      customer?.next_service_on,
      customer?.service_plan_name,
      customer?.follow_up_notes
    );
    if (nextTouch) return [];

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

    const scheduleLabelMap = {
      landscaping: "Schedule next property visit",
      property_maintenance: "Schedule next site visit",
      pressure_washing: "Schedule next wash visit",
      cleaning: "Schedule next cleaning visit",
      hvac: "Schedule next system visit",
      plumbing: "Schedule next follow-up visit",
    };

    return [
      { label: scheduleLabelMap[businessKey] || "Schedule next visit", action: "reactivate-repeat", className: "btn btn-primary btn-sm" },
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
    const actions = buildPaymentReactivationActions(options);
    if (!actions.length) {
      clearPaymentNextActions();
      return;
    }
    host.className = "action-row action-row--wrap u-mt-10";
    host.innerHTML = actions.map((action) => `
      <button type="button" class="${escapeAttr(action.className || "btn btn-ghost btn-sm")}" data-payment-reactivation-action="${escapeAttr(action.action || "")}">
        ${escapeHtml(action.label || "Take action")}
      </button>
    `).join("");

    host.querySelectorAll?.("[data-payment-reactivation-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-payment-reactivation-action");
        const { customer, order, job } = resolvePaymentContext(options);
        if (!customer) return;

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
      });
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
    paymentsList.innerHTML = rows.length ? "" : `<div class="muted">No payments recorded yet. Record a deposit, final payment, or manual collection to see it here.</div>`;

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
      await Promise.all([fetchPayments(), fetchCustomers(), fetchCrmOrders(), fetchJobs()]);
      const fresh = PAYMENTS_CACHE.find((row) => row.id === data.id) || data;
      loadPaymentIntoForm(fresh);

      // Sync payment_state to the database so it's accurate outside the UI cache
      const syncOrderId = data.order_id || payload.order_id;
      if (syncOrderId) {
        const freshOrder = CRM_ORDERS_CACHE.find((o) => o.id === syncOrderId);
        if (freshOrder) {
          const newState = orderPaymentState(freshOrder);
          sb.from("orders")
            .update({ payment_state: newState, updated_at: new Date().toISOString() })
            .eq("id", syncOrderId)
            .eq(TENANT_COLUMN, TENANT_ID)
            .then(() => {})
            .catch((e) => console.warn("[payments] order payment_state sync failed:", e.message));
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
    buildPaymentReactivationActions,
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
