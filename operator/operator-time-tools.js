// Time-entry helpers extracted from operator.js
// so order-level time logging lives outside the main shell.
async function renderTimeEntries(orderId) {
  const body = document.getElementById("timeLoggedBody");
  if (!body || body.style.display === "none") return;
  body.innerHTML = `<div class="muted" style="font-size:.82rem;">Loading...</div>`;
  const entries = await fetchTimeEntries(orderId);
  if (!entries.length) {
    body.innerHTML = `<div class="muted" style="font-size:.82rem;">No time entries yet. Log time here to keep invoicing accurate.</div>`;
    return;
  }

  const totalMins = entries.reduce((sum, entry) => sum + Number(entry.duration_minutes || 0), 0);
  const totalBillable = entries.reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);

  body.innerHTML = `
    <table style="width:100%;font-size:.8rem;border-collapse:collapse;">
      <thead><tr style="color:rgba(255,255,255,.35);">
        <th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Date</th>
        <th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Description</th>
        <th style="text-align:right;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Duration</th>
        <th style="text-align:right;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Billable?</th>
        <th style="text-align:right;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">Cost</th>
      </tr></thead>
      <tbody>${entries.map((entry) => {
        const mins = Number(entry.duration_minutes || 0);
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        const dur = hrs ? `${hrs}h ${rem}m` : `${rem}m`;
        const date = entry.started_at ? new Date(entry.started_at).toLocaleDateString() : (entry.date || "");
        return `<tr>
          <td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${escapeHtml(date)}</td>
          <td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${escapeHtml(entry.description || "")}</td>
          <td style="text-align:right;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${dur}</td>
          <td style="text-align:right;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${entry.billable ? "Yes" : "No"}</td>
          <td style="text-align:right;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${entry.billable && entry.amount_cents ? formatUsd(entry.amount_cents) : "--"}</td>
        </tr>`;
      }).join("")}
      </tbody>
      <tfoot><tr style="font-weight:600;">
        <td colspan="2" style="padding:6px 6px 2px;">Total</td>
        <td style="text-align:right;padding:6px 6px 2px;">${(totalMins / 60).toFixed(2)} hrs</td>
        <td></td>
        <td style="text-align:right;padding:6px 6px 2px;">${totalBillable ? formatUsd(totalBillable) : "--"}</td>
      </tr></tfoot>
    </table>
    <button id="btnTimeToInvoice" class="btn btn-ghost" style="margin-top:8px;font-size:.78rem;">Add uninvoiced hours to invoice</button>`;
}

function openLogTimeModal(orderId) {
  const existing = document.getElementById("logTimeModal");
  if (existing) {
    existing.remove();
    return;
  }

  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const defaultStarted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const modal = document.createElement("div");
  modal.id = "logTimeModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:480px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Log time entry</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="ltDesc" class="input" placeholder="Description *" style="width:100%;" />
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Started at</label>
            <input id="ltStartedAt" type="datetime-local" class="input" value="${defaultStarted}" style="width:100%;" />
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Duration (minutes)</label>
            <input id="ltDurationMins" type="number" min="1" step="1" placeholder="e.g. 60" class="input" style="width:100%;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Or, enter an end time</label>
            <input id="ltEndedAt" type="datetime-local" class="input" style="width:100%;" />
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div style="flex:1;">
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Hourly rate ($)</label>
            <input id="ltHourlyRate" type="number" min="0" step="0.01" placeholder="75.00" class="input" style="width:100%;" />
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding-top:18px;">
            <input id="ltBillable" type="checkbox" checked style="width:16px;height:16px;cursor:pointer;" />
            <label for="ltBillable" style="font-size:.85rem;color:#e8e9eb;cursor:pointer;">Billable</label>
          </div>
        </div>
      </div>
      <div id="ltMsg" style="font-size:.8rem;color:#f87171;min-height:18px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('logTimeModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="ltSave" class="btn btn-primary">Save entry</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("ltSave").onclick = async () => {
    const desc = (document.getElementById("ltDesc")?.value || "").trim();
    const startedAt = document.getElementById("ltStartedAt")?.value || "";
    const durationRaw = document.getElementById("ltDurationMins")?.value;
    const endedAt = document.getElementById("ltEndedAt")?.value || "";
    const billable = document.getElementById("ltBillable")?.checked ?? true;
    const rateRaw = document.getElementById("ltHourlyRate")?.value;
    const msgEl = document.getElementById("ltMsg");

    if (!desc) {
      msgEl.textContent = "Description is required.";
      return;
    }
    if (!startedAt) {
      msgEl.textContent = "Started at is required.";
      return;
    }
    if (!durationRaw && !endedAt) {
      msgEl.textContent = "Provide duration or ended at.";
      return;
    }

    const btn = document.getElementById("ltSave");
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
      const tok = await getAccessToken();
      const payload = {
        order_id: orderId,
        description: desc,
        started_at: new Date(startedAt).toISOString(),
        billable,
      };
      if (durationRaw) {
        payload.duration_minutes = parseInt(durationRaw, 10);
      } else {
        payload.ended_at = new Date(endedAt).toISOString();
      }
      if (rateRaw) {
        payload.hourly_rate_cents = Math.round(parseFloat(rateRaw) * 100);
      }

      const res = await fetch("/.netlify/functions/log-time-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save entry");
      }
      showToast("Time entry logged.");
      modal.remove();

      const body = document.getElementById("timeLoggedBody");
      const span = document.getElementById("timeLoggedToggle")?.querySelector("span");
      if (body) {
        body.style.display = "block";
        if (span) span.textContent = "Time logged";
        await renderTimeEntries(orderId);
      }
    } catch (err) {
      if (msgEl) msgEl.textContent = "Error: " + err.message;
      btn.disabled = false;
      btn.textContent = "Save entry";
    }
  };
}

const TIME_TOOLS_HELPERS = {
  renderTimeEntries,
  openLogTimeModal,
};

window.PROOFLINK_OPERATOR_TIME_TOOLS = {
  ...(window.PROOFLINK_OPERATOR_TIME_TOOLS || {}),
  ...TIME_TOOLS_HELPERS,
};

Object.assign(window, TIME_TOOLS_HELPERS);
