// Order workspace extracted from operator.js so list rendering, detail actions,
// and follow-through behavior stay together in one domain module.
function orderCollectionGuidance(order, amountDue, paymentState, depositGap, recentOrderPayment) {
  const hasEmail = !!String(order?.customer_email || order?.email || "").trim();
  if (amountDue <= 0) {
    return {
      title: "This work is financially closed",
      description: recentOrderPayment
        ? `The most recent payment landed ${formatDateTime(recentOrderPayment.paid_at || recentOrderPayment.created_at || recentOrderPayment.updated_at)}. The next move is retention, review follow-up, or repeat work.`
        : "No balance is left open on this work record.",
    };
  }
  if (depositGap > 0) {
    return {
      title: "The deposit still needs attention",
      description: hasEmail
        ? "Collect the deposit or send the reminder before the schedule gets ahead of the cash."
        : "Record the deposit here, and add an email address if you want reminders and invoice follow-through from the same record.",
    };
  }
  if (paymentState === "overdue") {
    return {
      title: "Payment follow-up is overdue",
      description: hasEmail
        ? "Send the reminder from this record, then keep the balance visible until it is fully collected."
        : "Record the next payment here. Adding an email address will unlock reminder follow-through from this same record.",
    };
  }
  return {
    title: "Payment is still open",
    description: hasEmail
      ? "Keep the invoice and the reminder flow attached to this record so the customer sees one clear path to pay."
      : "Record the payment here, and add an email address if you want invoice and reminder follow-through in the same place.",
  };
}

function isOrderInlinePanelOpen(panel) {
  return !!panel && !panel.classList.contains("u-hidden");
}

function setOrderInlinePanelOpen(panel, isOpen) {
  if (!panel) return;
  panel.classList.toggle("u-hidden", !isOpen);
}

function orderWorkspaceBlueprint() {
  if (typeof currentWorkspaceBlueprint === "function") return currentWorkspaceBlueprint();
  return { business: { key: "other", label: "Business", recordFocus: [] } };
}

function orderCustomerMemoryItems(customer, blueprint = orderWorkspaceBlueprint()) {
  if (!customer) return [];
  const sharedChecklist = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
  if (typeof sharedChecklist === "function") {
    return sharedChecklist(customer, blueprint).slice(0, 4);
  }
  const focus = Array.isArray(blueprint?.business?.recordFocus) ? blueprint.business.recordFocus : [];
  return focus.filter(Boolean).slice(0, 4).map((item) => ({
    label: "Booked-work memory",
    ready: !!String(item || "").trim(),
    note: item || "",
  }));
}

function renderOrderCustomerMemoryCard(customer, blueprint = orderWorkspaceBlueprint()) {
  const items = orderCustomerMemoryItems(customer, blueprint);
  if (!customer || !items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Customer memory</div>
      <div><strong>Keep the trade details attached to the booked work</strong></div>
      <div class="detail-copy">Use this view to keep the property, access, equipment, or repair context visible while you schedule, collect money, and hand work to the field.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
            <div class="memory-checklist__title">${escapeHtml(item.ready ? `Ready: ${item.label}` : `Still needed: ${item.label}`)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.note || "")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function orderPrepGuidanceItems(order, customer, blueprint = orderWorkspaceBlueprint()) {
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
      "Access and arrival",
      filled(customer?.access_notes, customer?.gate_notes, order?.service_address),
      firstFilled(customer?.access_notes, customer?.gate_notes, order?.service_address),
      "Confirm the property access notes and arrival details before this booked work becomes a field stop."
    ),
    detail(
      "Route and timing",
      filled(order?.scheduled_date, order?.scheduled_time, customer?.service_schedule, customer?.frequency),
      firstFilled(
        order?.scheduled_date && order?.scheduled_time ? `${order.scheduled_date} at ${order.scheduled_time}` : "",
        order?.scheduled_date,
        customer?.service_schedule,
        customer?.frequency
      ),
      "Lock in the service window and route cadence so the crew knows when this work really lands."
    ),
    detail(
      "Property focus",
      filled(customer?.seasonal_notes, customer?.cleanup_notes, order?.notes, customer?.service_notes),
      firstFilled(customer?.seasonal_notes, customer?.cleanup_notes, order?.notes, customer?.service_notes),
      "Call out the property area, seasonal work, or upsell detail that should stay attached to this booked work."
    ),
  ];

  const cleaning = [
    detail(
      "Entry and access",
      filled(customer?.access_notes, customer?.alarm_notes, customer?.entry_notes),
      firstFilled(customer?.access_notes, customer?.alarm_notes, customer?.entry_notes),
      "Confirm entry, alarm, lockbox, or access instructions before the visit is handed off."
    ),
    detail(
      "Scope for this visit",
      filled(customer?.scope_notes, customer?.checklist_notes, customer?.room_notes, order?.notes),
      firstFilled(customer?.scope_notes, customer?.checklist_notes, customer?.room_notes, order?.notes),
      "Carry the room-by-room scope, checklist, and add-ons into this booked work."
    ),
    detail(
      "Repeat cadence",
      filled(customer?.service_schedule, customer?.frequency, customer?.recurring_notes, customer?.add_on_notes),
      firstFilled(customer?.service_schedule, customer?.frequency, customer?.recurring_notes, customer?.add_on_notes),
      "Make sure the cadence and add-ons for this cleaning visit are clear before the team arrives."
    ),
  ];

  const hvac = [
    detail(
      "System context",
      filled(customer?.equipment_notes, customer?.system_notes, customer?.asset_summary, customer?.equipment_serial),
      firstFilled(customer?.equipment_notes, customer?.system_notes, customer?.asset_summary, customer?.equipment_serial),
      "Confirm the unit, system, or equipment details that should stay attached to this booked work."
    ),
    detail(
      "Access and contact",
      filled(customer?.access_notes, customer?.entry_notes, customer?.tenant_notes, order?.customer_phone, customer?.phone),
      firstFilled(customer?.access_notes, customer?.entry_notes, customer?.tenant_notes, order?.customer_phone, customer?.phone),
      "Confirm who is meeting the technician and how they get into the site."
    ),
    detail(
      "Diagnostic handoff",
      filled(customer?.diagnostic_notes, customer?.failure_symptoms, customer?.issue_summary, order?.notes),
      firstFilled(customer?.diagnostic_notes, customer?.failure_symptoms, customer?.issue_summary, order?.notes),
      "Carry the symptom history and diagnostic context into scheduling so the visit starts informed."
    ),
  ];

  const plumbing = [
    detail(
      "Access and shutoff",
      filled(customer?.shutoff_notes, customer?.access_notes, customer?.entry_notes),
      firstFilled(customer?.shutoff_notes, customer?.access_notes, customer?.entry_notes),
      "Confirm shutoff, entry, and arrival instructions before dispatch."
    ),
    detail(
      "Fixture and issue",
      filled(customer?.fixture_notes, customer?.issue_summary, customer?.leak_source, order?.notes),
      firstFilled(customer?.fixture_notes, customer?.issue_summary, customer?.leak_source, order?.notes),
      "Keep the fixture, leak, or repair context attached to this booked work."
    ),
    detail(
      "Repair follow-through",
      filled(customer?.approval_notes, customer?.restoration_notes, customer?.follow_up_notes),
      firstFilled(customer?.approval_notes, customer?.restoration_notes, customer?.follow_up_notes),
      "Call out any approval or restoration context before the job gets built from this work record."
    ),
  ];

  const fallback = [
    detail(
      "Customer contact",
      filled(order?.customer_phone, customer?.phone, order?.customer_email, customer?.email),
      firstFilled(order?.customer_phone, customer?.phone, order?.customer_email, customer?.email),
      "Confirm how the customer should be reached while this booked work is being scheduled and followed through."
    ),
    detail(
      "Site details",
      filled(order?.service_address, customer?.service_address, customer?.address_line1),
      firstFilled(order?.service_address, customer?.service_address, customer?.address_line1),
      "Keep the service address and site notes attached before the work becomes a field visit."
    ),
    detail(
      "Next handoff note",
      filled(order?.notes, customer?.follow_up_notes, customer?.service_notes),
      firstFilled(order?.notes, customer?.follow_up_notes, customer?.service_notes),
      "Add the one note the next person should not have to rediscover on their own."
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

function renderOrderPrepGuidanceCard(order, customer, blueprint = orderWorkspaceBlueprint()) {
  const items = orderPrepGuidanceItems(order, customer, blueprint);
  if (!items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Prep before field handoff</div>
      <div><strong>Make this booked work easier to execute well</strong></div>
      <div class="detail-copy">Use these reminders to confirm the details that matter before this record turns into scheduling, dispatch, and field execution.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
            <div class="memory-checklist__title">${escapeHtml(item.ready ? `Ready: ${item.label}` : `Still needed: ${item.label}`)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.note || "")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function orderNextMoveItems(order, customer, amountDueCents = 0, paymentState = "", blueprint = orderWorkspaceBlueprint()) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const filled = (...values) => values.some((value) => String(value || "").trim());
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const detail = (label, ready, readyNote, missingNote) => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
  });
  const moneyItem = detail(
    "Money follow-through",
    amountDueCents <= 0,
    "No balance is left open on this booked work.",
    paymentState === "overdue"
      ? "Payment follow-up is overdue. Keep the reminder and collection path attached to this record now."
      : "A balance is still open. Keep the reminder or payment step attached to this booked work."
  );

  const landscaping = [
    detail(
      "Crew prep note",
      filled(customer?.seasonal_notes, customer?.cleanup_notes, order?.notes),
      firstFilled(customer?.seasonal_notes, customer?.cleanup_notes, order?.notes),
      "Leave the next crew one plain-English property or seasonal note before this work turns into a field stop."
    ),
    detail(
      "Return-service plan",
      filled(customer?.service_schedule, customer?.frequency, customer?.follow_up_notes),
      firstFilled(customer?.service_schedule, customer?.frequency, customer?.follow_up_notes),
      "Confirm the repeat cadence or next service window so this property does not rely on memory alone."
    ),
    moneyItem,
  ];

  const cleaning = [
    detail(
      "Visit scope confirmed",
      filled(customer?.checklist_notes, customer?.scope_notes, customer?.add_on_notes, order?.notes),
      firstFilled(customer?.checklist_notes, customer?.scope_notes, customer?.add_on_notes, order?.notes),
      "Confirm the checklist or add-ons that make this visit successful before the team arrives."
    ),
    detail(
      "Next visit protected",
      filled(customer?.service_schedule, customer?.frequency, customer?.follow_up_notes),
      firstFilled(customer?.service_schedule, customer?.frequency, customer?.follow_up_notes),
      "Leave the next cleaning cadence or follow-up note visible so this customer does not have to reteach the routine."
    ),
    moneyItem,
  ];

  const hvac = [
    detail(
      "System follow-through",
      filled(customer?.parts_follow_up, customer?.maintenance_notes, customer?.diagnostic_notes),
      firstFilled(customer?.parts_follow_up, customer?.maintenance_notes, customer?.diagnostic_notes),
      "Call out the next diagnostic, parts, or maintenance step so this visit hands off cleanly."
    ),
    detail(
      "Customer contact path",
      filled(customer?.tenant_notes, customer?.access_notes, order?.customer_phone, customer?.phone),
      firstFilled(customer?.tenant_notes, customer?.access_notes, order?.customer_phone, customer?.phone),
      "Confirm who the office should reach and how the next HVAC step gets scheduled without churn."
    ),
    moneyItem,
  ];

  const plumbing = [
    detail(
      "Repair follow-through",
      filled(customer?.approval_notes, customer?.restoration_notes, customer?.follow_up_notes),
      firstFilled(customer?.approval_notes, customer?.restoration_notes, customer?.follow_up_notes),
      "Leave the approval, restoration, or return-visit note visible before this repair moves to the next stage."
    ),
    detail(
      "Site risk note",
      filled(customer?.shutoff_notes, customer?.issue_summary, customer?.fixture_notes),
      firstFilled(customer?.shutoff_notes, customer?.issue_summary, customer?.fixture_notes),
      "Keep the shutoff or issue note attached so the next visit starts safer and faster."
    ),
    moneyItem,
  ];

  const fallback = [
    detail(
      "Next office note",
      filled(order?.notes, customer?.follow_up_notes, customer?.service_notes),
      firstFilled(order?.notes, customer?.follow_up_notes, customer?.service_notes),
      "Leave the next person one clear note so this booked work does not depend on memory."
    ),
    moneyItem,
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

function renderOrderNextMoveCard(order, customer, amountDueCents = 0, paymentState = "", blueprint = orderWorkspaceBlueprint()) {
  const items = orderNextMoveItems(order, customer, amountDueCents, paymentState, blueprint);
  if (!items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Best next office move</div>
      <div><strong>Keep the booked work, field handoff, and money follow-through together</strong></div>
      <div class="detail-copy">Use this to keep the next trade-specific move attached to the same record instead of relying on memory or side notes.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}">
            <div class="memory-checklist__title">${escapeHtml(item.ready ? `Ready: ${item.label}` : `Needs attention: ${item.label}`)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.note || "")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function orderRetentionItems(order, customer, amountDueCents = 0, paymentState = "", blueprint = orderWorkspaceBlueprint()) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const bookingsApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
  const filled = (...values) => values.some((value) => String(value || "").trim());
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const timingInsight = customer && typeof bookingsApi.bookingDraftTimingInsight === "function"
    ? bookingsApi.bookingDraftTimingInsight(customer, {}, blueprint)
    : null;
  const detail = (label, ready, readyNote, missingNote, tone = "") => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
    tone: tone || (!ready ? "warn" : ""),
  });
  const moneyItem = detail(
    "Account closes cleanly",
    amountDueCents <= 0,
    "The money side is already in a good place, so the next move can stay focused on retention and repeat work.",
    paymentState === "overdue"
      ? "Leave a clear follow-up note so the work result and overdue collection step stay tied together."
      : "Leave the follow-up and payment note attached so the customer does not get a finished job with an unclear balance."
  );
  const repeatSignal = firstFilled(
    customer?.service_schedule,
    customer?.frequency,
    customer?.recurring_notes,
    customer?.service_plan_name,
    customer?.maintenance_notes,
    customer?.seasonal_notes,
    customer?.parts_follow_up,
    customer?.warranty_notes,
    customer?.restoration_notes,
    customer?.approval_notes
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
        timingInsight?.reason
          ? `${timingInsight.reason}${timingInsight.bookingDate ? ` Suggested next visit: ${timingInsight.bookingDate}.` : ""}`
          : "This customer has repeat-service signals, but the next visit or follow-up step still needs to be attached before the account cools off."
      )
    : null;

  const landscaping = [
    detail(
      "Next property touch",
      filled(customer?.seasonal_notes, customer?.service_schedule, customer?.follow_up_notes),
      firstFilled(customer?.seasonal_notes, customer?.service_schedule, customer?.follow_up_notes),
      "Capture the next route, cleanup, or seasonal note before this property falls out of rhythm."
    ),
    detail(
      "Customer follow-up",
      filled(customer?.upsell_notes, customer?.phone, customer?.email),
      firstFilled(customer?.upsell_notes, customer?.phone, customer?.email),
      "Leave the next customer-facing note attached so upsells and follow-up do not get lost after the visit."
    ),
    renewalRiskItem,
    moneyItem,
  ].filter(Boolean);

  const cleaning = [
    detail(
      "Next visit stays easy",
      filled(customer?.frequency, customer?.recurring_notes, customer?.follow_up_notes),
      firstFilled(customer?.frequency, customer?.recurring_notes, customer?.follow_up_notes),
      "Leave the next cleaning cadence attached so the customer does not have to restate the routine."
    ),
    detail(
      "Checklist memory sticks",
      filled(customer?.checklist_notes, customer?.add_on_notes, order?.notes),
      firstFilled(customer?.checklist_notes, customer?.add_on_notes, order?.notes),
      "Keep the add-ons or closeout note attached so the next visit starts from real memory."
    ),
    renewalRiskItem,
    moneyItem,
  ].filter(Boolean);

  const hvac = [
    detail(
      "Maintenance follow-up",
      filled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes),
      firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes),
      "Leave the maintenance, parts, or warranty note attached before the next system visit slips."
    ),
    detail(
      "Customer update stays clear",
      filled(customer?.tenant_notes, customer?.phone, customer?.email),
      firstFilled(customer?.tenant_notes, customer?.phone, customer?.email),
      "Keep the customer update path visible so the office can close out and rebook the next HVAC step cleanly."
    ),
    renewalRiskItem,
    moneyItem,
  ].filter(Boolean);

  const plumbing = [
    detail(
      "Repair follow-through",
      filled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes),
      firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes),
      "Leave the restoration, approval, or return-visit note attached so the repair does not stall after completion."
    ),
    detail(
      "Customer handoff",
      filled(customer?.phone, customer?.email, customer?.shutoff_notes),
      firstFilled(customer?.phone, customer?.email, customer?.shutoff_notes),
      "Keep the update path and shutoff/repair note visible so the customer knows what comes next."
    ),
    renewalRiskItem,
    moneyItem,
  ].filter(Boolean);

  const fallback = [
    detail(
      "Next customer step",
      filled(customer?.follow_up_notes, customer?.service_notes, order?.notes),
      firstFilled(customer?.follow_up_notes, customer?.service_notes, order?.notes),
      "Leave the next follow-up step attached so the customer relationship does not have to restart from memory."
    ),
    renewalRiskItem,
    moneyItem,
  ].filter(Boolean);

  return ({
    landscaping,
    property_maintenance: landscaping,
    pressure_washing: landscaping,
    cleaning,
    hvac,
    plumbing,
  })[businessKey] || fallback;
}

function orderRetentionActions(order, customer, amountDueCents = 0, blueprint = orderWorkspaceBlueprint()) {
  const status = String(order?.status || "").trim().toLowerCase();
  if (!["completed", "fulfilled", "paid"].includes(status)) return [];
  if (!customer || Number(amountDueCents || 0) > 0) return [];
  const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
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

function renderOrderRetentionCard(order, customer, amountDueCents = 0, paymentState = "", blueprint = orderWorkspaceBlueprint()) {
  const items = orderRetentionItems(order, customer, amountDueCents, paymentState, blueprint);
  const actions = orderRetentionActions(order, customer, amountDueCents, blueprint);
  if (!items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">After this work is done</div>
      <div><strong>Keep the next customer promise attached</strong></div>
      <div class="detail-copy">Use this to protect the repeat-service step, customer update, and account closeout while the work is still fresh.</div>
      <div class="memory-checklist">
        ${items.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}">
            <div class="memory-checklist__title">${escapeHtml(item.ready ? `Ready: ${item.label}` : `Needs attention: ${item.label}`)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.note || "")}</div>
          </div>
        `).join("")}
      </div>
      ${actions.length ? `
        <div class="action-row action-row--wrap u-mt-10">
          ${actions.map((action) => `
            <button type="button" class="${escapeAttr(action.className || "btn btn-ghost btn-sm")}" data-order-retention-action="${escapeAttr(action.action || "")}">
              ${escapeHtml(action.label || "Take action")}
            </button>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderOrders() {
  if (!ordersList) return;
  renderPipelineWorkspace();
  const rows = Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];
  const statusOptions = ["new", "quoted", "confirmed", "fulfilled", "completed", "paid", "cancelled"];

  if (!rows.length) {
    ordersList.innerHTML = `<div class="muted">No active work. When you convert a request to a job, it shows up here.</div>`;
    if (orderDetailWrap) orderDetailWrap.innerHTML = `<div class="muted">Select booked work to inspect it.</div>`;
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
      <div class="list-item order-item ${row.id === active.id ? "is-active" : ""} gap-8">
        <input type="checkbox" class="order-bulk-check order-select-checkbox" data-order-id="${escapeAttr(row.id)}" ${isChecked ? "checked" : ""} onclick="event.stopPropagation();" />
        <button type="button" class="li-btn li-btn-reset" data-order-id="${escapeAttr(row.id)}">
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
    btn.className = 'btn btn-ghost btn-block u-mt-12';
    btn.textContent = `Load ${Math.min(PAGE_SIZE, remaining)} more (${CRM_ORDERS_CACHE.length} of ${ORDERS_TOTAL_COUNT} shown)`;
    btn.addEventListener('click', async () => {
      FETCH_OFFSETS.orders += PAGE_SIZE;
      btn.disabled = true;
      btn.textContent = "Loading...";
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
  const blueprint = orderWorkspaceBlueprint();
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
  const collectionGuidance = orderCollectionGuidance(active, amountDue, paymentState, depositGap, recentOrderPayment);
  const reviewEmail = String(active.customer_email || active.email || "").trim();
  const orderFollowThroughActions = [
    ["completed", "fulfilled"].includes(String(active.status || "").toLowerCase()) && reviewEmail
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
        { label: "Due now", value: formatUsd(amountDue), note: paymentState === "overdue" ? "Needs payment follow-up" : "Still open", tone: paymentState === "overdue" ? "pill-bad" : "" },
        { label: "Deposit", value: depositGap > 0 ? `${formatUsd(depositGap)} open` : formatUsd(depositPaid), note: depositStatus === "not_required" ? "No deposit required" : formatDepositStatus(depositStatus) },
      ],
    })}
    ${isReturnCustomer && !existingCustomer ? `<div class="detail-card u-mt-14"><div class="kicker">Customer match</div><div class="detail-copy detail-copy--warn">${priorOrders.length} prior order(s) found for this email. Consider linking this person into CRM so the next request, job, and payment history stay together.</div></div>` : ""}
    ${renderRecordActionRail({
      eyebrow: "Quick actions",
      title: "Move this work forward",
      description: linkedJob
        ? "The booked work, field job, and payment flow are already tied together here. Use the actions below to keep them moving without jumping around."
        : "Use one action row to create the linked job, collect money, or open the right record without rebuilding anything.",
      actions: orderActionButtons,
    })}
    ${renderOrderCustomerMemoryCard(existingCustomer, blueprint)}
    ${renderOrderPrepGuidanceCard(active, existingCustomer, blueprint)}
    ${renderOrderNextMoveCard(active, existingCustomer, amountDue, paymentState, blueprint)}
    ${renderOrderRetentionCard(active, existingCustomer, amountDue, paymentState, blueprint)}

    ${(active.order_type === 'package' || active.order_type === 'retainer') ? `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Order type: ${escapeHtml(active.order_type === 'package' ? 'Session Package' : 'Monthly Retainer')}</div>
      ${active.order_type === 'package' ? (() => {
        const total = Number(active.package_sessions_total || 0);
        const used  = Number(active.package_sessions_used || 0);
        const remaining = Math.max(0, total - used);
        const pct = total > 0 ? Math.round(remaining / total * 10) : 0;
        const bar = '#'.repeat(pct) + '-'.repeat(10 - pct);
        return `<div class="detail-copy">Sessions: ${remaining} remaining of ${total} &nbsp;[${bar}]&nbsp; (used ${used})</div>
        ${active.package_valid_until ? `<div class="detail-copy">Valid until ${new Date(active.package_valid_until).toLocaleDateString()}</div>` : ''}`;
      })() : `<div class="detail-copy">Bills every ${escapeHtml(String(active.recurrence_interval_days || 30))} days</div>`}
    </div>` : ''}

    <div class="detail-card u-mt-14">
      <div class="kicker">Workflow next step</div>
      <div class="detail-copy">Request: ${escapeHtml(linkedLead?.contact_name || linkedLead?.title || "Not linked")}</div>
      <div class="detail-copy">Proposal: ${escapeHtml(linkedBid?.title || "Not linked")}</div>
      <div class="detail-copy">Tracked job: ${escapeHtml(linkedJob?.title || (linkedJob ? "Linked job" : "No job yet"))}</div>
      <div class="detail-copy">Recurring plan: ${escapeHtml(linkedPlan?.title || "Not set up")}</div>
      <div class="detail-copy">${linkedJob ? `Execution status: ${escapeHtml(String(linkedJob.status || "scheduled").replace(/_/g, " "))}` : "Create a job when this work is ready to be scheduled or performed."}</div>
      <div class="row action-row--wrap u-mt-10">
        <button id="btnOpenOrderRequest" class="btn btn-ghost" type="button">${linkedLead ? "Open request" : "Create request"}</button>
        <button id="btnOpenOrderBid" class="btn btn-ghost" type="button">${linkedBid ? "Open proposal" : "Draft proposal"}</button>
        <button id="btnCreateJobFromOrder" class="btn btn-primary" type="button">${linkedJob ? "Open linked job" : "Create job"}</button>
        <button id="btnCreateRecurringPlanFromOrder" class="btn" type="button">${linkedPlan ? "Open recurring plan" : "Make recurring"}</button>
        <button id="btnCollectOrderDeposit" class="btn btn-ghost" type="button">${depositGap > 0 ? "Collect deposit" : "Record payment"}</button>
        <button id="btnRecordOrderPayment" class="btn btn-ghost" type="button">Record payment</button>
        <button id="btnOpenOrderCustomer" class="btn btn-ghost" type="button">Open customer</button>
        <button id="btnDownloadInvoice" class="btn btn-ghost" type="button">Download invoice PDF</button>
        <button id="btnSetupRecurring" class="btn btn-ghost" type="button">Make recurring</button>
        ${active.customer_phone ? `<button id="btnOrderSms" class="btn btn-ghost" type="button">Text customer</button>` : ""}
      </div>
      <div id="recurringSetupPanel" class="inline-soft-panel u-hidden">
        <div class="row row-tight-end action-row--wrap">
          <label class="row-fill">Repeat every
            <select id="recurringFrequency">
              <option value="weekly">Week</option>
              <option value="biweekly">2 Weeks</option>
              <option value="monthly">Month</option>
            </select>
          </label>
          <label class="row-fill">Next date
            <input type="date" id="recurringNextDate" />
          </label>
          <button id="btnSaveRecurring" class="btn btn-primary" type="button">Save</button>
        </div>
        <div id="recurringMsg" class="msg u-mt-10"></div>
      </div>

      ${active.customer_phone ? `
      <div id="orderSmsPanel" class="inline-soft-panel u-hidden">
        <div class="inline-soft-panel__copy">Texting ${escapeHtml(active.customer_name || "customer")} at ${escapeHtml(active.customer_phone)}</div>
        <div id="orderSmsThread" class="inline-soft-panel__thread"></div>
        <div class="row gap-8">
          <input id="orderSmsInput" class="u-flex-1" type="text" placeholder="Type a message..." />
          <button id="btnOrderSmsSend" class="btn btn-primary btn-sm" type="button">Send</button>
        </div>
        <div id="orderSmsMsg" class="msg"></div>
      </div>` : ""}
    </div>

    <div class="detail-card u-mt-14">
      <div class="kicker">Deposit control</div>
      <div class="detail-copy">${escapeHtml(depositPolicyLabel(depositPolicy))}${depositDueDate ? ` | Due ${escapeHtml(formatDateOnly(depositDueDate))}` : ""}</div>
      <div class="detail-copy">${depositOverrideReason ? `Override reason: ${escapeHtml(depositOverrideReason)}` : "Use this when the business needs a deposit rule that is teachable, enforceable, and still flexible in real life."}</div>
      <div class="grid three form-grid u-mt-10">
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
      <label class="u-mt-10">Override reason
        <textarea id="orderDepositOverrideReason" rows="3" placeholder="Why this order can move ahead before the deposit is collected.">${escapeHtml(depositOverrideReason)}</textarea>
      </label>
      <div class="row action-row--wrap u-mt-10">
        <button id="btnSaveOrderDepositSettings" class="btn btn-primary" type="button">Save deposit settings</button>
        <button id="btnClearOrderDepositOverride" class="btn btn-ghost" type="button" ${depositOverrideReason ? "" : "disabled"}>Clear override</button>
      </div>
      <div id="orderDepositMsg" class="msg"></div>
    </div>

    ${renderRecordFollowThroughCard({
      eyebrow: "Follow-through",
      title: "Keep status, reminders, and collection aligned",
      description: reviewEmail
        ? "Update the workflow stage, send the right customer message, and keep money follow-through visible from one place."
        : "Update the workflow stage here. Add a customer email to unlock reminders, invoice email, and review follow-up.",
      summary: [
        { label: "Status", value: formatOrderWorkflowStatus(active.status || "new"), note: "Current workflow stage" },
        { label: "Collection", value: formatWorkflowPaymentState(paymentState), note: amountDue > 0 ? `${formatUsd(amountDue)} still open` : "Nothing outstanding" },
        { label: "Due date", value: active.payment_due_date ? formatDateOnly(active.payment_due_date) : (depositDueDate ? formatDateOnly(depositDueDate) : "Not set"), note: active.payment_due_date ? "Customer-facing due date" : "Falls back to deposit or schedule timing" },
        { label: "Recent payment", value: recentOrderPayment ? formatUsd(paymentAmountCents(recentOrderPayment)) : "None yet", note: recentOrderPayment ? formatDateTime(recentOrderPayment.paid_at || recentOrderPayment.created_at || recentOrderPayment.updated_at) : "No payment recorded yet" },
      ],
      controlsHtml: `
        <div class="row row-tight-end action-row--wrap">
          <label class="field row-fill">
            <span>Status</span>
            <select id="orderStatusSelect">
              ${statusOptions.map((status) => `<option value="${status}" ${String(active.status || "new").toLowerCase() === status ? "selected" : ""}>${escapeHtml(formatOrderWorkflowStatus(status))}</option>`).join("")}
            </select>
          </label>
          ${reviewEmail ? `<label class="modal-check"><input type="checkbox" id="chkNotifyOnStatusChange" class="modal-check__input" checked /><span class="modal-check__label">Notify customer</span></label>` : ""}
          <button id="btnSaveOrderStatus" class="btn btn-primary" type="button">Save status</button>
        </div>
      `,
      actions: orderFollowThroughActions,
      timelineHtml: `
        <div id="quoteFormPanel" class="inline-soft-panel inline-soft-panel--padded u-hidden">
          <div class="inline-soft-panel__title">New quote</div>
          <div class="row row-tight-end action-row--wrap">
            <label class="field row-fill">Title
              <input type="text" id="quoteTitle" placeholder="Quote title" value="${escapeAttr(active.title || '')}" />
            </label>
            <label class="field row-fill">Amount (USD)
              <input type="number" id="quoteAmount" placeholder="0.00" min="0" step="0.01" />
            </label>
            <label class="field row-fill">Valid until
              <input type="date" id="quoteValidUntil" />
            </label>
          </div>
          <label class="field u-mt-10">Description (optional)
            <textarea id="quoteDescription" class="u-full-width" rows="2" placeholder="Scope of work, inclusions, terms...">${escapeHtml(active.notes || '')}</textarea>
          </label>
          <div class="row gap-8 u-mt-10">
            <button id="btnSubmitQuote" class="btn btn-primary btn-sm" type="button">Send quote</button>
            <button id="btnCancelQuote" class="btn btn-ghost btn-sm" type="button">Cancel</button>
          </div>
        </div>
        <div id="orderNotifyMsg" class="msg u-mt-10"></div>
      `,
    })}
    <div class="detail-card u-mt-14">
      <div class="kicker">Collection guidance</div>
      <div><strong>${escapeHtml(collectionGuidance.title)}</strong></div>
      <div class="detail-copy">${escapeHtml(collectionGuidance.description)}</div>
      <div class="workspace-chip-row u-mt-10">
        <span class="pill ${amountDue > 0 ? "pill-bad" : "pill-good"}">${escapeHtml(amountDue > 0 ? `${formatUsd(amountDue)} still open` : "Nothing outstanding")}</span>
        <span class="pill">${escapeHtml(depositGap > 0 ? `${formatUsd(depositGap)} deposit open` : "Deposit handled or not required")}</span>
      </div>
    </div>

    <div class="detail-card u-mt-14" id="phasesSection">
      <div class="kicker detail-toggle" id="phasesToggle">
        <span>Project phases (show)</span>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openAddPhaseModal('${escapeAttr(active.id)}')">+ Phase</button>
      </div>
      <div id="phasesBody" class="u-hidden u-mt-10"></div>
    </div>

    <div class="detail-card u-mt-14" id="timeLoggedSection">
      <div class="kicker detail-toggle" id="timeLoggedToggle">
        <span>Time logged (show)</span>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openLogTimeModal('${escapeAttr(active.id)}')">+ Log Time</button>
      </div>
      <div id="timeLoggedBody" class="u-hidden u-mt-10"></div>
    </div>
  `;

  // Project phases collapsible section
  document.getElementById('phasesToggle')?.addEventListener('click', async (ev) => {
    if (ev.target.tagName === 'BUTTON') return;
    const body   = document.getElementById('phasesBody');
    const toggle = document.getElementById('phasesToggle')?.querySelector('span');
    if (!body) return;
    if (isOrderInlinePanelOpen(body)) { setOrderInlinePanelOpen(body, false); if (toggle) toggle.textContent = 'Project phases (show)'; return; }
    setOrderInlinePanelOpen(body, true);
    if (toggle) toggle.textContent = 'Project phases (hide)';
    body.innerHTML = '<div class="muted table-empty">Loading...</div>';
    await loadPhasesIntoEl(active.id, body);
  });

  // Time entries collapsible section
  document.getElementById("timeLoggedToggle")?.addEventListener("click", async (ev) => {
    if (ev.target.tagName === "BUTTON") return;
    const body   = document.getElementById("timeLoggedBody");
    const toggle = document.getElementById("timeLoggedToggle")?.querySelector("span");
    if (!body) return;
    if (isOrderInlinePanelOpen(body)) { setOrderInlinePanelOpen(body, false); if (toggle) toggle.textContent = "Time logged (show)"; return; }
    if (toggle) toggle.textContent = "Time logged (hide)";
    setOrderInlinePanelOpen(body, true);
    await renderTimeEntries(active.id);
  });

  // Time to invoice button
  document.addEventListener("click", async (ev) => {
    if (ev.target?.id !== "btnTimeToInvoice") return;
    const orderId = ACTIVE_ORDER_ID;
    if (!orderId) return;
    ev.target.disabled = true;
    ev.target.textContent = "Working...";
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
      if (ev.target) { ev.target.disabled = false; ev.target.textContent = "Add uninvoiced hours to invoice"; }
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

    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};

    // Auto-send review request when order is marked complete/fulfilled
    if (
      ["completed", "fulfilled"].includes(nextStatus)
      && String(data.customer_email || data.email || "").trim()
      && !data.review_requested_at
      && typeof coreUtils.requestOrderReview === "function"
    ) {
      try {
        const reviewResult = await coreUtils.requestOrderReview(data.id, {
          successMessage: "",
          customerName: data.customer_name || existingCustomer?.name || "there",
          businessName: typeof bidBrandContext === "function" ? bidBrandContext().tenantName : "our team",
        });
        data.review_requested_at = reviewResult.review_requested_at;
        renderOrders();
        renderDashboard();
        renderGuidance();
      } catch (e) {
        console.warn("[review] auto-request failed:", e.message);
      }
    }

    // Notify customer of status change if checkbox is checked
    const shouldNotify = $("chkNotifyOnStatusChange")?.checked;
    if (shouldNotify && String(data.customer_email || data.email || "").trim()) {
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
  orderDetailWrap.querySelectorAll("[data-order-retention-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-order-retention-action");
      if (!existingCustomer?.id) {
        if (action === "open-reactivation-customer" || action === "reactivate-repeat" || action === "generate-next-order") {
          $("btnOpenOrderCustomer")?.click();
        }
        return;
      }

      if (action === "open-reactivation-customer") {
        ACTIVE_CUSTOMER_ID = existingCustomer.id;
        CUSTOMER_CREATING = false;
        switchTab("customers");
        return;
      }

      if (action === "reactivate-repeat" || action === "request" || action === "create-request" || action === "generate-next-order") {
        const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
        if (typeof customerApi.openCustomerRetentionAction === "function") {
          customerApi.openCustomerRetentionAction(action, existingCustomer, blueprint, {
            requestOptions: {
              message: action === "create-request" ? "Follow-up request created from booked work." : "Follow-up request draft opened from booked work.",
              successMessage: "Follow-up request created from booked work.",
              pendingMessage: "Creating follow-up request from booked work...",
              sourceRecordType: "order",
              sourceRecordId: active.id || "",
            },
          });
          return;
        }
        if (action === "reactivate-repeat") {
          const bookingsApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
          if (typeof bookingsApi.openBookingDraftForCustomer === "function") {
            bookingsApi.openBookingDraftForCustomer(existingCustomer, {}, blueprint);
            return;
          }
          ACTIVE_CUSTOMER_ID = existingCustomer.id;
          switchTab("bookings");
        }
      }
    });
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
    const msg = $("orderNotifyMsg");
    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
    btn.disabled = true;
    try {
      const setReviewStatus = (message = "", tone = "") => {
        if (!msg) return;
        msg.textContent = message;
        msg.className = tone ? `msg ${tone === "ok" ? "success" : tone}` : "msg";
      };
      if (typeof coreUtils.requestOrderReview !== "function") {
        throw new Error("Review request tools are not ready yet.");
      }
      const reviewResult = await coreUtils.requestOrderReview(active.id, {
        button: btn,
        setStatus: setReviewStatus,
        customerName: active.customer_name || existingCustomer?.name || "there",
        businessName: typeof bidBrandContext === "function" ? bidBrandContext().tenantName : "our team",
        onSuccess: async (_payload, reviewRequestedAt) => {
          active.review_requested_at = reviewRequestedAt;
          renderOrders();
          renderDashboard();
          renderGuidance();
        },
      });
      active.review_requested_at = reviewResult.review_requested_at;
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
    if (msg) { msg.textContent = "Sending..."; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-order-notification", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (msg) { msg.textContent = "Customer notified."; msg.className = "msg success"; }
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
    if (msg) { msg.textContent = "Sending invoice..."; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-invoice-email", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (msg) { msg.textContent = "Invoice emailed."; msg.className = "msg success"; }
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
    if (msg) { msg.textContent = "Sending reminder..."; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/send-payment-reminder", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send");
      if (msg) { msg.textContent = "Payment reminder sent."; msg.className = "msg success"; }
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending."; msg.className = "msg error"; }
    }
    btn.disabled = false;
  });

  $("btnSendQuote")?.addEventListener("click", () => {
    const panel = $("quoteFormPanel");
    if (!panel) return;
    const isOpen = isOrderInlinePanelOpen(panel);
    setOrderInlinePanelOpen(panel, !isOpen);
    if (!isOpen) {
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
    setOrderInlinePanelOpen(panel, false);
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
    if (msg) { msg.textContent = "Sending quote..."; msg.className = "msg"; }

    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/create-quote", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ customer_name: customerName, customer_email: customerEmail, title, amount: Number(amountRaw), description, valid_until: validUntil }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to send quote");
      if (msg) { msg.textContent = `Quote sent to ${customerEmail}.`; msg.className = "msg success"; }
      const panel = $("quoteFormPanel");
      setOrderInlinePanelOpen(panel, false);
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error sending quote."; msg.className = "msg error"; }
    }
    if (btn) btn.disabled = false;
  });

  $("btnSetupRecurring")?.addEventListener("click", () => {
    const panel = $("recurringSetupPanel");
    if (!panel) return;
    const isOpen = isOrderInlinePanelOpen(panel);
    setOrderInlinePanelOpen(panel, !isOpen);
    if (!isOpen) {
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
    if (msg) { msg.textContent = "Saving..."; msg.className = "msg"; }
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/create-recurring-order", {
        method : "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
        body   : JSON.stringify({ order_id: active.id, frequency: freq, next_date: nd }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to save");
      if (msg) { msg.textContent = "Recurring schedule saved."; msg.className = "msg success"; }
      $("btnSetupRecurring").textContent = "Recurring: " + freq;
    } catch (err) {
      if (msg) { msg.textContent = err.message || "Error saving."; msg.className = "msg error"; }
      btn.disabled = false;
    }
  });

  // Order-level SMS
  $("btnOrderSms")?.addEventListener("click", async () => {
    const panel = $("orderSmsPanel");
    if (!panel) return;
    const isOpen = isOrderInlinePanelOpen(panel);
    setOrderInlinePanelOpen(panel, !isOpen);
    if (!isOpen && active.customer_phone) {
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
            return `<div class="sms-thread-row ${isOut ? 'sms-thread-row--outbound' : 'sms-thread-row--inbound'}">
              <div class="sms-thread-bubble ${isOut ? 'sms-thread-bubble--outbound' : 'sms-thread-bubble--inbound'}">
                ${escapeHtml(m.body || "")}
              </div>
            </div>`;
          }).join('') : '<p class="inline-soft-panel__empty">No messages yet.</p>';
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
        thread.innerHTML += `<div class="sms-thread-row sms-thread-row--outbound">
          <div class="sms-thread-bubble sms-thread-bubble--outbound">${escapeHtml(text)}</div>
        </div>`;
        thread.scrollTop = thread.scrollHeight;
      }
      if (msg) { msg.textContent = "Message sent."; msg.className = "msg success"; setTimeout(() => { if (msg) { msg.textContent = ""; msg.className = "msg"; } }, 2000); }
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
    btn.textContent = "Adding...";
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
      btn.textContent = "Added to CRM";
      btn.style.color = "#4ade80";
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Add customer to CRM";
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
      title: depositGap > 0 ? "Record deposit" : "Record payment",
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
