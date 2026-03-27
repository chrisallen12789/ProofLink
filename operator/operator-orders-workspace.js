// Order workspace extracted from operator.js so list rendering, detail actions,
// and follow-through behavior stay together in one domain module.
function renderOrders() {
  if (!ordersList) return;
  renderPipelineWorkspace();
  const rows = Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];
  const statusOptions = ["new", "quoted", "confirmed", "fulfilled", "completed", "paid", "cancelled"];

  if (!rows.length) {
    ordersList.innerHTML = `<div class="muted">No active work. When you convert a request to a job, it shows up here.</div>`;
    if (orderDetailWrap) orderDetailWrap.innerHTML = `<div class="muted">Select quoted or booked work to inspect it.</div>`;
    return;
  }

  if (!ACTIVE_ORDER_ID) ACTIVE_ORDER_ID = rows[0].id;
  const active = rows.find((x) => x.id === ACTIVE_ORDER_ID) || rows[0];
  ACTIVE_ORDER_ID = active.id;

  ordersList.innerHTML = rows.map((row) => {
    const customerName = row.customer_name || row.name || "Unnamed customer";
    const customerEmail = row.email || "No email";
    const submittedAt = row.created_at || row.createdAt || new Date().toISOString();
    const fulfillment = row.fulfillment || "pickup";
    const scheduledDate = row.scheduled_date || getScheduledDateFromOrder(row) || "No scheduled date";
    const scheduledTime = row.scheduled_time || row.pickupWindow || "No time";
    const totalCents = Number(row.total_cents || row.subtotal_cents || row.estimatedTotalCents || 0);
    const paymentState = orderPaymentState(row);
    const depositStatus = orderDepositStatus(row);
    const isChecked = BULK_SELECTED_ORDER_IDS.has(row.id);

    return `
      <div class="list-item ${row.id === active.id ? "is-active" : ""}" style="gap:8px;">
        <input type="checkbox" class="order-bulk-check" data-order-id="${escapeAttr(row.id)}" ${isChecked ? "checked" : ""} style="flex-shrink:0;margin:0;cursor:pointer;" onclick="event.stopPropagation();" />
        <button type="button" class="li-btn" data-order-id="${escapeAttr(row.id)}" style="flex:1;text-align:left;background:none;border:none;color:inherit;cursor:pointer;padding:0;">
          <div class="li-main">
            <div class="li-title">${escapeHtml(customerName)}</div>
            <div class="li-sub muted">${escapeHtml(customerEmail)}  |  ${escapeHtml(formatDateTime(submittedAt))}</div>
            <div class="li-sub muted">${escapeHtml(fulfillment)}  |  ${escapeHtml(String(scheduledDate))}  |  ${escapeHtml(String(scheduledTime))}</div>
          </div>
          <div class="li-meta">
            <span class="pill ${["fulfilled", "completed", "paid"].includes(String(row.status || "new").toLowerCase()) ? "pill-on" : ""}">${escapeHtml(formatOrderWorkflowStatus(row.status || "new"))}</span>
            ${depositStatus !== "not_required" ? `<span class="pill ${depositStatusClass(depositStatus)}">${escapeHtml(formatDepositStatus(depositStatus))}</span>` : ""}
            <span class="pill ${paymentStateClass(paymentState)}">${escapeHtml(formatWorkflowPaymentState(paymentState))}</span>
            <span class="pill">${formatUsd(totalCents)}</span>
          </div>
        </button>
      </div>
    `;
  }).join("");

  ordersList.querySelectorAll(".li-btn[data-order-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_ORDER_ID = btn.getAttribute("data-order-id");
      renderOrders();
    });
  });

  ordersList.querySelectorAll(".order-bulk-check").forEach((chk) => {
    chk.addEventListener("change", () => {
      const id = chk.dataset.orderId;
      if (chk.checked) BULK_SELECTED_ORDER_IDS.add(id);
      else BULK_SELECTED_ORDER_IDS.delete(id);
      updateBulkBar();
    });
  });

  if (CRM_ORDERS_CACHE.length < ORDERS_TOTAL_COUNT) {
    const remaining = ORDERS_TOTAL_COUNT - CRM_ORDERS_CACHE.length;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'width:100%;margin-top:12px;';
    btn.textContent = `Load ${Math.min(PAGE_SIZE, remaining)} more (${CRM_ORDERS_CACHE.length} of ${ORDERS_TOTAL_COUNT} shown)`;
    btn.addEventListener('click', async () => {
      FETCH_OFFSETS.orders += PAGE_SIZE;
      btn.disabled = true;
      btn.textContent = 'Loading…';
      await fetchCrmOrders();
      renderOrders();
    });
    ordersList.appendChild(btn);
  }

  const totalCents = Number(active.total_cents || active.subtotal_cents || active.estimatedTotalCents || 0);
  const scheduledDate = active.scheduled_date || getScheduledDateFromOrder(active) || "Not specified";
  const scheduledTime = active.scheduled_time || active.pickupWindow || "Not specified";
  const itemCount = Array.isArray(active.items) ? active.items.length : Number(active.item_count || active.itemCount || 0);
  const notesText = active.notes || active.cartSummary || "No extra notes provided.";
  const sourceLabel = String(active.source_type || "storefront").replace(/_/g, " ");
  const linkedJob = JOBS_CACHE.find((row) => row.order_id === active.id || row.id === active.primary_job_id) || null;
  const linkedPlan = SERVICE_PLANS_CACHE.find((row) => row.source_order_id === active.id) || null;
  const linkedLead = linkedLeadForOrder(active);
  const linkedBid = linkedBidForOrder(active);
  const paymentState = orderPaymentState(active);
  const amountDue = orderAmountDueCents(active);
  const amountPaid = orderAmountPaidCents(active);
  const depositPolicy = orderDepositPolicy(active);
  const depositStatus = orderDepositStatus(active);
  const depositRequired = orderDepositRequiredCents(active);
  const depositPaid = orderDepositPaidCents(active);
  const depositGap = orderDepositGapCents(active);
  const depositOverrideReason = orderDepositOverrideReason(active);
  const depositDueDate = orderDepositDueDate(active);
  const orderPayments = sortedPayments(PAYMENTS_CACHE.filter((payment) => payment.order_id === active.id));
  const recentOrderPayment = orderPayments[0] || null;
  const orderFollowThroughActions = [
    ["completed", "fulfilled"].includes(String(active.status || "").toLowerCase()) && active.customer_email
      ? { id: "btnRequestReview", label: active.review_requested_at ? "Review requested" : "Request review", className: "btn btn-ghost btn-sm", disabled: !!active.review_requested_at }
      : null,
    active.customer_email ? { id: "btnNotifyCustomer", label: "Notify customer", className: "btn btn-ghost btn-sm" } : null,
    active.customer_email ? { id: "btnSendInvoiceEmail", label: "Email invoice", className: "btn btn-ghost btn-sm" } : null,
    active.customer_email ? { id: "btnSendPaymentReminder", label: "Payment reminder", className: "btn btn-ghost btn-sm" } : null,
    active.customer_email ? { id: "btnSendQuote", label: "Send quote", className: "btn btn-ghost btn-sm" } : null,
  ].filter(Boolean);

  const orderEmail = active.email || active.customer_email || "";
  const existingCustomer = orderEmail ? CUSTOMERS_CACHE.find((c) => c.email?.toLowerCase() === orderEmail.toLowerCase()) : null;
  const priorOrders = existingCustomer
    ? CRM_ORDERS_CACHE.filter((o) => o.id !== active.id && (o.customer_id === existingCustomer.id || (o.email || o.customer_email || "").toLowerCase() === orderEmail.toLowerCase()))
    : CRM_ORDERS_CACHE.filter((o) => o.id !== active.id && orderEmail && (o.email || o.customer_email || "").toLowerCase() === orderEmail.toLowerCase());
  const isReturnCustomer = priorOrders.length > 0;
  const orderActionButtons = [
    !existingCustomer ? { id: "btnAddOrderToCrm", label: "Add customer to CRM", className: "btn btn-ghost btn-sm" } : null,
    { label: linkedJob ? "Open linked job" : "Create job", className: "btn btn-primary", data: { "order-quick-action": "open-job" } },
    { label: depositGap > 0 ? "Collect deposit" : "Record payment", className: "btn btn-ghost", data: { "order-quick-action": "collect-money" } },
    { label: "Open customer", className: "btn btn-ghost", data: { "order-quick-action": "open-customer" } },
    { label: "Download invoice", className: "btn btn-ghost", data: { "order-quick-action": "download-invoice" } },
    active.customer_phone ? { label: "Text customer", className: "btn btn-ghost", data: { "order-quick-action": "text-customer" } } : null,
  ].filter(Boolean);

  orderDetailWrap.innerHTML = `
    ${renderRecordHeroCard({
      eyebrow: "Work record",
      title: active.customer_name || active.name || "Unnamed customer",
      badges: [
        { label: formatOrderWorkflowStatus(active.status || "new") },
        { label: formatWorkflowPaymentState(paymentState), tone: paymentStateClass(paymentState) },
        depositStatus !== "not_required" ? { label: formatDepositStatus(depositStatus), tone: depositStatusClass(depositStatus) } : null,
        isReturnCustomer ? { label: "Returning customer", tone: "pill-on" } : null,
      ],
      meta: [
        `${active.email || "No email"} | ${active.phone || "No phone"}`,
        `Scheduled ${String(scheduledDate)} | ${String(scheduledTime)}`,
        `Fulfillment: ${active.fulfillment || "pickup"} | ${itemCount} item${itemCount === 1 ? "" : "s"} | Source: ${sourceLabel}`,
        active.referral_source ? `How they heard about you: ${String(active.referral_source)}` : "",
        existingCustomer ? `In CRM as ${existingCustomer.name || "customer"} | ${existingCustomer.order_count || priorOrders.length} prior order(s)` : "",
      ].filter(Boolean),
      description: linkedJob
        ? `This work is already tied to ${linkedJob.title || "a tracked job"}, so use the workflow below to keep execution and collection moving together.`
        : "Use the workflow below to move this record into a tracked job, recurring plan, or the right payment follow-through without rebuilding anything.",
      summary: [
        { label: "Order value", value: formatUsd(totalCents), note: "Committed work total" },
        { label: "Paid so far", value: formatUsd(amountPaid), note: "Money already collected" },
        { label: "Due now", value: formatUsd(amountDue), note: paymentState === "overdue" ? "Past due" : "Still open", tone: paymentState === "overdue" ? "pill-bad" : "" },
        { label: "Deposit", value: depositGap > 0 ? `${formatUsd(depositGap)} open` : formatUsd(depositPaid), note: depositStatus === "not_required" ? "No deposit required" : formatDepositStatus(depositStatus) },
      ],
    })}
    ${isReturnCustomer && !existingCustomer ? `<div class="detail-card" style="margin-top:14px;"><div class="kicker">Customer match</div><div class="detail-copy" style="font-size:.8rem;color:#fbbf24;">${priorOrders.length} prior order(s) found for this email. Consider linking this person into CRM so the next request, job, and payment history stay together.</div></div>` : ""}
    ${renderRecordActionRail({
      eyebrow: "Quick actions",
      title: "Move this work forward",
      description: linkedJob
        ? "The booked work, field job, and payment flow are already tied together here. Use the actions below to keep them moving without jumping around."
        : "Use one action row to create the linked job, collect money, or open the right record without rebuilding anything.",
      actions: orderActionButtons,
    })}

    ${(active.order_type === 'package' || active.order_type === 'retainer') ? `
    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Order type: ${escapeHtml(active.order_type === 'package' ? 'Session Package' : 'Monthly Retainer')}</div>
      ${active.order_type === 'package' ? (() => {
        const total = Number(active.package_sessions_total || 0);
        const used  = Number(active.package_sessions_used || 0);
        const remaining = Math.max(0, total - used);
        const pct = total > 0 ? Math.round(remaining / total * 10) : 0;
        const bar = '█'.repeat(pct) + '░'.repeat(10 - pct);
        return `<div class="detail-copy">Sessions: ${remaining} remaining of ${total} &nbsp;[${bar}]&nbsp; (used ${used})</div>
        ${active.package_valid_until ? `<div class="detail-copy">Valid until ${new Date(active.package_valid_until).toLocaleDateString()}</div>` : ''}`;
      })() : `<div class="detail-copy">Bills every ${escapeHtml(String(active.recurrence_interval_days || 30))} days</div>`}
    </div>` : ''}

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Workflow next step</div>
      <div class="detail-copy">Request: ${escapeHtml(linkedLead?.contact_name || linkedLead?.title || "Not linked")}</div>
      <div class="detail-copy">Proposal: ${escapeHtml(linkedBid?.title || "Not linked")}</div>
      <div class="detail-copy">Tracked job: ${escapeHtml(linkedJob?.title || (linkedJob ? "Linked job" : "No job yet"))}</div>
      <div class="detail-copy">Recurring plan: ${escapeHtml(linkedPlan?.title || "Not set up")}</div>
      <div class="detail-copy">${linkedJob ? `Execution status: ${escapeHtml(String(linkedJob.status || "scheduled").replace(/_/g, " "))}` : "Create a job when this work is ready to be scheduled or performed."}</div>
      <div class="row" style="margin-top:10px;">
        <button id="btnOpenOrderRequest" class="btn btn-ghost" type="button">${linkedLead ? "Open request" : "Create request"}</button>
        <button id="btnOpenOrderBid" class="btn btn-ghost" type="button">${linkedBid ? "Open proposal" : "Draft proposal"}</button>
        <button id="btnCreateJobFromOrder" class="btn btn-primary" type="button">${linkedJob ? "Open linked job" : "Create job"}</button>
        <button id="btnCreateRecurringPlanFromOrder" class="btn" type="button">${linkedPlan ? "Open recurring plan" : "Make recurring"}</button>
        <button id="btnCollectOrderDeposit" class="btn btn-ghost" type="button">${depositGap > 0 ? "Collect deposit" : "Record payment"}</button>
        <button id="btnRecordOrderPayment" class="btn btn-ghost" type="button">Record payment</button>
        <button id="btnOpenOrderCustomer" class="btn btn-ghost" type="button">Open customer</button>
        <button id="btnDownloadInvoice" class="btn btn-ghost" type="button">⬇ Invoice PDF</button>
        <button id="btnSetupRecurring" class="btn btn-ghost" type="button">🔁 Make recurring</button>
        ${active.customer_phone ? `<button id="btnOrderSms" class="btn btn-ghost" type="button">💬 Text customer</button>` : ""}
      </div>
      <div id="recurringSetupPanel" style="display:none;margin-top:12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div class="row" style="gap:8px;align-items:end;flex-wrap:wrap;">
          <label style="flex:1;min-width:130px;">Repeat every
            <select id="recurringFrequency">
              <option value="weekly">Week</option>
              <option value="biweekly">2 Weeks</option>
              <option value="monthly">Month</option>
            </select>
          </label>
          <label style="flex:1;min-width:140px;">Next date
            <input type="date" id="recurringNextDate" />
          </label>
          <button id="btnSaveRecurring" class="btn btn-primary" type="button" style="flex:0 0 auto;">Save</button>
        </div>
        <div id="recurringMsg" class="msg" style="margin-top:6px;"></div>
      </div>

      ${active.customer_phone ? `
      <div id="orderSmsPanel" style="display:none;margin-top:12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="font-size:.8rem;color:rgba(255,255,255,.5);margin-bottom:8px;">Texting ${escapeHtml(active.customer_name || "customer")} at ${escapeHtml(active.customer_phone)}</div>
        <div id="orderSmsThread" style="max-height:200px;overflow-y:auto;margin-bottom:8px;"></div>
        <div class="row" style="gap:8px;">
          <input id="orderSmsInput" type="text" style="flex:1;" placeholder="Type a message…" />
          <button id="btnOrderSmsSend" class="btn btn-primary btn-sm" type="button">Send</button>
        </div>
        <div id="orderSmsMsg" class="msg"></div>
      </div>` : ""}
    </div>

    <div class="detail-card" style="margin-top:14px;">
      <div class="kicker">Deposit control</div>
      <div class="detail-copy">${escapeHtml(depositPolicyLabel(depositPolicy))}${depositDueDate ? ` | Due ${escapeHtml(formatDateOnly(depositDueDate))}` : ""}</div>
      <div class="detail-copy">${depositOverrideReason ? `Override reason: ${escapeHtml(depositOverrideReason)}` : "Use this when the business needs a deposit rule that is teachable, enforceable, and still flexible in real life."}</div>
      <div class="grid three form-grid" style="margin-top:10px;">
        <label>Deposit policy
          <select id="orderDepositPolicySelect">
            <option value="optional" ${depositPolicy === "optional" ? "selected" : ""}>Optional</option>
            <option value="required_before_booking" ${depositPolicy === "required_before_booking" ? "selected" : ""}>Required before booking</option>
            <option value="required_before_job" ${depositPolicy === "required_before_job" ? "selected" : ""}>Required before job</option>
          </select>
        </label>
        <label>Required amount (USD)
          <input id="orderDepositRequiredAmount" type="number" min="0" step="0.01" value="${escapeAttr(money(depositRequired))}" />
        </label>
        <label>Deposit due date
          <input id="orderDepositDueDate" type="date" value="${escapeAttr(depositDueDate || "")}" />
        </label>
      </div>
      <label style="margin-top:10px;">Override reason
        <textarea id="orderDepositOverrideReason" rows="3" placeholder="Why this order can move ahead before the deposit is collected.">${escapeHtml(depositOverrideReason)}</textarea>
      </label>
      <div class="row" style="margin-top:10px;">
        <button id="btnSaveOrderDepositSettings" class="btn btn-primary" type="button">Save deposit settings</button>
        <button id="btnClearOrderDepositOverride" class="btn btn-ghost" type="button" ${depositOverrideReason ? "" : "disabled"}>Clear override</button>
      </div>
      <div id="orderDepositMsg" class="msg"></div>
    </div>

    ${renderRecordFollowThroughCard({
      eyebrow: "Follow-through",
      title: "Keep status, reminders, and collection aligned",
      description: active.customer_email
        ? "Update the workflow stage, send the right customer message, and keep money follow-through visible from one place."
        : "Update the workflow stage here. Add a customer email to unlock reminders, invoice email, and review follow-up.",
      summary: [
        { label: "Status", value: formatOrderWorkflowStatus(active.status || "new"), note: "Current workflow stage" },
        { label: "Collection", value: formatWorkflowPaymentState(paymentState), note: amountDue > 0 ? `${formatUsd(amountDue)} still open` : "Nothing outstanding" },
        { label: "Due date", value: active.payment_due_date ? formatDateOnly(active.payment_due_date) : (depositDueDate ? formatDateOnly(depositDueDate) : "Not set"), note: active.payment_due_date ? "Customer-facing due date" : "Falls back to deposit or schedule timing" },
        { label: "Recent payment", value: recentOrderPayment ? formatUsd(paymentAmountCents(recentOrderPayment)) : "None yet", note: recentOrderPayment ? formatDateTime(recentOrderPayment.paid_at || recentOrderPayment.created_at || recentOrderPayment.updated_at) : "No payment recorded yet" },
      ],
      controlsHtml: `
        <div class="row" style="align-items:end;flex-wrap:wrap;gap:8px;">
          <label class="field" style="flex:1;min-width:120px;">
            <span>Status</span>
            <select id="orderStatusSelect">
              ${statusOptions.map((status) => `<option value="${status}" ${String(active.status || "new").toLowerCase() === status ? "selected" : ""}>${escapeHtml(formatOrderWorkflowStatus(status))}</option>`).join("")}
            </select>
          </label>
          ${active.customer_email ? `<label style="display:flex;align-items:center;gap:6px;font-size:.8rem;cursor:pointer;white-space:nowrap;"><input type="checkbox" id="chkNotifyOnStatusChange" checked /> Notify customer</label>` : ""}
          <button id="btnSaveOrderStatus" class="btn btn-primary" type="button">Save status</button>
        </div>
      `,
      actions: orderFollowThroughActions,
      timelineHtml: `
        <div id="quoteFormPanel" style="display:none;margin-top:12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:14px;">
          <div style="font-size:.82rem;font-weight:600;margin-bottom:10px;color:var(--muted);">New quote</div>
          <div class="row" style="gap:8px;flex-wrap:wrap;align-items:end;">
            <label class="field" style="flex:2;min-width:160px;">Title
              <input type="text" id="quoteTitle" placeholder="Quote title" value="${escapeAttr(active.title || '')}" />
            </label>
            <label class="field" style="flex:1;min-width:100px;">Amount (USD)
              <input type="number" id="quoteAmount" placeholder="0.00" min="0" step="0.01" />
            </label>
            <label class="field" style="flex:1;min-width:110px;">Valid until
              <input type="date" id="quoteValidUntil" />
            </label>
          </div>
          <label class="field" style="margin-top:8px;">Description (optional)
            <textarea id="quoteDescription" rows="2" placeholder="Scope of work, inclusions, terms…" style="width:100%;resize:vertical;">${escapeHtml(active.notes || '')}</textarea>
          </label>
          <div class="row" style="gap:8px;margin-top:10px;">
            <button id="btnSubmitQuote" class="btn btn-primary btn-sm" type="button">Send quote</button>
            <button id="btnCancelQuote" class="btn btn-ghost btn-sm" type="button">Cancel</button>
          </div>
        </div>
        <div id="orderNotifyMsg" class="msg" style="margin-top:8px;"></div>
      `,
    })}

    <div class="detail-card" style="margin-top:14px;" id="phasesSection">
      <div class="kicker" style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;" id="phasesToggle">
        <span>Project phases ▸</span>
        <button class="btn btn-ghost" style="font-size:.72rem;padding:2px 8px;" onclick="event.stopPropagation();openAddPhaseModal('${escapeAttr(active.id)}')">+ Phase</button>
      </div>
      <div id="phasesBody" style="display:none;margin-top:10px;"></div>
    </div>

    <div class="detail-card" style="margin-top:14px;" id="timeLoggedSection">
      <div class="kicker" style="cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;" id="timeLoggedToggle">
        <span>Time logged ▸</span>
        <button class="btn btn-ghost" style="font-size:.72rem;padding:2px 8px;" onclick="event.stopPropagation();openLogTimeModal('${escapeAttr(active.id)}')">+ Log Time</button>
      </div>
      <div id="timeLoggedBody" style="display:none;margin-top:10px;"></div>
    </div>
  `;

  // Project phases collapsible section
  document.getElementById('phasesToggle')?.addEventListener('click', async (ev) => {
    if (ev.target.tagName === 'BUTTON') return;
    const body   = document.getElementById('phasesBody');
    const toggle = document.getElementById('phasesToggle')?.querySelector('span');
    if (!body) return;
    if (body.style.display !== 'none') { body.style.display = 'none'; if (toggle) toggle.textContent = 'Project phases ▸'; return; }
    body.style.display = 'block';
    if (toggle) toggle.textContent = 'Project phases ▾';
    body.innerHTML = '<div class="muted" style="font-size:.82rem;">Loading…</div>';
    await loadPhasesIntoEl(active.id, body);
  });

  // Time entries collapsible section
  document.getElementById("timeLoggedToggle")?.addEventListener("click", async (ev) => {
    if (ev.target.tagName === "BUTTON") return;
    const body   = document.getElementById("timeLoggedBody");
    const toggle = document.getElementById("timeLoggedToggle")?.querySelector("span");
    if (!body) return;
    if (body.style.display !== "none") { body.style.display = "none"; if (toggle) toggle.textContent = "Time logged ▸"; return; }
    if (toggle) toggle.textContent = "Time logged ▾";
    body.style.display = "block";
    await renderTimeEntries(active.id);
  });

  // Time → Invoice button
  document.addEventListener("click", async (ev) => {
    if (ev.target?.id !== "btnTimeToInvoice") return;
    const orderId = ACTIVE_ORDER_ID;
    if (!orderId) return;
    ev.target.disabled = true;
    ev.target.textContent = "Working…";
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/time-to-invoice", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: orderId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed");
      if (d.lines_created === 0) {
        showToast("No uninvoiced billable hours found.");
      } else {
        showToast(`Added ${d.lines_created} line item${d.lines_created === 1 ? "" : "s"} (${formatUsd(d.total_cents)}) to invoice.`);
        await fetchCrmOrders();
        renderOrders();
      }
    } catch (err) {
      showToast("Error: " + err.message);
    } finally {
      if (ev.target) { ev.target.disabled = false; ev.target.textContent = "⚡ Add uninvoiced hours to invoice"; }
    }
  });

  $("btnSaveOrderStatus")?.addEventListener("click", async () => {
    const nextStatus = $("orderStatusSelect")?.value || "new";
    try {
      assertOrderAllowsStatusChange(active, nextStatus);
    } catch (err) {
      notifyOperator(err.message || String(err));
      return;
    }
    const { data, error } = await sb.from("orders")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", active.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();

    if (error) {
      notifyOperator(error.message || String(error));
      return;
    }

    CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) => row.id === active.id ? data : row);
    TABS_LOADED.delete('orders');
    FETCH_OFFSETS.orders = 0;
    renderOrders();
    renderDashboard();
    renderGuidance();

    // Auto-send review request when order is marked complete/fulfilled
    if (["completed", "fulfilled"].includes(nextStatus) && data.customer_email && !data.review_requested_at) {
      try {
        const tok = await getAccessToken();
        await fetch("/.netlify/functions/request-review", {
          method : "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
          body   : JSON.stringify({ order_id: data.id }),
        });
      } catch (e) {
        console.warn("[review] auto-request failed:", e.message);
      }
    }

    // Notify customer of status change if checkbox is checked
    const shouldNotify = $("chkNotifyOnStatusChange")?.checked;
    if (shouldNotify && data.customer_email) {
      try {
        const tok = await getAccessToken();
        fetch("/.netlify/functions/send-order-notification", {
          method : "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
          body   : JSON.stringify({ order_id: data.id }),
        }).catch(() => {});
      } catch (e) {
        console.warn("[notify] status notification failed:", e.message);
      }
    }
  });
  $("btnOpenOrderCustomer")?.addEventListener("click", () => {
    if (existingCustomer?.id) {
      ACTIVE_CUSTOMER_ID = existingCustomer.id;
      CUSTOMER_CREATING = false;
      switchTab("customers");
      return;
    }
    const fallbackCustomerId = active.customer_id || "";
    if (fallbackCustomerId) {
      ACTIVE_CUSTOMER_ID = fallbackCustomerId;
      CUSTOMER_CREATING = false;
      switchTab("customers");
      return;
    }
    startNewCustomer();
    if (customerName) customerName.value = active.customer_name || active.name || "";
    if (customerEmail) customerEmail.value = active.email || active.customer_email || "";
    if (customerPhone) customerPhone.value = active.phone || active.customer_phone || "";
    if (customerAddress) customerAddress.value = active.service_address || active.address || "";
    switchTab("customers");
  });
  $("btnOpenOrderRequest")?.addEventListener("click", () => {
    if (linkedLead?.id) {
      ACTIVE_LEAD_ID = linkedLead.id;
      switchTab("leads");
      return;
    }
    clearLeadForm();
    renderLeadCustomerOptions(existingCustomer?.id || active.customer_id || "");
    if (leadCustomerId) leadCustomerId.value = existingCustomer?.id || active.customer_id || "";
    if (leadContactName) leadContactName.value = active.customer_name || active.name || "";
    if (leadContactEmail) leadContactEmail.value = active.email || active.customer_email || "";
    if (leadContactPhone) leadContactPhone.value = active.phone || active.customer_phone || "";
    if (leadServiceAddress) leadServiceAddress.value = active.service_address || active.address || "";
    if (leadTitle) leadTitle.value = active.customer_name ? `${active.customer_name} request` : "";
    if (leadSummary) leadSummary.value = active.notes || active.cartSummary || "";
    ACTIVE_LEAD_ID = null;
    renderLeadDetail(null).catch(console.error);
    switchTab("leads");
  });
  $("btnOpenOrderBid")?.addEventListener("click", () => {
    if (linkedBid?.id) {
      ACTIVE_BID_ID = linkedBid.id;
      renderBids(bidSearch?.value || "");
      switchTab("bids");
      return;
    }
    const draft = startNewBid(preferredBidProfile());
    const nextDraft = {
      ...draft,
      customer_id: existingCustomer?.id || active.customer_id || draft.customer_id || "",
      lead_id: linkedLead?.id || draft.lead_id || "",
      title: active.customer_name ? `${active.customer_name} proposal` : (draft.title || ""),
      service_address: active.service_address || draft.service_address || "",
      schedule_window: active.scheduled_time || active.pickupWindow || draft.schedule_window || "",
      project_summary: active.notes || active.cartSummary || draft.project_summary || "",
    };
    replaceBidDraft(nextDraft);
    persistBidDrafts();
    queueBidDraftSync();
    switchTab("bids");
  });
  $("btnDownloadInvoice")?.addEventListener("click", () => {
    generateInvoicePDF(active);
  });

  $("btnRequestReview")?.addEventListener("click", async () => {
    const btn = $("btnRequestReview");
    if (!btn || active.review_requested_at) return;
    btn.disabled = true;
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/request-review", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send review request");
      btn.textContent = "✓ Review requested";
      CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) =>
        row.id === active.id ? { ...row, review_requested_at: new Date().toISOString() } : row
      );
    } catch (err) {
      notifyOperator(err.message || String(err));
      btn.disabled = false;
    }
  });

  $("btnNotifyCustomer")?.addEventListener("click", async () => {
    const btn = $("btnNotifyCustomer");
    const msg = $("orderNotifyMsg");
    if (!btn) return;
    btn.disabled = true;
    if (msg) { msg.textContent = "Sending…"; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-order-notification", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (msg) { msg.textContent = "✓ Customer notified!"; msg.className = "msg success"; }
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending."; msg.className = "msg error"; }
    }
    btn.disabled = false;
  });

  $("btnSendInvoiceEmail")?.addEventListener("click", async () => {
    const btn = $("btnSendInvoiceEmail");
    const msg = $("orderNotifyMsg");
    if (!btn) return;
    btn.disabled = true;
    if (msg) { msg.textContent = "Sending invoice…"; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-invoice-email", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (msg) { msg.textContent = "✓ Invoice emailed!"; msg.className = "msg success"; }
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending."; msg.className = "msg error"; }
    }
    btn.disabled = false;
  });

  $("btnSendPaymentReminder")?.addEventListener("click", async () => {
    const btn = $("btnSendPaymentReminder");
    const msg = $("orderNotifyMsg");
    if (!btn) return;
    btn.disabled = true;
    if (msg) { msg.textContent = "Sending reminder…"; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-payment-reminder", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (msg) { msg.textContent = "✓ Payment reminder sent!"; msg.className = "msg success"; }
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending."; msg.className = "msg error"; }
    }
    btn.disabled = false;
  });

  $("btnSendQuote")?.addEventListener("click", () => {
    const panel = $("quoteFormPanel");
    if (!panel) return;
    const isHidden = panel.style.display === "none";
    panel.style.display = isHidden ? "block" : "none";
    if (isHidden) {
      // Default valid-until to 14 days from now
      const validUntil = $("quoteValidUntil");
      if (validUntil && !validUntil.value) {
        const d = new Date();
        d.setDate(d.getDate() + 14);
        validUntil.value = d.toISOString().slice(0, 10);
      }
      $("quoteAmount")?.focus();
    }
  });

  $("btnCancelQuote")?.addEventListener("click", () => {
    const panel = $("quoteFormPanel");
    if (panel) panel.style.display = "none";
  });

  $("btnSubmitQuote")?.addEventListener("click", async () => {
    const customerName  = active.customer_name || active.name || "";
    const customerEmail = active.email || active.customer_email || "";
    const title         = $("quoteTitle")?.value.trim() || `Quote for ${customerName}`;
    const amountRaw     = $("quoteAmount")?.value.trim();
    const description   = $("quoteDescription")?.value.trim() || "";
    const validUntil    = $("quoteValidUntil")?.value || null;
    const msg           = $("orderNotifyMsg");
    const btn           = $("btnSubmitQuote");

    if (!amountRaw || isNaN(Number(amountRaw)) || Number(amountRaw) <= 0) {
      if (msg) { msg.textContent = "Please enter a valid amount."; msg.className = "msg error"; }
      return;
    }

    if (btn) btn.disabled = true;
    if (msg) { msg.textContent = "Sending quote…"; msg.className = "msg"; }

    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/create-quote", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ customer_name: customerName, customer_email: customerEmail, title, amount: Number(amountRaw), description, valid_until: validUntil }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send quote");
      if (msg) { msg.textContent = `✓ Quote sent to ${customerEmail}!`; msg.className = "msg success"; }
      const panel = $("quoteFormPanel");
      if (panel) panel.style.display = "none";
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending quote."; msg.className = "msg error"; }
    }
    if (btn) btn.disabled = false;
  });

  $("btnSetupRecurring")?.addEventListener("click", () => {
    const panel = $("recurringSetupPanel");
    if (!panel) return;
    const isHidden = panel.style.display === "none";
    panel.style.display = isHidden ? "block" : "none";
    if (isHidden) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateInput = $("recurringNextDate");
      if (dateInput && !dateInput.value) {
        dateInput.value = tomorrow.toISOString().slice(0, 10);
      }
    }
  });

  $("btnSaveRecurring")?.addEventListener("click", async () => {
    const btn  = $("btnSaveRecurring");
    const msg  = $("recurringMsg");
    const freq = $("recurringFrequency")?.value;
    const nd   = $("recurringNextDate")?.value;
    if (!freq || !nd) { if (msg) { msg.textContent = "Select frequency and date."; msg.className = "msg error"; } return; }
    btn.disabled = true;
    if (msg) { msg.textContent = "Saving…"; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/create-recurring-order", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id, frequency: freq, next_date: nd }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to save");
      if (msg) { msg.textContent = "✓ Recurring schedule saved!"; msg.className = "msg success"; }
      $("btnSetupRecurring").textContent = "🔁 Recurring: " + freq;
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error saving."; msg.className = "msg error"; }
      btn.disabled = false;
    }
  });

  // Order-level SMS
  $("btnOrderSms")?.addEventListener("click", async () => {
    const panel = $("orderSmsPanel");
    if (!panel) return;
    const isHidden = panel.style.display === "none";
    panel.style.display = isHidden ? "block" : "none";
    if (isHidden && active.customer_phone) {
      const thread = $("orderSmsThread");
      if (thread && !thread.dataset.loaded) {
        thread.dataset.loaded = "1";
        try {
          const tok = await getAccessToken();
          const res = await fetch(`/.netlify/functions/get-sms-thread?phone=${encodeURIComponent(active.customer_phone)}`, {
            headers: { "Authorization": `Bearer ${tok}` },
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || `Server error (${res.status})`);
          const msgs = d.messages || [];
          thread.innerHTML = msgs.length ? msgs.map((m) => {
            const isOut = m.direction === 'outbound';
            return `<div style="display:flex;justify-content:${isOut ? 'flex-end' : 'flex-start'};margin-bottom:5px;">
              <div style="max-width:75%;background:${isOut ? '#c84b2f' : 'rgba(255,255,255,.1)'};border-radius:10px;padding:6px 10px;font-size:.82rem;">
                ${escapeHtml(m.body || "")}
              </div>
            </div>`;
          }).join('') : '<p style="font-size:.8rem;color:rgba(255,255,255,.4);">No messages yet.</p>';
          thread.scrollTop = thread.scrollHeight;
        } catch (e) { console.error("[order sms thread]", e); }
      }
    }
  });

  $("btnOrderSmsSend")?.addEventListener("click", async () => {
    const btn  = $("btnOrderSmsSend");
    const inp  = $("orderSmsInput");
    const msg  = $("orderSmsMsg");
    const text = inp?.value?.trim();
    if (!text || !active.customer_phone) return;
    btn.disabled = true;
    if (msg) { msg.textContent = ""; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-sms", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ to: active.customer_phone, body: text, order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (inp) inp.value = "";
      const thread = $("orderSmsThread");
      if (thread) {
        thread.innerHTML += `<div style="display:flex;justify-content:flex-end;margin-bottom:5px;">
          <div style="max-width:75%;background:#c84b2f;border-radius:10px;padding:6px 10px;font-size:.82rem;">${escapeHtml(text)}</div>
        </div>`;
        thread.scrollTop = thread.scrollHeight;
      }
      if (msg) { msg.textContent = "✓ Sent"; msg.className = "msg success"; setTimeout(() => { if (msg) { msg.textContent = ""; msg.className = "msg"; } }, 2000); }
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending."; msg.className = "msg error"; }
    }
    btn.disabled = false;
  });

  $("orderSmsInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnOrderSmsSend")?.click(); }
  });

  async function saveOrderDepositSettings(options = {}) {
    const msgEl = $("orderDepositMsg");
    const silent = !!options.silent;
    if (!silent) setInlineMessage(msgEl, "Saving...");
    const sourceOrder = CRM_ORDERS_CACHE.find((row) => row.id === active.id) || active;
    const nextPolicy = normalizeDepositPolicy($("orderDepositPolicySelect")?.value || "optional");
    const nextRequired = toCents($("orderDepositRequiredAmount")?.value || 0);
    const nextDueDate = $("orderDepositDueDate")?.value || null;
    const nextOverride = $("orderDepositOverrideReason")?.value?.trim() || null;
    if (nextPolicy !== "optional" && nextRequired <= 0) {
      const validationError = new Error("A required deposit policy needs an amount greater than zero.");
      if (!silent) setInlineMessage(msgEl, validationError.message, "error");
      throw validationError;
    }
    const payload = {
      deposit_policy: nextRequired > 0 ? nextPolicy : "optional",
      deposit_required_cents: nextRequired,
      deposit_due_date: nextRequired > 0 && nextPolicy !== "optional"
        ? (nextDueDate || sourceOrder.scheduled_date || sourceOrder.payment_due_date || new Date().toISOString().slice(0, 10))
        : null,
      deposit_override_reason: nextOverride,
      deposit_override_at: nextOverride ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb.from("orders")
      .update(payload)
      .eq("id", sourceOrder.id)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID)
      .select("*")
      .single();
    if (error) {
      if (isMissingDatabaseFeatureError(error, ["deposit_policy", "deposit_due_date", "deposit_override_reason"])) {
        throw new Error("Deposit control needs the service_deposit_control.sql migration before these settings can be saved.");
      }
      throw error;
    }
    ACTIVE_ORDER_ID = data.id;
    CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.some((row) => row.id === sourceOrder.id)
      ? CRM_ORDERS_CACHE.map((row) => row.id === sourceOrder.id ? data : row)
      : [data, ...CRM_ORDERS_CACHE];
    if (nextOverride && sourceOrder.customer_id) {
      await logCustomerInteraction(sourceOrder.customer_id, "payment", `Deposit override recorded for ${sourceOrder.cart_summary || "order"}`, {
        order_id: sourceOrder.id,
        deposit_override_reason: nextOverride,
        deposit_required_cents: nextRequired,
      }).catch(() => null);
    }
    TABS_LOADED.delete('orders');
    FETCH_OFFSETS.orders = 0;
    TABS_LOADED.delete('jobs');
    renderOrders();
    renderJobs(jobSearch?.value || "");
    renderDashboard();
    renderGuidance();
    renderMoney().catch(console.error);
    if (!silent) setInlineMessage($("orderDepositMsg"), "Deposit settings saved.", "ok");
    return data;
  }

  orderDetailWrap.querySelectorAll("[data-order-quick-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-order-quick-action") || "";
      if (action === "open-job") return $("btnCreateJobFromOrder")?.click();
      if (action === "collect-money") return $("btnCollectOrderDeposit")?.click();
      if (action === "open-customer") return $("btnOpenOrderCustomer")?.click();
      if (action === "download-invoice") return $("btnDownloadInvoice")?.click();
      if (action === "text-customer") return $("btnOrderSms")?.click();
    });
  });

  $("btnCreateJobFromOrder")?.addEventListener("click", async () => {
    let currentOrder = CRM_ORDERS_CACHE.find((row) => row.id === active.id) || active;
    const pendingOverride = $("orderDepositOverrideReason")?.value?.trim() || null;
    if (orderDepositBlocksJob(currentOrder) && pendingOverride) {
      try {
        currentOrder = await saveOrderDepositSettings({ silent: true });
      } catch (error) {
        setInlineMessage($("orderDepositMsg"), error.message || String(error), "error");
        $("orderDepositOverrideReason")?.focus();
        return;
      }
    }
    const currentLinkedJob = JOBS_CACHE.find((row) => row.order_id === currentOrder.id || row.id === currentOrder.primary_job_id) || null;
    if (currentLinkedJob) {
      ACTIVE_JOB_ID = currentLinkedJob.id;
      switchTab("jobs");
      return;
    }
    try {
      assertOrderAllowsJobCreation(currentOrder);
      await createJobFromOrderRecord(currentOrder);
      renderJobs(jobSearch?.value || "");
      renderOrders();
      renderDashboard();
      renderGuidance();
      switchTab("jobs");
    } catch (err) {
      const message = err.message || String(err);
      if (message.toLowerCase().includes("deposit")) {
        setInlineMessage($("orderDepositMsg"), "This order still has a required deposit open. Record the deposit or add an override reason below, then create the job.", "error");
        $("orderDepositOverrideReason")?.focus();
        return;
      }
      notifyOperator(message);
    }
  });
  $("btnCreateRecurringPlanFromOrder")?.addEventListener("click", async () => {
    if (linkedPlan) {
      ACTIVE_PLAN_ID = linkedPlan.id;
      renderPlans(planSearch?.value || "");
      switchTab("plans");
      return;
    }
    try {
      const result = await createServicePlanFromOrderRecord(active);
      if (result?.plan?.id) ACTIVE_PLAN_ID = result.plan.id;
      renderPlans(planSearch?.value || "");
      renderDashboard();
      renderGuidance();
      switchTab("plans");
    } catch (err) {
      notifyOperator(err.message || String(err));
    }
  });
  $("btnRecordOrderPayment")?.addEventListener("click", () => {
    ACTIVE_ORDER_ID = active.id;
    clearPaymentForm({
      customerId: active.customer_id || "",
      orderId: active.id,
    });
    switchTab("payments");
  });
  $("btnAddOrderToCrm")?.addEventListener("click", async () => {
    const btn = $("btnAddOrderToCrm");
    if (!btn) return;
    const name = active.customer_name || active.name || "Unnamed";
    const email = active.email || active.customer_email || "";
    const phone = active.phone || active.customer_phone || "";
    const approved = await showConfirmModal(`Add "${name}"${email ? ` (${email})` : ""} to your customer list?`, "Add customer", "Keep as-is");
    if (!approved) return;
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      const { data, error } = await sb.from("customers").insert({
        tenant_id: TENANT_ID,
        operator_id: opId(),
        name,
        email: email || null,
        phone: phone || null,
        order_count: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      await fetchCustomers();
      renderCustomersList(customerSearch?.value || "");
      btn.textContent = "✓ Added to CRM";
      btn.style.color = "#4ade80";
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "+ Add customer to CRM";
      notifyOperator("Failed to add customer: " + (err.message || String(err)));
    }
  });

  $("btnCollectOrderDeposit")?.addEventListener("click", () => {
    ACTIVE_ORDER_ID = active.id;
    clearPaymentForm({
      customerId: active.customer_id || "",
      orderId: active.id,
      amount: depositGap > 0 ? money(depositGap) : "",
      note: depositGap > 0 ? `Deposit for ${active.cart_summary || active.customer_name || "order"}` : "",
      title: depositGap > 0 ? "Record deposit" : "Manual payment entry",
    });
    switchTab("payments");
  });
  $("btnSaveOrderDepositSettings")?.addEventListener("click", async () => {
    try {
      await saveOrderDepositSettings();
    } catch (err) {
      setInlineMessage($("orderDepositMsg"), err.message || String(err), "error");
    }
  });
  $("btnClearOrderDepositOverride")?.addEventListener("click", async () => {
    const msgEl = $("orderDepositMsg");
    setInlineMessage(msgEl, "Clearing override...");
    try {
      const { data, error } = await sb.from("orders")
        .update({
          deposit_override_reason: null,
          deposit_override_at: null,
          deposit_override_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", active.id)
        .eq(OPERATOR_COLUMN, opId())
        .eq(TENANT_COLUMN, TENANT_ID)
        .select("*")
        .single();
      if (error) {
        if (isMissingDatabaseFeatureError(error, ["deposit_override_reason"])) {
          throw new Error("Deposit override clearing needs the service_deposit_control.sql migration.");
        }
        throw error;
      }
      ACTIVE_ORDER_ID = data.id;
      CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((row) => row.id === active.id ? data : row);
      TABS_LOADED.delete('orders');
      FETCH_OFFSETS.orders = 0;
      TABS_LOADED.delete('jobs');
      renderOrders();
      renderJobs(jobSearch?.value || "");
      renderDashboard();
      renderGuidance();
      renderMoney().catch(console.error);
      setInlineMessage($("orderDepositMsg"), "Deposit override cleared.", "ok");
    } catch (err) {
      setInlineMessage(msgEl, err.message || String(err), "error");
    }
  });
}
