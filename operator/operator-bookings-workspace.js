// Scheduling workspace extracted from operator.js so bookings, rescheduling,
// walk-ins, and quick time logging can evolve together.
async function fetchBookings() {
  if (FETCHING.has("bookings")) return;
  FETCHING.add("bookings");
  try {
    const tok = await getAccessToken();
    const year = BK_VIEW_DATE.getFullYear();
    const month = BK_VIEW_DATE.getMonth();
    const start = new Date(year, month, 1).toISOString().slice(0, 10);
    const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    const res = await fetch(`/.netlify/functions/get-bookings?start=${start}&end=${end}`, {
      headers: { Authorization: `Bearer ${tok}` },
      signal: _tabAbortController?.signal,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to fetch bookings");
    BOOKINGS_CACHE = (d.bookings || []).filter((booking) => !booking.is_deleted);
    return BOOKINGS_CACHE;
  } catch (err) {
    if (err.name === "AbortError" || err.message?.includes("abort")) return;
    throw err;
  } finally {
    FETCHING.delete("bookings");
  }
}

async function fetchOperatorMembers() {
  if (OPERATOR_MEMBERS_CACHE.length) return OPERATOR_MEMBERS_CACHE;
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/get-operator-members", {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(d.members)) {
      OPERATOR_MEMBERS_CACHE = d.members;
    }
  } catch (_) {}
  return OPERATOR_MEMBERS_CACHE;
}

function computeBookingRecurrenceCount(rule, baseDate, endDate) {
  const cleanRule = String(rule || "").trim().toUpperCase();
  if (!cleanRule || !baseDate || !endDate) return { count: null, message: "—" };

  const start = new Date(`${baseDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { count: null, message: "—" };
  }
  if (end <= start) {
    return { count: null, message: "End date must be after start date." };
  }

  const intervalDays = cleanRule === "DAILY"
    ? 1
    : cleanRule === "WEEKLY"
      ? 7
      : cleanRule === "BIWEEKLY"
        ? 14
        : 30;

  let count = 0;
  let current = new Date(start.getTime() + intervalDays * 86400000);
  while (current <= end) {
    count += 1;
    current = new Date(current.getTime() + intervalDays * 86400000);
  }
  return {
    count,
    message: `${count} recurring instance${count === 1 ? "" : "s"} will be created`,
  };
}

function renderBookingsCalendar(bookings) {
  const cal = $("bookingsCalendar");
  const label = $("bkMonthLabel");
  if (!cal) return;

  const year = BK_VIEW_DATE.getFullYear();
  const month = BK_VIEW_DATE.getMonth();
  const monthName = BK_VIEW_DATE.toLocaleString(undefined, { month: "long", year: "numeric" });
  if (label) label.textContent = monthName;

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDate = {};

  (bookings || []).forEach((booking) => {
    const dateKey = String(booking.starts_at || "").slice(0, 10);
    if (!dateKey) return;
    (byDate[dateKey] ||= []).push(booking);
  });

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(`<div class="cal-cell empty"></div>`);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateStr = date.toISOString().slice(0, 10);
    const dayBookings = byDate[dateStr] || [];
    const dots = dayBookings.length
      ? `<div class="cal-dots">${dayBookings.slice(0, 3).map(() => `<span class="cal-dot"></span>`).join("")}</div>`
      : `<div class="cal-dots"></div>`;
    const isToday = date.toDateString() === new Date().toDateString();
    cells.push(`
      <button type="button" class="cal-cell ${isToday ? "today" : ""}" data-bk-date="${dateStr}">
        <div class="cal-num">${day}</div>
        ${dots}
      </button>
    `);
  }

  cal.innerHTML = cells.join("");
  cal.querySelectorAll("[data-bk-date]").forEach((button) => {
    button.addEventListener("click", () => {
      const date = button.getAttribute("data-bk-date");
      renderBookingsList(bookings.filter((booking) => booking.starts_at?.slice(0, 10) === date));
      const listLabel = $("bkListLabel");
      if (listLabel) listLabel.textContent = new Date(`${date}T00:00:00`).toLocaleDateString();
    });
  });
}

function showBookingDetail(booking) {
  const existing = document.getElementById("bkDetailModal");
  if (existing) {
    existing.remove();
    return;
  }

  const assignedLabel = booking.assigned_operator_name
    || booking.assigned_operator?.display_name
    || booking.assigned_operator?.email
    || "";
  const operatorOptions = [`<option value="">Unassigned</option>`];
  if (booking.assigned_operator_id && assignedLabel) {
    operatorOptions.push(`<option value="${escapeAttr(booking.assigned_operator_id)}" selected>${escapeHtml(assignedLabel)}</option>`);
  }

  const localStartDate = booking.starts_at ? new Date(booking.starts_at) : null;
  const localEndDate = booking.ends_at ? new Date(booking.ends_at) : null;
  const localDate = localStartDate ? localStartDate.toISOString().slice(0, 10) : "";
  const localStart = localStartDate ? localStartDate.toTimeString().slice(0, 5) : "";
  const localEnd = localEndDate ? localEndDate.toTimeString().slice(0, 5) : "";

  const overlay = document.createElement("div");
  overlay.id = "bkDetailModal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:24px 28px;max-width:460px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div>
          <div style="font-size:1rem;font-weight:600;color:#e8e9eb;">${escapeHtml(booking.title || "Booking")}</div>
          <div style="font-size:.82rem;color:rgba(255,255,255,.45);">${escapeHtml(booking.customer_name || booking.customer_email || "Customer")}</div>
        </div>
        <button id="bkDetailClose" type="button" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:1.2rem;cursor:pointer;padding:0 4px;">×</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:4px;">Assigned to</label>
          <select id="bkAssignedOperator" class="input" style="width:100%;">
            ${operatorOptions.join("")}
          </select>
        </div>
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:4px;">Vehicle / crew notes</label>
          <input id="bkVehicleNotes" class="input" value="${escapeAttr(booking.notes_vehicle || "")}" placeholder="e.g. silver van, plate ABC123" style="width:100%;" />
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
          <div>
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Date</label>
            <input id="bkDetailDate" type="date" value="${escapeAttr(localDate)}" class="input" style="width:100%;" />
          </div>
          <div>
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">Start</label>
            <input id="bkDetailStart" type="time" value="${escapeAttr(localStart)}" class="input" style="width:100%;" />
          </div>
          <div>
            <label style="font-size:.72rem;color:rgba(255,255,255,.35);display:block;margin-bottom:2px;">End</label>
            <input id="bkDetailEnd" type="time" value="${escapeAttr(localEnd)}" class="input" style="width:100%;" />
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <span id="bkDetailMsg" style="font-size:.8rem;color:rgba(255,255,255,.5);"></span>
          <button id="bkDetailSave" class="btn btn-primary btn-sm" type="button">Save changes</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("bkDetailClose")?.addEventListener("click", () => overlay.remove());
  fetchOperatorMembers().then((members) => {
    const select = document.getElementById("bkAssignedOperator");
    if (!select) return;
    const selected = booking.assigned_operator_id || "";
    select.innerHTML = [
      `<option value="">Unassigned</option>`,
      ...members.map((member) => `<option value="${escapeAttr(member.id)}"${member.id === selected ? " selected" : ""}>${escapeHtml(member.display_name || member.email || member.id)}</option>`),
    ].join("");
  }).catch(() => {});

  document.getElementById("bkDetailSave")?.addEventListener("click", async () => {
    const saveButton = document.getElementById("bkDetailSave");
    const message = document.getElementById("bkDetailMsg");
    const date = document.getElementById("bkDetailDate")?.value;
    const startTime = document.getElementById("bkDetailStart")?.value;
    const endTime = document.getElementById("bkDetailEnd")?.value;
    const assignedOperatorId = (document.getElementById("bkAssignedOperator")?.value || "").trim();
    const vehicleNotes = (document.getElementById("bkVehicleNotes")?.value || "").trim();
    if (!date || !startTime) {
      if (message) message.textContent = "Choose a date and start time.";
      return;
    }

    const startsAt = new Date(`${date}T${startTime}:00`).toISOString();
    const endsAt = endTime ? new Date(`${date}T${endTime}:00`).toISOString() : null;
    try {
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "Saving…";
      }
      if (message) message.textContent = "";
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/update-booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify({
          id: booking.id,
          starts_at: startsAt,
          ends_at: endsAt,
          assigned_operator_id: assignedOperatorId || null,
          notes_vehicle: vehicleNotes || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to update booking");

      BOOKINGS_CACHE = BOOKINGS_CACHE.map((row) => (
        row.id === booking.id
          ? { ...row, starts_at: startsAt, ends_at: endsAt || row.ends_at, assigned_operator_id: assignedOperatorId || null, notes_vehicle: vehicleNotes || null }
          : row
      ));
      renderBookingsCalendar(BOOKINGS_CACHE);
      renderBookingsList(BOOKINGS_CACHE);
      showToast("Booking updated.");
      overlay.remove();
    } catch (err) {
      if (message) message.textContent = err.message || "Could not update this booking.";
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save changes";
      }
    }
  });
}

function renderBookingsList(bookings) {
  const list = $("bookingsList");
  if (!list) return;

  if (!bookings || !bookings.length) {
    list.innerHTML = `<div class="muted" style="font-size:.85rem;">No bookings here yet.</div>`;
    return;
  }

  list.innerHTML = bookings.map((booking) => `
    <div class="list-item" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
      <div class="li-main">
        <div class="li-title">${escapeHtml(booking.title || "Booking")}</div>
        <div class="li-sub muted">${escapeHtml(booking.customer_name || booking.customer_email || "Customer")}</div>
        <div class="li-sub muted">${escapeHtml(formatDateTime(booking.starts_at))}${booking.assigned_operator_name ? ` · ${escapeHtml(booking.assigned_operator_name)}` : ""}</div>
      </div>
      <div class="li-meta" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
        <span class="pill ${booking.status === "cancelled" ? "pill-off" : "pill-on"}">${escapeHtml(String(booking.status || "scheduled").replace(/_/g, " "))}</span>
        ${booking.customer_email && !["cancelled", "completed", "no_show"].includes(booking.status) && booking.starts_at && new Date(booking.starts_at) > new Date()
          ? `<button class="btn btn-ghost btn-sm bk-remind-btn" data-action="remind" data-booking-id="${booking.id}" type="button">Remind</button>`
          : ""}
        <button class="btn btn-ghost btn-sm bk-cancel-btn" data-action="cancel" data-booking-id="${booking.id}" type="button" ${booking.status === "cancelled" ? "disabled" : ""}>Cancel</button>
        <button class="btn btn-ghost btn-sm bk-detail-btn" data-action="detail" data-booking-id="${booking.id}" type="button">Details</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-action='cancel']").forEach((button) => {
    button.addEventListener("click", async () => {
      const bookingId = button.getAttribute("data-booking-id");
      if (!bookingId) return;
      try {
        const tok = await getAccessToken();
        const res = await fetch("/.netlify/functions/update-booking", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tok}`,
          },
          body: JSON.stringify({ id: bookingId, status: "cancelled" }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Failed to cancel booking");
        await fetchBookings();
        renderBookingsCalendar(BOOKINGS_CACHE);
        renderBookingsList(BOOKINGS_CACHE);
        const listLabel = $("bkListLabel");
        if (listLabel) listLabel.textContent = "Upcoming bookings";
      } catch (err) {
        notifyOperator(err.message || "Error cancelling booking");
      }
    });
  });

  list.querySelectorAll("[data-action='detail']").forEach((button) => {
    button.addEventListener("click", () => {
      const bookingId = button.getAttribute("data-booking-id");
      const booking = BOOKINGS_CACHE.find((row) => row.id === bookingId);
      if (booking) showBookingDetail(booking);
    });
  });

  list.querySelectorAll("[data-action='remind']").forEach((button) => {
    button.addEventListener("click", async () => {
      const bookingId = button.getAttribute("data-booking-id");
      if (!bookingId) return;
      try {
        const tok = await getAccessToken();
        const res = await fetch("/.netlify/functions/send-booking-reminder", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tok}`,
          },
          body: JSON.stringify({ booking_id: bookingId }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Failed to send reminder");
        showToast("Reminder sent.");
      } catch (err) {
        notifyOperator(err.message || "Could not send reminder.");
      }
    });
  });
}

async function renderBookings() {
  try {
    await fetchBookings();
  } catch (err) {
    console.error("[renderBookings]", err);
  }

  renderBookingsCalendar(BOOKINGS_CACHE);
  const myBookingsActive = localStorage.getItem("pl_my_bookings_filter") === "true";
  const btnMyBookings = $("btnMyBookings");
  if (btnMyBookings) {
    btnMyBookings.style.background = myBookingsActive ? "rgba(200,75,47,.2)" : "";
    btnMyBookings.style.color = myBookingsActive ? "var(--accent)" : "";
  }

  let filteredBookings = BOOKINGS_CACHE;
  if (myBookingsActive) {
    const myOperatorId = CURRENT_OPERATOR?.operator_id || CURRENT_OPERATOR?.id || "";
    if (myOperatorId) filteredBookings = BOOKINGS_CACHE.filter((booking) => booking.assigned_operator_id === myOperatorId);
  }

  const upcoming = filteredBookings.filter((booking) => !["cancelled", "completed", "no_show"].includes(String(booking.status || "").toLowerCase()));
  renderBookingsList(upcoming.length ? upcoming : filteredBookings);

  const noShowStat = $("bookingsNoShowStat");
  if (noShowStat) {
    const concluded = BOOKINGS_CACHE.filter((booking) => ["no_show", "completed"].includes(booking.status));
    const noShows = BOOKINGS_CACHE.filter((booking) => booking.status === "no_show");
    noShowStat.textContent = concluded.length ? `${Math.round((noShows.length / concluded.length) * 100)}%` : "—";
  }

  const linkDisplay = $("bookingLinkDisplay");
  if (linkDisplay) {
    const slug = CURRENT_OPERATOR?.tenant_slug || OPERATOR_CONFIG?.tenantSlug || "";
    linkDisplay.textContent = slug ? `${window.location.origin}/${slug}/book.html` : "—";
  }
}

function openWalkInBookingModal() {
  const existing = document.getElementById("walkInModal");
  if (existing) {
    existing.remove();
    return;
  }

  const modal = document.createElement("div");
  modal.id = "walkInModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  const customerOptions = CUSTOMERS_CACHE.map((customer) => (
    `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || "Unknown")}</option>`
  )).join("");

  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Walk-in booking</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Customer</label>
          <select id="wiCustomer" class="input" style="width:100%;">
            <option value="">-- Select or type name --</option>
            ${customerOptions}
          </select>
        </div>
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Service</label>
          <input id="wiService" class="input" placeholder="e.g. Haircut, Oil change, Dog grooming" style="width:100%;" />
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Price ($)</label>
            <input id="wiPrice" type="number" min="0" step="0.01" class="input" placeholder="0.00" style="width:100%;" />
          </div>
          <div style="flex:1;">
            <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Assigned to</label>
            <select id="wiOperator" class="input" style="width:100%;">
              <option value="">Unassigned</option>
              ${(OPERATOR_MEMBERS_CACHE || []).map((member) => `<option value="${escapeAttr(member.id)}">${escapeHtml(member.display_name || member.email || member.id)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:3px;">Notes</label>
          <input id="wiNotes" class="input" placeholder="Optional" style="width:100%;" />
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="wiCancel" class="btn btn-ghost">Cancel</button>
        <button id="wiSave" class="btn btn-primary">Create walk-in</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("wiCancel").onclick = () => modal.remove();
  document.getElementById("wiSave").onclick = async () => {
    const customerId = document.getElementById("wiCustomer")?.value;
    const service = (document.getElementById("wiService")?.value || "").trim();
    const operatorId = document.getElementById("wiOperator")?.value;
    const notes = (document.getElementById("wiNotes")?.value || "").trim();
    if (!service) {
      notifyOperator("Add a service name first.");
      return;
    }

    const button = document.getElementById("wiSave");
    button.disabled = true;
    button.textContent = "Creating…";
    try {
      const tok = await getAccessToken();
      const now = new Date().toISOString();
      const res = await fetch("/.netlify/functions/create-booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify({
          customer_id: customerId || undefined,
          title: service,
          starts_at: now,
          is_walk_in: true,
          assigned_operator_id: operatorId || undefined,
          notes,
          skip_confirmation_email: true,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed");
      showToast("Walk-in created.");
      modal.remove();
      await fetchBookings();
      renderBookings();
    } catch (err) {
      showToast(`Error: ${err.message}`);
      button.disabled = false;
      button.textContent = "Create walk-in";
    }
  };
}

function openTimeLogModal() {
  const existing = document.getElementById("timeLogModal");
  if (existing) {
    existing.remove();
    return;
  }

  const modal = document.createElement("div");
  modal.id = "timeLogModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  const openOrders = CRM_ORDERS_CACHE.filter((order) => !["paid", "cancelled"].includes(String(order.status || "").toLowerCase()));
  const orderOptions = openOrders.map((order) => (
    `<option value="${escapeAttr(order.id)}">${escapeHtml(order.customer_name || order.name || "Order")} — ${escapeHtml(order.title || order.id)}</option>`
  )).join("");

  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:440px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 20px;font-size:1rem;color:#e8e9eb;">Log time</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="tlCustomer" class="input" placeholder="Customer name" />
        <input id="tlDescription" class="input" placeholder="Work description" />
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="tlHours" class="input" type="number" min="0" step="0.25" placeholder="Hours" style="width:90px;" />
          <input id="tlRate" class="input" type="number" min="0" step="1" placeholder="Rate ($/hr)" style="flex:1;" />
          <label style="display:flex;align-items:center;gap:5px;font-size:.8rem;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" id="tlBillable" checked /> Billable
          </label>
        </div>
        <input id="tlDate" class="input" type="date" />
        <div>
          <label style="font-size:.78rem;color:rgba(255,255,255,.45);display:block;margin-bottom:4px;">Link to order (optional)</label>
          <select id="tlOrderLink" class="input" style="width:100%;">
            <option value="">No order linked</option>
            ${orderOptions}
          </select>
        </div>
      </div>
      <div id="tlMsg" style="font-size:.8rem;margin-bottom:10px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="tlCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
        <button id="tlSave" class="btn btn-primary btn-sm" type="button">Save time entry</button>
      </div>
    </div>
  `;

  modal.querySelector("#tlDate").value = new Date().toISOString().slice(0, 10);
  modal.querySelector("#tlCancel").onclick = () => modal.remove();
  modal.querySelector("#tlSave").onclick = async () => {
    const customer = modal.querySelector("#tlCustomer").value.trim();
    const description = modal.querySelector("#tlDescription").value.trim();
    const hours = parseFloat(modal.querySelector("#tlHours").value) || 0;
    const rate = parseFloat(modal.querySelector("#tlRate").value) || 0;
    const date = modal.querySelector("#tlDate").value;
    const billable = modal.querySelector("#tlBillable").checked;
    const orderId = modal.querySelector("#tlOrderLink").value;
    const message = modal.querySelector("#tlMsg");

    if (!hours || !description) {
      message.textContent = "Enter hours and description.";
      message.style.color = "#f87171";
      return;
    }

    const amountCents = billable ? Math.round(hours * rate * 100) : 0;
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/log-time-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify({
          tenant_id: TENANT_ID,
          operator_id: opId(),
          customer: customer || "Time entry",
          description,
          hours,
          rate_per_hour: rate,
          billable,
          amount_cents: amountCents,
          date,
          order_id: orderId || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to save time entry");
      if (d.entry) TIME_ENTRIES_CACHE = [...TIME_ENTRIES_CACHE, d.entry];
      message.textContent = `Logged ${hours}h${billable && rate ? ` = $${(amountCents / 100).toFixed(2)} billable` : ""}`;
      message.style.color = "#4ade80";
      setTimeout(() => modal.remove(), 1500);
    } catch (err) {
      message.textContent = err.message || "Failed to save.";
      message.style.color = "#f87171";
    }
  };
  document.body.appendChild(modal);
}

let BOOKINGS_WORKSPACE_BOUND = false;
function initBookingsWorkspaceBindings() {
  if (BOOKINGS_WORKSPACE_BOUND) return;
  BOOKINGS_WORKSPACE_BOUND = true;

  $("btnMyBookings")?.addEventListener("click", () => {
    const current = localStorage.getItem("pl_my_bookings_filter") === "true";
    localStorage.setItem("pl_my_bookings_filter", current ? "false" : "true");
    renderBookings();
  });

  $("btnWalkIn")?.addEventListener("click", openWalkInBookingModal);
  $("btnNewBooking")?.addEventListener("click", () => {
    const form = $("newBookingForm");
    if (!form) return;
    form.classList.toggle("hidden");
    if (form.classList.contains("hidden")) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const bookingDate = $("bkDate");
    if (bookingDate && !bookingDate.value) bookingDate.value = tomorrow.toISOString().slice(0, 10);
  });
  $("btnCancelBooking")?.addEventListener("click", () => {
    const form = $("newBookingForm");
    if (form) form.classList.add("hidden");
  });
  $("btnLogTime")?.addEventListener("click", openTimeLogModal);
  $("btnRefreshBookings")?.addEventListener("click", () => renderBookings());
  $("btnBkPrev")?.addEventListener("click", async () => {
    BK_VIEW_DATE = new Date(BK_VIEW_DATE.getFullYear(), BK_VIEW_DATE.getMonth() - 1, 1);
    await renderBookings();
  });
  $("btnBkNext")?.addEventListener("click", async () => {
    BK_VIEW_DATE = new Date(BK_VIEW_DATE.getFullYear(), BK_VIEW_DATE.getMonth() + 1, 1);
    await renderBookings();
  });

  const ruleEl = $("bkRecurrenceRule");
  const optionsEl = $("bkRecurrenceOptions");
  const endEl = $("bkRecurrenceEnd");
  const countEl = $("bkRecurrenceCount");
  const updateRecurrenceMessage = () => {
    const result = computeBookingRecurrenceCount(
      ruleEl?.value || "",
      $("bkDate")?.value || "",
      endEl?.value || ""
    );
    if (countEl) countEl.textContent = result.message;
  };
  ruleEl?.addEventListener("change", () => {
    if (optionsEl) optionsEl.style.display = ruleEl.value ? "block" : "none";
    updateRecurrenceMessage();
  });
  endEl?.addEventListener("change", updateRecurrenceMessage);
  $("bkDate")?.addEventListener("change", updateRecurrenceMessage);

  $("btnSaveBooking")?.addEventListener("click", async () => {
    const button = $("btnSaveBooking");
    const message = $("newBookingMsg");
    const name = $("bkCustomerName")?.value.trim();
    const email = $("bkCustomerEmail")?.value.trim();
    const title = $("bkTitle")?.value.trim();
    const date = $("bkDate")?.value;
    const time = $("bkStart")?.value;
    const duration = parseInt($("bkDuration")?.value || "60", 10);
    const notes = $("bkNotes")?.value.trim();
    const recurrenceRule = $("bkRecurrenceRule")?.value || "";
    const recurrenceEnd = $("bkRecurrenceEnd")?.value || "";

    if (message) {
      message.textContent = "";
      message.className = "msg";
    }
    if (!name || !title || !date || !time) {
      if (message) {
        message.textContent = "Please fill in all required fields.";
        message.className = "msg error";
      }
      return;
    }

    const startsAt = new Date(`${date}T${time}:00`).toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60000).toISOString();
    button.disabled = true;
    if (message) {
      message.textContent = "Saving…";
      message.className = "msg";
    }

    try {
      const tok = await getAccessToken();
      const payload = {
        customer_name: name,
        customer_email: email || undefined,
        title,
        starts_at: startsAt,
        ends_at: endsAt,
        notes: notes || undefined,
      };
      if (recurrenceRule) {
        payload.recurrence_rule = recurrenceRule;
        if (recurrenceEnd) payload.recurrence_end_date = recurrenceEnd;
      }
      const res = await fetch("/.netlify/functions/create-booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok}`,
        },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to save booking");

      if (recurrenceRule && recurrenceEnd && d.booking?.id) {
        try {
          const recurrenceRes = await fetch("/.netlify/functions/create-recurring-bookings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tok}`,
            },
            body: JSON.stringify({
              booking_id: d.booking.id,
              recurrence_rule: recurrenceRule,
              recurrence_end_date: recurrenceEnd,
            }),
          });
          const recurrenceData = await recurrenceRes.json().catch(() => ({}));
          const createdCount = recurrenceData.count || 0;
          if (message) {
            message.textContent = `Booked + ${createdCount} recurring instance${createdCount === 1 ? "" : "s"} created.`;
            message.className = "msg success";
          }
          showToast(`Booked + ${createdCount} recurring instance${createdCount === 1 ? "" : "s"} created.`);
        } catch (_) {
          if (message) {
            message.textContent = "Booking saved. Recurring instances may have failed.";
            message.className = "msg success";
          }
        }
      } else if (message) {
        message.textContent = "Booking saved.";
        message.className = "msg success";
      }

      ["bkCustomerName", "bkCustomerEmail", "bkTitle", "bkNotes"].forEach((id) => {
        const field = $(id);
        if (field) field.value = "";
      });
      const recurrenceRuleEl = $("bkRecurrenceRule");
      if (recurrenceRuleEl) recurrenceRuleEl.value = "";
      if (optionsEl) optionsEl.style.display = "none";
      if (endEl) endEl.value = "";
      button.disabled = false;
      await renderBookings();
      setTimeout(() => {
        const form = $("newBookingForm");
        if (form) form.classList.add("hidden");
      }, 1200);
    } catch (err) {
      if (message) {
        message.textContent = err.message || "Error saving.";
        message.className = "msg error";
      }
      button.disabled = false;
    }
  });
}

const BOOKINGS_WORKSPACE_HELPERS = {
  fetchBookings,
  fetchOperatorMembers,
  computeBookingRecurrenceCount,
  renderBookingsCalendar,
  showBookingDetail,
  renderBookingsList,
  renderBookings,
  openWalkInBookingModal,
  openTimeLogModal,
  initBookingsWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {}),
  ...BOOKINGS_WORKSPACE_HELPERS,
};

Object.assign(window, BOOKINGS_WORKSPACE_HELPERS);
