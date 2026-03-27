// Time-entry helpers extracted from operator.js
// so order-level time logging lives outside the main shell.
async function renderTimeEntries(orderId) {
  const body = document.getElementById("timeLoggedBody");
  if (!body || body.style.display === "none") return;
  body.innerHTML = `<div class="muted table-empty">Loading...</div>`;
  const entries = await fetchTimeEntries(orderId);
  if (!entries.length) {
    body.innerHTML = `<div class="muted table-empty">No time entries yet. Log time here to keep invoicing accurate.</div>`;
    return;
  }

  const totalMins = entries.reduce((sum, entry) => sum + Number(entry.duration_minutes || 0), 0);
  const totalBillable = entries.reduce((sum, entry) => sum + Number(entry.amount_cents || 0), 0);

  body.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Date</th>
        <th>Description</th>
        <th class="data-table__num">Duration</th>
        <th class="data-table__num">Billable?</th>
        <th class="data-table__num">Cost</th>
      </tr></thead>
      <tbody>${entries.map((entry) => {
        const mins = Number(entry.duration_minutes || 0);
        const hrs = Math.floor(mins / 60);
        const rem = mins % 60;
        const dur = hrs ? `${hrs}h ${rem}m` : `${rem}m`;
        const date = entry.started_at ? new Date(entry.started_at).toLocaleDateString() : (entry.date || "");
        return `<tr>
          <td>${escapeHtml(date)}</td>
          <td>${escapeHtml(entry.description || "")}</td>
          <td class="data-table__num">${dur}</td>
          <td class="data-table__num">${entry.billable ? "Yes" : "No"}</td>
          <td class="data-table__num">${entry.billable && entry.amount_cents ? formatUsd(entry.amount_cents) : "--"}</td>
        </tr>`;
      }).join("")}
      </tbody>
      <tfoot><tr>
        <td colspan="2">Total</td>
        <td class="data-table__num">${(totalMins / 60).toFixed(2)} hrs</td>
        <td></td>
        <td class="data-table__num">${totalBillable ? formatUsd(totalBillable) : "--"}</td>
      </tr></tfoot>
    </table>
    <button id="btnTimeToInvoice" class="btn btn-ghost btn-sm u-mt-10" type="button">Add uninvoiced hours to invoice</button>`;
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
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title u-mb-18">Log time entry</h3>
      <div class="modal-stack u-mb-18">
        <input id="ltDesc" class="input u-full-width" placeholder="Description *" />
        <div class="modal-grid-2">
          <div class="modal-grid-2__fill">
            <label class="section-heading-note">Started at</label>
            <input id="ltStartedAt" type="datetime-local" class="input u-full-width" value="${defaultStarted}" />
          </div>
        </div>
        <div class="modal-grid-2">
          <div class="modal-grid-2__fill">
            <label class="section-heading-note">Duration (minutes)</label>
            <input id="ltDurationMins" type="number" min="1" step="1" placeholder="e.g. 60" class="input u-full-width" />
          </div>
          <div class="modal-grid-2__fill">
            <label class="section-heading-note">Or, enter an end time</label>
            <input id="ltEndedAt" type="datetime-local" class="input u-full-width" />
          </div>
        </div>
        <div class="modal-grid-2">
          <div class="modal-grid-2__fill">
            <label class="section-heading-note">Hourly rate ($)</label>
            <input id="ltHourlyRate" type="number" min="0" step="0.01" placeholder="75.00" class="input u-full-width" />
          </div>
          <div class="modal-check">
            <input id="ltBillable" class="modal-check__input" type="checkbox" checked />
            <label for="ltBillable" class="modal-check__label">Billable</label>
          </div>
        </div>
      </div>
      <div id="ltMsg" class="msg u-mb-10"></div>
      <div class="modal-footer">
        <span></span>
        <div class="action-row">
          <button id="ltCancel" class="btn btn-ghost" type="button">Cancel</button>
          <button id="ltSave" class="btn btn-primary" type="button">Save entry</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("ltCancel")?.addEventListener("click", () => modal.remove());

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
      msgEl.className = "msg error u-mb-10";
      return;
    }
    if (!startedAt) {
      msgEl.textContent = "Started at is required.";
      msgEl.className = "msg error u-mb-10";
      return;
    }
    if (!durationRaw && !endedAt) {
      msgEl.textContent = "Provide duration or ended at.";
      msgEl.className = "msg error u-mb-10";
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
      if (msgEl) {
        msgEl.textContent = "Error: " + err.message;
        msgEl.className = "msg error u-mb-10";
      }
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
