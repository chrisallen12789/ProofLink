// Order creation, export, and bulk-status tools extracted from operator.js
// so the order workspace can keep shrinking without changing behavior.
(function attachOperatorOrdersTools(global) {
  function exportOrdersJson() {
    const blob = new Blob([JSON.stringify(CRM_ORDERS_CACHE || [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `operator-orders-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function updateBulkBar() {
    const bar = $("bulkStatusBar");
    const countEl = $("bulkSelectedCount");
    if (!bar) return;
    const count = BULK_SELECTED_ORDER_IDS.size;
    bar.style.display = count > 0 ? "flex" : "none";
    if (countEl) countEl.textContent = `${count} selected`;
  }

  function openCreateOrderModal() {
    const existing = document.getElementById("createOrderModal");
    if (existing) {
      existing.remove();
      return;
    }
    const modal = document.createElement("div");
    modal.id = "createOrderModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;";
    modal.innerHTML = `
      <div style="background:#1a1d27;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:28px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <strong style="font-size:1rem;">New order</strong>
          <button id="createOrderClose" type="button" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:1.2rem;cursor:pointer;">x</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <input id="coCustomerName" class="input" placeholder="Customer name *" />
          <input id="coCustomerEmail" class="input" type="email" placeholder="Customer email" />
          <input id="coTitle" class="input" placeholder="Order title *" />
          <input id="coAmount" class="input" type="number" min="0" step="0.01" placeholder="Amount (USD)" />
          <div style="margin-top:10px;">
            <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:4px;">Order type</label>
            <select id="orderType" class="input" style="width:100%;margin-bottom:8px;">
              <option value="standard">Standard (one-time)</option>
              <option value="package">Session package</option>
              <option value="retainer">Monthly retainer</option>
            </select>
            <div id="packageFields" style="display:none;">
              <div style="display:flex;gap:8px;margin-bottom:8px;">
                <div style="flex:1;">
                  <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Sessions included</label>
                  <input type="number" id="packageSessions" class="input" min="1" value="10" style="width:100%;" />
                </div>
                <div style="flex:1;">
                  <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Valid until</label>
                  <input type="date" id="packageValidUntil" class="input" style="width:100%;" />
                </div>
              </div>
            </div>
            <div id="retainerFields" style="display:none;">
              <label style="font-size:.75rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Bill every (days)</label>
              <select id="retainerInterval" class="input" style="width:100%;">
                <option value="30">Monthly (30 days)</option>
                <option value="14">Bi-weekly (14 days)</option>
                <option value="7">Weekly (7 days)</option>
              </select>
            </div>
          </div>
        </div>
        <div id="coMsg" style="font-size:.8rem;margin:10px 0;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
          <button id="coCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
          <button id="coSave" class="btn btn-primary btn-sm" type="button">Create order</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#createOrderClose").onclick = () => modal.remove();
    modal.querySelector("#coCancel").onclick = () => modal.remove();
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.remove();
    });

    const orderTypeEl = modal.querySelector("#orderType");
    const packageFields = modal.querySelector("#packageFields");
    const retainerFields = modal.querySelector("#retainerFields");
    orderTypeEl.addEventListener("change", () => {
      packageFields.style.display = orderTypeEl.value === "package" ? "block" : "none";
      retainerFields.style.display = orderTypeEl.value === "retainer" ? "block" : "none";
    });

    modal.querySelector("#coSave").onclick = async () => {
      const saveBtn = modal.querySelector("#coSave");
      const msgEl = modal.querySelector("#coMsg");
      const name = modal.querySelector("#coCustomerName").value.trim();
      const email = modal.querySelector("#coCustomerEmail").value.trim();
      const title = modal.querySelector("#coTitle").value.trim();
      const amount = parseFloat(modal.querySelector("#coAmount").value) || 0;
      const orderType = orderTypeEl.value;
      if (!name || !title) {
        msgEl.textContent = "Name and title are required.";
        msgEl.style.color = "#f87171";
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      const payload = {
        tenant_id: TENANT_ID,
        operator_id: opId(),
        customer_name: name,
        customer_email: email || undefined,
        title,
        total_cents: Math.round(amount * 100),
        status: "new",
        order_type: orderType,
      };
      if (orderType === "package") {
        payload.package_sessions_total = parseInt(modal.querySelector("#packageSessions").value, 10) || 10;
        const validUntil = modal.querySelector("#packageValidUntil").value;
        if (validUntil) payload.package_valid_until = validUntil;
      }
      if (orderType === "retainer") {
        payload.recurrence_interval_days = parseInt(modal.querySelector("#retainerInterval").value, 10) || 30;
      }
      try {
        const { data, error } = await sb.from("orders").insert(withTenantScope(payload)).select("*").single();
        if (error) throw error;
        CRM_ORDERS_CACHE = [data, ...CRM_ORDERS_CACHE];
        ACTIVE_ORDER_ID = data.id;
        TABS_LOADED.delete("orders");
        FETCH_OFFSETS.orders = 0;
        renderOrders();
        renderDashboard();
        showToast("Order created.");
        modal.remove();
      } catch (err) {
        msgEl.textContent = err.message || "Failed to create order.";
        msgEl.style.color = "#f87171";
        saveBtn.disabled = false;
        saveBtn.textContent = "Create order";
      }
    };
  }

  $("btnNewOrderManual")?.addEventListener("click", openCreateOrderModal);

  btnRefreshOrders?.addEventListener("click", async () => {
    try {
      await Promise.all([fetchCrmOrders(), fetchJobs(), fetchServicePlans()]);
      renderOrders();
      renderJobs(jobSearch?.value || "");
      renderPlans(planSearch?.value || "");
      renderDashboard();
      renderGuidance();
    } catch (err) {
      notifyOperator(err.message || String(err));
    }
  });

  btnRefreshGuidance?.addEventListener("click", () => {
    renderGuidance();
    renderDashboard();
  });

  btnExportOrders?.addEventListener("click", exportOrdersJson);

  $("btnExportOrdersCsv")?.addEventListener("click", () => {
    const rows = CRM_ORDERS_CACHE;
    if (!rows.length) {
      notifyOperator("There are no work records to export yet.");
      return;
    }
    const headers = ["id", "customer_name", "email", "phone", "status", "fulfillment", "scheduled_date", "total_cents", "total_amount", "source_type", "created_at", "updated_at"];
    downloadCsv("orders", headers, rows.map((row) => headers.map((header) => row[header] ?? "")));
  });

  $("btnBulkStatusApply")?.addEventListener("click", async () => {
    const status = $("bulkStatusSelect")?.value;
    if (!status) {
      setInlineMessage($("bulkMsg"), "Choose a status first.", "error");
      return;
    }
    if (!BULK_SELECTED_ORDER_IDS.size) {
      setInlineMessage($("bulkMsg"), "No orders selected.", "error");
      return;
    }
    const confirmed = await showConfirmModal(`Change ${BULK_SELECTED_ORDER_IDS.size} order(s) to "${status}"?`, "Yes, update all", "Cancel");
    if (!confirmed) return;

    const ids = Array.from(BULK_SELECTED_ORDER_IDS);
    const now = new Date().toISOString();
    const { error } = await sb.from("orders")
      .update({ status, updated_at: now })
      .in("id", ids)
      .eq(OPERATOR_COLUMN, opId())
      .eq(TENANT_COLUMN, TENANT_ID);

    if (error) {
      notifyOperator(`Bulk update failed: ${error.message}`);
      return;
    }
    CRM_ORDERS_CACHE = CRM_ORDERS_CACHE.map((order) => ids.includes(order.id) ? { ...order, status, updated_at: now } : order);
    BULK_SELECTED_ORDER_IDS.clear();
    updateBulkBar();
    TABS_LOADED.delete("orders");
    FETCH_OFFSETS.orders = 0;
    renderOrders();
    renderDashboard();
  });

  $("btnBulkClear")?.addEventListener("click", () => {
    BULK_SELECTED_ORDER_IDS.clear();
    updateBulkBar();
    renderOrders();
  });

  if (btnImportBridgeOrders) {
    btnImportBridgeOrders.hidden = true;
    btnImportBridgeOrders.disabled = true;
  }

  const tools = {
    openCreateOrderModal,
    updateBulkBar,
    exportOrdersJson,
  };

  global.PROOFLINK_OPERATOR_ORDER_TOOLS = {
    ...(global.PROOFLINK_OPERATOR_ORDER_TOOLS || {}),
    ...tools,
  };
  Object.assign(global, tools);
})(window);
