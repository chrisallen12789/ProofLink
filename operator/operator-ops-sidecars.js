// Operational sidecars extracted from operator.js so lower-priority workspace
// helpers can load on demand instead of inflating the main shell.
(function attachOperatorOpsSidecars(global) {
  let availabilityBlocksCache = [];
  let bindingsReady = false;

  function runtime() {
    return global.PROOFLINK_OPERATOR_RUNTIME || {};
  }

  function getAccessToken() {
    return runtime().getAccessToken?.() || Promise.resolve("");
  }

  function getOrdersCache() {
    return runtime().getOrdersCache?.() || [];
  }

  async function loadAvailabilityBlocks() {
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/manage-availability-blocks", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const payload = await res.json().catch(() => ({}));
      availabilityBlocksCache = payload.blocks || [];
    } catch (_) {
      availabilityBlocksCache = [];
    }
    renderAvailabilityBlocks();
  }

  function renderAvailabilityBlocks() {
    const el = global.$?.("availabilityBlocksList");
    if (!el) return;
    if (!availabilityBlocksCache.length) {
      el.innerHTML = '<div class="muted" style="font-size:.82rem;">No date blocks yet. Click <strong>+ Add Block</strong> above to pause bookings during vacations or off-season.</div>';
      return;
    }
    el.innerHTML = availabilityBlocksCache.map((row) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);">
        <div>
          <div style="font-weight:500;color:#e8e9eb;">${global.escapeHtml(row.title || "Unavailable")}</div>
          <div style="font-size:.78rem;color:rgba(255,255,255,.4);">
            ${new Date(row.starts_at).toLocaleDateString()} – ${new Date(row.ends_at).toLocaleDateString()}
            ${row.block_bookings ? ' · <span style="color:#fbbf24;">Blocks new bookings</span>' : ""}
          </div>
        </div>
        <button class="btn btn-ghost" style="font-size:.72rem;" data-delete-avail-block="${global.escapeAttr(row.id)}">Delete</button>
      </div>`).join("");

    el.querySelectorAll("[data-delete-avail-block]").forEach((button) => {
      button.addEventListener("click", () => deleteAvailBlock(button.getAttribute("data-delete-avail-block")));
    });
  }

  async function deleteAvailBlock(id) {
    if (!(await global.showConfirmModal("Delete this date block?", "Delete", "Cancel"))) return;
    const tok = await getAccessToken();
    await fetch(`/.netlify/functions/manage-availability-blocks?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tok}` },
    });
    await loadAvailabilityBlocks();
  }

  function openAvailabilityBlockModal() {
    const existing = global.document.getElementById("addAvailBlockModal");
    if (existing) {
      existing.remove();
      return;
    }
    const modal = global.document.createElement("div");
    modal.id = "addAvailBlockModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
    modal.innerHTML = `
      <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px 28px;max-width:400px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 16px;font-size:1rem;color:#e8e9eb;">Block dates</h3>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
          <input id="abTitle" class="input" placeholder="Label (e.g. Winter break, Vacation)" style="width:100%;" />
          <div style="display:flex;gap:8px;">
            <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">From</label>
              <input id="abStart" type="date" class="input" style="width:100%;" /></div>
            <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">To</label>
              <input id="abEnd" type="date" class="input" style="width:100%;" /></div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer;">
            <input id="abBlockBookings" type="checkbox" checked /> Block new customer bookings during this period
          </label>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" id="abCancel" class="btn btn-ghost">Cancel</button>
          <button type="button" id="abSave" class="btn btn-primary">Save block</button>
        </div>
      </div>`;
    global.document.body.appendChild(modal);
    global.document.getElementById("abCancel").onclick = () => modal.remove();
    global.document.getElementById("abSave").onclick = async () => {
      const starts = global.$?.("abStart")?.value;
      const ends = global.$?.("abEnd")?.value;
      if (!starts || !ends) {
        global.notifyOperator("Add both a start and end date.");
        return;
      }
      if (starts > ends) {
        global.notifyOperator("The start date needs to come before the end date.");
        return;
      }
      const btn = global.$?.("abSave");
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        const tok = await getAccessToken();
        const res = await fetch("/.netlify/functions/manage-availability-blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            title: (global.$?.("abTitle")?.value || "").trim() || "Unavailable",
            starts_at: starts,
            ends_at: ends,
            block_bookings: global.$?.("abBlockBookings")?.checked !== false,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        global.showToast("Date block saved.");
        modal.remove();
        await loadAvailabilityBlocks();
      } catch (err) {
        global.showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = "Save block";
      }
    };
  }

  function renderPackagesSummary() {
    const card = global.$?.("packagesSummaryCard");
    const list = global.$?.("packagesSummaryList");
    if (!card || !list) return;
    const packages = getOrdersCache().filter((row) => row.order_type === "package" && !row.is_deleted);
    if (!packages.length) {
      card.classList.add("u-hidden");
      return;
    }
    card.classList.remove("u-hidden");
    list.innerHTML = packages.map((row) => {
      const used = Number(row.package_sessions_used || 0);
      const total = Number(row.package_sessions_total || 0);
      const remaining = Math.max(0, total - used);
      const pct = total > 0 ? Math.round((remaining / total) * 100) : 0;
      const expiry = row.package_valid_until ? ` · expires ${new Date(row.package_valid_until).toLocaleDateString()}` : "";
      const customerName = row.customer_name || row.email || "Unknown";
      const tone = remaining === 0 ? "#ef4444" : remaining <= 2 ? "#fbbf24" : "#34d399";
      return `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <div><span style="font-weight:500;color:#e8e9eb;">${global.escapeHtml(customerName)}</span> <span style="color:rgba(255,255,255,.4);font-size:.8rem;">${global.escapeHtml(row.title || "")}</span></div>
          <span style="font-size:.8rem;font-weight:600;color:${tone};">${remaining} / ${total} remaining</span>
        </div>
        <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;">
          <div style="height:100%;width:${pct}%;background:${tone};border-radius:2px;transition:width .3s;"></div>
        </div>
        <div style="font-size:.72rem;color:rgba(255,255,255,.3);margin-top:3px;">${expiry}</div>
      </div>`;
    }).join("");
  }

  async function loadPhasesIntoEl(orderId, bodyEl) {
    try {
      const tok = await getAccessToken();
      const res = await fetch(`/.netlify/functions/manage-project-phases?order_id=${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const payload = await res.json().catch(() => ({}));
      const phases = payload.phases || [];
      if (!phases.length) {
        bodyEl.innerHTML = '<div class="muted" style="font-size:.82rem;">No payment phases yet. Use <strong>+ Phase</strong> to break this project into milestones and track deposits or staged payments.</div>';
        return;
      }
      const totalPhased = phases.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
      bodyEl.innerHTML = `
        <div style="margin-bottom:8px;font-size:.78rem;color:rgba(255,255,255,.4);">Total phased: ${global.formatUsd(totalPhased)}</div>
        ${phases.sort((a, b) => a.phase_number - b.phase_number).map((row) => {
          const statusColor = row.status === "completed" ? "#34d399" : row.status === "invoiced" ? "#60a5fa" : row.status === "in_progress" ? "#fbbf24" : "rgba(255,255,255,.3)";
          return `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);">
            <div style="background:${statusColor};color:#12141c;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;flex-shrink:0;">${row.phase_number}</div>
            <div style="flex:1;">
              <div style="font-weight:500;color:#e8e9eb;">${global.escapeHtml(row.title)}</div>
              ${row.description ? `<div style="font-size:.75rem;color:rgba(255,255,255,.4);">${global.escapeHtml(row.description)}</div>` : ""}
              <div style="font-size:.75rem;color:rgba(255,255,255,.35);">${global.formatUsd(row.amount_cents)}${row.due_date ? ` · due ${new Date(row.due_date).toLocaleDateString()}` : ""}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
              <span style="font-size:.7rem;font-weight:600;color:${statusColor};text-transform:uppercase;">${row.status}</span>
              ${row.status !== "completed" && row.status !== "invoiced" ? `<button class="btn btn-ghost" style="font-size:.7rem;padding:2px 6px;" data-phase-complete="${global.escapeAttr(row.id)}" data-phase-order="${global.escapeAttr(orderId)}">Mark done</button>` : ""}
            </div>
          </div>`;
        }).join("")}`;

      bodyEl.querySelectorAll("[data-phase-complete]").forEach((button) => {
        button.addEventListener("click", () => {
          markPhaseComplete(button.getAttribute("data-phase-complete"), button.getAttribute("data-phase-order")).catch(console.error);
        });
      });
    } catch (err) {
      bodyEl.innerHTML = `<div class="muted" style="font-size:.82rem;">Error loading phases: ${global.escapeHtml(err.message)}</div>`;
    }
  }

  async function markPhaseComplete(phaseId, orderId) {
    const tok = await getAccessToken();
    await fetch("/.netlify/functions/manage-project-phases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ id: phaseId, status: "completed", completed_at: new Date().toISOString() }),
    });
    global.showToast("Phase marked complete.");
    const body = global.document.getElementById("phasesBody");
    if (body && body.style.display !== "none") await loadPhasesIntoEl(orderId, body);
  }

  function openAddPhaseModal(orderId) {
    const existing = global.document.getElementById("addPhaseModal");
    if (existing) {
      existing.remove();
      return;
    }
    const modal = global.document.createElement("div");
    modal.id = "addPhaseModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
    modal.innerHTML = `
      <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px 28px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 16px;font-size:1rem;color:#e8e9eb;">Add project phase</h3>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">
          <input id="phTitle" class="input" placeholder="Phase name *" style="width:100%;" />
          <textarea id="phDesc" class="input" rows="2" placeholder="Description (optional)" style="width:100%;resize:vertical;"></textarea>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Phase #</label>
              <input id="phNum" type="number" min="1" value="1" class="input" style="width:100%;" /></div>
            <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Billing amount ($)</label>
              <input id="phAmount" type="number" min="0" step="0.01" placeholder="0.00" class="input" style="width:100%;" /></div>
            <div style="flex:1;"><label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Due date</label>
              <input id="phDue" type="date" class="input" style="width:100%;" /></div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" id="phCancel" class="btn btn-ghost">Cancel</button>
          <button type="button" id="phSave" class="btn btn-primary">Add phase</button>
        </div>
      </div>`;
    global.document.body.appendChild(modal);
    global.document.getElementById("phCancel").onclick = () => modal.remove();
    global.document.getElementById("phSave").onclick = async () => {
      const title = (global.$?.("phTitle")?.value || "").trim();
      if (!title) {
        global.notifyOperator("Add a phase name first.");
        return;
      }
      const btn = global.$?.("phSave");
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        const tok = await getAccessToken();
        const res = await fetch("/.netlify/functions/manage-project-phases", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            order_id: orderId,
            title,
            description: (global.$?.("phDesc")?.value || "").trim() || undefined,
            phase_number: parseInt(global.$?.("phNum")?.value || 1, 10),
            amount_cents: Math.round(parseFloat(global.$?.("phAmount")?.value || 0) * 100),
            due_date: global.$?.("phDue")?.value || undefined,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        global.showToast("Phase added.");
        modal.remove();
        const body = global.document.getElementById("phasesBody");
        if (body) await loadPhasesIntoEl(orderId, body);
      } catch (err) {
        global.showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = "Add phase";
      }
    };
  }

  function initIdleTimer() {
    const WARN_MS = 25 * 60 * 1000;
    const LOGOUT_MS = 30 * 60 * 1000;
    let warnTimer;
    let logoutTimer;
    let banner;

    function showIdleBanner() {
      if (banner) return;
      banner = global.document.createElement("div");
      banner.id = "idleBanner";
      banner.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e2029;border:1px solid rgba(200,75,47,.5);border-radius:8px;padding:14px 20px;color:#e8e9eb;font-size:.85rem;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 24px rgba(0,0,0,.4);";
      banner.innerHTML = '<span>You\\'ll be signed out in 5 minutes due to inactivity.</span><button type="button" id="idleBannerStay" style="background:#c84b2f;color:#fff;border:none;border-radius:4px;padding:6px 14px;font-size:.8rem;cursor:pointer;font-weight:600;">Stay signed in</button>';
      global.document.body.appendChild(banner);
      global.document.getElementById("idleBannerStay")?.addEventListener("click", () => {
        global.document.getElementById("idleBanner")?.remove();
        global._idleReset?.();
      });
    }

    function reset() {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      if (banner) {
        banner.remove();
        banner = null;
      }
      warnTimer = setTimeout(showIdleBanner, WARN_MS);
      logoutTimer = setTimeout(async () => {
        const sb = runtime().getSupabase?.() || global.sb;
        const { error } = await sb.auth.signOut();
        if (!error) global.location.reload();
      }, LOGOUT_MS);
    }

    global._idleReset = reset;
    ["mousemove", "keydown", "click", "touchstart"].forEach((eventName) => {
      global.document.addEventListener(eventName, reset, { passive: true });
    });
    reset();
  }

  async function refreshVendorsWorkspace() {
    await global.fetchVendors();
    global.renderVendors();
  }

  function openAddVendorModal() {
    const existing = global.document.getElementById("addVendorModal");
    if (existing) {
      existing.remove();
      return;
    }
    const modal = global.document.createElement("div");
    modal.id = "addVendorModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
    modal.innerHTML = `
      <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:440px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Add vendor / subcontractor</h3>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
          <input id="vName" class="input" placeholder="Name *" style="width:100%;" />
          <input id="vCompany" class="input" placeholder="Company" style="width:100%;" />
          <div style="display:flex;gap:8px;">
            <input id="vEmail" class="input" placeholder="Email" style="flex:1;" />
            <input id="vPhone" class="input" placeholder="Phone" style="flex:1;" />
          </div>
          <input id="vTrade" class="input" placeholder="Trade / specialty (e.g. Electrical, Plumbing)" style="width:100%;" />
          <textarea id="vNotes" class="input" rows="2" placeholder="Notes" style="width:100%;resize:vertical;"></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" id="avCancel" class="btn btn-ghost">Cancel</button>
          <button type="button" id="avSave" class="btn btn-primary">Save vendor</button>
        </div>
      </div>`;
    global.document.body.appendChild(modal);
    global.document.getElementById("avCancel").onclick = () => modal.remove();
    global.document.getElementById("avSave").onclick = async () => {
      const name = (global.document.getElementById("vName")?.value || "").trim();
      if (!name) {
        global.notifyOperator("Add a name first.");
        return;
      }
      const btn = global.document.getElementById("avSave");
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        const tok = await getAccessToken();
        const res = await fetch("/.netlify/functions/manage-vendors", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            name,
            company: global.document.getElementById("vCompany")?.value.trim() || undefined,
            email: global.document.getElementById("vEmail")?.value.trim() || undefined,
            phone: global.document.getElementById("vPhone")?.value.trim() || undefined,
            trade: global.document.getElementById("vTrade")?.value.trim() || undefined,
            notes: global.document.getElementById("vNotes")?.value.trim() || undefined,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        global.showToast("Vendor saved.");
        modal.remove();
        await refreshVendorsWorkspace();
      } catch (err) {
        global.showToast(`Error: ${err.message}`);
        btn.disabled = false;
        btn.textContent = "Save vendor";
      }
    };
  }

  function bindOpsSidecars() {
    if (bindingsReady) return;
    bindingsReady = true;
    global.$?.("btnAddAvailBlock")?.addEventListener("click", openAvailabilityBlockModal);
    global.$?.("btnRefreshVendors")?.addEventListener("click", () => refreshVendorsWorkspace().catch(console.error));
    global.$?.("btnAddVendor")?.addEventListener("click", openAddVendorModal);
  }

  initIdleTimer();
  bindOpsSidecars();

  const workspace = {
    bindOpsSidecars,
    loadAvailabilityBlocks,
    renderAvailabilityBlocks,
    deleteAvailBlock,
    renderPackagesSummary,
    loadPhasesIntoEl,
    markPhaseComplete,
    openAddPhaseModal,
    refreshVendorsWorkspace,
    openAddVendorModal,
  };

  global.PROOFLINK_OPERATOR_OPS_SIDECARS = {
    ...(global.PROOFLINK_OPERATOR_OPS_SIDECARS || {}),
    ...workspace,
  };

  Object.assign(global, {
    loadAvailabilityBlocks,
    renderPackagesSummary,
    loadPhasesIntoEl,
    markPhaseComplete,
    openAddPhaseModal,
  });
})(window);
