// Jobs workspace extracted from operator.js so field execution, linked records,
// and crew-side follow-through stay together in one domain module.
function jobsWorkspaceBlueprint() {
  if (typeof currentWorkspaceBlueprint === "function") return currentWorkspaceBlueprint();
  return { business: { key: "other", label: "Business", recordFocus: [] } };
}

function jobTemplateRecordFocus(blueprint = jobsWorkspaceBlueprint()) {
  const focus = Array.isArray(blueprint?.business?.recordFocus) ? blueprint.business.recordFocus : [];
  return focus.filter(Boolean).slice(0, 3);
}

function jobCustomerMemoryItems(linkedCustomer, blueprint = jobsWorkspaceBlueprint()) {
  if (!linkedCustomer) return [];
  const sharedChecklist = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL?.customerMemoryChecklist;
  if (typeof sharedChecklist === "function") {
    return sharedChecklist(linkedCustomer, blueprint).slice(0, 4);
  }
  return jobTemplateRecordFocus(blueprint).map((item) => ({
    label: "Field memory",
    ready: !!String(item || "").trim(),
    note: item || "",
  }));
}

function hydrovacAlertsForJob(jobIdValue) {
  return Array.isArray(HYDROVAC_ALERTS_CACHE)
    ? HYDROVAC_ALERTS_CACHE.filter((alert) => (
      alert
      && alert.resolved !== true
      && String(alert.reference_type || "job").toLowerCase() === "job"
      && String(alert.reference_id || "") === String(jobIdValue || "")
    ))
    : [];
}

function hydrovacManifestNeedsCloseout(job) {
  return (
    Number(job?.total_loads_hauled || 0) > 0
    || Number(job?.total_disposal_cost_cents || 0) > 0
    || Number(job?.disposal_cost_cents || 0) > 0
    || !!String(job?.disposal_site || "").trim()
    || !!String(job?.disposal_manifest_number || "").trim()
  );
}

function buildJobReadinessSummary(job, order, linkedCustomer, hydrovacState = null, blueprint = jobsWorkspaceBlueprint()) {
  const items = [];
  const addItem = (label, ready, note, options = {}) => {
    items.push({
      label,
      ready: !!ready,
      note: note || "",
      blocker: options.blocker !== false,
    });
  };

  const hasCustomer = !!(linkedCustomer?.id || job?.customer_id || order?.customer_id);
  const hasAddress = !!String(job?.service_address || order?.service_address || "").trim();
  const hasCrew = !!String(job?.assigned_member_id || job?.assigned_operator_id || "").trim();
  const hasSchedule = !!String(job?.scheduled_date || "").trim();
  const hydrovac = !!(job && typeof isHydrovacJob === "function" && isHydrovacJob(job, blueprint));

  addItem(
    "Customer linked",
    hasCustomer,
    hasCustomer
      ? `${linkedCustomer?.name || order?.customer_name || "Customer"} is tied to this work.`
      : "Link a customer so history, money, and follow-up stay in one record."
  );
  addItem(
    "Service address",
    hasAddress,
    hasAddress
      ? String(job?.service_address || order?.service_address || "")
      : "Add the service address before dispatch or field work starts."
  );
  addItem(
    "Scheduled time",
    hasSchedule,
    hasSchedule
      ? `${String(job?.scheduled_date || "")}${job?.scheduled_time ? ` at ${job.scheduled_time}` : ""}`
      : "Pick the service date so the office and crew are aligned."
  );
  addItem(
    "Assigned crew",
    hasCrew,
    hasCrew
      ? "A crew member is already attached to this job."
      : "Assign the crew member who will own the field update and closeout."
  );

  if (hydrovac) {
    const tickets = Array.isArray(hydrovacState?.tickets) ? hydrovacState.tickets : [];
    const permits = Array.isArray(HYDROVAC_PERMITS_CACHE) ? HYDROVAC_PERMITS_CACHE.filter((permit) => permit.job_id === job.id) : [];
    const openAlerts = hydrovacAlertsForJob(job.id);
    const manifests = Array.isArray(hydrovacState?.manifests)
      ? hydrovacState.manifests
      : (typeof hydrovacJobManifestSnapshot === "function" ? hydrovacJobManifestSnapshot(job.id).manifests : []);
    const manifestSnapshot = typeof hydrovacJobManifestSnapshot === "function"
      ? hydrovacJobManifestSnapshot(job.id)
      : { openLoads: 0, confirmedUnbilled: 0, manifests };
    const now = Date.now();
    const hasValidLocate = tickets.some((ticket) => {
      const status = normalizeWorkflowStatusValue(ticket?.status || "");
      const until = Date.parse(ticket?.extended_until || ticket?.valid_until || "");
      return ["active", "extended"].includes(status) && (!Number.isFinite(until) || until > now);
    });
    const hasValidPermit = permits.some((permit) => {
      const status = normalizeWorkflowStatusValue(permit?.status || "");
      const until = Date.parse(permit?.permit_valid_until || "");
      return status === "open" && (!Number.isFinite(until) || until > now);
    });
    const manifestIssues = manifests.flatMap((manifest) => {
      const problems = [];
      const number = manifest?.manifest_number || manifest?.id || "load";
      if (normalizeWorkflowStatusValue(manifest?.status || "") !== "confirmed") {
        problems.push(`Confirm ${number}`);
      }
      if (!String(manifest?.disposal_facility_id || manifest?.disposal_facility_name || "").trim()) {
        problems.push(`add the disposal facility for ${number}`);
      }
      if (!String(manifest?.disposal_ticket_number || "").trim()) {
        problems.push(`add the disposal ticket for ${number}`);
      }
      if (manifest?.quantity_actual == null && manifest?.quantity_estimated == null) {
        problems.push(`add hauled quantity for ${number}`);
      }
      return problems;
    });

    if (typeof hydrovacJobNeedsLocate === "function" && hydrovacJobNeedsLocate(job)) {
      addItem(
        "Locate ticket",
        hasValidLocate,
        hasValidLocate
          ? "Active locate coverage is on file for this excavation work."
          : "This hydrovac job needs an active locate ticket before work can start."
      );
    }
    if (typeof hydrovacJobNeedsPermit === "function" && hydrovacJobNeedsPermit(job)) {
      addItem(
        "Confined-space permit",
        hasValidPermit,
        hasValidPermit
          ? "An open confined-space permit is on file."
          : "This job needs an open confined-space permit before the crew can begin."
      );
    }
    addItem(
      "Compliance alerts",
      openAlerts.length === 0,
      openAlerts.length
        ? openAlerts.map((alert) => alert.message || titleCaseWords(String(alert.alert_type || "alert").replace(/_/g, " "))).slice(0, 2).join(" ")
        : "No unresolved hydrovac compliance alerts are open on this job."
    );
    if (hydrovacManifestNeedsCloseout(job) || manifests.length) {
      addItem(
        "Loads ready for closeout",
        manifestSnapshot.openLoads === 0 && manifestIssues.length === 0,
        manifestSnapshot.openLoads > 0
          ? `${manifestSnapshot.openLoads} hauled load${manifestSnapshot.openLoads === 1 ? "" : "s"} still need confirmation before closeout.`
          : (manifestIssues[0] || "Manifest details are ready for closeout."),
      );
    }
  }

  const blockers = items.filter((item) => item.blocker && !item.ready);
  const readyCount = items.filter((item) => item.ready).length;
  const nextStep = blockers[0]?.note
    || "This job has the key details in place, so the office and crew can keep moving without guesswork.";

  return {
    items,
    blockers,
    readyCount,
    totalCount: items.length,
    title: blockers.length
      ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} to clear`
      : "Ready for the next move",
    description: blockers.length
      ? "Clear these items before dispatch, start, or closeout so the crew does not find out the hard way."
      : "The essentials are in place. Use the field updates below to keep execution, proof, and money moving together.",
    nextStep,
  };
}

function renderJobReadinessCard(summary) {
  if (!summary) return "";
  const blockerItems = summary.blockers.length ? summary.blockers : summary.items.filter((item) => item.ready).slice(0, 3);
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Readiness</div>
      <div><strong>${escapeHtml(summary.title)}</strong></div>
      <div class="detail-copy">${escapeHtml(summary.description)}</div>
      <div class="workspace-chip-row u-mt-10">
        <span class="pill ${summary.blockers.length ? "pill-bad" : "pill-good"}">${escapeHtml(`${summary.readyCount}/${summary.totalCount} checks ready`)}</span>
        <span class="pill">${escapeHtml(summary.blockers.length ? `${summary.blockers.length} blocker${summary.blockers.length === 1 ? "" : "s"}` : "No blockers open")}</span>
      </div>
      <div class="detail-copy u-mt-10"><strong>Next step:</strong> ${escapeHtml(summary.nextStep)}</div>
      <div class="memory-checklist">
        ${blockerItems.map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}">
            <div class="memory-checklist__title">${escapeHtml(item.ready ? `Ready: ${item.label}` : `Needs attention: ${item.label}`)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.note || "")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function jobCloseoutChecklistItems(job, order, linkedCustomer, blueprint = jobsWorkspaceBlueprint(), amountDueCents = 0, readiness = null) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const filled = (...values) => values.some((value) => String(value || "").trim());
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const detail = (label, ready, readyNote, missingNote) => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
  });

  if (readiness?.blockers?.length) {
    return readiness.blockers.slice(0, 3).map((item) => ({
      label: item.label,
      ready: false,
      note: item.note || "Clear this before closeout.",
    }));
  }

  const landscaping = [
    detail(
      "Site note saved",
      filled(job?.notes, linkedCustomer?.service_notes, linkedCustomer?.follow_up_notes),
      firstFilled(job?.notes, linkedCustomer?.service_notes, linkedCustomer?.follow_up_notes),
      "Leave a field note about what was finished, what changed, or what should happen next at the property."
    ),
    detail(
      "Follow-up opportunity",
      filled(linkedCustomer?.seasonal_notes, linkedCustomer?.upsell_notes, linkedCustomer?.cleanup_notes),
      firstFilled(linkedCustomer?.seasonal_notes, linkedCustomer?.upsell_notes, linkedCustomer?.cleanup_notes),
      "Capture the next cleanup, route opportunity, or upsell while the crew context is still fresh."
    ),
    detail(
      "Money follow-through",
      amountDueCents <= 0,
      "No balance is left open on this work.",
      "Decide whether payment should be collected now or followed up right away after the visit."
    ),
  ];

  const cleaning = [
    detail(
      "Checklist and scope note",
      filled(job?.notes, linkedCustomer?.checklist_notes, linkedCustomer?.scope_notes),
      firstFilled(job?.notes, linkedCustomer?.checklist_notes, linkedCustomer?.scope_notes),
      "Save the visit note or checklist summary before this cleaning job is closed."
    ),
    detail(
      "Entry secured",
      filled(linkedCustomer?.access_notes, linkedCustomer?.alarm_notes, linkedCustomer?.entry_notes),
      firstFilled(linkedCustomer?.access_notes, linkedCustomer?.alarm_notes, linkedCustomer?.entry_notes),
      "Confirm any lockup, alarm, or access detail that the office should remember after the crew leaves."
    ),
    detail(
      "Money follow-through",
      amountDueCents <= 0,
      "No balance is left open on this visit.",
      "Keep payment or reminder follow-through attached so this visit closes out cleanly for the customer."
    ),
  ];

  const hvac = [
    detail(
      "Findings logged",
      filled(job?.notes, linkedCustomer?.diagnostic_notes, linkedCustomer?.system_notes),
      firstFilled(job?.notes, linkedCustomer?.diagnostic_notes, linkedCustomer?.system_notes),
      "Log the diagnostic finding or repair result before closeout so the next tech starts informed."
    ),
    detail(
      "Parts or return visit",
      filled(linkedCustomer?.parts_follow_up, linkedCustomer?.follow_up_notes, linkedCustomer?.maintenance_notes),
      firstFilled(linkedCustomer?.parts_follow_up, linkedCustomer?.follow_up_notes, linkedCustomer?.maintenance_notes),
      "Call out any parts hold, maintenance-plan follow-up, or return-visit need before closing this job."
    ),
    detail(
      "Approval or payment",
      amountDueCents <= 0 || filled(linkedCustomer?.approval_notes),
      amountDueCents <= 0 ? "Money is closed or already handled." : firstFilled(linkedCustomer?.approval_notes),
      "Confirm whether approval, estimate follow-up, or payment collection is the next move after the technician leaves."
    ),
  ];

  const plumbing = [
    detail(
      "Repair result logged",
      filled(job?.notes, linkedCustomer?.issue_summary, linkedCustomer?.fixture_notes),
      firstFilled(job?.notes, linkedCustomer?.issue_summary, linkedCustomer?.fixture_notes),
      "Save the repair outcome so the next person knows what was fixed and what still needs attention."
    ),
    detail(
      "Restoration follow-through",
      filled(linkedCustomer?.restoration_notes, linkedCustomer?.follow_up_notes, linkedCustomer?.approval_notes),
      firstFilled(linkedCustomer?.restoration_notes, linkedCustomer?.follow_up_notes, linkedCustomer?.approval_notes),
      "Call out any restoration risk, approval, or return-visit follow-through before closing this job."
    ),
    detail(
      "Money follow-through",
      amountDueCents <= 0,
      "No balance is left open on this repair.",
      "Keep payment or reminder follow-through attached so the repair closes out cleanly."
    ),
  ];

  const fallback = [
    detail(
      "Field note saved",
      filled(job?.notes),
      job?.notes,
      "Save the field note before closing this job so the office is not guessing later."
    ),
    detail(
      "Customer context retained",
      !!linkedCustomer,
      `${linkedCustomer?.name || "Customer"} is still linked to this work.`,
      "Link the customer so future service and payment history stay attached."
    ),
    detail(
      "Money follow-through",
      amountDueCents <= 0,
      "No balance is left open on this job.",
      "Decide whether payment should be collected now or followed up right away."
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

function buildJobCloseoutGuidance(job, order, readiness, amountDueCents, linkedCustomer = null, blueprint = jobsWorkspaceBlueprint()) {
  const fieldStatus = normalizeWorkflowStatusValue(job?.status || "scheduled");
  if (readiness?.blockers?.length) {
    return {
      title: "Clear the blockers before closeout",
      description: readiness.nextStep || "Clear the missing customer, schedule, compliance, or load details before the crew tries to close this job out.",
      chips: [
        `${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"} open`,
        amountDueCents > 0 ? `${formatUsd(amountDueCents)} still open` : "No payment blocker",
      ],
      items: jobCloseoutChecklistItems(job, order, linkedCustomer, blueprint, amountDueCents, readiness),
    };
  }
  if (fieldStatus === "completed") {
    return {
      title: amountDueCents > 0 ? "Field work is done, and payment is the next move" : "This job is ready to stay closed",
      description: amountDueCents > 0
        ? "The field work is complete. Keep the invoice, reminder, or collection follow-through attached here until the balance is cleared."
        : "The key field details are in place. Keep this record tied to the customer and booked work so future service starts from history instead of guesswork.",
      chips: [
        "Crew updates captured",
        amountDueCents > 0 ? `${formatUsd(amountDueCents)} still open` : "Nothing outstanding",
      ],
      items: jobCloseoutChecklistItems(job, order, linkedCustomer, blueprint, amountDueCents, readiness),
    };
  }
  return {
    title: "Leave the job easy to finish",
    description: amountDueCents > 0
      ? "Before the crew leaves, save the field note, make sure the work status is current, and decide whether payment should be collected or followed up right away."
      : "Before the crew leaves, save the field note and make sure the work status and customer context reflect what actually happened on site.",
    chips: [
      titleCaseWords(String(job?.status || "scheduled").replace(/_/g, " ")),
      amountDueCents > 0 ? `${formatUsd(amountDueCents)} still open` : "No balance open",
    ],
    items: jobCloseoutChecklistItems(job, order, linkedCustomer, blueprint, amountDueCents, readiness),
  };
}

function renderTemplateRecordFocusCard(blueprint = jobsWorkspaceBlueprint()) {
  const focus = jobTemplateRecordFocus(blueprint);
  if (!focus.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Template record focus</div>
      <div><strong>What matters most on this record</strong></div>
      <div class="detail-copy">Capture the details this business type depends on so future work feels easier, not more generic.</div>
      <div class="memory-checklist">
        ${focus.map((item, index) => `
          <div class="memory-checklist__item">
            <div class="memory-checklist__title">${escapeHtml(`Focus ${index + 1}`)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderJobCustomerMemoryCard(linkedCustomer, blueprint = jobsWorkspaceBlueprint()) {
  const items = jobCustomerMemoryItems(linkedCustomer, blueprint);
  if (!linkedCustomer || !items.length) return "";
  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Customer memory</div>
      <div><strong>Carry the site details into the field</strong></div>
      <div class="detail-copy">Keep the repeat-service context tied to the active job so the crew and office do not have to relearn it under pressure.</div>
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

async function renderJobDetail(jobIdValue) {
  if (!jobDetailWrap) return;
  const job = JOBS_CACHE.find((row) => row.id === jobIdValue) || null;
  populateJobForm(job);
  if (!job) {
    if (btnJobOpenOrder) btnJobOpenOrder.disabled = true;
    if (btnJobRecordPayment) btnJobRecordPayment.disabled = true;
  jobDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Job execution</div><div><strong>Create or select a job.</strong></div><div class="detail-copy">Use jobs only for approved work that is ready for the field. Quotes still being worked up belong in Walkthrough Bids.</div></div>`;
    return;
  }
  const order = linkedOrderForJob(job);
  const linkedLead = linkedLeadForOrder(order);
  const linkedBid = linkedBidForOrder(order);
  const linkedCustomer = CUSTOMERS_CACHE.find((row) => row.id === job.customer_id) || null;
  const blueprint = jobsWorkspaceBlueprint();
  const depositStatus = orderDepositStatus(order);
  const revenueCents = jobRevenueCents(job, order);
  const costCents = jobTrackedCostCents(job, order);
  const grossProfitCents = jobGrossProfitCents(job, order);
  const marginRatio = jobMarginRatio(job, order);
  const trackedExpenses = trackedJobExpenses(job, order);
  const laborCostCents = trackedExpenses.filter((expense) => normalizeExpenseType(expense.expense_type) === "labor" || expenseHasLaborDetail(expense))
    .reduce((sum, expense) => sum + expenseAmountCents(expense), 0);
  const laborHours = trackedExpenses.reduce((sum, expense) => sum + expenseLaborHoursValue(expense), 0);
  const materialCostCents = trackedExpenses.filter((expense) => normalizeExpenseType(expense.expense_type) === "material" || expenseHasMaterialDetail(expense))
    .reduce((sum, expense) => sum + expenseAmountCents(expense), 0);
  const changeOrderCostCents = trackedExpenses.filter((expense) => expenseIsChangeOrder(expense))
    .reduce((sum, expense) => sum + expenseAmountCents(expense), 0);
  const leftoverNotes = uniqList(trackedExpenses.flatMap((expense) => expenseLeftoverNotes(expense))).slice(0, 3);
  const wasteNotes = uniqList(trackedExpenses.flatMap((expense) => expenseWasteNotes(expense))).slice(0, 3);
  const hvRev = calcHydrovacRevenueCents(job);
  const hvBreakdown = hvRev !== null ? hydrovacRevenueBreakdownHtml(job) : null;
  const hydrovacState = isHydrovacJob(job) ? hydrovacJobDetailState(job.id) : null;
  const readiness = buildJobReadinessSummary(job, order, linkedCustomer, hydrovacState, blueprint);
  const fieldActualMins = job.actual_start_at && job.actual_end_at
    ? Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000)
    : null;
  const fieldStatus = normalizeWorkflowStatusValue(job.status || "scheduled");
  const fieldDueNow = Number(job.amount_due_cents || orderAmountDueCents(order) || 0);
  const closeoutGuidance = buildJobCloseoutGuidance(job, order, readiness, fieldDueNow, linkedCustomer, blueprint);
  const fieldActionButtons = [
    ["scheduled", "dispatched"].includes(fieldStatus) ? { label: "Start work", className: "btn btn-primary", data: { "job-field-action": "start" } } : null,
    fieldStatus === "blocked" ? { label: "Resume work", className: "btn btn-primary", data: { "job-field-action": "resume" } } : null,
    ["scheduled", "dispatched", "in_progress"].includes(fieldStatus) ? { label: "Mark blocked", className: "btn btn-ghost", data: { "job-field-action": "block" } } : null,
    !["completed", "cancelled"].includes(fieldStatus) ? { label: "Complete job", className: "btn btn-ghost", data: { "job-field-action": "complete" } } : null,
    { label: "Save field note", id: "btnJobSaveFieldNote", className: "btn btn-ghost" },
  ].filter(Boolean);
  const jobActionButtons = [
    order ? { label: "Open booked work", className: "btn btn-primary", data: { "job-quick-action": "open-order" } } : null,
    { label: linkedCustomer ? "Open customer" : "Open customers", className: "btn btn-ghost", data: { "job-quick-action": "open-customer" } },
    { label: "Record payment", className: "btn btn-ghost", data: { "job-quick-action": "record-payment" }, disabled: !order },
    { label: "Log job cost", className: "btn btn-ghost", data: { "job-quick-action": "log-cost" } },
  ].filter(Boolean);
  jobDetailWrap.innerHTML = `
    ${renderRecordHeroCard({
      eyebrow: "Execution record",
      title: job.title || "Job",
      badges: [
        { label: titleCaseWords(String(job.status || "scheduled").replace(/_/g, " ")) },
        order ? { label: formatOrderWorkflowStatus(order.status || "new") } : null,
        { label: formatWorkflowPaymentState(job.payment_state || orderPaymentState(order)), tone: paymentStateClass(job.payment_state || orderPaymentState(order)) },
        order ? { label: formatDepositStatus(depositStatus), tone: depositStatusClass(depositStatus) } : null,
      ],
      meta: [
        `${linkedCustomer?.name || order?.customer_name || "Customer not linked"}`,
        `Scheduled ${String(job.scheduled_date || "No date")} | ${String(job.scheduled_time || "No time")}`,
        job.service_address || order?.service_address || "No service address recorded",
      ],
      description: linkedLead
        ? `This job is already tied back to ${linkedLead.contact_name || linkedLead.title || "the original request"}, so field execution, customer context, and money stay in one chain.`
        : "Use this job record to keep field execution, proof, and money state attached to the same piece of work.",
      summary: [
        { label: "Revenue", value: formatUsd(revenueCents), note: "Current job revenue" },
        { label: "Tracked cost", value: formatUsd(costCents), note: trackedExpenses.length ? `${trackedExpenses.length} linked cost item${trackedExpenses.length === 1 ? "" : "s"}` : "No cost logged yet" },
        { label: "Gross profit", value: formatUsd(grossProfitCents), note: "Revenue minus tracked cost", tone: grossProfitToneClass(grossProfitCents) },
        { label: "Due now", value: formatUsd(Number(job.amount_due_cents || orderAmountDueCents(order) || 0)), note: formatWorkflowPaymentState(job.payment_state || orderPaymentState(order)), tone: paymentStateClass(job.payment_state || orderPaymentState(order)) },
      ],
    })}
    ${renderRecordActionRail({
      eyebrow: "Quick actions",
      title: "Keep field work and follow-through together",
      description: order
        ? "Jump to the booked work, customer, money, or cost log from one place while the crew context is still fresh."
        : "Use this job to stay anchored in field execution, then move to the customer or money follow-through without hunting around.",
      actions: jobActionButtons,
    })}
    ${renderJobReadinessCard(readiness)}
    ${renderTemplateRecordFocusCard(blueprint)}
    ${renderJobCustomerMemoryCard(linkedCustomer, blueprint)}
    ${renderRecordFollowThroughCard({
      eyebrow: "Field updates",
      title: "Handle the on-site moves fast",
      description: "Use this area when the crew arrives, gets blocked, finishes the work, or needs to leave a field note without digging through the full job form.",
      summary: [
        { label: "Current stage", value: titleCaseWords(String(job.status || "scheduled").replace(/_/g, " ")), note: order ? `Booked work is ${formatOrderWorkflowStatus(order.status || "new")}` : "No booked-work record linked" },
        { label: "Scheduled for", value: `${String(job.scheduled_date || "No date")} | ${String(job.scheduled_time || "No time")}`, note: job.schedule_window || "No schedule window recorded" },
        { label: "On-site time", value: fieldActualMins != null ? `${(fieldActualMins / 60).toFixed(1)}h` : (job.actual_start_at ? "Started" : "Not started"), note: job.actual_start_at ? `${formatDateTime(job.actual_start_at)}${job.actual_end_at ? ` -> ${formatDateTime(job.actual_end_at)}` : ""}` : "No actual start captured yet" },
        { label: "Money still open", value: formatUsd(fieldDueNow), note: formatWorkflowPaymentState(job.payment_state || orderPaymentState(order)) },
      ],
      controlsHtml: `
        <label class="field">
          <span>Field note</span>
          <textarea id="jobFieldUpdateNote" rows="3" placeholder="Access issue, change in scope, proof reminder, customer update, or collection note.">${escapeHtml(job.notes || "")}</textarea>
        </label>
      `,
      actions: fieldActionButtons,
      timelineHtml: `
        <div class="detail-copy">${job.check_in_lat ? `Check-in captured at ${escapeHtml(String(job.check_in_lat))}, ${escapeHtml(String(job.check_in_lng || ""))}.` : "If location permission is available, starting work will capture the crew check-in automatically."}</div>
        <div id="jobFieldUpdateMsg" class="msg" style="margin-top:8px;"></div>
      `,
    })}
    <div class="detail-card u-mt-14">
      <div class="kicker">Closeout guidance</div>
      <div><strong>${escapeHtml(closeoutGuidance.title)}</strong></div>
      <div class="detail-copy">${escapeHtml(closeoutGuidance.description)}</div>
      <div class="workspace-chip-row u-mt-10">
        ${closeoutGuidance.chips.map((chip) => `<span class="pill">${escapeHtml(chip)}</span>`).join("")}
      </div>
      <div class="memory-checklist u-mt-10">
        ${(closeoutGuidance.items || []).map((item) => `
          <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}">
            <div class="memory-checklist__title">${escapeHtml(item.ready ? `Ready: ${item.label}` : `Still needed: ${item.label}`)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.note || "")}</div>
          </div>
        `).join("")}
      </div>
    </div>
    <div class="detail-card u-mt-14">
      <div class="kicker">Job economics</div>
      <div class="workspace-chip-row">
        <span class="pill">Revenue ${escapeHtml(formatUsd(revenueCents))}</span>
        <span class="pill">Tracked cost ${escapeHtml(formatUsd(costCents))}</span>
        <span class="pill ${grossProfitToneClass(grossProfitCents)}">Gross profit ${escapeHtml(formatUsd(grossProfitCents))}</span>
        <span class="pill ${marginToneClass(marginRatio)}">Margin ${escapeHtml(formatPercent(marginRatio))}</span>
      </div>
      <div class="detail-copy">${trackedExpenses.length ? `${trackedExpenses.length} linked job cost${trackedExpenses.length === 1 ? "" : "s"} are shaping this margin right now.` : "No linked job costs yet. Log labor, materials, or vendor spend against this job to make the margin real."}</div>
      ${trackedExpenses.length ? `
        <div class="workspace-chip-row">
          <span class="pill">Labor ${escapeHtml(formatUsd(laborCostCents))}${laborHours > 0 ? ` • ${escapeHtml(String(Number(laborHours.toFixed(2))))}h` : ""}</span>
          <span class="pill">Materials ${escapeHtml(formatUsd(materialCostCents))}</span>
          ${changeOrderCostCents > 0 ? `<span class="pill pill-warn">Change-order cost ${escapeHtml(formatUsd(changeOrderCostCents))}</span>` : ``}
        </div>
      ` : ``}
      ${leftoverNotes.length ? `<div class="detail-copy">Leftovers: ${escapeHtml(leftoverNotes.join(" | "))}</div>` : ``}
      ${wasteNotes.length ? `<div class="detail-copy">Waste / overage: ${escapeHtml(wasteNotes.join(" | "))}</div>` : ``}
      <div class="row" style="margin-top:12px;">
        <button type="button" class="btn btn-ghost" data-job-cost-action="log" data-job-id="${escapeAttr(job.id)}">Log job cost</button>
      </div>
      ${hvBreakdown ? `
      <div class="job-detail-section" style="margin-top:12px;padding:12px;background:rgba(200,75,47,.06);border-radius:8px;border:1px solid rgba(200,75,47,.15);">
        <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:rgba(255,255,255,.35);margin-bottom:6px;">Hydrovac billing</div>
        ${hvBreakdown.html}
        <div style="font-weight:700;margin-top:4px;">$${(hvBreakdown.total/100).toFixed(2)}</div>
      </div>
      ` : ''}
    </div>
    ${renderLinkedRecordCard({
      eyebrow: "Linked work",
      title: "See the full work chain",
      description: "A job should stay tied to the request, proposal, booked work, and customer so nobody has to reconstruct what happened later.",
      items: [
        { label: "Request", value: linkedLead?.contact_name || linkedLead?.title || "Not linked", note: linkedLead ? titleCaseWords(String(linkedLead.status || "new")) : "No intake record attached yet" },
        { label: "Proposal", value: linkedBid?.title || "Not linked", note: linkedBid ? titleCaseWords(String(linkedBid.status || "draft")) : "No proposal attached yet" },
        { label: "Booked work", value: order?.customer_name || order?.title || "Not linked", note: order ? formatOrderWorkflowStatus(order.status || "new") : "Link or create booked work to keep billing attached" },
        { label: "Customer", value: linkedCustomer?.name || "Not linked", note: linkedCustomer ? "Customer history is attached" : "Link a customer so future work and payments stay together" },
        { label: "Service address", value: job.service_address || order?.service_address || "No service address recorded", note: "Field location for the crew and office" },
      ],
      footerHtml: `
        <div class="pipeline-next-steps">
          <button id="btnJobOpenRequest" class="btn btn-ghost" type="button">${linkedLead ? "Open request" : "Open requests"}</button>
          <button id="btnJobOpenBid" class="btn btn-ghost" type="button">${linkedBid ? "Open proposal" : "Open proposals"}</button>
          <button id="btnJobOpenCustomer" class="btn btn-ghost" type="button">${linkedCustomer ? "Open customer" : "Open customers"}</button>
        </div>
      `,
    })}
    ${isHydrovacJob(job) ? renderHydrovacJobOperations(job, order, hydrovacState) : ""}
    ${(() => {
      if (!job.assigned_operator_id) return '';
      const member = (TEAM_MEMBERS_CACHE || []).find(
        (m) => m.id === job.assigned_operator_id || m.user_id === job.assigned_operator_id
      );
      const memberName = member?.name || member?.email || 'Assigned crew';
      const actualMins = job.actual_start_at && job.actual_end_at
        ? Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000)
        : null;
      return `
        <div class="detail-card u-mt-14">
          <div class="kicker">Crew &amp; Hours</div>
          <div class="detail-copy"><strong>${escapeHtml(memberName)}</strong>${member?.role ? ` &middot; ${escapeHtml(member.role)}` : ''}</div>
          ${actualMins != null ? `<div class="detail-copy">Actual time: <strong>${(actualMins / 60).toFixed(1)}h</strong> &middot; ${escapeHtml(formatDateTime(job.actual_start_at))} &rarr; ${escapeHtml(formatDateTime(job.actual_end_at))}</div>` : ''}
          ${job.billable_hours ? `<div class="detail-copy">Estimated: ${job.billable_hours}h</div>` : ''}
          ${job.check_in_lat ? `<div class="detail-copy muted muted-small">Check-in: ${job.check_in_lat}, ${job.check_in_lng}</div>` : ''}
          <div class="row u-mt-10">
            <button type="button" class="btn btn-ghost btn-sm" id="btnJobLogHours">Log hours for ${escapeHtml(memberName)}</button>
          </div>
        </div>`;
    })()}
  `;
  jobDetailWrap.querySelectorAll('[data-job-cost-action="log"]').forEach((button) => {
    button.addEventListener("click", () => openExpenseForJob(job));
  });
  const syncFieldJobState = (patch = {}) => {
    if (Object.prototype.hasOwnProperty.call(patch, "status")) job.status = patch.status;
    if (Object.prototype.hasOwnProperty.call(patch, "notes")) job.notes = patch.notes;
    if (Object.prototype.hasOwnProperty.call(patch, "actual_start_at")) job.actual_start_at = patch.actual_start_at;
    if (Object.prototype.hasOwnProperty.call(patch, "actual_end_at")) job.actual_end_at = patch.actual_end_at;
    if (Object.prototype.hasOwnProperty.call(patch, "check_in_lat")) job.check_in_lat = patch.check_in_lat;
    if (Object.prototype.hasOwnProperty.call(patch, "check_in_lng")) job.check_in_lng = patch.check_in_lng;
  };
  jobDetailWrap.querySelector('#btnJobSaveFieldNote')?.addEventListener("click", async () => {
    const msgEl = jobDetailWrap.querySelector('#jobFieldUpdateMsg');
    const nextNote = jobDetailWrap.querySelector('#jobFieldUpdateNote')?.value?.trim() || "";
    const nextStatus = jobStatus?.value || job.status || "scheduled";
    const patch = { id: job.id, notes: nextNote, status: nextStatus };
    if (jobNotes) jobNotes.value = nextNote;
    setInlineMessage(msgEl, "Saving field note...");
    try {
      await saveJobRecord(patch);
      syncFieldJobState(patch);
      setInlineMessage(msgEl, "Field note saved.", "ok");
    } catch (error) {
      setInlineMessage(msgEl, error.message || String(error), "error");
    }
  });
  jobDetailWrap.querySelectorAll("[data-job-field-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-job-field-action") || "";
      const msgEl = jobDetailWrap.querySelector('#jobFieldUpdateMsg');
      const nextNote = jobDetailWrap.querySelector('#jobFieldUpdateNote')?.value?.trim() || "";
      const nowIso = new Date().toISOString();
      const patch = {
        id: job.id,
        notes: nextNote,
      };
      if (action === "start" || action === "resume") {
        patch.status = "in_progress";
        if (!job.actual_start_at) patch.actual_start_at = nowIso;
        const position = await getCurrentPositionSafe();
        if (Number.isFinite(position?.lat) && Number.isFinite(position?.lng)) {
          patch.check_in_lat = position.lat;
          patch.check_in_lng = position.lng;
        }
      }
      if (action === "block") {
        patch.status = "blocked";
      }
      if (action === "complete") {
        patch.status = "completed";
        if (!job.actual_start_at) patch.actual_start_at = nowIso;
        if (!job.actual_end_at) patch.actual_end_at = nowIso;
      }
      if (jobNotes) jobNotes.value = nextNote;
      if (jobStatus && patch.status) jobStatus.value = patch.status;
      setInlineMessage(msgEl, action === "complete" ? "Closing out job..." : "Saving field update...");
      try {
        if (patch.status && isHydrovacJob(job)) {
          const result = await requestOperatorFunction("update-job-status", {
            method: "POST",
            body: patch,
          });
          syncFieldJobState(result?.job || patch);
          await Promise.all([
            fetchJobs(),
            fetchCrmOrders(),
            fetchJobHydrovacDetails(job.id, { force: true }).catch(() => null),
          ]);
          renderJobs(jobSearch?.value || "");
          renderOrders();
          renderDashboard();
          renderGuidance();
        } else {
          await saveJobRecord(patch);
          syncFieldJobState(patch);
        }
        const successLabel = action === "start"
          ? "Work started."
          : action === "resume"
            ? "Work resumed."
            : action === "block"
              ? "Job marked blocked."
              : "Job completed.";
        setInlineMessage(msgEl, successLabel, "ok");
      } catch (error) {
        setInlineMessage(msgEl, error.message || String(error), "error");
      }
    });
  });
  jobDetailWrap.querySelectorAll("[data-job-quick-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-job-quick-action") || "";
      if (action === "open-order") {
        if (order?.id) {
          ACTIVE_ORDER_ID = order.id;
          renderOrders();
          switchTab("orders");
        }
        return;
      }
      if (action === "open-customer") {
        if (linkedCustomer?.id) {
          ACTIVE_CUSTOMER_ID = linkedCustomer.id;
          CUSTOMER_CREATING = false;
        }
        switchTab("customers");
        return;
      }
      if (action === "record-payment") {
        if (!order?.id) return;
        ACTIVE_ORDER_ID = order.id;
        ACTIVE_JOB_ID = job.id;
        clearPaymentForm({
          customerId: job.customer_id || order.customer_id || "",
          orderId: order.id,
          amount: money(Number(job.amount_due_cents || orderAmountDueCents(order) || 0)),
        });
        renderPayments();
        switchTab("payments");
        return;
      }
      if (action === "log-cost") {
        openExpenseForJob(job);
      }
    });
  });
  jobDetailWrap.querySelector('#btnJobLogHours')?.addEventListener("click", () => maybeLogJobHours(job));
  jobDetailWrap.querySelector('#btnJobOpenRequest')?.addEventListener("click", () => {
    if (linkedLead?.id) ACTIVE_LEAD_ID = linkedLead.id;
    switchTab("leads");
  });
  jobDetailWrap.querySelector('#btnJobOpenBid')?.addEventListener("click", () => {
    if (linkedBid?.id) ACTIVE_BID_ID = linkedBid.id;
    switchTab("bids");
  });
  jobDetailWrap.querySelector('#btnJobOpenCustomer')?.addEventListener("click", () => {
    if (linkedCustomer?.id) {
      ACTIVE_CUSTOMER_ID = linkedCustomer.id;
      CUSTOMER_CREATING = false;
    }
    switchTab("customers");
  });
  if (isHydrovacJob(job)) {
    if (!hydrovacState?.loadedAt && !hydrovacState?.loading) {
      fetchJobHydrovacDetails(job.id)
        .then(() => {
          if (ACTIVE_JOB_ID === job.id) renderJobDetail(job.id).catch(console.error);
        })
        .catch(console.warn);
    }
    jobDetailWrap.querySelector('#jobHydrovacTicketForm')?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        setInlineMessage(jobMsg, "Saving locate ticket...");
        await requestOperatorFunction("manage-locate-tickets", {
          method: "POST",
          body: {
            job_id: job.id,
            order_id: job.order_id || order?.id || null,
            customer_id: job.customer_id || order?.customer_id || null,
            ticket_number: jobDetailWrap.querySelector('#jobHydrovacTicketNumber')?.value || "",
            one_call_center: jobDetailWrap.querySelector('#jobHydrovacTicketCenter')?.value || "",
            work_site_address: job.service_address || order?.service_address || "",
            excavation_type: job.service_type || job.job_type || "hydrovac",
            valid_from: new Date().toISOString(),
            valid_until: localDateToIso(jobDetailWrap.querySelector('#jobHydrovacTicketValidUntil')?.value, true),
          },
        });
        setInlineMessage(jobMsg, "Locate ticket saved.", "good");
        await fetchJobHydrovacDetails(job.id, { force: true });
        await renderJobDetail(job.id);
      } catch (error) {
        setInlineMessage(jobMsg, error?.message || "Failed to save locate ticket.", "error");
      }
    });
    jobDetailWrap.querySelectorAll('[data-hv-verify-ticket]').forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          setInlineMessage(jobMsg, "Marking ticket verified...");
          const ticketId = button.getAttribute("data-hv-verify-ticket") || "";
          const ticket = (hydrovacState?.tickets || []).find((row) => row.id === ticketId);
          await requestOperatorFunction("manage-locate-tickets", {
            method: "PATCH",
            body: {
              id: ticketId,
              status: ticket?.status === "requested" ? "active" : ticket?.status,
              verified_on_site: true,
            },
          });
          setInlineMessage(jobMsg, "Locate ticket marked verified.", "good");
          await fetchJobHydrovacDetails(job.id, { force: true });
          await renderJobDetail(job.id);
        } catch (error) {
          setInlineMessage(jobMsg, error?.message || "Failed to verify locate ticket.", "error");
        }
      });
    });
    jobDetailWrap.querySelector('#jobHydrovacManifestForm')?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        setInlineMessage(jobMsg, "Logging load...");
        await requestOperatorFunction("manage-waste-manifests", {
          method: "POST",
          body: {
            job_id: job.id,
            order_id: job.order_id || order?.id || null,
            customer_id: job.customer_id || order?.customer_id || null,
            material_type: jobDetailWrap.querySelector('#jobHydrovacManifestMaterial')?.value || "soil",
            quantity_unit: jobDetailWrap.querySelector('#jobHydrovacManifestUnit')?.value || "gallons",
            quantity_estimated: Number(jobDetailWrap.querySelector('#jobHydrovacManifestQuantity')?.value || 0),
            pickup_address: job.service_address || order?.service_address || "",
            departed_site_at: new Date().toISOString(),
            disposal_charge_cents: toCents(jobDetailWrap.querySelector('#jobHydrovacManifestCharge')?.value || 0),
            disposal_cost_cents: toCents(jobDetailWrap.querySelector('#jobHydrovacManifestCost')?.value || 0),
            notes: jobDetailWrap.querySelector('#jobHydrovacManifestNote')?.value || "",
          },
        });
        setInlineMessage(jobMsg, "Load logged.", "good");
        await fetchJobHydrovacDetails(job.id, { force: true });
        await fetchJobs();
        renderJobs(jobSearch?.value || "");
      } catch (error) {
        setInlineMessage(jobMsg, error?.message || "Failed to log load.", "error");
      }
    });
    jobDetailWrap.querySelectorAll('[data-hv-confirm-manifest]').forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          setInlineMessage(jobMsg, "Confirming load...");
          const manifestId = button.getAttribute("data-hv-confirm-manifest") || "";
          const manifest = (hydrovacState?.manifests || []).find((row) => row.id === manifestId);
          await requestOperatorFunction("manage-waste-manifests", {
            method: "PATCH",
            body: {
              id: manifestId,
              status: "confirmed",
              arrived_facility_at: new Date().toISOString(),
              quantity_actual: manifest?.quantity_actual ?? manifest?.quantity_estimated ?? null,
            },
          });
          setInlineMessage(jobMsg, "Load confirmed.", "good");
          await Promise.all([
            fetchJobHydrovacDetails(job.id, { force: true }),
            fetchJobs(),
          ]);
          renderJobs(jobSearch?.value || "");
        } catch (error) {
          setInlineMessage(jobMsg, error?.message || "Failed to confirm load.", "error");
        }
      });
    });
    jobDetailWrap.querySelectorAll('[data-hv-delete-manifest]').forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          setInlineMessage(jobMsg, "Removing draft load...");
          const manifestId = button.getAttribute("data-hv-delete-manifest") || "";
          await requestOperatorFunction("manage-waste-manifests", {
            method: "DELETE",
            query: `id=${encodeURIComponent(manifestId)}`,
          });
          setInlineMessage(jobMsg, "Draft load removed.", "good");
          await Promise.all([
            fetchJobHydrovacDetails(job.id, { force: true }),
            fetchJobs(),
          ]);
          renderJobs(jobSearch?.value || "");
        } catch (error) {
          setInlineMessage(jobMsg, error?.message || "Failed to remove draft load.", "error");
        }
      });
    });
    jobDetailWrap.querySelector('[data-hv-action="invoice"]')?.addEventListener("click", async () => {
      try {
        setInlineMessage(jobMsg, "Drafting hydrovac invoice...");
        await postOperatorFunction("generate-hydrovac-invoice", { job_id: job.id });
        await Promise.all([fetchCrmOrders(), fetchJobs()]);
        setInlineMessage(jobMsg, "Hydrovac invoice draft created on the linked order.", "good");
      } catch (error) {
        setInlineMessage(jobMsg, error?.message || "Failed to draft hydrovac invoice.", "error");
      }
    });
  }
  if (btnJobOpenOrder) btnJobOpenOrder.disabled = !job.order_id;
  if (btnJobRecordPayment) btnJobRecordPayment.disabled = !job.order_id;
}
function sortedJobs(filter = "") {
  const needle = String(filter || "").trim().toLowerCase();
  const rows = [...(JOBS_CACHE || [])].sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  if (!needle) return rows;
  return rows.filter((row) => {
    const order = linkedOrderForJob(row);
    const haystack = [
      row.title,
      row.service_address,
      row.summary,
      row.notes,
      row.status,
      order?.customer_name,
      order?.email,
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}
function renderJobs(filter = "") {
  if (!jobsList) return;
  renderJobWorkspace();
  const rows = sortedJobs(filter);
  if (!rows.length) {
    jobsList.innerHTML = `<div class="muted">No active jobs yet. Approved work will show up here once it is ready for execution.</div>`;
    ACTIVE_JOB_ID = null;
    window.renderJobDetail(null).catch(console.error);
    return;
  }
  if (!ACTIVE_JOB_ID || !rows.some((row) => row.id === ACTIVE_JOB_ID)) ACTIVE_JOB_ID = rows[0].id;
  const active = rows.find((row) => row.id === ACTIVE_JOB_ID) || rows[0];
  ACTIVE_JOB_ID = active.id;
  jobsList.innerHTML = rows.map((row) => {
    const order = linkedOrderForJob(row);
    const customer = CUSTOMERS_CACHE.find((customerRow) => customerRow.id === row.customer_id) || null;
    const customerLabel = customer?.name || order?.customer_name || "Unlinked customer";
    const paymentState = row.payment_state || orderPaymentState(order);
    const marginRatio = jobMarginRatio(row, order);
    return `
      <button type="button" class="list-item ${row.id === active.id ? "is-active" : ""}" data-job-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.title || order?.customer_name || "Job")}</div>
          <div class="li-sub muted">${escapeHtml(customerLabel)}</div>
          <div class="li-sub muted">${escapeHtml(String(row.status || "scheduled").replace(/_/g, " "))} | ${escapeHtml(String(row.scheduled_date || "No date"))}</div>
          <div class="li-sub muted">${escapeHtml(row.service_address || "No service address")}</div>
          <div class="li-sub muted">Revenue ${escapeHtml(formatUsd(jobRevenueCents(row, order)))} | Cost ${escapeHtml(formatUsd(jobTrackedCostCents(row, order)))} | Margin ${escapeHtml(formatPercent(marginRatio))}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${paymentStateClass(paymentState)}">${escapeHtml(formatWorkflowPaymentState(paymentState))}</span>
        </div>
      </button>
    `;
  }).join("");
  jobsList.querySelectorAll("[data-job-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ACTIVE_JOB_ID = btn.getAttribute("data-job-id");
      renderJobs(filter);
    });
  });
  window.renderJobDetail(ACTIVE_JOB_ID).catch(console.error);
}

const JOBS_WORKSPACE_HELPERS = {
  buildJobReadinessSummary,
  buildJobCloseoutGuidance,
  renderJobDetail,
  renderJobs,
};

window.PROOFLINK_OPERATOR_JOBS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_JOBS_WORKSPACE || {}),
  ...JOBS_WORKSPACE_HELPERS,
};

Object.assign(window, JOBS_WORKSPACE_HELPERS);
