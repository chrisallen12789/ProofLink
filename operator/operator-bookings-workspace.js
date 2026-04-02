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

let _operatorMembersLastFetched = 0;
const OPERATOR_MEMBERS_TTL_MS = 5 * 60 * 1000; // re-fetch after 5 minutes

async function fetchOperatorMembers({ force = false } = {}) {
  const stale = Date.now() - _operatorMembersLastFetched > OPERATOR_MEMBERS_TTL_MS;
  if (!force && OPERATOR_MEMBERS_CACHE.length && !stale) return OPERATOR_MEMBERS_CACHE;
  try {
    const tok = await getAccessToken();
    const res = await fetch("/.netlify/functions/get-operator-members", {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!res.ok) { console.warn("[fetchOperatorMembers] fetch failed:", res.status); return OPERATOR_MEMBERS_CACHE; }
    const d = await res.json().catch(() => ({}));
    if (Array.isArray(d.members)) {
      OPERATOR_MEMBERS_CACHE = d.members;
      _operatorMembersLastFetched = Date.now();
    }
  } catch (err) { console.warn("[fetchOperatorMembers] error:", err.message); }
  return OPERATOR_MEMBERS_CACHE;
}

function computeBookingRecurrenceCount(rule, baseDate, endDate) {
  const cleanRule = String(rule || "").trim().toUpperCase();
  if (!cleanRule || !baseDate || !endDate) return { count: null, message: "--" };

  const start = new Date(`${baseDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { count: null, message: "--" };
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

function bookingWorkspaceBlueprint() {
  if (typeof currentWorkspaceBlueprint === "function") return currentWorkspaceBlueprint();
  return { business: { key: "other", label: "Business", recordFocus: [] } };
}

function linkedCustomerForBooking(booking) {
  if (!booking) return null;
  if (booking.customer_id) {
    const byId = (CUSTOMERS_CACHE || []).find((row) => row.id === booking.customer_id);
    if (byId) return byId;
  }
  const bookingEmail = String(booking.customer_email || "").trim().toLowerCase();
  const bookingName = String(booking.customer_name || "").trim().toLowerCase();
  return (CUSTOMERS_CACHE || []).find((row) => {
    const rowEmail = String(row.email || "").trim().toLowerCase();
    const rowName = String(row.name || "").trim().toLowerCase();
    return (bookingEmail && rowEmail && rowEmail === bookingEmail) || (bookingName && rowName && rowName === bookingName);
  }) || null;
}

function bookingCustomerMemoryItems(booking, blueprint = bookingWorkspaceBlueprint()) {
  const customer = linkedCustomerForBooking(booking);
  if (!customer) return [];
  const sharedChecklist = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
  if (typeof sharedChecklist === "function") {
    return sharedChecklist(customer, blueprint).slice(0, 4);
  }
  return (blueprint?.business?.recordFocus || []).slice(0, 4).map((item) => ({
    label: item.label,
    note: item.description || "",
    ready: false,
  }));
}

function renderBookingCustomerMemoryCard(booking, blueprint = bookingWorkspaceBlueprint()) {
  const items = bookingCustomerMemoryItems(booking, blueprint);
  if (!items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Customer memory</div>
      <div><strong>Keep the trade details attached to this visit</strong></div>
      <div class="detail-copy">Keep the property, access, equipment, or repair context visible while you assign the visit and hand it off to the field.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Detail")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "Still needs attention before this visit starts.")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function bookingPrepGuidanceItems(booking, blueprint = bookingWorkspaceBlueprint()) {
  const customer = linkedCustomerForBooking(booking) || {};
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const filled = (...values) => values.some((value) => String(value || "").trim());
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const detail = (label, ready, readyNote, missingNote) => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
  });

  const landscaping = [
    detail(
      "Access ready",
      filled(customer.access_notes, customer.gate_notes, customer.entry_notes),
      firstFilled(customer.access_notes, customer.gate_notes, customer.entry_notes),
      "Confirm gate codes, access notes, and where the crew should park before the visit starts."
    ),
    detail(
      "Route and cadence",
      filled(customer.service_schedule, customer.frequency, customer.recurring_notes),
      firstFilled(customer.service_schedule, customer.frequency, customer.recurring_notes),
      "Confirm whether this stop is a one-time cleanup, a route stop, or a seasonal follow-up."
    ),
    detail(
      "Property focus",
      filled(customer.seasonal_notes, customer.cleanup_notes, customer.service_notes, customer.notes),
      firstFilled(customer.seasonal_notes, customer.cleanup_notes, customer.service_notes, customer.notes),
      "Call out the property area, cleanup focus, or upsell opportunity the crew should remember."
    ),
  ];

  const cleaning = [
    detail(
      "Entry ready",
      filled(customer.access_notes, customer.alarm_notes, customer.entry_notes),
      firstFilled(customer.access_notes, customer.alarm_notes, customer.entry_notes),
      "Confirm entry, alarm, lockbox, or access instructions before dispatch."
    ),
    detail(
      "Scope checked",
      filled(customer.scope_notes, customer.checklist_notes, customer.room_notes, customer.preferences),
      firstFilled(customer.scope_notes, customer.checklist_notes, customer.room_notes, customer.preferences),
      "Confirm the rooms, checklist, and add-ons this visit needs before the team arrives."
    ),
    detail(
      "Cadence and add-ons",
      filled(customer.service_schedule, customer.frequency, customer.add_on_notes, customer.recurring_notes),
      firstFilled(customer.service_schedule, customer.frequency, customer.add_on_notes, customer.recurring_notes),
      "Call out repeat cadence and any add-ons so this visit matches what the customer expects."
    ),
  ];

  const hvac = [
    detail(
      "System context",
      filled(customer.equipment_notes, customer.system_notes, customer.asset_summary, customer.equipment_serial),
      firstFilled(customer.equipment_notes, customer.system_notes, customer.asset_summary, customer.equipment_serial),
      "Confirm the system, unit, or equipment details the technician should have before arrival."
    ),
    detail(
      "Access and contact",
      filled(customer.access_notes, customer.entry_notes, customer.tenant_notes, customer.phone),
      firstFilled(customer.access_notes, customer.entry_notes, customer.tenant_notes, customer.phone),
      "Confirm site access, tenant contact, and arrival instructions before dispatch."
    ),
    detail(
      "Diagnostic prep",
      filled(customer.diagnostic_notes, customer.failure_symptoms, customer.issue_summary, customer.maintenance_notes),
      firstFilled(customer.diagnostic_notes, customer.failure_symptoms, customer.issue_summary, customer.maintenance_notes),
      "Carry the symptom history and any maintenance-plan follow-up into this visit."
    ),
  ];

  const plumbing = [
    detail(
      "Shutoff and access",
      filled(customer.shutoff_notes, customer.access_notes, customer.entry_notes),
      firstFilled(customer.shutoff_notes, customer.access_notes, customer.entry_notes),
      "Confirm shutoff location, access instructions, and who will meet the technician."
    ),
    detail(
      "Fixture and issue",
      filled(customer.fixture_notes, customer.issue_summary, customer.leak_source, customer.system_notes),
      firstFilled(customer.fixture_notes, customer.issue_summary, customer.leak_source, customer.system_notes),
      "Call out the fixture, problem area, or leak source before the truck rolls."
    ),
    detail(
      "Repair follow-through",
      filled(customer.approval_notes, customer.restoration_notes, customer.follow_up_notes),
      firstFilled(customer.approval_notes, customer.restoration_notes, customer.follow_up_notes),
      "Confirm any approval, restoration, or return-visit context that could affect this repair."
    ),
  ];

  const fallback = [
    detail(
      "Customer contact",
      filled(customer.phone, customer.email),
      firstFilled(customer.phone, customer.email),
      "Make sure the team has a working customer contact before the visit starts."
    ),
    detail(
      "Site context",
      filled(customer.service_address, customer.address_line1, customer.notes),
      firstFilled(customer.service_address, customer.address_line1, customer.notes),
      "Capture the location details and service notes the team should not have to relearn."
    ),
    detail(
      "Next-step note",
      filled(customer.follow_up_notes, customer.service_notes, customer.preferences),
      firstFilled(customer.follow_up_notes, customer.service_notes, customer.preferences),
      "Add the one note that will help this visit go smoothly from arrival through closeout."
    ),
  ];

  return ({
    landscaping,
    property_maintenance: landscaping,
    pressure_washing: landscaping,
    cleaning,
    hvac,
    plumbing,
  })[businessKey] || fallback;
}

function renderBookingPrepGuidanceCard(booking, blueprint = bookingWorkspaceBlueprint()) {
  const items = bookingPrepGuidanceItems(booking, blueprint);
  if (!items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Prep for this visit</div>
      <div><strong>Give the next stop a cleaner handoff</strong></div>
      <div class="detail-copy">Use these reminders to confirm the details that matter before the schedule becomes field work.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Detail")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "Still needs attention before this visit starts.")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function bookingAssignmentGuidanceItems(booking, blueprint = bookingWorkspaceBlueprint()) {
  const customer = linkedCustomerForBooking(booking) || {};
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const hasAssignedOperator = !!String(
    booking?.assigned_operator_name
      || booking?.assigned_operator?.display_name
      || booking?.assigned_operator?.email
      || booking?.assigned_operator_id
      || ""
  ).trim();
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const filled = (...values) => values.some((value) => String(value || "").trim());
  const detail = (label, ready, readyNote, missingNote, tone = "") => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
    tone: tone || (!ready ? "warn" : ""),
  });

  const assignmentItem = detail(
    "Crew assignment",
    hasAssignedOperator,
    "Someone is already attached to this visit, so the handoff can stay specific.",
    "Assign the visit before it gets closer to the field and starts depending on memory."
  );

  const landscaping = [
    assignmentItem,
    detail(
      "Arrival plan",
      filled(customer?.gate_notes, customer?.access_notes, booking?.notes_vehicle),
      firstFilled(customer?.gate_notes, customer?.access_notes, booking?.notes_vehicle),
      "Leave one plain-English parking, gate, or route note for the crew before this stop is on today's board."
    ),
    detail(
      "Next property touch",
      filled(customer?.service_schedule, customer?.seasonal_notes, customer?.follow_up_notes),
      firstFilled(customer?.service_schedule, customer?.seasonal_notes, customer?.follow_up_notes),
      "Call out the seasonal or repeat-service note that should still be visible after this visit wraps."
    ),
  ];

  const cleaning = [
    assignmentItem,
    detail(
      "Entry and checklist handoff",
      filled(customer?.access_notes, customer?.alarm_notes, customer?.checklist_notes, customer?.add_on_notes),
      firstFilled(customer?.access_notes, customer?.alarm_notes, customer?.checklist_notes, customer?.add_on_notes),
      "Leave the entry, alarm, checklist, or add-on note attached so the cleaner walks in prepared."
    ),
    detail(
      "Next visit protected",
      filled(customer?.frequency, customer?.recurring_notes, customer?.follow_up_notes),
      firstFilled(customer?.frequency, customer?.recurring_notes, customer?.follow_up_notes),
      "Keep the next visit cadence visible so this customer does not have to reteach the routine."
    ),
  ];

  const hvac = [
    assignmentItem,
    detail(
      "Tech handoff",
      filled(customer?.equipment_notes, customer?.diagnostic_notes, customer?.parts_follow_up),
      firstFilled(customer?.equipment_notes, customer?.diagnostic_notes, customer?.parts_follow_up),
      "Leave the system, diagnostic, or parts note attached so the technician starts from real context."
    ),
    detail(
      "Customer contact path",
      filled(customer?.tenant_notes, customer?.access_notes, customer?.phone, customer?.email),
      firstFilled(customer?.tenant_notes, customer?.access_notes, customer?.phone, customer?.email),
      "Confirm who should be reached for arrival, approval, or follow-up before the dispatch window opens."
    ),
  ];

  const plumbing = [
    assignmentItem,
    detail(
      "Repair-risk handoff",
      filled(customer?.shutoff_notes, customer?.approval_notes, customer?.restoration_notes),
      firstFilled(customer?.shutoff_notes, customer?.approval_notes, customer?.restoration_notes),
      "Keep the shutoff, approval, or restoration note attached so the next plumbing step starts safer and cleaner."
    ),
    detail(
      "Customer follow-through stays visible",
      filled(customer?.follow_up_notes, customer?.issue_summary, customer?.phone),
      firstFilled(customer?.follow_up_notes, customer?.issue_summary, customer?.phone),
      "Leave the one follow-up note that makes the repair easy to finish after today's visit."
    ),
  ];

  const fallback = [
    assignmentItem,
    detail(
      "Customer contact path",
      filled(customer?.phone, customer?.email, booking?.customer_email),
      firstFilled(customer?.phone, customer?.email, booking?.customer_email),
      "Confirm who should be reached if timing shifts or this visit needs a quick follow-up."
    ),
    detail(
      "Next-step note",
      filled(customer?.follow_up_notes, customer?.service_notes, booking?.notes_vehicle),
      firstFilled(customer?.follow_up_notes, customer?.service_notes, booking?.notes_vehicle),
      "Leave one note that makes this booking easier to hand off and easier to finish well."
    ),
  ];

  return ({
    landscaping,
    property_maintenance: landscaping,
    pressure_washing: landscaping,
    cleaning,
    hvac,
    plumbing,
  })[businessKey] || fallback;
}

function renderBookingAssignmentGuidanceCard(booking, blueprint = bookingWorkspaceBlueprint()) {
  const items = bookingAssignmentGuidanceItems(booking, blueprint);
  if (!items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Best next scheduling move</div>
      <div><strong>Turn this booking into a cleaner field handoff</strong></div>
      <div class="detail-copy">Use this to keep assignment, arrival prep, and the next customer-facing step visible from the same visit record.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible before this visit starts.")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function bookingFollowThroughItems(booking, blueprint = bookingWorkspaceBlueprint()) {
  const customer = linkedCustomerForBooking(booking) || {};
  const linkedOrder = booking?.order_id
    ? (CRM_ORDERS_CACHE.find((row) => row.id === booking.order_id) || null)
    : null;
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const filled = (...values) => values.some((value) => String(value || "").trim());
  const detail = (label, ready, readyNote, missingNote, tone = "") => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
    tone: tone || (!ready ? "warn" : ""),
  });
  const balanceDue = linkedOrder ? Number(orderAmountDueCents(linkedOrder) || 0) : 0;
  const balanceItem = detail(
    "Money follow-through",
    !linkedOrder || balanceDue <= 0,
    !linkedOrder
      ? "No booked-work balance is attached to this visit right now."
      : "The linked balance is already handled, so this visit can roll into the next service step cleanly.",
    linkedOrder
      ? `${formatUsd(balanceDue)} is still open on the linked booked work. Keep the reminder or collection step attached while this visit is fresh.`
      : "Attach this visit to booked work or leave a payment note so billing does not have to guess what happened after the stop.",
    linkedOrder && balanceDue > 0 ? "warn" : ""
  );
  const repeatSignal = firstFilled(
    customer?.service_schedule,
    customer?.frequency,
    customer?.recurring_notes,
    customer?.service_plan_name,
    customer?.maintenance_notes,
    customer?.seasonal_notes
  );
  const nextTouch = firstFilled(
    customer?.next_service_on,
    customer?.follow_up_notes,
    customer?.service_plan_name
  );
  const renewalRiskItem = repeatSignal
    ? detail(
        "Renewal risk",
        !!nextTouch,
        `The next repeat step is still visible here: ${nextTouch}.`,
        "This account has repeat-service signals, but the next visit or follow-up step still needs to be attached before it goes quiet."
      )
    : null;

  const tradeItems = {
    landscaping: [
      detail(
        "Route stays protected",
        filled(customer?.service_schedule, customer?.frequency, customer?.follow_up_notes),
        firstFilled(customer?.service_schedule, customer?.frequency, customer?.follow_up_notes),
        "Leave the next route or repeat-service note attached so this property does not fall out of rotation."
      ),
      detail(
        "Seasonal follow-up",
        filled(customer?.seasonal_notes, customer?.cleanup_notes, customer?.upsell_notes),
        firstFilled(customer?.seasonal_notes, customer?.cleanup_notes, customer?.upsell_notes),
        "Capture the next cleanup, mulch, or seasonal note before the property goes quiet."
      ),
      renewalRiskItem,
      balanceItem,
    ].filter(Boolean),
    cleaning: [
      detail(
        "Next visit stays clear",
        filled(customer?.frequency, customer?.recurring_notes, customer?.follow_up_notes),
        firstFilled(customer?.frequency, customer?.recurring_notes, customer?.follow_up_notes),
        "Leave the cadence and next-visit note attached so the customer does not have to reteach the routine."
      ),
      detail(
        "Checklist closeout",
        filled(customer?.checklist_notes, customer?.add_on_notes, booking?.notes_vehicle),
        firstFilled(customer?.checklist_notes, customer?.add_on_notes, booking?.notes_vehicle),
        "Leave one closeout or add-on note attached so the next cleaning visit starts from the last one."
      ),
      renewalRiskItem,
      balanceItem,
    ].filter(Boolean),
    hvac: [
      detail(
        "Maintenance follow-up",
        filled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes),
        firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes),
        "Leave the maintenance, parts, or warranty note attached before the next system visit slips."
      ),
      detail(
        "Customer update path",
        filled(customer?.tenant_notes, customer?.phone, customer?.email, customer?.follow_up_notes),
        firstFilled(customer?.tenant_notes, customer?.phone, customer?.email, customer?.follow_up_notes),
        "Confirm who should hear the outcome, approval need, or next step after the technician wraps."
      ),
      renewalRiskItem,
      balanceItem,
    ].filter(Boolean),
    plumbing: [
      detail(
        "Repair follow-through",
        filled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes),
        firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes),
        "Leave the restoration, approval, or return-visit note attached so the repair does not stall after today."
      ),
      detail(
        "Customer update path",
        filled(customer?.phone, customer?.email, customer?.shutoff_notes, customer?.follow_up_notes),
        firstFilled(customer?.phone, customer?.email, customer?.shutoff_notes, customer?.follow_up_notes),
        "Confirm who should get the repair update and any next-step instructions after the visit wraps."
      ),
      renewalRiskItem,
      balanceItem,
    ].filter(Boolean),
  };

  return tradeItems[businessKey] || [
    detail(
      "Next service step",
      filled(customer?.follow_up_notes, customer?.service_notes, booking?.notes_vehicle),
      firstFilled(customer?.follow_up_notes, customer?.service_notes, booking?.notes_vehicle),
      "Leave one clear next step attached so the customer does not fall into guesswork after this visit."
    ),
    detail(
      "Customer update path",
      filled(customer?.phone, customer?.email, customer?.follow_up_notes),
      firstFilled(customer?.phone, customer?.email, customer?.follow_up_notes),
      "Confirm who should hear the result or next step after this visit wraps."
    ),
    renewalRiskItem,
    balanceItem,
  ].filter(Boolean);
}

function renderBookingFollowThroughCard(booking, blueprint = bookingWorkspaceBlueprint()) {
  const items = bookingFollowThroughItems(booking, blueprint);
  if (!items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">After this visit</div>
      <div><strong>Keep the next step attached while the visit is still fresh</strong></div>
      <div class="detail-copy">Use this to protect the next customer promise, repeat-service step, or money follow-through before the visit just turns into history.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
            <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
            <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible before this visit fades into history.")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
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
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
        <div>
          <div class="modal-title">${escapeHtml(booking.title || "Booking")}</div>
          <div class="modal-subtitle">${escapeHtml(booking.customer_name || booking.customer_email || "Customer")}</div>
        </div>
        <button id="bkDetailClose" class="modal-close" type="button">Close</button>
      </div>
      <div class="modal-stack">
          ${renderBookingCustomerMemoryCard(booking)}
          ${renderBookingPrepGuidanceCard(booking)}
          ${renderBookingAssignmentGuidanceCard(booking)}
          ${renderBookingFollowThroughCard(booking)}
          <div>
            <label class="field-note-label field-note-label--tight">Assigned to</label>
            <select id="bkAssignedOperator" class="input u-full-width">
            ${operatorOptions.join("")}
          </select>
        </div>
        <div>
          <label class="field-note-label field-note-label--tight">Vehicle / crew notes</label>
          <input id="bkVehicleNotes" class="input u-full-width" value="${escapeAttr(booking.notes_vehicle || "")}" placeholder="e.g. silver van, plate ABC123" />
        </div>
        <div class="modal-grid-3">
          <div>
            <label class="section-heading-note">Date</label>
            <input id="bkDetailDate" type="date" value="${escapeAttr(localDate)}" class="input u-full-width" />
          </div>
          <div>
            <label class="section-heading-note">Start</label>
            <input id="bkDetailStart" type="time" value="${escapeAttr(localStart)}" class="input u-full-width" />
          </div>
          <div>
            <label class="section-heading-note">End</label>
            <input id="bkDetailEnd" type="time" value="${escapeAttr(localEnd)}" class="input u-full-width" />
          </div>
        </div>
        <div class="modal-footer">
          <span id="bkDetailMsg" class="modal-status"></span>
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
        saveButton.textContent = "Saving...";
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

      const updatedBooking = d.booking || {
        ...booking,
        starts_at: startsAt,
        ends_at: endsAt || booking.ends_at,
        assigned_operator_id: assignedOperatorId || null,
        notes_vehicle: vehicleNotes || null,
      };
      BOOKINGS_CACHE = BOOKINGS_CACHE.map((row) => (
        row.id === booking.id ? { ...row, ...updatedBooking } : row
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
    list.innerHTML = `<div class="muted muted-small">No bookings here yet. New appointments will appear here as soon as they are scheduled.</div>`;
    return;
  }

  list.innerHTML = bookings.map((booking) => `
    <div class="list-item list-item--top">
      <div class="li-main">
        <div class="li-title">${escapeHtml(booking.title || "Booking")}</div>
        <div class="li-sub muted">${escapeHtml(booking.customer_name || booking.customer_email || "Customer")}</div>
        <div class="li-sub muted">${escapeHtml([
          formatDateTime(booking.starts_at),
          booking.location || booking.service_address || "",
          booking.assigned_operator_name || "",
        ].filter((value) => String(value || "").trim()).join(" | "))}</div>
      </div>
      <div class="li-meta li-meta--tight">
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
    noShowStat.textContent = concluded.length ? `${Math.round((noShows.length / concluded.length) * 100)}%` : "--";
  }

  const linkDisplay = $("bookingLinkDisplay");
  if (linkDisplay) {
    const slug = CURRENT_OPERATOR?.tenant_slug || OPERATOR_CONFIG?.tenantSlug || "";
    linkDisplay.textContent = slug ? `${window.location.origin}/${slug}/book.html` : "--";
  }
}

function bookingDraftTitle(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint()) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const customerName = String(customer?.name || customer?.customer_name || customer?.email || "Customer").trim();
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const maintenanceLike = firstFilled(customer?.service_plan_name, customer?.maintenance_notes, options?.notes).toLowerCase();
  const fallbackTitleMap = {
    landscaping: `${customerName} property visit`,
    property_maintenance: `${customerName} site visit`,
    pressure_washing: `${customerName} wash visit`,
    cleaning: `${customerName} cleaning visit`,
    hvac: /maintenance|tune/.test(maintenanceLike) ? `${customerName} maintenance visit` : `${customerName} system visit`,
    plumbing: firstFilled(customer?.restoration_notes, customer?.approval_notes) ? `${customerName} repair follow-up` : `${customerName} plumbing follow-up`,
  };
  return firstFilled(
    options?.title,
    customer?.service_plan_name,
    fallbackTitleMap[businessKey],
    `${customerName} follow-up visit`
  );
}

function bookingDraftRecurrenceRule(customer = {}, options = {}) {
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const raw = String(firstFilled(options?.recurrenceRule, customer?.frequency, customer?.service_schedule, customer?.recurring_notes)).trim().toLowerCase();
  if (!raw) return "";
  if (/every other|biweekly|bi-weekly|2 weeks|two weeks/.test(raw)) return "BIWEEKLY";
  if (/weekly|every week/.test(raw)) return "WEEKLY";
  if (/monthly|every month/.test(raw)) return "MONTHLY";
  if (/daily|every day/.test(raw)) return "DAILY";
  return "";
}

function addDaysToIsoDate(baseDate, days) {
  const value = String(baseDate || "").trim();
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function bookingDraftCadenceInsight(customer = {}, options = {}) {
  const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
  if (typeof customerApi.customerRepeatCadenceInsight === "function") {
    return customerApi.customerRepeatCadenceInsight(customer);
  }
  const recurrenceRule = bookingDraftRecurrenceRule(customer, options);
  if (!recurrenceRule) return null;
  const cadenceDays = {
    DAILY: 1,
    WEEKLY: 7,
    BIWEEKLY: 14,
    MONTHLY: 30,
  }[recurrenceRule] || null;
  if (!cadenceDays) return null;
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const lastTouchValue = firstFilled(customer?.last_service_on, customer?.last_contact_at, customer?.updated_at, customer?.created_at);
  if (!lastTouchValue) return { cadenceDays, overdueDays: 0, message: `This repeat work usually runs about every ${cadenceDays} days.` };
  const lastTouch = new Date(lastTouchValue);
  if (Number.isNaN(lastTouch.getTime())) return { cadenceDays, overdueDays: 0, message: `This repeat work usually runs about every ${cadenceDays} days.` };
  const ageDays = Math.max(0, Math.floor((Date.now() - lastTouch.getTime()) / 86400000));
  const overdueDays = Math.max(0, ageDays - cadenceDays);
  return {
    cadenceDays,
    overdueDays,
    message: overdueDays > 0
      ? `This account usually runs about every ${cadenceDays} days and is roughly ${overdueDays} days past that rhythm.`
      : `This account usually runs about every ${cadenceDays} days, so the next visit should stay close to that rhythm.`,
  };
}

function bookingDraftTradeTimingInsight(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint(), now = new Date()) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const hasFilled = (...values) => values.some((value) => String(value || "").trim());
  const tradeNotes = String(firstFilled(
    customer?.maintenance_notes,
    customer?.parts_follow_up,
    customer?.warranty_notes,
    customer?.restoration_notes,
    customer?.approval_notes,
    customer?.seasonal_notes,
    customer?.cleanup_notes,
    options?.notes
  )).toLowerCase();
  const month = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getMonth() + 1 : new Date().getMonth() + 1;

  if (businessKey === "plumbing") {
    if (/emergency|leak|burst|flood/.test(tradeNotes)) {
      return {
        offsetDays: 1,
        message: "This repair follow-up looks urgent, so the callback should land almost immediately.",
      };
    }
    if (hasFilled(customer?.restoration_notes, customer?.approval_notes) || /restoration|approval|repair|return/.test(tradeNotes)) {
      return {
        offsetDays: 3,
        message: "This repair follow-up still has restoration or approval attached, so it should stay within the next few days.",
      };
    }
    return {
      offsetDays: 7,
      message: "This plumbing follow-up should stay on the schedule while the repair context is still fresh.",
    };
  }
  if (businessKey === "hvac") {
    if (hasFilled(customer?.parts_follow_up, customer?.warranty_notes) || /parts|warranty/.test(tradeNotes)) {
      return {
        offsetDays: 7,
        message: "This system follow-up still has parts or warranty work attached, so it should stay within the next week.",
      };
    }
    if ((/spring|cooling/.test(tradeNotes) && month >= 2 && month <= 5) || (/fall|heating/.test(tradeNotes) && month >= 8 && month <= 11)) {
      return {
        offsetDays: 14,
        message: "The maintenance window is opening for this system, so the next visit should be queued now.",
      };
    }
    if (hasFilled(customer?.maintenance_notes) || /maintenance|tune-up|tune up/.test(tradeNotes)) {
      return {
        offsetDays: 21,
        message: "This system should stay on a proactive maintenance rhythm, so the next visit is being staged a few weeks out.",
      };
    }
    return {
      offsetDays: 7,
      message: "This system follow-up should stay visible while the service context is still warm.",
    };
  }
  if (["landscaping", "property_maintenance", "pressure_washing"].includes(businessKey)) {
    if ((/spring/.test(tradeNotes) && month >= 2 && month <= 5) || (/fall|autumn/.test(tradeNotes) && month >= 8 && month <= 11)) {
      return {
        offsetDays: 14,
        message: "The seasonal window is opening, so this property follow-up should be queued now.",
      };
    }
    if (businessKey === "pressure_washing" && (hasFilled(customer?.seasonal_notes) || /season|wash/.test(tradeNotes))) {
      return {
        offsetDays: 21,
        message: "This property looks ready for its next wash cycle soon, so the follow-up is being staged ahead of the season.",
      };
    }
    if (hasFilled(customer?.seasonal_notes, customer?.cleanup_notes) || /season|cleanup|mulch|route|property/.test(tradeNotes)) {
      return {
        offsetDays: 14,
        message: "This property follow-up should stay visible before the route or seasonal work slips.",
      };
    }
    return {
      offsetDays: 7,
      message: "This property follow-up should stay on the calendar while the last visit is still easy to remember.",
    };
  }
  if (businessKey === "cleaning") {
    return {
      offsetDays: 7,
      message: "This cleaning follow-up should stay visible while the routine and add-ons are still fresh.",
    };
  }
  return {
    offsetDays: 7,
    message: "The next service follow-up is ready to schedule.",
  };
}

function bookingDraftDefaultOffsetDays(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint()) {
  return Number(bookingDraftTradeTimingInsight(customer, options, blueprint)?.offsetDays || 7);
}

function bookingDraftDate(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint()) {
  const explicitDate = String(options?.date || customer?.next_service_on || "").trim();
  if (explicitDate) return explicitDate;

  const cadenceInsight = bookingDraftCadenceInsight(customer, options);
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const lastTouchValue = firstFilled(customer?.last_service_on, customer?.last_contact_at, customer?.updated_at, customer?.created_at);
  if (cadenceInsight?.cadenceDays && lastTouchValue) {
    const suggested = addDaysToIsoDate(String(lastTouchValue).slice(0, 10), cadenceInsight.cadenceDays);
    const today = typeof todayDateValue === "function" ? todayDateValue(0) : new Date().toISOString().slice(0, 10);
    if (suggested && suggested >= today) return suggested;
  }

  const defaultOffset = bookingDraftDefaultOffsetDays(customer, options, blueprint);
  const urgentOffset = cadenceInsight?.overdueDays > 0 ? Math.min(defaultOffset, 3) : defaultOffset;
  return typeof todayDateValue === "function" ? todayDateValue(urgentOffset) : "";
}

function bookingDraftRecurrenceEnd(customer = {}, options = {}, bookingDate = "") {
  const explicitEnd = String(options?.recurrenceEnd || "").trim();
  if (explicitEnd) return explicitEnd;
  const recurrenceRule = bookingDraftRecurrenceRule(customer, options);
  if (!recurrenceRule) return "";
  const offsetDays = {
    DAILY: 14,
    WEEKLY: 84,
    BIWEEKLY: 112,
    MONTHLY: 180,
  };
  const baseDate = String(bookingDate || "").trim();
  if (baseDate) return addDaysToIsoDate(baseDate, offsetDays[recurrenceRule] || 84);
  return typeof todayDateValue === "function" ? todayDateValue(offsetDays[recurrenceRule] || 84) : "";
}

function bookingDraftTimingReason(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint()) {
  const cadenceInsight = bookingDraftCadenceInsight(customer, options);
  const recurrenceRule = bookingDraftRecurrenceRule(customer, options);
  const tradeTimingInsight = bookingDraftTradeTimingInsight(customer, options, blueprint);
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const tradeLabelMap = {
    landscaping: "property follow-up",
    property_maintenance: "site follow-up",
    pressure_washing: "property follow-up",
    cleaning: "cleaning follow-up",
    hvac: "system follow-up",
    plumbing: "repair follow-up",
  };
  if (cadenceInsight?.overdueDays > 0) {
    return cadenceInsight.message;
  }
  if (cadenceInsight?.cadenceDays) {
    return cadenceInsight.message;
  }
  if (recurrenceRule) {
    return `This ${tradeLabelMap[businessKey] || "repeat follow-up"} stays on a ${recurrenceRule.toLowerCase()} rhythm.`;
  }
  if (tradeTimingInsight?.message) {
    return tradeTimingInsight.message;
  }
  return `The next ${tradeLabelMap[businessKey] || "service follow-up"} is ready to schedule.`;
}

function bookingDraftTimingInsight(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint()) {
  const bookingDate = bookingDraftDate(customer, options, blueprint);
  return {
    bookingDate,
    reason: bookingDraftTimingReason(customer, options, blueprint),
    cadenceInsight: bookingDraftCadenceInsight(customer, options),
    tradeInsight: bookingDraftTradeTimingInsight(customer, options, blueprint),
  };
}

function bookingDraftTimingMessage(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint(), bookingDate = "") {
  const reason = bookingDraftTimingReason(customer, options, blueprint);
  const targetLabel = bookingDate ? ` It is queued for ${bookingDate}.` : "";
  return `Booking draft opened from the follow-up guidance. ${reason}${targetLabel}`;
}

function bookingDraftNotes(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint()) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const notesByTrade = {
    landscaping: [
      customer?.service_schedule,
      customer?.seasonal_notes,
      customer?.gate_notes,
      customer?.access_notes,
    ],
    property_maintenance: [
      customer?.service_schedule,
      customer?.follow_up_notes,
      customer?.access_notes,
    ],
    pressure_washing: [
      customer?.service_schedule,
      customer?.seasonal_notes,
      customer?.service_notes,
    ],
    cleaning: [
      customer?.recurring_notes,
      customer?.checklist_notes,
      customer?.add_on_notes,
      customer?.entry_notes,
    ],
    hvac: [
      customer?.maintenance_notes,
      customer?.parts_follow_up,
      customer?.warranty_notes,
      customer?.equipment_notes,
    ],
    plumbing: [
      customer?.restoration_notes,
      customer?.approval_notes,
      customer?.shutoff_notes,
      customer?.follow_up_notes,
    ],
  };
  const fallbackNoteMap = {
    landscaping: "Keep the next route or seasonal property touch visible from this visit.",
    property_maintenance: "Keep the next site walk or maintenance touch visible from this visit.",
    pressure_washing: "Keep the next wash cycle or property follow-up visible from this visit.",
    cleaning: "Keep the next visit cadence, access, and checklist visible from this visit.",
    hvac: "Keep the next maintenance, diagnostic, or warranty touch visible from this visit.",
    plumbing: "Keep the next approval, restoration, or return visit visible from this visit.",
  };
  const guidedNotes = (notesByTrade[businessKey] || [])
    .filter((value, index, values) => {
      const text = String(value || "").trim();
      return text && values.findIndex((entry) => String(entry || "").trim() === text) === index;
    })
    .slice(0, 3)
    .join(" | ");
  const extraNotes = [options?.extraNotes]
    .filter((value) => String(value || "").trim())
    .join(" | ");
  return firstFilled(
    options?.notes,
    [guidedNotes, extraNotes].filter((value) => String(value || "").trim()).join(" | "),
    customer?.follow_up_notes,
    customer?.recurring_notes,
    customer?.maintenance_notes,
    customer?.seasonal_notes,
    customer?.service_notes,
    fallbackNoteMap[businessKey],
    "Keep the next customer promise visible from this visit."
  );
}

function openBookingDraftForCustomer(customer = {}, options = {}, blueprint = bookingWorkspaceBlueprint()) {
  if (typeof switchTab === "function") switchTab("bookings");
  const form = $("newBookingForm");
  form?.classList?.remove?.("hidden");

  const bookingDate = String(bookingDraftDate(customer, options, blueprint)).trim();
  const recurrenceRule = String(bookingDraftRecurrenceRule(customer, options)).trim();
  const recurrenceEnd = String(bookingDraftRecurrenceEnd(customer, options, bookingDate)).trim();
  const customerName = String(customer?.name || customer?.customer_name || "").trim();
  const customerEmail = String(customer?.email || customer?.customer_email || "").trim();

  const customerNameField = $("bkCustomerName");
  if (customerNameField) customerNameField.value = customerName;
  const customerEmailField = $("bkCustomerEmail");
  if (customerEmailField) customerEmailField.value = customerEmail;
  const customerIdField = $("bkCustomerId");
  if (customerIdField) customerIdField.value = String(options?.customer_id || customer?.id || customer?.customer_id || "").trim();
  const customerLocationField = $("bkCustomerLocationId");
  if (customerLocationField) customerLocationField.value = String(options?.customer_location_id || customer?.customer_location_id || "").trim();
  const locationLabelField = $("bkLocationLabel");
  if (locationLabelField) locationLabelField.value = String(options?.locationLabel || options?.location || "").trim();
  const serviceAddressField = $("bkServiceAddress");
  if (serviceAddressField) serviceAddressField.value = String(options?.service_address || customer?.service_address || customer?.address_line1 || "").trim();
  const titleField = $("bkTitle");
  if (titleField) titleField.value = bookingDraftTitle(customer, options, blueprint);
  const dateField = $("bkDate");
  if (dateField) dateField.value = bookingDate;
  const startField = $("bkStart");
  if (startField) startField.value = String(options?.start || "09:00");
  const notesField = $("bkNotes");
  if (notesField) notesField.value = bookingDraftNotes(customer, options, blueprint);
  const recurrenceRuleField = $("bkRecurrenceRule");
  if (recurrenceRuleField) recurrenceRuleField.value = recurrenceRule;
  const recurrenceOptions = $("bkRecurrenceOptions");
  if (recurrenceOptions?.classList?.toggle) recurrenceOptions.classList.toggle("u-hidden", !recurrenceRule);
  const recurrenceEndField = $("bkRecurrenceEnd");
  if (recurrenceEndField) recurrenceEndField.value = recurrenceEnd;
  const recurrenceCountField = $("bkRecurrenceCount");
  if (recurrenceCountField) {
    const result = computeBookingRecurrenceCount(recurrenceRule, bookingDate, recurrenceEnd);
    recurrenceCountField.textContent = result.message;
  }

  const message = $("newBookingMsg");
  const timingMessage = bookingDraftTimingMessage(customer, options, blueprint, bookingDate);
  if (typeof setInlineMessage === "function") setInlineMessage(message, timingMessage, "ok");
  else if (message) {
    message.textContent = timingMessage;
    message.className = "msg success";
  }
  dateField?.focus?.();
}

function clearBookingDraftFields({ keepMessage = false } = {}) {
  [
    "bkCustomerId",
    "bkCustomerLocationId",
    "bkCustomerName",
    "bkCustomerEmail",
    "bkLocationLabel",
    "bkServiceAddress",
    "bkTitle",
    "bkNotes",
    "bkDate",
    "bkStart",
    "bkRecurrenceEnd",
  ].forEach((id) => {
    const field = $(id);
    if (field) field.value = "";
  });

  const recurrenceRuleField = $("bkRecurrenceRule");
  if (recurrenceRuleField) recurrenceRuleField.value = "";
  const recurrenceOptions = $("bkRecurrenceOptions");
  if (recurrenceOptions?.classList?.add) recurrenceOptions.classList.add("u-hidden");
  const recurrenceCountField = $("bkRecurrenceCount");
  if (recurrenceCountField) recurrenceCountField.textContent = "--";

  if (!keepMessage) {
    const message = $("newBookingMsg");
    if (typeof setInlineMessage === "function") setInlineMessage(message, "");
    else if (message) {
      message.textContent = "";
      message.className = "msg";
    }
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
  modal.className = "modal-overlay";
  const customerOptions = CUSTOMERS_CACHE.map((customer) => (
    `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name || customer.email || "Unknown")}</option>`
  )).join("");

  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title u-mb-18">Walk-in booking</h3>
      <div class="modal-stack u-mb-18">
        <div>
          <label class="field-note-label field-note-label--tight">Customer</label>
          <select id="wiCustomer" class="input u-full-width">
            <option value="">-- Select or type name --</option>
            ${customerOptions}
          </select>
        </div>
        <div>
          <label class="field-note-label field-note-label--tight">Service</label>
          <input id="wiService" class="input u-full-width" placeholder="e.g. Haircut, Oil change, Dog grooming" />
        </div>
        <div class="modal-grid-2">
          <div class="modal-grid-2__fill">
            <label class="field-note-label field-note-label--tight">Price ($)</label>
            <input id="wiPrice" type="number" min="0" step="0.01" class="input u-full-width" placeholder="0.00" />
          </div>
          <div class="modal-grid-2__fill">
            <label class="field-note-label field-note-label--tight">Assigned to</label>
            <select id="wiOperator" class="input u-full-width">
              <option value="">Unassigned</option>
              ${(OPERATOR_MEMBERS_CACHE || []).map((member) => `<option value="${escapeAttr(member.id)}">${escapeHtml(member.display_name || member.email || member.id)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div>
          <label class="field-note-label field-note-label--tight">Notes</label>
          <input id="wiNotes" class="input u-full-width" placeholder="Optional" />
        </div>
      </div>
      <div class="modal-footer">
        <span></span>
        <div class="action-row">
          <button id="wiCancel" class="btn btn-ghost" type="button">Cancel</button>
          <button id="wiSave" class="btn btn-primary" type="button">Create walk-in</button>
        </div>
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
  modal.className = "modal-overlay";
  const openOrders = CRM_ORDERS_CACHE.filter((order) => !["paid", "cancelled"].includes(String(order.status || "").toLowerCase()));
  const orderOptions = openOrders.map((order) => (
    `<option value="${escapeAttr(order.id)}">${escapeHtml(order.customer_name || order.name || "Order")} -- ${escapeHtml(order.title || order.id)}</option>`
  )).join("");

  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title u-mb-18">Log time</h3>
      <div class="modal-stack u-mb-18">
        <input id="tlCustomer" class="input u-full-width" placeholder="Customer name" />
        <input id="tlDescription" class="input u-full-width" placeholder="Work description" />
        <div class="row gap-8">
          <input id="tlHours" class="input u-w-150" type="number" min="0" step="0.25" placeholder="Hours" />
          <input id="tlRate" class="input u-flex-1" type="number" min="0" step="1" placeholder="Rate ($/hr)" />
          <label class="modal-check">
            <input type="checkbox" id="tlBillable" class="modal-check__input" checked />
            <span class="modal-check__label">Billable</span>
          </label>
        </div>
        <input id="tlDate" class="input u-full-width" type="date" />
        <div>
          <label class="field-note-label field-note-label--tight">Link to order (optional)</label>
          <select id="tlOrderLink" class="input u-full-width">
            <option value="">No order linked</option>
            ${orderOptions}
          </select>
        </div>
      </div>
      <div id="tlMsg" class="msg u-mb-10"></div>
      <div class="modal-footer">
        <span></span>
        <div class="action-row">
        <button id="tlCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
        <button id="tlSave" class="btn btn-primary btn-sm" type="button">Save time entry</button>
        </div>
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
      message.className = "msg error u-mb-10";
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
      message.className = "msg success u-mb-10";
      setTimeout(() => modal.remove(), 1500);
    } catch (err) {
      message.textContent = err.message || "Failed to save.";
      message.className = "msg error u-mb-10";
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
    if (form.classList?.contains?.("hidden")) clearBookingDraftFields();
    form.classList.toggle("hidden");
    if (form.classList.contains("hidden")) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const bookingDate = $("bkDate");
    if (bookingDate && !bookingDate.value) bookingDate.value = tomorrow.toISOString().slice(0, 10);
  });
  $("btnCancelBooking")?.addEventListener("click", () => {
    const form = $("newBookingForm");
    clearBookingDraftFields();
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
    if (optionsEl) optionsEl.classList.toggle("u-hidden", !ruleEl.value);
    updateRecurrenceMessage();
  });
  endEl?.addEventListener("change", updateRecurrenceMessage);
  $("bkDate")?.addEventListener("change", updateRecurrenceMessage);

  $("btnSaveBooking")?.addEventListener("click", async () => {
    const button = $("btnSaveBooking");
    const message = $("newBookingMsg");
    const name = $("bkCustomerName")?.value.trim();
    const email = $("bkCustomerEmail")?.value.trim();
    const customerId = $("bkCustomerId")?.value.trim();
    const customerLocationId = $("bkCustomerLocationId")?.value.trim();
    const locationLabel = $("bkLocationLabel")?.value.trim();
    const serviceAddress = $("bkServiceAddress")?.value.trim();
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

    // Warn if booking is being scheduled in the past
    if (new Date(startsAt) < new Date()) {
      const confirmed = window.confirm("This booking date is in the past. Save it anyway?");
      if (!confirmed) return;
    }
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60000).toISOString();

    // Warn on booking conflicts (same time window, not cancelled)
    const conflicting = (BOOKINGS_CACHE || []).filter((b) => {
      if (["cancelled", "no_show"].includes(String(b.status || "").toLowerCase())) return false;
      if (!b.starts_at || !b.ends_at) return false;
      return new Date(b.starts_at) < new Date(endsAt) && new Date(b.ends_at) > new Date(startsAt);
    });
    if (conflicting.length > 0) {
      const names = conflicting.map((b) => b.customer_name || b.title || "another booking").join(", ");
      const ok = window.confirm(`This time slot overlaps with ${conflicting.length === 1 ? "another booking" : conflicting.length + " other bookings"} (${names}). Save anyway?`);
      if (!ok) return;
    }

    button.disabled = true;
    if (message) {
      message.textContent = "Saving...";
      message.className = "msg";
    }

    try {
      const tok = await getAccessToken();
      const payload = {
        customer_id: customerId || undefined,
        customer_location_id: customerLocationId || undefined,
        customer_name: name,
        customer_email: email || undefined,
        location: locationLabel || undefined,
        service_address: serviceAddress || undefined,
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

      clearBookingDraftFields({ keepMessage: true });
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
    bookingDraftTitle,
    bookingDraftRecurrenceRule,
    bookingDraftCadenceInsight,
    bookingDraftTradeTimingInsight,
    bookingDraftDefaultOffsetDays,
    bookingDraftDate,
    bookingDraftRecurrenceEnd,
    bookingDraftTimingReason,
    bookingDraftTimingInsight,
    bookingDraftTimingMessage,
    bookingDraftNotes,
    openBookingDraftForCustomer,
    renderBookingsCalendar,
    bookingWorkspaceBlueprint,
    linkedCustomerForBooking,
    bookingCustomerMemoryItems,
    renderBookingCustomerMemoryCard,
    bookingPrepGuidanceItems,
    renderBookingPrepGuidanceCard,
    bookingAssignmentGuidanceItems,
    renderBookingAssignmentGuidanceCard,
    bookingFollowThroughItems,
    renderBookingFollowThroughCard,
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

