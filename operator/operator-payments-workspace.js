// Payments workspace extracted from operator.js to keep the manual collection
// flow in one domain-specific module.
(function attachOperatorPaymentsWorkspace(global) {
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
    if (paymentFormTitle) paymentFormTitle.textContent = options.title || "Manual payment entry";
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
    setInlineMessage(paymentMsg, "");
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
    setInlineMessage(paymentMsg, "Editing a manual payment record.");
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
    paymentsList.innerHTML = rows.length ? "" : `<div class="muted">No payments recorded yet. Collect a deposit or close a job to see it here.</div>`;

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
          setInlineMessage(paymentMsg, "Stripe-created payment records are read-only here. Use this form for manual collections.", "error");
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
  });

  paymentOrderId?.addEventListener("change", () => {
    const order = CRM_ORDERS_CACHE.find((row) => row.id === paymentOrderId.value);
    if (order?.customer_id) {
      renderPaymentCustomerOptions(order.customer_id);
      if (paymentCustomerId) paymentCustomerId.value = order.customer_id;
      renderPaymentOrderOptions(order.customer_id, order.id);
    }
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
      renderPayments();
      renderOrders();
      renderJobs(jobSearch?.value || "");
      renderCustomersList(customerSearch?.value || "");
      renderDashboard();
      renderMoney().catch(console.error);
      renderGuidance();
      if (ACTIVE_CUSTOMER_ID) renderCustomerDetail(ACTIVE_CUSTOMER_ID).catch(console.error);
      markWorkspaceClean("payments");
      setInlineMessage(paymentMsg, "Payment saved.", "ok");
    } catch (err) {
      setInlineMessage(paymentMsg, err.message || String(err), "error");
    }
  });

  const helpers = {
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
