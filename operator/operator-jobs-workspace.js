// Jobs workspace extracted from operator.js so field execution, linked records,
// and crew-side follow-through stay together in one domain module.
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
  const fieldActualMins = job.actual_start_at && job.actual_end_at
    ? Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000)
    : null;
  const fieldStatus = normalizeWorkflowStatusValue(job.status || "scheduled");
  const fieldDueNow = Number(job.amount_due_cents || orderAmountDueCents(order) || 0);
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
    <div class="detail-card" style="margin-top:14px;">
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
        <div class="detail-card" style="margin-top:14px;">
          <div class="kicker">Crew &amp; Hours</div>
          <div class="detail-copy"><strong>${escapeHtml(memberName)}</strong>${member?.role ? ` &middot; ${escapeHtml(member.role)}` : ''}</div>
          ${actualMins != null ? `<div class="detail-copy">Actual time: <strong>${(actualMins / 60).toFixed(1)}h</strong> &middot; ${escapeHtml(formatDateTime(job.actual_start_at))} &rarr; ${escapeHtml(formatDateTime(job.actual_end_at))}</div>` : ''}
          ${job.billable_hours ? `<div class="detail-copy">Estimated: ${job.billable_hours}h</div>` : ''}
          ${job.check_in_lat ? `<div class="detail-copy muted" style="font-size:.8rem;">Check-in: ${job.check_in_lat}, ${job.check_in_lng}</div>` : ''}
          <div class="row" style="margin-top:10px;">
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
  renderJobDetail,
  renderJobs,
};

window.PROOFLINK_OPERATOR_JOBS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_JOBS_WORKSPACE || {}),
  ...JOBS_WORKSPACE_HELPERS,
};

Object.assign(window, JOBS_WORKSPACE_HELPERS);
