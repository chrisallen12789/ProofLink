// Customer detail workflow extracted from operator.js so the operator shell
// can keep shrinking around real business domains.
(function attachOperatorCustomerDetail(global) {
  const CUSTOMER_RETENTION_REACTIVATION_CACHE = global.PROOFLINK_CUSTOMER_RETENTION_REACTIVATION_CACHE
    || (global.PROOFLINK_CUSTOMER_RETENTION_REACTIVATION_CACHE = {});

  function customerAiStatusTone(status) {
    if (status === "ready") return "pill-good";
    if (status === "blocked") return "pill-bad";
    return "pill-warn";
  }
  function customerAiPriorityTone(priority) {
    if (priority === "high") return "pill-bad";
    if (priority === "low") return "";
    return "pill-warn";
  }
  function customerAiFormatStatus(value) {
    const normalized = String(value || "review_needed").replace(/_/g, " ").trim();
    if (typeof titleCaseWords === "function") return titleCaseWords(normalized);
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Review needed";
  }
  function customerAiFormatDate(value) {
    if (!value) return "";
    if (typeof formatDateTime === "function") return formatDateTime(value);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }
  function customerRetentionPrimaryRef(item = {}) {
    const refs = Array.isArray(item.record_refs) ? item.record_refs : [];
    const preferredTypes = ["customer", "plan", "order", "job", "bid", "lead"];
    for (const recordType of preferredTypes) {
      const match = refs.find((ref) => ref && ref.record_type === recordType && ref.record_id);
      if (match) return match;
    }
    return refs.find((ref) => ref && ref.record_id) || null;
  }
  function openCustomerRetentionRecordRef(ref) {
    const recordType = String(ref?.record_type || "").trim().toLowerCase();
    const recordId = String(ref?.record_id || "").trim();
    if (!recordType || !recordId) return false;
    if (recordType === "customer") {
      ACTIVE_CUSTOMER_ID = recordId;
      if (typeof renderCustomerDetailWorkspace === "function") {
        const customer = (CUSTOMERS_CACHE || []).find((row) => row.id === recordId) || null;
        Promise.resolve(renderCustomerDetailWorkspace(recordId, customer)).catch(console.error);
      }
      return true;
    }
    if (recordType === "plan") {
      ACTIVE_PLAN_ID = recordId;
      if (typeof switchTab === "function") switchTab("plans");
      return true;
    }
    if (recordType === "order") return openCustomerRecordTab("orders", recordId);
    if (recordType === "job") return openCustomerRecordTab("jobs", recordId);
    if (recordType === "bid") return openCustomerRecordTab("bids", recordId);
    if (recordType === "lead") return openCustomerRecordTab("leads", recordId);
    return false;
  }
  function renderCustomerRetentionReactivationReport(state = null) {
    const report = state?.report || null;
    if (!report) {
      return `<div class="detail-copy">Run the reactivation review to separate immediate follow-up candidates from active-work holds, plan overlap, and lighter-touch accounts.</div>`;
    }
    const findings = Array.isArray(report.findings) ? report.findings : [];
    const blockers = Array.isArray(report.blockers) ? report.blockers : [];
    const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
    const summary = state?.context_summary || {};
    const generatedAt = report.generated_at || state?.generated_at || "";
    return `
      <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
      <div class="workspace-chip-row u-mt-10">
        <span class="pill ${customerAiStatusTone(report.summary_status || "review_needed")}">${escapeHtml(customerAiFormatStatus(report.summary_status || "review_needed"))}</span>
        ${summary.reactivate_now ? `<span class="pill pill-bad">${escapeHtml(`${summary.reactivate_now} reactivate now`)}</span>` : ""}
        ${summary.recent_work_still_open ? `<span class="pill pill-warn">${escapeHtml(`${summary.recent_work_still_open} open-work hold`)}</span>` : ""}
        ${summary.plan_recovery ? `<span class="pill pill-warn">${escapeHtml(`${summary.plan_recovery} plan overlap`)}</span>` : ""}
        ${summary.light_touch_reactivation ? `<span class="pill">${escapeHtml(`${summary.light_touch_reactivation} light touch`)}</span>` : ""}
      </div>
      ${blockers.length ? `
        <div class="memory-checklist u-mt-10">
          ${blockers.slice(0, 2).map((item) => `
            <div class="memory-checklist__item memory-checklist__item--warn">
              <div class="memory-checklist__title">${escapeHtml(item.title || "Reactivation blocker")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${findings.length ? `
        <div class="memory-checklist u-mt-10">
          ${findings.slice(0, 4).map((item) => {
            const primaryRef = customerRetentionPrimaryRef(item);
            return `
              <div class="memory-checklist__item ${item.category === "reactivate_now" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
                <div class="memory-checklist__title">${escapeHtml(item.title || "Reactivation finding")}</div>
                <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
                ${primaryRef ? `
                  <div class="action-row action-row--wrap u-mt-10">
                    <button type="button" class="btn btn-ghost btn-sm" data-customer-retention-open-record="${escapeAttr(primaryRef.record_type)}" data-customer-retention-record-id="${escapeAttr(primaryRef.record_id)}">Open ${escapeHtml(primaryRef.label || primaryRef.record_type)}</button>
                  </div>
                ` : ""}
              </div>
            `;
          }).join("")}
        </div>
      ` : ""}
      ${actions.length ? `
        <div class="detail-copy u-mt-10"><strong>Recommended actions</strong></div>
        <div class="workspace-chip-row">
          ${actions.slice(0, 3).map((action) => `<span class="pill ${customerAiPriorityTone(action.priority || "medium")}">${escapeHtml(customerAiFormatStatus(`${action.priority || "medium"} priority`))}</span>`).join("")}
        </div>
      ` : ""}
      ${generatedAt ? `<div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(customerAiFormatDate(generatedAt))}</div>` : ""}
    `;
  }
  function renderCustomerRetentionReactivationCard(context = global.CURRENT_CUSTOMER_DETAIL_CONTEXT || {}) {
    const customer = context.customer || global.CURRENT_CUSTOMER_DETAIL_CUSTOMER || null;
    if (!customer?.id) return "";
    const state = CUSTOMER_RETENTION_REACTIVATION_CACHE[String(customer.id || "").trim()] || null;
    const primaryRef = customerRetentionPrimaryRef(state?.report?.findings?.[0] || {});
    return `
      <div class="detail-card detail-card--spaced customer-support-card customer-support-card--focus">
        <div class="kicker">AI reactivation review</div>
        <div><strong>Retention / Reactivation Manager</strong></div>
        <div class="detail-copy">Keep dormant repeat-service pressure separate from open work and plan recovery before outreach starts.</div>
        <div class="action-row action-row--wrap u-mt-10">
          <button type="button" class="btn btn-ghost btn-sm" id="btnRunCustomerRetentionReview">${state?.report ? "Run again" : "Run reactivation review"}</button>
          ${primaryRef ? `<button type="button" class="btn btn-ghost btn-sm" id="btnOpenCustomerRetentionPrimary">Open first record</button>` : ""}
        </div>
        <div id="customerRetentionReviewMsg" class="msg ${state?.error ? "error" : state?.loading ? "" : state?.message ? "ok" : ""} u-mt-10">${escapeHtml(state?.loading ? "Reviewing reactivation queue..." : state?.error || state?.message || "")}</div>
        <div id="customerRetentionReviewReport" class="u-mt-10">${renderCustomerRetentionReactivationReport(state)}</div>
      </div>
    `;
  }
  async function runCustomerRetentionReactivationReview(customer = global.CURRENT_CUSTOMER_DETAIL_CUSTOMER || null, options = {}) {
    if (!customer?.id) return null;
    const cacheKey = String(customer.id || "").trim();
    CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey] = {
      ...(CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey] || {}),
      loading: true,
      error: "",
      message: "",
    };
    if (options.rerender !== false) {
      Promise.resolve(renderCustomerDetailWorkspace(customer.id, customer)).catch(console.error);
    }
    if (typeof requestOperatorFunction !== "function") {
      CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey] = {
        ...(CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey] || {}),
        loading: false,
        error: "Reactivation review tools are not ready yet.",
        message: "",
      };
      if (options.rerender !== false) {
        Promise.resolve(renderCustomerDetailWorkspace(customer.id, customer)).catch(console.error);
      }
      return CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey];
    }
    try {
      const payload = await requestOperatorFunction("ai-agent-report", {
        method: "POST",
        body: {
          agent_key: "retention_reactivation_manager",
          customer_id: customer.id,
        },
      });
      CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey] = {
        loading: false,
        error: "",
        message: "Reactivation review refreshed.",
        report: payload?.report || null,
        context_summary: payload?.context_summary || null,
        generated_at: payload?.generated_at || payload?.report?.generated_at || "",
      };
      if (options.rerender !== false) {
        Promise.resolve(renderCustomerDetailWorkspace(customer.id, customer)).catch(console.error);
      }
      return CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey];
    } catch (error) {
      CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey] = {
        ...(CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey] || {}),
        loading: false,
        error: error?.message || String(error),
        message: "",
      };
      if (options.rerender !== false) {
        Promise.resolve(renderCustomerDetailWorkspace(customer.id, customer)).catch(console.error);
      }
      return CUSTOMER_RETENTION_REACTIVATION_CACHE[cacheKey];
    }
  }

  function customerDisplayAddress(customer) {
    if (!customer) return "No service address yet.";
    const parts = [
      customer.address_line1 || customer.service_address || customer.billing_address || "",
      [customer.city || "", customer.state || "", customer.zip || ""].filter(Boolean).join(" ").trim(),
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "No service address yet.";
  }

  function customerRequests(customerIdValue) {
    return [...(LEADS_CACHE || [])]
      .filter((row) => row.customer_id === customerIdValue)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  }

  function customerBids(customerIdValue) {
    return [...(BIDS_CACHE || [])]
      .filter((row) => row.customer_id === customerIdValue)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  }
  function bidLineItemTotalCents(item) {
    return Math.round(Number(item?.quantity || 0) * Number(item?.unit_price_cents || 0));
  }
  function bidGrandTotalCents(bid) {
    const explicitTotal = Number(bid?.total_cents || 0);
    if (explicitTotal > 0) return explicitTotal;
    const rows = Array.isArray(bid?.line_items) ? bid.line_items : [];
    return rows
      .filter((item) => String(item.kind || "base").toLowerCase() !== "option")
      .reduce((sum, item) => sum + bidLineItemTotalCents(item), 0);
  }

  function customerJobs(customerIdValue) {
    return [...(JOBS_CACHE || [])]
      .filter((row) => row.customer_id === customerIdValue)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  }

  function customerKnownAddresses(customerIdValue, customer = null) {
    const known = new Set();
    const addAddress = (value) => {
      const normalized = String(value || "").trim();
      if (normalized) known.add(normalized);
    };
    addAddress(customer?.service_address);
    addAddress(customer?.address_line1);
    addAddress(customer?.billing_address);
    customerRequests(customerIdValue).forEach((row) => addAddress(row.service_address));
    customerBids(customerIdValue).forEach((row) => addAddress(row.service_address));
    [...(CRM_ORDERS_CACHE || [])].filter((row) => row.customer_id === customerIdValue && !row.is_deleted).forEach((row) => addAddress(row.service_address));
    customerJobs(customerIdValue).forEach((row) => addAddress(row.service_address));
    return [...known];
  }

  function customerPrimaryDisplayLabel(customer = null) {
    return customer?.company_name || customer?.name || "Unnamed customer";
  }

  function customerContactSummary(customer = null) {
    const parts = [];
    if (customer?.company_name && customer?.name) parts.push(customer.name);
    if (customer?.email) parts.push(customer.email);
    if (customer?.phone) parts.push(customer.phone);
    return parts.length ? parts.join(" | ") : "No contact details on file";
  }

  function customerActivityTimeline({
    customerRequestsRows = [],
    customerBidRows = [],
    customerOrders = [],
    customerJobsRows = [],
    customerPayments = [],
    interactions = [],
  } = {}) {
    return [
      ...interactions.map((row) => ({
        key: `interaction-${row.id || row.created_at || Math.random()}`,
        kind: "Interaction",
        title: customerInteractionLabel(row.type),
        note: row.summary || "Customer interaction logged",
        when: row.created_at || row.updated_at || "",
      })),
      ...customerRequestsRows.map((row) => ({
        key: `request-${row.id}`,
        kind: "Request",
        title: row.contact_name || row.title || row.requested_service_type || "Request",
        note: `${titleCaseWords(String(row.status || "new"))} | ${row.requested_service_type || "Service request"}`,
        when: row.updated_at || row.created_at || "",
        tab: "leads",
        id: row.id,
      })),
      ...customerBidRows.map((row) => ({
        key: `bid-${row.id}`,
        kind: "Proposal",
        title: row.title || "Proposal",
        note: `${titleCaseWords(String(row.status || "draft"))} | ${formatUsd(bidGrandTotalCents(row))}`,
        when: row.updated_at || row.created_at || "",
        tab: "bids",
        id: row.id,
      })),
      ...customerOrders.map((row) => ({
        key: `order-${row.id}`,
        kind: "Booked work",
        title: row.title || row.customer_name || "Order",
        note: `${titleCaseWords(String(row.status || "new"))} | ${formatUsd(row.total_cents || 0)}`,
        when: row.updated_at || row.created_at || "",
        tab: "orders",
        id: row.id,
      })),
      ...customerJobsRows.map((row) => ({
        key: `job-${row.id}`,
        kind: "Field job",
        title: row.title || "Job",
        note: `${titleCaseWords(String(row.status || "scheduled"))} | ${row.scheduled_date || "No scheduled date"}`,
        when: row.updated_at || row.created_at || "",
        tab: "jobs",
        id: row.id,
      })),
      ...customerPayments.map((row) => ({
        key: `payment-${row.id}`,
        kind: "Payment",
        title: `${formatPaymentMode(row.payment_mode)} | ${titleCaseWords(String(row.status || "paid"))}`,
        note: `${formatUsd(paymentAmountCents(row))} | ${formatDateTime(row.paid_at || row.created_at || row.updated_at)}`,
        when: row.paid_at || row.created_at || row.updated_at || "",
        tab: "payments",
        id: row.id,
      })),
    ]
      .sort((a, b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime())
      .slice(0, 10);
  }

  function customerTemplateRecordFocus() {
    const blueprint = typeof currentWorkspaceBlueprint === "function"
      ? currentWorkspaceBlueprint()
      : { business: { recordFocus: [] } };
    return Array.isArray(blueprint?.business?.recordFocus)
      ? blueprint.business.recordFocus.filter(Boolean).slice(0, 4)
      : [];
  }

  function customerMemoryChecklist(customer, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const address = customerDisplayAddress(customer);
    const hasAddress = address !== "No service address yet.";
    const hasAny = (...values) => values.some((value) => String(value || "").trim());
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const detail = (label, ready, readyNote, missingNote) => ({
      label,
      ready: !!ready,
      note: ready ? readyNote : missingNote,
    });

    const propertyItems = [
      detail(
        "Property profile",
        hasAddress,
        address,
        "Add the service address and the property details the crew should not have to relearn."
      ),
      detail(
        "Access notes",
        hasAny(customer?.access_notes, customer?.gate_notes, customer?.service_notes, customer?.notes),
        customer?.access_notes || customer?.gate_notes || customer?.service_notes || customer?.notes || "",
        "Capture gate codes, entry notes, parking, or site access details for repeat visits."
      ),
      detail(
        "Repeat-service memory",
        hasAny(customer?.service_schedule, customer?.frequency, customer?.recurring_notes, customer?.service_plan_name),
        customer?.service_schedule || customer?.frequency || customer?.recurring_notes || customer?.service_plan_name || "",
        "Capture cadence, route timing, or repeat-work preferences so follow-up stays easy."
      ),
      detail(
        "Seasonal opportunities",
        hasAny(customer?.seasonal_notes, customer?.upsell_notes, customer?.cleanup_notes, customer?.follow_up_notes),
        firstFilled(customer?.seasonal_notes, customer?.upsell_notes, customer?.cleanup_notes, customer?.follow_up_notes),
        "Capture cleanup timing, seasonal upgrades, or upsell notes so the next visit grows the account."
      ),
    ];

    const indoorServiceItems = [
      detail(
        "Site profile",
        hasAddress,
        address,
        "Add the service address so the next visit starts from a real site record."
      ),
      detail(
        "Access instructions",
        hasAny(customer?.access_notes, customer?.alarm_notes, customer?.entry_notes, customer?.notes),
        customer?.access_notes || customer?.alarm_notes || customer?.entry_notes || customer?.notes || "",
        "Capture entry, alarm, parking, or on-site contact notes for the team."
      ),
      detail(
        "Scope memory",
        hasAny(customer?.service_notes, customer?.scope_notes, customer?.checklist_notes, customer?.room_notes, customer?.preferences, customer?.notes),
        firstFilled(customer?.service_notes, customer?.scope_notes, customer?.checklist_notes, customer?.room_notes, customer?.preferences, customer?.notes),
        "Record the scope details, add-ons, or room-by-room expectations that protect repeat quality."
      ),
      detail(
        "Visit cadence",
        hasAny(customer?.service_schedule, customer?.frequency, customer?.recurring_notes, customer?.add_on_notes),
        firstFilled(customer?.service_schedule, customer?.frequency, customer?.recurring_notes, customer?.add_on_notes),
        "Capture repeat cadence and add-ons so the next cleaning visit starts with the right expectations."
      ),
    ];

    const equipmentItems = [
      detail(
        "Equipment history",
        hasAny(customer?.equipment_notes, customer?.system_notes, customer?.asset_summary, customer?.equipment_serial, customer?.notes),
        firstFilled(customer?.equipment_notes, customer?.system_notes, customer?.asset_summary, customer?.equipment_serial, customer?.notes),
        "Capture the system, fixture, or asset context so diagnostics and repeat work start faster."
      ),
      detail(
        "Site and access",
        hasAddress || hasAny(customer?.access_notes, customer?.entry_notes, customer?.tenant_notes),
        hasAddress ? address : firstFilled(customer?.access_notes, customer?.entry_notes, customer?.tenant_notes),
        "Add the site details, tenant notes, or access information the technician needs on arrival."
      ),
      detail(
        "Diagnostic memory",
        hasAny(customer?.diagnostic_notes, customer?.failure_symptoms, customer?.issue_summary, customer?.system_notes),
        firstFilled(customer?.diagnostic_notes, customer?.failure_symptoms, customer?.issue_summary, customer?.system_notes),
        "Capture symptoms, findings, and technician notes so repeat diagnostics start from real context."
      ),
      detail(
        "Follow-up context",
        hasAny(customer?.maintenance_notes, customer?.service_schedule, customer?.follow_up_notes, customer?.parts_follow_up, customer?.warranty_notes),
        firstFilled(customer?.maintenance_notes, customer?.service_schedule, customer?.follow_up_notes, customer?.parts_follow_up, customer?.warranty_notes),
        "Capture maintenance-plan context, return-visit risk, or parts follow-up before it slips."
      ),
    ];

    const plumbingItems = [
      detail(
        "Fixture history",
        hasAny(customer?.fixture_notes, customer?.system_notes, customer?.equipment_notes, customer?.notes),
        firstFilled(customer?.fixture_notes, customer?.system_notes, customer?.equipment_notes, customer?.notes),
        "Capture the fixture, line, or previous repair context so every visit starts from known conditions."
      ),
      detail(
        "Site and shutoff",
        hasAddress || hasAny(customer?.access_notes, customer?.entry_notes, customer?.shutoff_notes),
        hasAddress ? address : firstFilled(customer?.access_notes, customer?.entry_notes, customer?.shutoff_notes),
        "Store access, shutoff, or tenant notes so the team can arrive ready for the repair."
      ),
      detail(
        "Emergency context",
        hasAny(customer?.emergency_notes, customer?.issue_summary, customer?.water_damage_notes, customer?.leak_source),
        firstFilled(customer?.emergency_notes, customer?.issue_summary, customer?.water_damage_notes, customer?.leak_source),
        "Capture urgency, leak source, or damage context before it gets lost between calls and visits."
      ),
      detail(
        "Repair follow-through",
        hasAny(customer?.approval_notes, customer?.restoration_notes, customer?.follow_up_notes, customer?.parts_follow_up),
        firstFilled(customer?.approval_notes, customer?.restoration_notes, customer?.follow_up_notes, customer?.parts_follow_up),
        "Track approvals, restoration risk, and return-visit follow-through so the repair closes out cleanly."
      ),
    ];

    const map = {
      landscaping: propertyItems,
      property_maintenance: propertyItems,
      pressure_washing: propertyItems,
      cleaning: indoorServiceItems,
      pet_services: indoorServiceItems,
      hvac: equipmentItems,
      plumbing: plumbingItems,
    };

    const fallbackNote = firstFilled(customer?.service_notes, customer?.preferences, customer?.notes);
    const fallbackLabels = [
      "Relationship memory",
      "Access context",
      "Service notes",
      "Next-step memory",
    ];
    return map[businessKey] || customerTemplateRecordFocus().map((item, index) => ({
      label: fallbackLabels[index] || `Memory ${index + 1}`,
      ready: hasAny(customer?.notes, customer?.service_notes, customer?.preferences),
      note: fallbackNote || item,
    }));
  }

  function customerCollectionGuidance(customer, customerOrders, customerPayments, balance) {
    const latestPayment = customerPayments[0] || null;
    const latestOrder = customerOrders[0] || null;
    const hasEmail = !!String(customer?.email || latestOrder?.customer_email || "").trim();
    if (!customerOrders.length) {
      return {
        title: "No money follow-through yet",
        description: "Once this customer has approved work, this record will keep billing, payment, and the next customer-facing step in one place.",
      };
    }
    if (balance <= 0 && latestPayment) {
      return {
        title: "This customer is paid up",
        description: `The most recent payment landed ${formatDateTime(latestPayment.paid_at || latestPayment.created_at || latestPayment.updated_at)}. Keep the next follow-up focused on repeat work or reviews.`,
      };
    }
    if (balance > 0 && !latestPayment) {
      return {
        title: "The first payment step is still open",
        description: hasEmail
          ? "Send the invoice or collect the first payment while the work is still fresh for the customer."
          : "Record the payment here, and add an email address if you want invoice and reminder follow-through from the same record.",
      };
    }
    return {
      title: "There is still money to collect",
      description: hasEmail
        ? "Use this record to send the next reminder, log the payment, and keep the balance visible until it is fully closed."
        : "Record the next payment here. Adding an email address will also unlock invoice and reminder follow-through from this record.",
    };
  }

  function customerRenewalRiskItem({
    customer = null,
    businessKey = "service_business",
    openRequestsCount = 0,
    openProposalCount = 0,
    activeWorkCount = 0,
    latestInteraction = null,
  } = {}) {
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const detail = (label, ready, readyNote, missingNote, tone = "") => ({
      label,
      ready: !!ready,
      note: ready ? readyNote : missingNote,
      tone: tone || (!ready ? "warn" : ""),
    });
    const repeatCadenceDays = customerRepeatCadenceDays(customer);
    const cadenceInsight = customerRepeatCadenceInsight(customer);
    const repeatSignal = customerRepeatSignalValue(customer);
    if (!repeatSignal) return null;

    const nextTouch = firstFilled(
      customer?.next_service_on,
      customer?.follow_up_notes,
      customer?.service_plan_name,
      latestInteraction?.summary
    );
    const protectedRenewal = openRequestsCount > 0
      || openProposalCount > 0
      || activeWorkCount > 0
      || !!nextTouch;
    const tradeMessages = {
      landscaping: "This property has repeat-service history, but the next visit or seasonal touch still needs to be attached before the account cools off.",
      property_maintenance: "This site has repeat-service history, but the next walk or maintenance touch still needs to be attached before it drifts.",
      cleaning: "This account has repeat-service cadence, but the next visit still needs to be attached before the customer has to ask.",
      hvac: "This system has maintenance history, but the next visit or warranty follow-through still needs to be attached before it turns reactive again.",
      plumbing: "This repair history points to more follow-through, but the next approval, restoration, or return visit still needs to be attached.",
    };

    return detail(
      "Renewal risk",
      protectedRenewal,
      activeWorkCount > 0
        ? "The next visit or follow-through is already moving inside active work."
        : repeatCadenceDays && nextTouch
          ? `The next repeat touch is still visible here: ${nextTouch}. That stays in step with the usual ${repeatCadenceDays}-day rhythm.`
          : `The next repeat touch is still visible here: ${nextTouch}.`,
      cadenceInsight?.message || tradeMessages[businessKey] || "This customer has repeat-service signals, but the next visit or renewal step still needs to be attached before the account goes quiet."
    );
  }

  function customerRepeatCadenceDays(customer = null) {
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const raw = String(firstFilled(
      customer?.service_schedule,
      customer?.frequency,
      customer?.recurring_notes,
      customer?.service_plan_name
    )).trim().toLowerCase();
    if (!raw) return null;
    if (/every other|biweekly|bi-weekly|2 weeks|two weeks/.test(raw)) return 14;
    if (/weekly|every week/.test(raw)) return 7;
    if (/monthly|every month/.test(raw)) return 30;
    if (/quarterly|every quarter|every 3 months|three months/.test(raw)) return 90;
    const dayMatch = raw.match(/(\d+)\s*day/);
    if (dayMatch) return Number(dayMatch[1]);
    const weekMatch = raw.match(/(\d+)\s*week/);
    if (weekMatch) return Number(weekMatch[1]) * 7;
    const monthMatch = raw.match(/(\d+)\s*month/);
    if (monthMatch) return Number(monthMatch[1]) * 30;
    return null;
  }

  function customerRepeatCadenceInsight(customer = null, now = new Date()) {
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const cadenceDays = customerRepeatCadenceDays(customer);
    if (!cadenceDays) return null;
    const lastTouchValue = firstFilled(
      customer?.last_service_on,
      customer?.last_contact_at,
      customer?.updated_at,
      customer?.created_at
    );
    if (!lastTouchValue) return null;
    const lastTouch = new Date(lastTouchValue);
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(lastTouch.getTime()) || Number.isNaN(current.getTime())) return null;
    const ageDays = Math.max(0, Math.floor((current.getTime() - lastTouch.getTime()) / 86400000));
    const overdueDays = ageDays - cadenceDays;
    if (overdueDays <= 0) {
      return {
        cadenceDays,
        ageDays,
        overdueDays: 0,
        message: `This account usually runs about every ${cadenceDays} days, so the next visit should be attached before that rhythm slips.`,
      };
    }
    return {
      cadenceDays,
      ageDays,
      overdueDays,
      message: `This account usually runs about every ${cadenceDays} days and is roughly ${overdueDays} days past that rhythm.`,
    };
  }

  function customerRepeatSignalValue(customer = null) {
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    return firstFilled(
      customer?.service_schedule,
      customer?.frequency,
      customer?.recurring_notes,
      customer?.service_plan_name,
      customer?.maintenance_notes,
      customer?.seasonal_notes,
      customer?.follow_up_notes,
      customer?.parts_follow_up,
      customer?.warranty_notes,
      customer?.restoration_notes,
      customer?.approval_notes
    );
  }

  function customerRelationshipGuidance({
    customer = null,
    openRequestsCount = 0,
    openProposalCount = 0,
    activeOrderCount = 0,
    activeJobCount = 0,
    balance = 0,
    latestInteraction = null,
    latestPayment = null,
    blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } }),
  } = {}) {
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const activeWorkCount = Number(activeOrderCount || 0) + Number(activeJobCount || 0);
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const detail = (label, ready, readyNote, missingNote, tone = "") => ({
      label,
      ready: !!ready,
      note: ready ? readyNote : missingNote,
      tone: tone || (!ready ? "warn" : ""),
    });

    const renewalRiskItem = customerRenewalRiskItem({
      customer,
      businessKey,
      openRequestsCount,
      openProposalCount,
      activeWorkCount,
      latestInteraction,
    });

    let title = "Protect the next piece of work";
    let description = "The relationship is in a healthy spot. Use the next move below to protect repeat work and keep the customer feeling looked after.";
    if (openRequestsCount > 0) {
      title = "Respond to the open work first";
      description = "There is still intake waiting on scope or a response. Clearing that first keeps work from getting lost before it ever reaches pricing.";
    } else if (openProposalCount > 0) {
      title = "Move the live proposal to a decision";
      description = "A proposal is still open. Follow up while the customer context is fresh so booked work does not stall here.";
    } else if (activeWorkCount > 0) {
      title = "Keep the active work moving cleanly";
      description = "Work is already in motion. Use the next move below to keep execution, closeout, and customer communication aligned.";
    } else if (balance > 0) {
      title = "Close the money loop";
      description = "The work has moved farther than the payment. Make the balance easy to finish before this turns into avoidable collections drag.";
    } else if (renewalRiskItem && !renewalRiskItem.ready) {
      title = "Protect the next repeat visit";
      description = "This account has repeat-work signals, but the next visit or renewal step is not fully attached yet. Keep it visible before the relationship cools off.";
    }

    const items = [
      detail(
        "Open requests",
        openRequestsCount === 0,
        "Nothing is waiting on a first response right now.",
        `${openRequestsCount} request${openRequestsCount === 1 ? "" : "s"} still need scope, response, or a clear next step.`
      ),
      detail(
        "Live proposals",
        openProposalCount === 0,
        "No proposal is waiting on approval right now.",
        `${openProposalCount} proposal${openProposalCount === 1 ? "" : "s"} still need follow-up, approval, or a decision.`
      ),
      detail(
        "Active work",
        activeWorkCount === 0,
        "No booked work or active job is still hanging open.",
        `${activeWorkCount} work item${activeWorkCount === 1 ? "" : "s"} still need scheduling, execution, or closeout follow-through.`
      ),
      detail(
        "Money follow-through",
        balance <= 0,
        latestPayment
          ? `The latest payment landed ${formatDateTime(latestPayment.paid_at || latestPayment.created_at || latestPayment.updated_at)} and nothing is still due.`
          : "Nothing is currently outstanding for this customer.",
        `There is still ${formatUsd(balance)} open. Keep the next invoice, reminder, or payment step obvious from this record.`
      ),
    ];

    const tradeItemMap = {
      landscaping: detail(
        "Seasonal follow-through",
        !!firstFilled(customer?.seasonal_notes, customer?.upsell_notes, customer?.follow_up_notes),
        firstFilled(customer?.seasonal_notes, customer?.upsell_notes, customer?.follow_up_notes),
        "Capture the next cleanup, mowing, mulch, or seasonal upgrade timing before the property goes quiet."
      ),
      property_maintenance: detail(
        "Site follow-through",
        !!firstFilled(customer?.service_schedule, customer?.follow_up_notes, customer?.service_notes),
        firstFilled(customer?.service_schedule, customer?.follow_up_notes, customer?.service_notes),
        "Capture the next site walk, turnover, or recurring maintenance note before the property needs to be relearned."
      ),
      cleaning: detail(
        "Repeat visit prep",
        !!firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes, customer?.access_notes),
        firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes, customer?.access_notes),
        "Lock in cadence, access, and add-ons so the next cleaning visit is easy to schedule and deliver."
      ),
      hvac: detail(
        "System follow-through",
        !!firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes, customer?.follow_up_notes),
        firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes, customer?.follow_up_notes),
        "Capture maintenance timing, parts follow-up, or warranty notes before the next system visit slips."
      ),
      plumbing: detail(
        "Repair follow-through",
        !!firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.parts_follow_up, customer?.follow_up_notes),
        firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.parts_follow_up, customer?.follow_up_notes),
        "Capture restoration, approval, or return-visit follow-through before the repair goes quiet."
      ),
    };

    items.push(
      tradeItemMap[businessKey] || detail(
        "Relationship follow-through",
        !!firstFilled(customer?.follow_up_notes, latestInteraction?.summary, customer?.service_notes),
        firstFilled(customer?.follow_up_notes, latestInteraction?.summary, customer?.service_notes),
        "Capture the next follow-up step so this customer stays easy to serve and easy to retain."
      )
    );
    if (renewalRiskItem) items.push(renewalRiskItem);

    return { title, description, items };
  }

  function customerReactivationActions({
    customer = null,
    openRequestsCount = 0,
    openProposalCount = 0,
    activeOrderCount = 0,
    activeJobCount = 0,
    blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } }),
  } = {}) {
    const actions = customerRetentionWorkflowActions({
      customer,
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      blueprint,
      includeOpenCustomer: false,
      requestAction: "create-request",
      requestLabel: customerCreateRequestActionLabel(blueprint),
      primaryClassName: "btn btn-primary",
      secondaryClassName: "btn btn-ghost",
    });
    return actions.map((action) => ({
      label: action.label,
      className: action.className,
      data: {
        "customer-action": action.action === "reactivate-repeat"
          ? "booking"
          : (action.action === "generate-next-order" ? "plan-order" : (action.action === "create-request" ? "create-request" : "request")),
      },
    }));
  }

  function customerScheduleActionLabel(blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const scheduleLabelMap = {
      landscaping: "Schedule next property visit",
      property_maintenance: "Schedule next site visit",
      pressure_washing: "Schedule next wash visit",
      cleaning: "Schedule next cleaning visit",
      hvac: "Schedule next system visit",
      plumbing: "Schedule next follow-up visit",
    };
    return scheduleLabelMap[businessKey] || "Schedule next visit";
  }

  function customerRequestActionLabel(blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const requestLabelMap = {
      landscaping: "Draft seasonal follow-up request",
      property_maintenance: "Draft site follow-up request",
      pressure_washing: "Draft wash follow-up request",
      cleaning: "Draft cleaning follow-up request",
      hvac: "Draft maintenance follow-up request",
      plumbing: "Draft repair follow-up request",
    };
    return requestLabelMap[businessKey] || "Draft follow-up request";
  }

  function customerCreateRequestActionLabel(blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const requestLabelMap = {
      landscaping: "Create seasonal follow-up request",
      property_maintenance: "Create site follow-up request",
      pressure_washing: "Create wash follow-up request",
      cleaning: "Create cleaning follow-up request",
      hvac: "Create maintenance follow-up request",
      plumbing: "Create repair follow-up request",
    };
    return requestLabelMap[businessKey] || "Create follow-up request";
  }

  function customerRepeatNextTouchValue(customer = null) {
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    return firstFilled(
      customer?.next_service_on,
      customer?.follow_up_notes
    );
  }

  function customerRepeatPlanState(customer = null, now = new Date()) {
    if (!customer?.id) {
      return {
        plan: null,
        nextRunOn: "",
        dueNow: false,
        canGenerate: false,
        hasOpenGeneratedWork: false,
        generatedOrder: null,
      };
    }
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const planRows = typeof SERVICE_PLANS_CACHE !== "undefined" && Array.isArray(SERVICE_PLANS_CACHE) ? SERVICE_PLANS_CACHE : [];
    const orderRows = typeof CRM_ORDERS_CACHE !== "undefined" && Array.isArray(CRM_ORDERS_CACHE) ? CRM_ORDERS_CACHE : [];
    const activePlans = planRows
      .filter((plan) => (
        String(plan?.customer_id || "") === String(customer.id)
        && String(plan?.status || "").trim().toLowerCase() === "active"
      ))
      .sort((a, b) => {
        const aDue = a?.next_run_on ? new Date(a.next_run_on).getTime() : Number.POSITIVE_INFINITY;
        const bDue = b?.next_run_on ? new Date(b.next_run_on).getTime() : Number.POSITIVE_INFINITY;
        if (aDue !== bDue) return aDue - bDue;
        return new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime();
      });
    const plan = activePlans[0] || null;
    const nextRunOn = String(plan?.next_run_on || "").trim();
    const dueNow = !!nextRunOn && new Date(nextRunOn).getTime() <= startOfToday.getTime();
    const generatedOrder = plan?.last_generated_order_id
      ? orderRows.find((row) => String(row?.id || "") === String(plan.last_generated_order_id)) || null
      : null;
    const generatedStatus = String(generatedOrder?.status || "").trim().toLowerCase();
    const hasOpenGeneratedWork = !!generatedOrder && !["completed", "fulfilled", "paid", "cancelled", "void"].includes(generatedStatus);
    const canGenerate = !!plan && !!nextRunOn && !hasOpenGeneratedWork && (dueNow || !generatedOrder);
    return {
      plan,
      nextRunOn,
      dueNow,
      canGenerate,
      hasOpenGeneratedWork,
      generatedOrder,
    };
  }

  function customerGenerateWorkActionLabel() {
    return "Generate next booked work";
  }

  function customerRetentionWorkflowActions({
    customer = null,
    openRequestsCount = 0,
    openProposalCount = 0,
    activeOrderCount = 0,
    activeJobCount = 0,
    blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } }),
    includeGenerateWork = true,
    includeSchedule = true,
    includeRequest = true,
    requestAction = "request",
    requestLabel = "",
    includeOpenCustomer = true,
    primaryClassName = "btn btn-primary btn-sm",
    secondaryClassName = "btn btn-ghost btn-sm",
  } = {}) {
    const repeatSignal = customerRepeatSignalValue(customer);
    if (!repeatSignal) return [];

    const planState = customerRepeatPlanState(customer);
    const nextTouch = customerRepeatNextTouchValue(customer);
    const activeWorkCount = Number(activeOrderCount || 0) + Number(activeJobCount || 0);
    if ((nextTouch && !planState.canGenerate) || openRequestsCount > 0 || openProposalCount > 0 || activeWorkCount > 0) return [];

    const actions = [];
    if (includeGenerateWork && planState.canGenerate) {
      actions.push({
        label: customerGenerateWorkActionLabel(),
        action: "generate-next-order",
        className: primaryClassName,
      });
    } else if (includeSchedule) {
      actions.push({
        label: customerScheduleActionLabel(blueprint),
        action: "reactivate-repeat",
        className: primaryClassName,
      });
    }
    if (includeRequest) {
      actions.push({
        label: requestLabel || customerRequestActionLabel(blueprint),
        action: requestAction,
        className: secondaryClassName,
      });
    }
    if (includeOpenCustomer) {
      actions.push({
        label: "Open customer",
        action: "open-reactivation-customer",
        className: secondaryClassName,
      });
    }
    return actions;
  }

  function customerFollowUpRequestDraft(customer = null, options = {}, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    if (!customer) return null;
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const address = customerDisplayAddress(customer);
    const requestTitles = {
      landscaping: `${customer.name || "Customer"} seasonal follow-up`,
      property_maintenance: `${customer.name || "Customer"} site follow-up`,
      pressure_washing: `${customer.name || "Customer"} wash follow-up`,
      cleaning: `${customer.name || "Customer"} cleaning follow-up`,
      hvac: `${customer.name || "Customer"} maintenance follow-up`,
      plumbing: `${customer.name || "Customer"} repair follow-up`,
    };
    const requestedServiceTypes = {
      landscaping: "Seasonal property follow-up",
      property_maintenance: "Site maintenance follow-up",
      pressure_washing: "Wash follow-up",
      cleaning: "Cleaning follow-up",
      hvac: "Maintenance follow-up",
      plumbing: "Repair follow-up",
    };
    const summaryByTrade = {
      landscaping: firstFilled(customer?.seasonal_notes, customer?.follow_up_notes, customer?.service_schedule, customer?.service_notes),
      property_maintenance: firstFilled(customer?.service_schedule, customer?.follow_up_notes, customer?.access_notes, customer?.service_notes),
      pressure_washing: firstFilled(customer?.seasonal_notes, customer?.service_schedule, customer?.service_notes),
      cleaning: firstFilled(customer?.recurring_notes, customer?.checklist_notes, customer?.add_on_notes, customer?.entry_notes),
      hvac: firstFilled(customer?.parts_follow_up, customer?.warranty_notes, customer?.maintenance_notes, customer?.equipment_notes),
      plumbing: firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.shutoff_notes, customer?.follow_up_notes),
    };
    const notesByTrade = {
      landscaping: firstFilled(customer?.gate_notes, customer?.access_notes, customer?.service_notes),
      property_maintenance: firstFilled(customer?.access_notes, customer?.follow_up_notes, customer?.service_notes),
      pressure_washing: firstFilled(customer?.access_notes, customer?.service_notes, customer?.follow_up_notes),
      cleaning: firstFilled(customer?.entry_notes, customer?.access_notes, customer?.alarm_notes),
      hvac: firstFilled(customer?.equipment_notes, customer?.diagnostic_notes, customer?.follow_up_notes),
      plumbing: firstFilled(customer?.issue_summary, customer?.fixture_notes, customer?.follow_up_notes),
    };

    return {
      title: options.title || requestTitles[businessKey] || `${customer.name || "Customer"} follow-up request`,
      requestedServiceType: options.requestedServiceType || requestedServiceTypes[businessKey] || "Follow-up request",
      serviceAddress: address === "No service address yet." ? "" : address,
      summary: options.summary || summaryByTrade[businessKey] || firstFilled(customer?.follow_up_notes, customer?.service_notes, customer?.notes),
      notes: options.notes || notesByTrade[businessKey] || "",
      message: options.message || "Follow-up request draft opened from the customer record.",
    };
  }

  function customerPostWorkGuidance({
    customer = null,
    customerOrders = [],
    customerJobs = [],
    balance = 0,
    blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } }),
  } = {}) {
    const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
    const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
    const detail = (label, ready, readyNote, missingNote, tone = "") => ({
      label,
      ready: !!ready,
      note: ready ? readyNote : missingNote,
      tone: tone || (!ready ? "warn" : ""),
    });
    const completedOrder = [...(customerOrders || [])]
      .filter((order) => ["completed", "paid"].includes(String(order?.status || "").toLowerCase()))
      .sort((a, b) => new Date(b.updated_at || b.completed_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.completed_at || a.created_at || 0).getTime())[0] || null;
    const completedJob = [...(customerJobs || [])]
      .filter((job) => ["completed"].includes(String(job?.status || "").toLowerCase()))
      .sort((a, b) => new Date(b.updated_at || b.completed_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.completed_at || a.created_at || 0).getTime())[0] || null;
    const latestCompletedAt = completedJob?.completed_at
      || completedJob?.updated_at
      || completedOrder?.completed_at
      || completedOrder?.updated_at
      || completedOrder?.created_at
      || "";

    if (!completedOrder && !completedJob) return null;

    const moneyItem = detail(
      "Final money step",
      balance <= 0,
      "The money side of the finished work is already closed.",
      `There is still ${formatUsd(balance)} open after the work wrapped. Close that loop while the visit is still fresh.`
    );

    const landscaping = [
      detail(
        "Next property touch stays visible",
        !!firstFilled(customer?.seasonal_notes, customer?.follow_up_notes, customer?.service_schedule),
        firstFilled(customer?.seasonal_notes, customer?.follow_up_notes, customer?.service_schedule),
        "Leave the next cleanup, seasonal upgrade, or repeat-service note attached before the property goes quiet."
      ),
      detail(
        "Closeout note is reusable",
        !!firstFilled(customer?.cleanup_notes, customer?.service_notes, completedOrder?.notes, completedJob?.notes),
        firstFilled(customer?.cleanup_notes, customer?.service_notes, completedOrder?.notes, completedJob?.notes),
        "Capture one plain-English note about what the crew finished so the next visit starts smarter."
      ),
      moneyItem,
    ];

    const cleaning = [
      detail(
        "Next visit expectation stays visible",
        !!firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes),
        firstFilled(customer?.recurring_notes, customer?.add_on_notes, customer?.checklist_notes),
        "Lock in the next cleaning cadence, add-ons, or checklist update before the customer has to restate it."
      ),
      detail(
        "Access and closeout stay together",
        !!firstFilled(customer?.access_notes, customer?.alarm_notes, customer?.follow_up_notes),
        firstFilled(customer?.access_notes, customer?.alarm_notes, customer?.follow_up_notes),
        "Carry the access and closeout note forward so the next visit is still easy to deliver."
      ),
      moneyItem,
    ];

    const hvac = [
      detail(
        "System follow-through stays visible",
        !!firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes),
        firstFilled(customer?.maintenance_notes, customer?.parts_follow_up, customer?.warranty_notes),
        "Leave the maintenance, parts, or warranty note attached so the next HVAC visit starts informed."
      ),
      detail(
        "Diagnostic history is reusable",
        !!firstFilled(customer?.diagnostic_notes, customer?.equipment_notes, customer?.follow_up_notes),
        firstFilled(customer?.diagnostic_notes, customer?.equipment_notes, customer?.follow_up_notes),
        "Capture what changed, what was recommended, or what still needs approval before the system issue goes quiet."
      ),
      moneyItem,
    ];

    const plumbing = [
      detail(
        "Repair closeout stays visible",
        !!firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes),
        firstFilled(customer?.restoration_notes, customer?.approval_notes, customer?.follow_up_notes),
        "Leave the restoration, approval, or return-visit note attached so the repair closes out cleanly."
      ),
      detail(
        "Issue history is reusable",
        !!firstFilled(customer?.issue_summary, customer?.fixture_notes, customer?.shutoff_notes),
        firstFilled(customer?.issue_summary, customer?.fixture_notes, customer?.shutoff_notes),
        "Capture the issue and shutoff context before the next plumbing call starts from scratch."
      ),
      moneyItem,
    ];

    const fallback = [
      detail(
        "Next customer step",
        !!firstFilled(customer?.follow_up_notes, customer?.service_notes, completedOrder?.notes, completedJob?.notes),
        firstFilled(customer?.follow_up_notes, customer?.service_notes, completedOrder?.notes, completedJob?.notes),
        "Leave one clear next step attached so completed work turns into an easier next move."
      ),
      moneyItem,
    ];

    const items = ({
      landscaping,
      property_maintenance: landscaping,
      pressure_washing: landscaping,
      cleaning,
      hvac,
      plumbing,
    })[businessKey] || fallback;

    return {
      title: "Turn finished work into the next easy step",
      description: latestCompletedAt
        ? `The latest completed work wrapped ${formatDateTime(latestCompletedAt)}. Keep the follow-through, repeat opportunity, and money step attached while it is still fresh.`
        : "Keep the follow-through, repeat opportunity, and money step attached while the finished work is still fresh.",
      items,
    };
  }

  function renderCustomerRecordFocusCard() {
    const customer = global.CURRENT_CUSTOMER_DETAIL_CUSTOMER || null;
    const blueprint = typeof currentWorkspaceBlueprint === "function"
      ? currentWorkspaceBlueprint()
      : { business: { key: "service_business" } };
    const seenFocus = new Set();
    const focus = customerMemoryChecklist(customer, blueprint)
      .filter((item) => {
        const key = `${String(item?.label || "").trim().toLowerCase()}::${String(item?.note || "").trim().toLowerCase()}`;
        if (!key || seenFocus.has(key)) return false;
        seenFocus.add(key);
        return true;
      })
      .slice(0, 4);
    if (!focus.length) return "";
    return `
      <div class="detail-card detail-card--spaced customer-support-card customer-support-card--focus">
        <div class="kicker">Service memory</div>
        <div><strong>Keep the repeat-visit details the team should not have to relearn</strong></div>
        <div class="detail-copy">Access notes, scope memory, and trade-specific context stay compact here so crews and operators can scan them fast.</div>
        <div class="memory-checklist">
          ${focus.map((item) => `
            <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""}">
              <div class="memory-checklist__title">${escapeHtml(item.ready ? `Ready: ${item.label}` : `Still needed: ${item.label}`)}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(item.note)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function customerWorkbenchStageSummary({
    openRequestsCount = 0,
    openProposalCount = 0,
    activeOrderCount = 0,
    activeJobCount = 0,
    balance = 0,
    latestInteraction = null,
  } = {}) {
    const activeWorkCount = Number(activeOrderCount || 0) + Number(activeJobCount || 0);
    if (openRequestsCount > 0) {
      return {
        label: "Intake needs attention",
        note: `${openRequestsCount} open request${openRequestsCount === 1 ? "" : "s"} still need scope, response, or conversion.`,
      };
    }
    if (openProposalCount > 0) {
      return {
        label: "Pricing is still moving",
        note: `${openProposalCount} live proposal${openProposalCount === 1 ? "" : "s"} need follow-through before momentum cools off.`,
      };
    }
    if (activeWorkCount > 0) {
      return {
        label: "Execution is live",
        note: `${activeWorkCount} booked or active work item${activeWorkCount === 1 ? "" : "s"} still need delivery, proof, or closeout attention.`,
      };
    }
    if (balance > 0) {
      return {
        label: "Money follow-through remains",
        note: `${formatUsd(balance)} is still open, so the account looks quiet operationally but not financially.`,
      };
    }
    if (latestInteraction?.summary) {
      return {
        label: "Relationship is between cycles",
        note: "No active work is open right now. The next best move is keeping the last promise or creating the next request cleanly.",
      };
    }
    return {
      label: "Ready for the next move",
      note: "No active work, pricing, or collection pressure is open right now, so this record should feel simple and ready to reuse fast.",
    };
  }

  function renderCustomerOperatorBriefCard({
    customer = null,
    knownAddresses = [],
    openRequestsCount = 0,
    openProposalCount = 0,
    activeOrderCount = 0,
    activeJobCount = 0,
    balance = 0,
    lastTouchValue = "",
    latestInteraction = null,
    customerIdValue = "",
  } = {}) {
    const stage = customerWorkbenchStageSummary({
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      balance,
      latestInteraction,
    });
    const latestDraft = latestCustomerWorkbenchDraftForCustomer(customerIdValue);
    const siteCount = Math.max(
      knownAddresses.length,
      customerDisplayAddress(customer) === "No service address yet." ? 0 : 1
    );
    return `
      <div class="detail-card detail-card--spaced customer-operator-brief">
        <div class="customer-operator-brief__head">
          <div>
            <div class="kicker">Operator brief</div>
            <div><strong>${escapeHtml(stage.label)}</strong></div>
          </div>
          <span class="pill ${escapeAttr(openRequestsCount || openProposalCount || activeOrderCount || activeJobCount || balance > 0 ? "pill-warn" : "pill-on")}">${escapeHtml(openRequestsCount + openProposalCount + activeOrderCount + activeJobCount > 0 ? "Needs eyes" : "Stable")}</span>
        </div>
        <div class="detail-copy">${escapeHtml(stage.note)}</div>
        <div class="customer-operator-brief__grid">
          <div class="customer-operator-brief__item">
            <span>Last touch</span>
            <strong>${escapeHtml(lastTouchValue ? formatDateTime(lastTouchValue) : "Not recorded")}</strong>
            <small>${escapeHtml(latestInteraction ? customerInteractionLabel(latestInteraction.type) : "No interaction logged yet")}</small>
          </div>
          <div class="customer-operator-brief__item">
            <span>Account shape</span>
            <strong>${escapeHtml(siteCount > 1 ? `${siteCount} sites on file` : "Single-site account")}</strong>
            <small>${escapeHtml(customer?.company_name ? "Company-style account with primary contact attached" : "Direct customer record with one main contact")}</small>
          </div>
          <div class="customer-operator-brief__item">
            <span>Draft state</span>
            <strong>${escapeHtml(latestDraft ? `${customerWorkbenchAppLabel(latestDraft.appKey)} panel saved` : "No draft waiting")}</strong>
            <small>${escapeHtml(latestDraft?.draft?.updated_at ? `Autosaved ${formatDateTime(latestDraft.draft.updated_at)}` : "Close any panel and ProofLink will hold your place automatically.")}</small>
          </div>
          <div class="customer-operator-brief__item">
            <span>Live pressure</span>
            <strong>${escapeHtml(String(openRequestsCount + openProposalCount + activeOrderCount + activeJobCount))}</strong>
            <small>${escapeHtml(openRequestsCount + openProposalCount + activeOrderCount + activeJobCount > 0
              ? `${openRequestsCount + openProposalCount + activeOrderCount + activeJobCount} active relationship signal${openRequestsCount + openProposalCount + activeOrderCount + activeJobCount === 1 ? "" : "s"}`
              : "No active pipeline or work pressure right now")}</small>
          </div>
        </div>
      </div>
    `;
  }

  function renderCustomerCommandCard(actions = []) {
    return `
      <div class="detail-card detail-card--spaced customer-command-card">
        <div class="customer-command-card__head">
          <div>
            <div class="kicker">Quick moves</div>
            <div><strong>Keep the next useful move one click away</strong></div>
          </div>
          <div class="detail-copy">Common actions stay here. The app shelf below handles deeper work.</div>
        </div>
        <div class="customer-command-card__buttons">
          ${actions.map((action) => `<button type="button" class="${escapeAttr(action.className || "btn btn-ghost")}" ${Object.entries(action.data || {}).map(([key, value]) => `${key}="${escapeAttr(value)}"`).join(" ")}>${escapeHtml(action.label || "Open")}</button>`).join("")}
        </div>
      </div>
    `;
  }

  function renderCustomerActionCard({
    customer = null,
    knownAddresses = [],
    openRequestsCount = 0,
    openProposalCount = 0,
    activeOrderCount = 0,
    activeJobCount = 0,
    balance = 0,
    lastTouchValue = "",
    latestInteraction = null,
    customerIdValue = "",
    actions = [],
  } = {}) {
    const stage = customerWorkbenchStageSummary({
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      balance,
      latestInteraction,
    });
    const latestDraft = latestCustomerWorkbenchDraftForCustomer(customerIdValue);
    const siteCount = Math.max(
      knownAddresses.length,
      customerDisplayAddress(customer) === "No service address yet." ? 0 : 1
    );
    const activeSignals = openRequestsCount + openProposalCount + activeOrderCount + activeJobCount;
    return `
      <div class="detail-card detail-card--spaced customer-action-card">
        <div class="customer-action-card__head">
          <div>
            <div class="kicker">Account control</div>
            <div><strong>${escapeHtml(stage.label)}</strong></div>
            <div class="detail-copy">${escapeHtml(stage.note)}</div>
          </div>
          <span class="pill ${escapeAttr(activeSignals > 0 || balance > 0 ? "pill-warn" : "pill-on")}">${escapeHtml(activeSignals > 0 || balance > 0 ? "Needs eyes" : "Stable")}</span>
        </div>
        <div class="customer-action-card__meta">
          <div class="customer-action-card__item">
            <span>Last touch</span>
            <strong>${escapeHtml(lastTouchValue ? formatDateTime(lastTouchValue) : "Not recorded")}</strong>
            <small>${escapeHtml(latestInteraction
              ? (typeof customerInteractionLabel === "function"
                  ? customerInteractionLabel(latestInteraction.type)
                  : String(latestInteraction.type || "Interaction"))
              : "No interaction logged yet")}</small>
          </div>
          <div class="customer-action-card__item">
            <span>Account shape</span>
            <strong>${escapeHtml(siteCount > 1 ? `${siteCount} sites on file` : "Single-site account")}</strong>
            <small>${escapeHtml(customer?.company_name ? "Company-style account with primary contact attached" : "Direct customer record with one main contact")}</small>
          </div>
          <div class="customer-action-card__item">
            <span>Draft state</span>
            <strong>${escapeHtml(latestDraft ? `${customerWorkbenchAppLabel(latestDraft.appKey)} panel saved` : "No draft waiting")}</strong>
            <small>${escapeHtml(latestDraft?.draft?.updated_at ? `Autosaved ${formatDateTime(latestDraft.draft.updated_at)}` : "Panels hold your place automatically.")}</small>
          </div>
          <div class="customer-action-card__item">
            <span>Live pressure</span>
            <strong>${escapeHtml(String(activeSignals))}</strong>
            <small>${escapeHtml(activeSignals > 0
              ? `${activeSignals} live signal${activeSignals === 1 ? "" : "s"} still need operator attention.`
              : "No active pipeline or work pressure right now.")}</small>
          </div>
        </div>
        <div class="customer-action-card__buttons">
          ${actions.map((action) => `<button type="button" class="${escapeAttr(action.className || "btn btn-ghost")}" ${Object.entries(action.data || {}).map(([key, value]) => `${key}="${escapeAttr(value)}"`).join(" ")}>${escapeHtml(action.label || "Open")}</button>`).join("")}
        </div>
      </div>
    `;
  }

  function renderCustomerJumpRow() {
    return `
      <div class="customer-jump-row">
        <button type="button" class="customer-jump-chip" data-customer-jump-target="customerProfileSection">Profile</button>
        <button type="button" class="customer-jump-chip" data-customer-jump-target="customerWorkflowSection">Workflow</button>
        <button type="button" class="customer-jump-chip" data-customer-jump-target="customerFollowThroughSection">Follow-through</button>
        <button type="button" class="customer-jump-chip" data-customer-jump-target="customerActivityTimelineSection">Activity</button>
      </div>
    `;
  }

  function renderCustomerProfileCard(customer, {
    knownAddresses = [],
  } = {}) {
    const profileItems = [
      {
        label: "Account name",
        value: customer?.company_name || customer?.name || "Not recorded",
        note: customer?.company_name ? "Company, campus, HOA, or billing entity" : "Primary customer label on file",
      },
      {
        label: "Primary contact",
        value: customer?.name || "Not recorded",
        note: customerContactSummary(customer),
      },
      {
        label: "Preferred contact",
        value: titleCaseWords(String(customer?.preferred_contact || "email")),
        note: customer?.email || customer?.phone || "Add an email or phone number to improve follow-through",
      },
      {
        label: "Lead source",
        value: customer?.lead_source ? titleCaseWords(String(customer.lead_source).replace(/_/g, " ")) : "Manual or unknown",
        note: customer?.created_at ? `Added ${formatDateTime(customer.created_at)}` : "Created in CRM",
      },
      {
        label: "Primary address",
        value: customerDisplayAddress(customer),
        note: knownAddresses.length > 1 ? `${knownAddresses.length} known service sites` : "Primary location on file",
      },
    ];

    return `
      <div class="detail-card customer-support-card customer-support-card--profile" id="customerProfileSection">
        <div class="kicker">Account profile</div>
        <div><strong>Read the essentials without squinting through six tiny boxes</strong></div>
        <div class="detail-copy">The basics live here: who this account belongs to, how to reach them, and which site the team expects to serve.</div>
        <div class="customer-profile-list">
          ${profileItems.map((item) => `
            <div class="customer-profile-row">
              <span>${escapeHtml(item.label)}</span>
              <div class="customer-profile-row__value">
                <strong>${escapeHtml(item.value || "Not recorded")}</strong>
                <small>${escapeHtml(item.note || "")}</small>
              </div>
            </div>
          `).join("")}
        </div>
        ${knownAddresses.length ? `
          <div class="customer-site-list">
            <span class="customer-site-list__label">Known sites</span>
            <div class="customer-site-list__chips">
              ${knownAddresses.slice(0, 5).map((address) => `<span class="pill">${escapeHtml(address)}</span>`).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderCustomerFootprintCard({
    customer = null,
    customerRequestsRows = [],
    customerBidRows = [],
    customerOrders = [],
    customerJobsRows = [],
    customerPayments = [],
    balance = 0,
    knownAddresses = [],
  } = {}) {
    const totalValue = typeof customerLifetimeValueCents === "function"
      ? customerLifetimeValueCents(customer)
      : Number(customer?.lifetime_value_cents || 0);
    const totalSites = Math.max(knownAddresses.length, customerDisplayAddress(customer) === "No service address yet." ? 0 : 1);
    const totalWorkRecords = customerOrders.length + customerJobsRows.length;
    const footprintItems = [
      {
        label: "Request history",
        value: String(customerRequestsRows.length),
        note: customerRequestsRows.length ? "All intake records ever attached" : "No requests attached yet",
      },
      {
        label: "Proposal history",
        value: String(customerBidRows.length),
        note: customerBidRows.length ? "Saved walkthrough and pricing history" : "No proposals attached yet",
      },
      {
        label: "Work history",
        value: String(totalWorkRecords),
        note: `${customerOrders.length} order${customerOrders.length === 1 ? "" : "s"} | ${customerJobsRows.length} job${customerJobsRows.length === 1 ? "" : "s"}`,
      },
      {
        label: "Lifetime value",
        value: formatUsd(totalValue),
        note: totalValue > 0 ? "Best available paid history for this account" : "Value builds as payments get recorded",
      },
    ];

    return `
      <div class="detail-card customer-support-card customer-support-card--footprint" id="customerFootprintSection">
        <div class="kicker">Attached work</div>
        <div><strong>See how much history is already tied to this account</strong></div>
        <div class="detail-copy">This strip is about account depth, not live status. It keeps the long-view history separate from the hero above.</div>
        <div class="customer-footprint-strip">
          ${footprintItems.map((item) => `
            <div class="customer-footprint-stat">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value || "0")}</strong>
              <small>${escapeHtml(item.note || "")}</small>
            </div>
          `).join("")}
        </div>
        <div class="customer-footprint-note">
          <span>${escapeHtml(`${customerPayments.length} payment${customerPayments.length === 1 ? "" : "s"} recorded`)}</span>
          <span>${escapeHtml(totalSites > 1 ? `${totalSites} known sites attached` : "Single-site account so far")}</span>
          ${balance > 0 ? `<span>${escapeHtml(`${formatUsd(balance)} still open`)}</span>` : ""}
        </div>
      </div>
    `;
  }

  function renderCustomerOverviewCard({
    customer = null,
    knownAddresses = [],
    customerRequestsRows = [],
    customerBidRows = [],
    customerOrders = [],
    customerJobsRows = [],
    customerPayments = [],
    balance = 0,
  } = {}) {
    const totalValue = typeof customerLifetimeValueCents === "function"
      ? customerLifetimeValueCents(customer)
      : Number(customer?.lifetime_value_cents || 0);
    const formatCase = (value) => {
      const normalized = String(value || "").replace(/_/g, " ").trim();
      if (!normalized) return "";
      if (typeof titleCaseWords === "function") return titleCaseWords(normalized);
      return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
    };
    const totalSites = Math.max(
      knownAddresses.length,
      customerDisplayAddress(customer) === "No service address yet." ? 0 : 1
    );
    const profileItems = [
      {
        label: "Primary contact",
        value: customer?.name || "Not recorded",
        note: customerContactSummary(customer),
      },
      {
        label: "Preferred contact",
        value: formatCase(customer?.preferred_contact || "email"),
        note: customer?.email || customer?.phone || "Add an email or phone number to improve follow-through",
      },
      {
        label: "Lead source",
        value: customer?.lead_source ? formatCase(customer.lead_source) : "Manual or unknown",
        note: customer?.created_at ? `Added ${formatDateTime(customer.created_at)}` : "Created in CRM",
      },
      {
        label: "Primary address",
        value: customerDisplayAddress(customer),
        note: totalSites > 1 ? `${totalSites} known service sites` : "Primary location on file",
      },
    ];
    const footprintItems = [
      {
        label: "Request history",
        value: String(customerRequestsRows.length),
        note: customerRequestsRows.length ? "All intake records ever attached" : "No requests attached yet",
      },
      {
        label: "Proposal history",
        value: String(customerBidRows.length),
        note: customerBidRows.length ? "Saved walkthrough and pricing history" : "No proposals attached yet",
      },
      {
        label: "Work history",
        value: String(customerOrders.length + customerJobsRows.length),
        note: `${customerOrders.length} order${customerOrders.length === 1 ? "" : "s"} | ${customerJobsRows.length} job${customerJobsRows.length === 1 ? "" : "s"}`,
      },
      {
        label: "Lifetime value",
        value: formatUsd(totalValue),
        note: totalValue > 0 ? "Best available paid history for this account" : "Value builds as payments get recorded",
      },
    ];
    return `
      <div class="detail-card customer-overview-card" id="customerProfileSection">
        <div class="kicker">Overview</div>
        <div><strong>Identity and history stay together here</strong></div>
        <div class="customer-overview-card__grid">
          <div class="customer-overview-card__section">
            <div class="customer-overview-card__label">Account basics</div>
            <div class="customer-profile-list">
              ${profileItems.map((item) => `
                <div class="customer-profile-row">
                  <span>${escapeHtml(item.label)}</span>
                  <div class="customer-profile-row__value">
                    <strong>${escapeHtml(item.value || "Not recorded")}</strong>
                    <small>${escapeHtml(item.note || "")}</small>
                  </div>
                </div>
              `).join("")}
            </div>
            ${knownAddresses.length ? `
              <div class="customer-site-list">
                <span class="customer-site-list__label">Known sites</span>
                <div class="customer-site-list__chips">
                  ${knownAddresses.slice(0, 5).map((address) => `<span class="pill">${escapeHtml(address)}</span>`).join("")}
                </div>
              </div>
            ` : ""}
          </div>
          <div class="customer-overview-card__section" id="customerFootprintSection">
            <div class="customer-overview-card__label">Account depth</div>
            <div class="customer-footprint-strip">
              ${footprintItems.map((item) => `
                <div class="customer-footprint-stat">
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.value || "0")}</strong>
                  <small>${escapeHtml(item.note || "")}</small>
                </div>
              `).join("")}
            </div>
            <div class="customer-footprint-note">
              <span>${escapeHtml(`${customerPayments.length} payment${customerPayments.length === 1 ? "" : "s"} recorded`)}</span>
              <span>${escapeHtml(totalSites > 1 ? `${totalSites} known sites attached` : "Single-site account so far")}</span>
              ${balance > 0 ? `<span>${escapeHtml(`${formatUsd(balance)} still open`)}</span>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderCustomerActivityTimelineCard(timelineItems = []) {
    return `
      <div class="detail-card record-card-spaced" id="customerActivityTimelineSection">
        <div class="kicker">Recent activity</div>
        <div><strong>Jump into the latest movement fast</strong></div>
        <div class="detail-copy">Every recent interaction, proposal, work record, and payment stays visible here so the next click starts from real context.</div>
        <div class="customer-activity-timeline">
          ${timelineItems.length ? timelineItems.map((item) => `
            <button
              type="button"
              class="customer-activity-item"
              ${item.tab && item.id ? `data-customer-open-tab="${escapeAttr(item.tab)}" data-customer-open-id="${escapeAttr(item.id)}"` : ""}
            >
              <span class="customer-activity-item__copy">
                <span class="customer-activity-item__eyebrow">${escapeHtml(item.kind || "Activity")}</span>
                <strong>${escapeHtml(item.title || "Activity")}</strong>
                <span>${escapeHtml(item.note || "Recent movement on this account.")}</span>
              </span>
              <span class="customer-activity-item__meta">
                <span class="pill">${escapeHtml(item.kind || "Activity")}</span>
                <time>${escapeHtml(item.when ? formatDateTime(item.when) : "No date")}</time>
              </span>
            </button>
          `).join("") : `<div class="empty-note">No customer activity has been logged yet.</div>`}
        </div>
      </div>
    `;
  }

  const CUSTOMER_WORKBENCH_APP_ORDER = [
    "profile",
    "requests",
    "proposals",
    "work",
    "money",
    "follow_through",
  ];

  function customerWorkbenchDraftStorage() {
    try {
      const storage = global.localStorage || global.sessionStorage || null;
      if (!storage || typeof storage.getItem !== "function") return null;
      return storage;
    } catch (_) {
      return null;
    }
  }

  function customerWorkbenchDraftKey(customerIdValue, appKey) {
    const tenantScope = typeof TENANT_ID !== "undefined" && TENANT_ID ? TENANT_ID : "tenant";
    return `prooflink:customer-workbench:${String(tenantScope)}:${String(customerIdValue || "customer")}:${String(appKey || "panel")}:draft`;
  }

  function customerWorkbenchLastAppKey(customerIdValue) {
    const tenantScope = typeof TENANT_ID !== "undefined" && TENANT_ID ? TENANT_ID : "tenant";
    return `prooflink:customer-workbench:${String(tenantScope)}:${String(customerIdValue || "customer")}:last-app`;
  }

  function normalizeCustomerWorkbenchDraftValue(value = {}) {
    const input = value && typeof value === "object" ? value : {};
    return Object.keys(input)
      .sort()
      .reduce((acc, key) => {
        const current = input[key];
        acc[key] = typeof current === "string"
          ? current.trim()
          : (current ?? "");
        return acc;
      }, {});
  }

  function customerWorkbenchDraftHasContent(value = {}) {
    return Object.values(normalizeCustomerWorkbenchDraftValue(value)).some((entry) => {
      if (Array.isArray(entry)) return entry.length > 0;
      return String(entry || "").trim().length > 0;
    });
  }

  function readCustomerWorkbenchDraft(customerIdValue, appKey) {
    const storage = customerWorkbenchDraftStorage();
    if (!storage || !customerIdValue || !appKey) return null;
    try {
      const raw = storage.getItem(customerWorkbenchDraftKey(customerIdValue, appKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.value || typeof parsed.value !== "object") return null;
      return {
        updated_at: parsed.updated_at || "",
        value: parsed.value,
      };
    } catch (_) {
      return null;
    }
  }

  function writeCustomerWorkbenchDraft(customerIdValue, appKey, value = {}) {
    const storage = customerWorkbenchDraftStorage();
    if (!storage || !customerIdValue || !appKey) return null;
    const payload = {
      updated_at: new Date().toISOString(),
      value: normalizeCustomerWorkbenchDraftValue(value),
    };
    try {
      storage.setItem(customerWorkbenchDraftKey(customerIdValue, appKey), JSON.stringify(payload));
      return payload;
    } catch (_) {
      return null;
    }
  }

  function clearCustomerWorkbenchDraft(customerIdValue, appKey) {
    const storage = customerWorkbenchDraftStorage();
    if (!storage || !customerIdValue || !appKey) return;
    try {
      storage.removeItem(customerWorkbenchDraftKey(customerIdValue, appKey));
    } catch (_) {}
  }

  function syncCustomerWorkbenchDraft(customerIdValue, appKey, value = {}, baseline = {}) {
    const normalizedValue = normalizeCustomerWorkbenchDraftValue(value);
    const normalizedBaseline = normalizeCustomerWorkbenchDraftValue(baseline);
    if (!customerWorkbenchDraftHasContent(normalizedValue) || JSON.stringify(normalizedValue) === JSON.stringify(normalizedBaseline)) {
      clearCustomerWorkbenchDraft(customerIdValue, appKey);
      return null;
    }
    return writeCustomerWorkbenchDraft(customerIdValue, appKey, normalizedValue);
  }

  function rememberCustomerWorkbenchApp(customerIdValue, appKey) {
    const storage = customerWorkbenchDraftStorage();
    if (!storage || !customerIdValue || !appKey) return;
    try {
      storage.setItem(customerWorkbenchLastAppKey(customerIdValue), String(appKey || "").trim());
    } catch (_) {}
  }

  function readCustomerWorkbenchLastApp(customerIdValue) {
    const storage = customerWorkbenchDraftStorage();
    if (!storage || !customerIdValue) return "";
    try {
      return String(storage.getItem(customerWorkbenchLastAppKey(customerIdValue)) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function latestCustomerWorkbenchDraftForCustomer(customerIdValue, appKeys = CUSTOMER_WORKBENCH_APP_ORDER) {
    if (!customerIdValue) return null;
    const matches = appKeys
      .map((appKey) => ({
        appKey,
        draft: readCustomerWorkbenchDraft(customerIdValue, appKey),
      }))
      .filter((entry) => entry.draft?.updated_at);
    if (!matches.length) return null;
    matches.sort((a, b) => new Date(b.draft.updated_at || 0).getTime() - new Date(a.draft.updated_at || 0).getTime());
    return matches[0];
  }

  function customerWorkbenchAppLabel(appKey = "") {
    const labels = {
      profile: "Profile",
      requests: "Requests",
      proposals: "Proposals",
      work: "Work",
      money: "Money",
      follow_through: "Follow-through",
    };
    return labels[String(appKey || "").trim()] || "Panel";
  }

  function customerWorkbenchProfileBaseline(customer = null) {
    return {
      company_name: customer?.company_name || "",
      name: customer?.name || "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      preferred_contact: customer?.preferred_contact || "email",
      address_line1: customer?.address_line1 || "",
      city: customer?.city || "",
      state: customer?.state || "",
      zip: customer?.zip || "",
      notes: customer?.notes || "",
    };
  }

  function customerWorkbenchRequestBaseline(customer = null, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    const draft = customerFollowUpRequestDraft(customer, {}, blueprint) || {};
    return {
      title: draft.title || "",
      requestedServiceType: draft.requestedServiceType || "",
      serviceAddress: draft.serviceAddress || "",
      summary: draft.summary || "",
      notes: draft.notes || "",
    };
  }

  function customerWorkbenchFollowThroughBaseline() {
    return {
      type: "note",
      summary: "",
    };
  }

  function renderCustomerWorkbenchRecordList(rows, options = {}) {
    if (!rows.length) return `<div class="empty-note">${escapeHtml(options.empty || "Nothing here yet.")}</div>`;
    return `
      <div class="customer-flow-list">
        ${rows.map((row) => {
          const title = options.title ? options.title(row) : "Open record";
          const meta = options.meta ? options.meta(row) : "";
          const badge = options.badge ? options.badge(row) : "";
          return `
            <button type="button" class="customer-flow-item" data-customer-open-tab="${escapeAttr(options.tab || "")}" data-customer-open-id="${escapeAttr(row.id || "")}">
              <span class="customer-flow-item__copy">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(meta)}</span>
              </span>
              ${badge ? `<span class="pill">${escapeHtml(badge)}</span>` : ""}
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function customerWorkbenchAppCards({
    customer = null,
    customerIdValue = "",
    customerRequestsRows = [],
    customerBidRows = [],
    customerOrders = [],
    customerJobsRows = [],
    customerPayments = [],
    activityTimeline = [],
    openRequestsCount = 0,
    openProposalCount = 0,
    activeOrderCount = 0,
    activeJobCount = 0,
    balance = 0,
    lastTouchValue = "",
    knownAddresses = [],
  } = {}) {
    const profileDraft = !!readCustomerWorkbenchDraft(customerIdValue, "profile");
    const requestsDraft = !!readCustomerWorkbenchDraft(customerIdValue, "requests");
    const followThroughDraft = !!readCustomerWorkbenchDraft(customerIdValue, "follow_through");
    return [
      {
        key: "profile",
        meta: "Account",
        title: "Profile",
        copy: "Edit contacts, sites, and internal notes without leaving the customer workbench.",
        status: profileDraft
          ? "Draft waiting"
          : (knownAddresses.length > 1 ? `${knownAddresses.length} sites on file` : (customer?.email || customer?.phone ? "Contact ready" : "Needs contact details")),
        openLabel: profileDraft ? "Resume draft" : "Open panel",
        dirty: profileDraft,
      },
      {
        key: "requests",
        meta: "Intake",
        title: "Requests",
        copy: "Keep new requests tied to this account and draft the next follow-up without changing tabs.",
        status: requestsDraft
          ? "Draft waiting"
          : (openRequestsCount > 0 ? `${openRequestsCount} open request${openRequestsCount === 1 ? "" : "s"}` : `${customerRequestsRows.length} total request${customerRequestsRows.length === 1 ? "" : "s"}`),
        openLabel: requestsDraft ? "Resume draft" : "Open panel",
        dirty: requestsDraft,
      },
      {
        key: "proposals",
        meta: "Pricing",
        title: "Proposals",
        copy: "Review proposal history and open the estimate builder only when you need detailed pricing work.",
        status: openProposalCount > 0
          ? `${openProposalCount} live proposal${openProposalCount === 1 ? "" : "s"}`
          : `${customerBidRows.length} saved proposal${customerBidRows.length === 1 ? "" : "s"}`,
        openLabel: "Open panel",
        dirty: false,
      },
      {
        key: "work",
        meta: "Execution",
        title: "Work",
        copy: "See booked work, active jobs, and the next operational move from one place.",
        status: activeOrderCount + activeJobCount > 0
          ? `${activeOrderCount + activeJobCount} active work item${activeOrderCount + activeJobCount === 1 ? "" : "s"}`
          : `${customerOrders.length + customerJobsRows.length} total work record${customerOrders.length + customerJobsRows.length === 1 ? "" : "s"}`,
        openLabel: "Open panel",
        dirty: false,
      },
      {
        key: "money",
        meta: "Collections",
        title: "Money",
        copy: "Keep billed work, recent payments, and collection context close to the customer.",
        status: balance > 0
          ? `${formatUsd(balance)} open`
          : (customerPayments.length ? "Collected for now" : "No payments yet"),
        openLabel: "Open panel",
        dirty: false,
      },
      {
        key: "follow_through",
        meta: "Relationship",
        title: "Follow-through",
        copy: "Log the latest touchpoint, see recent activity, and keep the next promise visible.",
        status: followThroughDraft
          ? "Draft waiting"
          : (lastTouchValue ? `Last touch ${formatDateTime(lastTouchValue)}` : `${activityTimeline.length} recent activity item${activityTimeline.length === 1 ? "" : "s"}`),
        openLabel: followThroughDraft ? "Resume draft" : "Open panel",
        dirty: followThroughDraft,
      },
    ];
  }

  function renderCustomerWorkbenchLauncher(context = {}) {
    const customerIdValue = context.customerIdValue || "";
    const cards = customerWorkbenchAppCards(context);
    const latestDraft = latestCustomerWorkbenchDraftForCustomer(customerIdValue);
    return `
      <div class="detail-card customer-workbench-launcher" id="customerWorkflowSection">
        <div class="customer-workbench-launcher__head">
          <div>
            <div class="kicker">Customer apps</div>
            <div><strong>Open one focused panel and keep the rest of the account quiet</strong></div>
            <div class="detail-copy">Each panel stays tied to this customer, keeps its own draft, and drops you back where you left off.</div>
          </div>
          <div class="customer-workbench-launcher__stats">
            <span class="pill">${escapeHtml(`${cards.length} app${cards.length === 1 ? "" : "s"}`)}</span>
            <span class="pill">${escapeHtml(latestDraft ? "Draft waiting" : "No drafts open")}</span>
          </div>
        </div>
        ${latestDraft ? `
          <div class="customer-workbench-resume">
            <div class="customer-workbench-resume__copy">
              <div class="customer-workbench-resume__eyebrow">Resume draft</div>
              <strong>${escapeHtml(customerWorkbenchAppLabel(latestDraft.appKey))} panel still has unsaved work</strong>
              <span>${escapeHtml(latestDraft.draft?.updated_at ? `Saved automatically ${formatDateTime(latestDraft.draft.updated_at)}` : "Saved automatically when the panel was closed.")}</span>
            </div>
            <button type="button" class="btn btn-primary" data-customer-app-open="${escapeAttr(latestDraft.appKey)}">Resume draft</button>
          </div>
        ` : ""}
        <div class="customer-workbench-app-grid">
          ${cards.map((card) => `
            <button
              type="button"
              class="workspace-launch-card ${card.dirty ? "is-dirty" : ""}"
              data-customer-app-open="${escapeAttr(card.key)}"
            >
              <span class="workspace-launch-card__meta">${escapeHtml(card.meta)}</span>
              <strong class="workspace-launch-card__title">${escapeHtml(card.title)}</strong>
              <span class="workspace-launch-card__copy">${escapeHtml(card.copy)}</span>
              <span class="workspace-launch-card__footer">
                <span class="workspace-launch-card__status">${escapeHtml(card.status)}</span>
                <span class="workspace-launch-card__open">${escapeHtml(card.openLabel)}</span>
              </span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function rerenderCustomerWorkbench(customerIdValue) {
    if (!customerIdValue) return Promise.resolve();
    if (typeof renderCustomerDetail === "function") {
      try {
        return Promise.resolve(renderCustomerDetail(customerIdValue));
      } catch (_) {}
    }
    if (typeof renderCustomersList === "function") {
      try {
        return Promise.resolve(renderCustomersList(customerSearch?.value || ""));
      } catch (_) {}
    }
    return Promise.resolve();
  }

  function closeCustomerWorkbenchModal() {
    const existing = global.CURRENT_CUSTOMER_WORKBENCH_MODAL;
    if (!existing) return;
    existing.overlay?.remove?.();
    if (typeof document !== "undefined" && existing.keyHandler) {
      document.removeEventListener("keydown", existing.keyHandler);
    }
    global.CURRENT_CUSTOMER_WORKBENCH_MODAL = null;
  }

  function openCustomerWorkbenchModal({ customerIdValue = "", appKey = "", title = "", subtitle = "", bodyHtml = "", wide = true, onReady = null } = {}) {
    if (typeof document === "undefined" || !document?.body) return null;
    closeCustomerWorkbenchModal();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "customerWorkbenchModal";
    overlay.innerHTML = `
      <div class="modal-card customer-workbench-modal ${wide ? "customer-workbench-modal--wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="customerWorkbenchModalTitle">
        <div class="modal-head">
          <div>
            <div class="modal-title" id="customerWorkbenchModalTitle">${escapeHtml(title || customerWorkbenchAppLabel(appKey))}</div>
            <div class="modal-subtitle">${escapeHtml(subtitle || "Stay in context, move faster, and keep your place if you close this panel.")}</div>
          </div>
          <button type="button" class="modal-close" data-customer-modal-close aria-label="Close customer panel">&times;</button>
        </div>
        <div class="customer-workbench-modal__body">${bodyHtml}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => closeCustomerWorkbenchModal();
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector("[data-customer-modal-close]")?.addEventListener("click", close);
    const keyHandler = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", keyHandler);
    global.CURRENT_CUSTOMER_WORKBENCH_MODAL = { overlay, keyHandler, appKey, customerIdValue };
    rememberCustomerWorkbenchApp(customerIdValue, appKey);
    onReady?.({ overlay, close });
    return overlay;
  }

  function bindCustomerWorkbenchRecordButtons(root = document) {
    root.querySelectorAll("[data-customer-open-tab][data-customer-open-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.getAttribute("data-customer-open-tab") || "";
        const recordId = button.getAttribute("data-customer-open-id") || "";
        if (!tab || !recordId) return;
        closeCustomerWorkbenchModal();
        openCustomerRecordTab(tab, recordId);
      });
    });
  }

  function normalizeCustomerWorkbenchContext(context = {}) {
    const customer = context.customer || global.CURRENT_CUSTOMER_DETAIL_CUSTOMER || null;
    const customerIdValue = context.customerIdValue || customer?.id || "";
    const blueprint = context.blueprint || (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } });
    const customerRequestsRows = context.customerRequestsRows || customerRequests(customerIdValue).slice(0, 12);
    const customerBidRows = context.customerBidRows || customerBids(customerIdValue).slice(0, 12);
    const customerJobsRows = context.customerJobsRows || customerJobs(customerIdValue).slice(0, 12);
    const customerOrders = context.customerOrders || CRM_ORDERS_CACHE
      .filter((row) => row.customer_id === customerIdValue && !row.is_deleted)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
      .slice(0, 12);
    const customerPayments = context.customerPayments || sortedPayments(PAYMENTS_CACHE.filter((row) => row.customer_id === customerIdValue)).slice(0, 12);
    const totalBilled = context.totalBilled ?? customerOrders.reduce((sum, order) => sum + Number(order.total_cents || 0), 0);
    const totalPaid = context.totalPaid ?? customerPayments.reduce((sum, payment) => sum + Math.max(0, paymentRevenueContributionCents(payment)), 0);
    const balance = context.balance ?? Math.max(0, totalBilled - totalPaid);
    const openRequestsCount = context.openRequestsCount ?? customerRequestsRows.filter((lead) => !["won", "closed", "archived", "cancelled"].includes(String(lead.status || "").toLowerCase())).length;
    const openProposalCount = context.openProposalCount ?? customerBidRows.filter((bid) => !["won", "lost", "archived", "rejected"].includes(String(bid.status || "").toLowerCase())).length;
    const activeOrderCount = context.activeOrderCount ?? customerOrders.filter((order) => !["completed", "cancelled", "archived"].includes(String(order.status || "").toLowerCase())).length;
    const activeJobCount = context.activeJobCount ?? customerJobsRows.filter((job) => !["completed", "cancelled", "archived"].includes(String(job.status || "").toLowerCase())).length;
    const latestInteraction = context.latestInteraction || (Array.isArray(context.interactions) ? context.interactions[0] : null) || null;
    const latestPayment = context.latestPayment || customerPayments[0] || null;
    const lastTouchValue = context.lastTouchValue || customer?.last_contact_at || latestInteraction?.created_at || "";
    const knownAddresses = context.knownAddresses || customerKnownAddresses(customerIdValue, customer);
    const activityTimeline = context.activityTimeline || customerActivityTimeline({
      customerRequestsRows,
      customerBidRows,
      customerOrders,
      customerJobsRows,
      customerPayments,
      interactions: context.interactions || [],
    });
    const nextMoveGuidance = context.nextMoveGuidance || customerRelationshipGuidance({
      customer,
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      balance,
      latestInteraction,
      latestPayment,
      blueprint,
    });
    const reactivationActions = context.reactivationActions || customerReactivationActions({
      customer,
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      blueprint,
    });
    const postWorkGuidance = context.postWorkGuidance || customerPostWorkGuidance({
      customer,
      customerOrders,
      customerJobs: customerJobsRows,
      balance,
      blueprint,
    });
    const postWorkActions = context.postWorkActions || (postWorkGuidance && balance <= 0
      ? customerRetentionWorkflowActions({
          customer,
          openRequestsCount,
          openProposalCount,
          activeOrderCount,
          activeJobCount,
          blueprint,
          includeGenerateWork: true,
          includeSchedule: true,
          includeRequest: true,
          requestAction: "create-request",
          requestLabel: customerCreateRequestActionLabel(blueprint),
          includeOpenCustomer: false,
          primaryClassName: "btn btn-primary",
          secondaryClassName: "btn btn-ghost",
        })
      : []);
    const collectionGuidance = context.collectionGuidance || customerCollectionGuidance(customer, customerOrders, customerPayments, balance);
    return {
      ...context,
      customer,
      customerIdValue,
      blueprint,
      customerRequestsRows,
      customerBidRows,
      customerJobsRows,
      customerOrders,
      customerPayments,
      totalBilled,
      totalPaid,
      balance,
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      latestInteraction,
      latestPayment,
      lastTouchValue,
      knownAddresses,
      activityTimeline,
      nextMoveGuidance,
      reactivationActions,
      postWorkGuidance,
      postWorkActions,
      collectionGuidance,
    };
  }

  function handleCustomerWorkbenchAction(action, context = {}) {
    const resolved = normalizeCustomerWorkbenchContext(context);
    const customer = resolved.customer;
    if (!customer) return false;

    if (action === "edit" || action === "profile") return openCustomerWorkbenchApp("profile", resolved);
    if (action === "request" || action === "requests-panel") return openCustomerWorkbenchApp("requests", resolved);
    if (action === "bid" || action === "proposals") return openCustomerWorkbenchApp("proposals", resolved);
    if (action === "work") return openCustomerWorkbenchApp("work", resolved);
    if (action === "money") return openCustomerWorkbenchApp("money", resolved);
    if (action === "note" || action === "follow_through") return openCustomerWorkbenchApp("follow_through", resolved);

    if (action === "booking") {
      closeCustomerWorkbenchModal();
      return openCustomerRetentionAction("reactivate-repeat", customer, resolved.blueprint);
    }
    if (action === "plan-order") {
      closeCustomerWorkbenchModal();
      return openCustomerRetentionAction("generate-next-order", customer, resolved.blueprint);
    }
    if (action === "payment") {
      closeCustomerWorkbenchModal();
      return openCustomerPaymentDraft(resolved.customerIdValue);
    }
    if (action === "requests") {
      closeCustomerWorkbenchModal();
      return switchTab("leads");
    }
    if (action === "bids") {
      closeCustomerWorkbenchModal();
      return switchTab("bids");
    }
    if (action === "orders") {
      closeCustomerWorkbenchModal();
      return switchTab("orders");
    }
    if (action === "jobs") {
      closeCustomerWorkbenchModal();
      return switchTab("jobs");
    }
    if (action === "payments") {
      closeCustomerWorkbenchModal();
      return switchTab("payments");
    }
    if (action === "archive") {
      closeCustomerWorkbenchModal();
      return archiveCustomer(resolved.customerIdValue);
    }
    return false;
  }

  function openCustomerWorkbenchApp(appKey, context = global.CURRENT_CUSTOMER_DETAIL_CONTEXT || {}) {
    const resolved = normalizeCustomerWorkbenchContext(context);
    if (!resolved.customer || !resolved.customerIdValue) return false;
    if (appKey === "profile") return openCustomerWorkbenchProfileApp(resolved);
    if (appKey === "requests") return openCustomerWorkbenchRequestsApp(resolved);
    if (appKey === "proposals") return openCustomerWorkbenchProposalsApp(resolved);
    if (appKey === "work") return openCustomerWorkbenchWorkApp(resolved);
    if (appKey === "money") return openCustomerWorkbenchMoneyApp(resolved);
    if (appKey === "follow_through") return openCustomerWorkbenchFollowThroughApp(resolved);
    return false;
  }

  function openCustomerWorkbenchProfileApp(context = {}) {
    const { customer, customerIdValue, knownAddresses } = context;
    const baseline = customerWorkbenchProfileBaseline(customer);
    const draft = readCustomerWorkbenchDraft(customerIdValue, "profile")?.value || {};
    const values = { ...baseline, ...draft };
    return openCustomerWorkbenchModal({
      customerIdValue,
      appKey: "profile",
      title: `Profile: ${customerPrimaryDisplayLabel(customer)}`,
      subtitle: "Update the customer record here. If you close this panel before saving, the draft stays with this customer.",
      bodyHtml: `
        <div class="modal-stack">
          <div class="customer-workbench-modal__summary">
            <span class="pill">${escapeHtml(knownAddresses.length > 1 ? `${knownAddresses.length} known sites` : "Single-site record")}</span>
            <span class="pill">${escapeHtml(customer?.preferred_contact ? `Prefers ${titleCaseWords(String(customer.preferred_contact))}` : "Preferred contact not set")}</span>
            <span class="pill">${escapeHtml(customer?.email || customer?.phone ? "Contact details on file" : "Needs contact details")}</span>
          </div>
          <div class="modal-status">Close this panel any time. Unsaved changes stay attached to this customer as a draft.</div>
          <form id="customerWorkbenchProfileForm" class="modal-stack">
            <div class="modal-grid-2">
              <div class="modal-grid-2__fill">
                <label class="field-note-label field-note-label--tight">Account name</label>
                <input id="customerWorkbenchProfileCompany" class="input u-full-width" value="${escapeAttr(values.company_name || "")}" placeholder="Company, city department, HOA, campus" />
              </div>
              <div class="modal-grid-2__fill">
                <label class="field-note-label field-note-label--tight">Primary contact</label>
                <input id="customerWorkbenchProfileName" class="input u-full-width" value="${escapeAttr(values.name || "")}" placeholder="Contact name" />
              </div>
            </div>
            <div class="modal-grid-2">
              <div class="modal-grid-2__fill">
                <label class="field-note-label field-note-label--tight">Email</label>
                <input id="customerWorkbenchProfileEmail" class="input u-full-width" value="${escapeAttr(values.email || "")}" placeholder="name@example.com" />
              </div>
              <div class="modal-grid-2__fill">
                <label class="field-note-label field-note-label--tight">Phone</label>
                <input id="customerWorkbenchProfilePhone" class="input u-full-width" value="${escapeAttr(values.phone || "")}" placeholder="555-555-5555" />
              </div>
            </div>
            <div>
              <label class="field-note-label field-note-label--tight">Preferred contact</label>
              <select id="customerWorkbenchProfilePreferred" class="input u-full-width">
                ${["email", "phone", "text", "any"].map((option) => `<option value="${escapeAttr(option)}"${String(values.preferred_contact || "email") === option ? " selected" : ""}>${escapeHtml(titleCaseWords(option))}</option>`).join("")}
              </select>
            </div>
            <div class="modal-grid-3">
              <div>
                <label class="field-note-label field-note-label--tight">Address</label>
                <input id="customerWorkbenchProfileAddress" class="input u-full-width" value="${escapeAttr(values.address_line1 || "")}" placeholder="Service address" />
              </div>
              <div>
                <label class="field-note-label field-note-label--tight">City</label>
                <input id="customerWorkbenchProfileCity" class="input u-full-width" value="${escapeAttr(values.city || "")}" placeholder="City" />
              </div>
              <div class="modal-grid-2">
                <div class="modal-grid-2__fill">
                  <label class="field-note-label field-note-label--tight">State</label>
                  <input id="customerWorkbenchProfileState" class="input u-full-width" value="${escapeAttr(values.state || "")}" placeholder="State" />
                </div>
                <div class="modal-grid-2__fill">
                  <label class="field-note-label field-note-label--tight">ZIP</label>
                  <input id="customerWorkbenchProfileZip" class="input u-full-width" value="${escapeAttr(values.zip || "")}" placeholder="ZIP" />
                </div>
              </div>
            </div>
            <div>
              <label class="field-note-label field-note-label--tight">Internal notes</label>
              <textarea id="customerWorkbenchProfileNotes" class="input u-full-width customer-workbench-modal__textarea" placeholder="Gate codes, billing notes, site history, or anything the team should remember.">${escapeHtml(values.notes || "")}</textarea>
            </div>
          </form>
          <div class="modal-footer">
            <span id="customerWorkbenchProfileStatus" class="modal-status"></span>
            <div class="action-row">
              <button id="customerWorkbenchProfileDiscard" class="btn btn-ghost" type="button">Discard draft</button>
              <button id="customerWorkbenchProfileSave" class="btn btn-primary" type="button">Save changes</button>
            </div>
          </div>
        </div>
      `,
      onReady: ({ overlay, close }) => {
        const collect = () => ({
          company_name: overlay.querySelector("#customerWorkbenchProfileCompany")?.value || "",
          name: overlay.querySelector("#customerWorkbenchProfileName")?.value || "",
          email: overlay.querySelector("#customerWorkbenchProfileEmail")?.value || "",
          phone: overlay.querySelector("#customerWorkbenchProfilePhone")?.value || "",
          preferred_contact: overlay.querySelector("#customerWorkbenchProfilePreferred")?.value || "email",
          address_line1: overlay.querySelector("#customerWorkbenchProfileAddress")?.value || "",
          city: overlay.querySelector("#customerWorkbenchProfileCity")?.value || "",
          state: overlay.querySelector("#customerWorkbenchProfileState")?.value || "",
          zip: overlay.querySelector("#customerWorkbenchProfileZip")?.value || "",
          notes: overlay.querySelector("#customerWorkbenchProfileNotes")?.value || "",
        });
        const status = overlay.querySelector("#customerWorkbenchProfileStatus");
        const syncDraft = () => {
          syncCustomerWorkbenchDraft(customerIdValue, "profile", collect(), baseline);
          if (status) status.textContent = "";
        };
        overlay.querySelectorAll("input, select, textarea").forEach((field) => {
          field.addEventListener("input", syncDraft);
          field.addEventListener("change", syncDraft);
        });
        overlay.querySelector("#customerWorkbenchProfileDiscard")?.addEventListener("click", () => {
          clearCustomerWorkbenchDraft(customerIdValue, "profile");
          overlay.querySelector("#customerWorkbenchProfileCompany").value = baseline.company_name || "";
          overlay.querySelector("#customerWorkbenchProfileName").value = baseline.name || "";
          overlay.querySelector("#customerWorkbenchProfileEmail").value = baseline.email || "";
          overlay.querySelector("#customerWorkbenchProfilePhone").value = baseline.phone || "";
          overlay.querySelector("#customerWorkbenchProfilePreferred").value = baseline.preferred_contact || "email";
          overlay.querySelector("#customerWorkbenchProfileAddress").value = baseline.address_line1 || "";
          overlay.querySelector("#customerWorkbenchProfileCity").value = baseline.city || "";
          overlay.querySelector("#customerWorkbenchProfileState").value = baseline.state || "";
          overlay.querySelector("#customerWorkbenchProfileZip").value = baseline.zip || "";
          overlay.querySelector("#customerWorkbenchProfileNotes").value = baseline.notes || "";
          if (status) status.textContent = "Draft discarded.";
        });
        overlay.querySelector("#customerWorkbenchProfileSave")?.addEventListener("click", async () => {
          if (status) status.textContent = "Saving customer...";
          try {
            const saveApi = global.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE?.saveCustomerRecord || (typeof saveCustomerRecord === "function" ? saveCustomerRecord : null);
            if (typeof saveApi !== "function") throw new Error("Customer save is not ready yet.");
            await saveApi({
              id: customer.id,
              ...collect(),
            });
            clearCustomerWorkbenchDraft(customerIdValue, "profile");
            close();
            showToast("Customer saved.");
          } catch (error) {
            if (status) status.textContent = error?.message || "Could not save the customer yet.";
          }
        });
        overlay.querySelector("#customerWorkbenchProfileCompany")?.focus?.();
      },
    });
  }

  function openCustomerWorkbenchRequestsApp(context = {}) {
    const { customer, customerIdValue, blueprint, customerRequestsRows, openRequestsCount } = context;
    const baseline = customerWorkbenchRequestBaseline(customer, blueprint);
    const draft = readCustomerWorkbenchDraft(customerIdValue, "requests")?.value || {};
    const values = { ...baseline, ...draft };
    return openCustomerWorkbenchModal({
      customerIdValue,
      appKey: "requests",
      title: `Requests: ${customerPrimaryDisplayLabel(customer)}`,
      subtitle: "Draft the next request here and keep intake tied to the right account without jumping away from the customer.",
      bodyHtml: `
        <div class="modal-stack">
          <div class="customer-workbench-modal__summary">
            <span class="pill">${escapeHtml(`${customerRequestsRows.length} total request${customerRequestsRows.length === 1 ? "" : "s"}`)}</span>
            <span class="pill">${escapeHtml(openRequestsCount > 0 ? `${openRequestsCount} still open` : "No open requests right now")}</span>
            <span class="pill">${escapeHtml(values.serviceAddress || "Address can be added later")}</span>
          </div>
          <div class="customer-workbench-modal__section">
            <div class="customer-workbench-modal__section-head">
              <div>
                <div class="kicker">New request</div>
                <strong>Capture the next intake step</strong>
              </div>
            </div>
            <div class="modal-status">If you close this panel before saving, the request draft stays with this customer.</div>
            <div class="modal-stack u-mt-10">
              <div class="modal-grid-2">
                <div class="modal-grid-2__fill">
                  <label class="field-note-label field-note-label--tight">Request title</label>
                  <input id="customerWorkbenchRequestTitle" class="input u-full-width" value="${escapeAttr(values.title || "")}" placeholder="Follow-up title" />
                </div>
                <div class="modal-grid-2__fill">
                  <label class="field-note-label field-note-label--tight">Service type</label>
                  <input id="customerWorkbenchRequestType" class="input u-full-width" value="${escapeAttr(values.requestedServiceType || "")}" placeholder="Service type" />
                </div>
              </div>
              <div>
                <label class="field-note-label field-note-label--tight">Service address</label>
                <input id="customerWorkbenchRequestAddress" class="input u-full-width" value="${escapeAttr(values.serviceAddress || "")}" placeholder="Service address" />
              </div>
              <div>
                <label class="field-note-label field-note-label--tight">Summary</label>
                <textarea id="customerWorkbenchRequestSummary" class="input u-full-width customer-workbench-modal__textarea" placeholder="What is needed next?">${escapeHtml(values.summary || "")}</textarea>
              </div>
              <div>
                <label class="field-note-label field-note-label--tight">Notes</label>
                <textarea id="customerWorkbenchRequestNotes" class="input u-full-width customer-workbench-modal__textarea" placeholder="Anything the estimator or dispatcher should know.">${escapeHtml(values.notes || "")}</textarea>
              </div>
            </div>
          </div>
          <div class="customer-workbench-modal__section">
            <div class="customer-workbench-modal__section-head">
              <div>
                <div class="kicker">Recent requests</div>
                <strong>Open the right intake record fast</strong>
              </div>
              <button type="button" class="btn btn-ghost" data-customer-action="requests">Open full requests</button>
            </div>
            ${renderCustomerWorkbenchRecordList(customerRequestsRows.slice(0, 6), {
              tab: "leads",
              empty: "No requests are attached to this customer yet.",
              title: (lead) => lead.contact_name || lead.title || lead.requested_service_type || "Request",
              meta: (lead) => `${titleCaseWords(String(lead.status || "new"))} | ${lead.requested_service_type || "Service request"}`,
              badge: (lead) => lead.requested_service_type || "Request",
            })}
          </div>
          <div class="modal-footer">
            <span id="customerWorkbenchRequestStatus" class="modal-status"></span>
            <div class="action-row">
              <button id="customerWorkbenchRequestDiscard" class="btn btn-ghost" type="button">Discard draft</button>
              <button id="customerWorkbenchRequestOpenFull" class="btn btn-ghost" type="button">Open in full builder</button>
              <button id="customerWorkbenchRequestSave" class="btn btn-primary" type="button">Save request</button>
            </div>
          </div>
        </div>
      `,
      onReady: ({ overlay, close }) => {
        const status = overlay.querySelector("#customerWorkbenchRequestStatus");
        const collect = () => ({
          title: overlay.querySelector("#customerWorkbenchRequestTitle")?.value || "",
          requestedServiceType: overlay.querySelector("#customerWorkbenchRequestType")?.value || "",
          serviceAddress: overlay.querySelector("#customerWorkbenchRequestAddress")?.value || "",
          summary: overlay.querySelector("#customerWorkbenchRequestSummary")?.value || "",
          notes: overlay.querySelector("#customerWorkbenchRequestNotes")?.value || "",
        });
        const syncDraft = () => {
          syncCustomerWorkbenchDraft(customerIdValue, "requests", collect(), baseline);
          if (status) status.textContent = "";
        };
        overlay.querySelectorAll("input, textarea").forEach((field) => {
          field.addEventListener("input", syncDraft);
          field.addEventListener("change", syncDraft);
        });
        overlay.querySelector("#customerWorkbenchRequestDiscard")?.addEventListener("click", () => {
          clearCustomerWorkbenchDraft(customerIdValue, "requests");
          overlay.querySelector("#customerWorkbenchRequestTitle").value = baseline.title || "";
          overlay.querySelector("#customerWorkbenchRequestType").value = baseline.requestedServiceType || "";
          overlay.querySelector("#customerWorkbenchRequestAddress").value = baseline.serviceAddress || "";
          overlay.querySelector("#customerWorkbenchRequestSummary").value = baseline.summary || "";
          overlay.querySelector("#customerWorkbenchRequestNotes").value = baseline.notes || "";
          if (status) status.textContent = "Draft discarded.";
        });
        overlay.querySelector("#customerWorkbenchRequestOpenFull")?.addEventListener("click", () => {
          clearCustomerWorkbenchDraft(customerIdValue, "requests");
          close();
          openCustomerRequestDraft(customer, collect(), blueprint);
        });
        overlay.querySelector("#customerWorkbenchRequestSave")?.addEventListener("click", async () => {
          const leadPlanApi = global.PROOFLINK_OPERATOR_LEAD_PLAN_WORKSPACE || {};
          if (typeof leadPlanApi.saveLeadRecord !== "function") {
            clearCustomerWorkbenchDraft(customerIdValue, "requests");
            close();
            openCustomerRequestDraft(customer, collect(), blueprint);
            return;
          }
          if (status) status.textContent = "Saving request...";
          try {
            const valuesToSave = collect();
            await leadPlanApi.saveLeadRecord({
              customer_id: customer.id || "",
              contact_name: customer.name || "",
              contact_email: customer.email || "",
              contact_phone: customer.phone || "",
              preferred_contact: customer.preferred_contact || "phone",
              title: valuesToSave.title || "",
              requested_service_type: valuesToSave.requestedServiceType || "",
              service_address: valuesToSave.serviceAddress || "",
              summary: valuesToSave.summary || "",
              notes: valuesToSave.notes || "",
              metadata: {
                created_from: "customer_workbench",
                source_action: "customer_panel_request",
                source_record_type: "customer",
                source_record_id: customer.id || "",
              },
            });
            clearCustomerWorkbenchDraft(customerIdValue, "requests");
            await rerenderCustomerWorkbench(customerIdValue);
            close();
            showToast("Request saved.");
          } catch (error) {
            if (status) status.textContent = error?.message || "Could not save the request yet.";
          }
        });
        overlay.querySelectorAll("[data-customer-action]").forEach((button) => {
          button.addEventListener("click", () => {
            handleCustomerWorkbenchAction(button.getAttribute("data-customer-action") || "", context);
          });
        });
        bindCustomerWorkbenchRecordButtons(overlay);
        overlay.querySelector("#customerWorkbenchRequestSummary")?.focus?.();
      },
    });
  }

  function openCustomerWorkbenchProposalsApp(context = {}) {
    const { customer, customerIdValue, customerBidRows, openProposalCount } = context;
    return openCustomerWorkbenchModal({
      customerIdValue,
      appKey: "proposals",
      title: `Proposals: ${customerPrimaryDisplayLabel(customer)}`,
      subtitle: "Proposal history stays visible here. Open the full proposal builder only when you need detailed pricing work.",
      bodyHtml: `
        <div class="modal-stack">
          <div class="customer-workbench-modal__summary">
            <span class="pill">${escapeHtml(`${customerBidRows.length} proposal${customerBidRows.length === 1 ? "" : "s"} on file`)}</span>
            <span class="pill">${escapeHtml(openProposalCount > 0 ? `${openProposalCount} still live` : "No live proposals right now")}</span>
          </div>
          <div class="detail-card">
            <div class="kicker">Estimate workflow</div>
            <div><strong>Keep the customer context, then jump into pricing only when needed</strong></div>
            <div class="detail-copy">This panel is the quick view. The line-item builder still lives in the full proposal workspace so pricing stays accurate and traceable.</div>
            <div class="customer-action-row action-row--wrap u-mt-10">
              <button type="button" class="btn btn-primary" id="customerWorkbenchProposalDraft">Draft proposal</button>
              <button type="button" class="btn btn-ghost" data-customer-action="bids">Open full proposals</button>
            </div>
          </div>
          <div class="customer-workbench-modal__section">
            <div class="customer-workbench-modal__section-head">
              <div>
                <div class="kicker">Recent proposals</div>
                <strong>Open the right pricing record fast</strong>
              </div>
            </div>
            ${renderCustomerWorkbenchRecordList(customerBidRows.slice(0, 8), {
              tab: "bids",
              empty: "No proposals are attached to this customer yet.",
              title: (bid) => bid.title || "Proposal",
              meta: (bid) => `${titleCaseWords(String(bid.status || "draft"))} | ${formatDateTime(bid.updated_at || bid.created_at)}`,
              badge: (bid) => formatUsd(bidGrandTotalCents(bid)),
            })}
          </div>
        </div>
      `,
      onReady: ({ overlay, close }) => {
        overlay.querySelector("#customerWorkbenchProposalDraft")?.addEventListener("click", () => {
          close();
          openCustomerBidDraft(customer);
        });
        overlay.querySelectorAll("[data-customer-action]").forEach((button) => {
          button.addEventListener("click", () => {
            handleCustomerWorkbenchAction(button.getAttribute("data-customer-action") || "", context);
          });
        });
        bindCustomerWorkbenchRecordButtons(overlay);
      },
    });
  }

  function openCustomerWorkbenchWorkApp(context = {}) {
    const {
      customer,
      customerIdValue,
      customerOrders,
      customerJobsRows,
      nextMoveGuidance,
      reactivationActions,
      postWorkGuidance,
      postWorkActions,
      activeOrderCount,
      activeJobCount,
    } = context;
    return openCustomerWorkbenchModal({
      customerIdValue,
      appKey: "work",
      title: `Work: ${customerPrimaryDisplayLabel(customer)}`,
      subtitle: "Booked work and field execution stay in one panel so the operator can see what is active before leaving the customer.",
      bodyHtml: `
        <div class="modal-stack">
          <div class="customer-workbench-modal__summary">
            <span class="pill">${escapeHtml(`${customerOrders.length} booked work item${customerOrders.length === 1 ? "" : "s"}`)}</span>
            <span class="pill">${escapeHtml(`${customerJobsRows.length} job${customerJobsRows.length === 1 ? "" : "s"}`)}</span>
            <span class="pill">${escapeHtml(activeOrderCount + activeJobCount > 0 ? `${activeOrderCount + activeJobCount} active now` : "No active work right now")}</span>
          </div>
          <div class="detail-card customer-next-step-card">
            <div class="kicker">Best next move</div>
            <div><strong>${escapeHtml(nextMoveGuidance.title)}</strong></div>
            <div class="detail-copy">${escapeHtml(nextMoveGuidance.description)}</div>
            <div class="memory-checklist">
              ${nextMoveGuidance.items.map((item) => `
                <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
                  <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
                  <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible here.")}</div>
                </div>
              `).join("")}
            </div>
            ${reactivationActions.length ? `
              <div class="customer-action-row action-row--wrap u-mt-10">
                ${reactivationActions.map((action) => `<button type="button" class="${escapeAttr(action.className || "btn btn-ghost")}" data-customer-action="${escapeAttr(action.data?.["customer-action"] || "")}">${escapeHtml(action.label || "Take action")}</button>`).join("")}
              </div>
            ` : ""}
          </div>
          ${postWorkGuidance ? `
            <div class="detail-card customer-next-step-card">
              <div class="kicker">After the work wraps</div>
              <div><strong>${escapeHtml(postWorkGuidance.title)}</strong></div>
              <div class="detail-copy">${escapeHtml(postWorkGuidance.description)}</div>
              <div class="memory-checklist">
                ${postWorkGuidance.items.map((item) => `
                  <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
                    <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
                    <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible here.")}</div>
                  </div>
                `).join("")}
              </div>
              ${postWorkActions.length ? `
                <div class="customer-action-row action-row--wrap u-mt-10">
                  ${postWorkActions.map((action) => `<button type="button" class="${escapeAttr(action.className || "btn btn-ghost")}" data-customer-action="${escapeAttr(action.action === "reactivate-repeat" ? "booking" : (action.action === "generate-next-order" ? "plan-order" : action.action))}">${escapeHtml(action.label || "Take action")}</button>`).join("")}
                </div>
              ` : ""}
            </div>
          ` : ""}
          <div class="customer-workbench-modal__split">
            <div class="customer-workbench-modal__section">
              <div class="customer-workbench-modal__section-head">
                <div>
                  <div class="kicker">Booked work</div>
                  <strong>Orders tied to this customer</strong>
                </div>
                <button type="button" class="btn btn-ghost" data-customer-action="orders">Open orders</button>
              </div>
              ${renderCustomerWorkbenchRecordList(customerOrders.slice(0, 6), {
                tab: "orders",
                empty: "No booked work yet. Approved proposals will land here.",
                title: (order) => order.title || order.customer_name || "Order",
                meta: (order) => `${titleCaseWords(String(order.status || "new"))} | ${order.scheduled_date || getScheduledDateFromOrder(order) || "No scheduled date"}`,
                badge: (order) => formatUsd(order.total_cents || 0),
              })}
            </div>
            <div class="customer-workbench-modal__section">
              <div class="customer-workbench-modal__section-head">
                <div>
                  <div class="kicker">Field jobs</div>
                  <strong>Execution without losing account context</strong>
                </div>
                <button type="button" class="btn btn-ghost" data-customer-action="jobs">Open jobs</button>
              </div>
              ${renderCustomerWorkbenchRecordList(customerJobsRows.slice(0, 6), {
                tab: "jobs",
                empty: "No jobs yet. Once work is ready for the field, it shows up here.",
                title: (job) => job.title || "Job",
                meta: (job) => `${titleCaseWords(String(job.status || "scheduled"))} | ${job.scheduled_date || "No scheduled date"}`,
                badge: (job) => job.service_type || "Execution",
              })}
            </div>
          </div>
        </div>
      `,
      onReady: ({ overlay }) => {
        overlay.querySelectorAll("[data-customer-action]").forEach((button) => {
          button.addEventListener("click", () => {
            handleCustomerWorkbenchAction(button.getAttribute("data-customer-action") || "", context);
          });
        });
        bindCustomerWorkbenchRecordButtons(overlay);
      },
    });
  }

  function openCustomerWorkbenchMoneyApp(context = {}) {
    const {
      customer,
      customerIdValue,
      totalBilled,
      totalPaid,
      balance,
      customerOrders,
      customerPayments,
      collectionGuidance,
    } = context;
    return openCustomerWorkbenchModal({
      customerIdValue,
      appKey: "money",
      title: `Money: ${customerPrimaryDisplayLabel(customer)}`,
      subtitle: "Collections and payment readiness stay tied to the work so the operator can see the real money picture before acting.",
      bodyHtml: `
        <div class="modal-stack">
          <div class="customer-workbench-modal__metrics">
            <div class="customer-money-card"><span>Total billed</span><strong>${formatUsd(totalBilled || 0)}</strong></div>
            <div class="customer-money-card"><span>Total paid</span><strong>${formatUsd(totalPaid || 0)}</strong></div>
            <div class="customer-money-card"><span>Open balance</span><strong>${formatUsd(balance || 0)}</strong></div>
            <div class="customer-money-card"><span>Lifetime value</span><strong>${formatUsd(customerLifetimeValueCents(customer))}</strong></div>
          </div>
          <div class="detail-card">
            <div class="kicker">Collection view</div>
            <div><strong>${escapeHtml(collectionGuidance.title)}</strong></div>
            <div class="detail-copy">${escapeHtml(collectionGuidance.description)}</div>
            <div class="customer-action-row action-row--wrap u-mt-10">
              <button type="button" class="btn btn-primary" data-customer-action="payment">Record payment</button>
              <button type="button" class="btn btn-ghost" data-customer-action="payments">Open payments</button>
              <button type="button" class="btn btn-ghost" data-customer-action="orders">Open booked work</button>
            </div>
          </div>
          <div class="customer-workbench-modal__split">
            <div class="customer-workbench-modal__section">
              <div class="customer-workbench-modal__section-head">
                <div>
                  <div class="kicker">Recent orders</div>
                  <strong>Work that drives the billing picture</strong>
                </div>
              </div>
              ${renderCustomerWorkbenchRecordList(customerOrders.slice(0, 6), {
                tab: "orders",
                empty: "No booked work yet for this customer.",
                title: (order) => order.title || order.customer_name || "Order",
                meta: (order) => `${titleCaseWords(String(order.status || "new"))} | ${formatDateTime(order.updated_at || order.created_at)}`,
                badge: (order) => formatUsd(order.total_cents || 0),
              })}
            </div>
            <div class="customer-workbench-modal__section">
              <div class="customer-workbench-modal__section-head">
                <div>
                  <div class="kicker">Recent payments</div>
                  <strong>Latest money movement on the account</strong>
                </div>
              </div>
              ${renderCustomerWorkbenchRecordList(customerPayments.slice(0, 6), {
                tab: "payments",
                empty: "No payments recorded yet.",
                title: (payment) => `${formatPaymentMode(payment.payment_mode)} | ${titleCaseWords(String(payment.status || "paid"))}`,
                meta: (payment) => formatDateTime(payment.paid_at || payment.created_at || payment.updated_at),
                badge: (payment) => formatUsd(paymentAmountCents(payment)),
              })}
            </div>
          </div>
        </div>
      `,
      onReady: ({ overlay }) => {
        overlay.querySelectorAll("[data-customer-action]").forEach((button) => {
          button.addEventListener("click", () => {
            handleCustomerWorkbenchAction(button.getAttribute("data-customer-action") || "", context);
          });
        });
        bindCustomerWorkbenchRecordButtons(overlay);
      },
    });
  }

  function openCustomerWorkbenchFollowThroughApp(context = {}) {
    const {
      customer,
      customerIdValue,
      nextMoveGuidance,
      postWorkGuidance,
      activityTimeline,
      balance,
      lastTouchValue,
    } = context;
    const baseline = customerWorkbenchFollowThroughBaseline();
    const draft = readCustomerWorkbenchDraft(customerIdValue, "follow_through")?.value || {};
    const values = { ...baseline, ...draft };
    return openCustomerWorkbenchModal({
      customerIdValue,
      appKey: "follow_through",
      title: `Follow-through: ${customerPrimaryDisplayLabel(customer)}`,
      subtitle: "Keep the relationship warm, log what happened, and protect the next action without losing customer context.",
      bodyHtml: `
        <div class="modal-stack">
          <div class="modal-status">Close this panel any time. Unsaved interaction notes stay attached to this customer as a draft.</div>
          <div class="detail-card customer-next-step-card">
            <div class="kicker">Best next move</div>
            <div><strong>${escapeHtml(nextMoveGuidance.title)}</strong></div>
            <div class="detail-copy">${escapeHtml(nextMoveGuidance.description)}</div>
            <div class="workspace-chip-row u-mt-10">
              <span class="pill ${balance > 0 ? "pill-bad" : "pill-good"}">${escapeHtml(balance > 0 ? `${formatUsd(balance)} still open` : "Nothing outstanding")}</span>
              <span class="pill">${escapeHtml(lastTouchValue ? `Last touch ${formatDateTime(lastTouchValue)}` : "No touchpoint logged yet")}</span>
            </div>
            <div class="memory-checklist">
              ${nextMoveGuidance.items.map((item) => `
                <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
                  <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
                  <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible here.")}</div>
                </div>
              `).join("")}
            </div>
          </div>
          ${postWorkGuidance ? `
            <div class="detail-card customer-next-step-card">
              <div class="kicker">After the work wraps</div>
              <div><strong>${escapeHtml(postWorkGuidance.title)}</strong></div>
              <div class="detail-copy">${escapeHtml(postWorkGuidance.description)}</div>
              <div class="memory-checklist">
                ${postWorkGuidance.items.map((item) => `
                  <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
                    <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
                    <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible here.")}</div>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ""}
          <div class="customer-workbench-modal__section">
            <div class="customer-workbench-modal__section-head">
              <div>
                <div class="kicker">Interaction log</div>
                <strong>Capture the latest touchpoint</strong>
              </div>
            </div>
            <div class="modal-grid-2">
              <div class="modal-grid-2__fill">
                <label class="field-note-label field-note-label--tight">Interaction type</label>
                <select id="customerWorkbenchInteractionType" class="input u-full-width">
                  ${customerInteractionOptionsMarkup(values.type || "note")}
                </select>
              </div>
              <div class="modal-grid-2__fill">
                <label class="field-note-label field-note-label--tight">Summary</label>
                <input id="customerWorkbenchInteractionSummary" class="input u-full-width" value="${escapeAttr(values.summary || "")}" placeholder="${escapeAttr(customerInteractionPlaceholder(values.type || "note"))}" />
              </div>
            </div>
          </div>
          ${renderCustomerActivityTimelineCard(activityTimeline)}
          <div class="modal-footer">
            <span id="customerWorkbenchInteractionStatus" class="modal-status"></span>
            <div class="action-row">
              <button id="customerWorkbenchInteractionDiscard" class="btn btn-ghost" type="button">Discard draft</button>
              <button id="customerWorkbenchInteractionSave" class="btn btn-primary" type="button">Add interaction</button>
            </div>
          </div>
        </div>
      `,
      onReady: ({ overlay, close }) => {
        const status = overlay.querySelector("#customerWorkbenchInteractionStatus");
        const typeField = overlay.querySelector("#customerWorkbenchInteractionType");
        const summaryField = overlay.querySelector("#customerWorkbenchInteractionSummary");
        const collect = () => ({
          type: typeField?.value || "note",
          summary: summaryField?.value || "",
        });
        const syncDraft = () => {
          syncCustomerWorkbenchDraft(customerIdValue, "follow_through", collect(), baseline);
          if (summaryField) summaryField.placeholder = customerInteractionPlaceholder(typeField?.value || "note");
          if (status) status.textContent = "";
        };
        typeField?.addEventListener("change", syncDraft);
        summaryField?.addEventListener("input", syncDraft);
        overlay.querySelector("#customerWorkbenchInteractionDiscard")?.addEventListener("click", () => {
          clearCustomerWorkbenchDraft(customerIdValue, "follow_through");
          if (typeField) typeField.value = baseline.type;
          if (summaryField) {
            summaryField.value = baseline.summary;
            summaryField.placeholder = customerInteractionPlaceholder(baseline.type);
          }
          if (status) status.textContent = "Draft discarded.";
        });
        overlay.querySelector("#customerWorkbenchInteractionSave")?.addEventListener("click", async () => {
          const summary = String(summaryField?.value || "").trim();
          if (!summary) {
            if (status) status.textContent = "Add a short summary before saving.";
            return;
          }
          if (status) status.textContent = "Saving interaction...";
          try {
            const api = global.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE?.logCustomerInteraction || (typeof logCustomerInteraction === "function" ? logCustomerInteraction : null);
            if (typeof api !== "function") throw new Error("Interaction logging is not ready yet.");
            await api(customerIdValue, typeField?.value || "note", summary, { created_from: "customer_workbench" });
            clearCustomerWorkbenchDraft(customerIdValue, "follow_through");
            await fetchCustomers?.();
            await rerenderCustomerWorkbench(customerIdValue);
            close();
            renderDashboard?.();
            renderMoney?.().catch?.(console.error);
            showToast("Interaction logged.");
          } catch (error) {
            if (status) status.textContent = error?.message || "Could not save the interaction yet.";
          }
        });
        bindCustomerWorkbenchRecordButtons(overlay);
        summaryField?.focus?.();
      },
    });
  }

  function openCustomerRequestDraft(customer, options = {}, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    if (!customer) return;
    const draft = customerFollowUpRequestDraft(customer, options, blueprint) || {};
    switchTab("leads");
    ACTIVE_LEAD_ID = null;
    clearLeadForm();
    renderLeadCustomerOptions(customer.id);
    if (leadCustomerId) leadCustomerId.value = customer.id;
    if (leadContactName) leadContactName.value = customer.name || "";
    if (leadContactEmail) leadContactEmail.value = customer.email || "";
    if (leadContactPhone) leadContactPhone.value = customer.phone || "";
    if (leadPreferredContact) leadPreferredContact.value = customer.preferred_contact || "phone";
    if (leadRequestedService) leadRequestedService.value = draft.requestedServiceType || "";
    if (leadTitle) leadTitle.value = draft.title || `${customer.name || "Customer"} request`;
    if (leadServiceAddress) leadServiceAddress.value = draft.serviceAddress || "";
    if (leadSummary) leadSummary.value = draft.summary || "";
    if (leadNotes) leadNotes.value = draft.notes || "";
    if (leadSummary) leadSummary.focus();
    setInlineMessage(leadMsg, draft.message || "New request draft opened from the customer record.", "ok");
  }

  function createCustomerRequestRecord(customer, options = {}, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    if (!customer) return false;
    const leadPlanApi = global.PROOFLINK_OPERATOR_LEAD_PLAN_WORKSPACE || {};
    if (typeof leadPlanApi.saveLeadRecord !== "function") {
      openCustomerRequestDraft(customer, options, blueprint);
      return true;
    }
    const draft = customerFollowUpRequestDraft(customer, options, blueprint) || {};
    showToast(options.pendingMessage || "Creating follow-up request...");
    Promise.resolve(leadPlanApi.saveLeadRecord({
      customer_id: customer.id || "",
      contact_name: customer.name || "",
      contact_email: customer.email || "",
      contact_phone: customer.phone || "",
      preferred_contact: customer.preferred_contact || "phone",
      title: draft.title || `${customer.name || "Customer"} follow-up request`,
      requested_service_type: draft.requestedServiceType || "Follow-up request",
      service_address: draft.serviceAddress || "",
      summary: draft.summary || "",
      notes: draft.notes || "",
      metadata: {
        created_from: "customer_retention",
        source_action: options.sourceAction || "create-request",
        source_record_type: options.sourceRecordType || "customer",
        source_record_id: options.sourceRecordId || customer.id || "",
      },
    }))
      .then((lead) => {
        if (lead?.id) ACTIVE_LEAD_ID = lead.id;
        switchTab("leads");
        showToast(options.successMessage || "Follow-up request created from the customer record.");
      })
      .catch((error) => {
        showToast(error?.message || "Could not create the follow-up request yet.");
      });
    return true;
  }

  function openCustomerBidDraft(customer) {
    if (!customer) return;
    switchTab("bids");
    const draft = startNewBid(preferredBidProfile());
    const address = customerDisplayAddress(customer);
    const nextDraft = {
      ...draft,
      customer_id: customer.id,
      title: `${customer.name || "Customer"} proposal`,
      site_contact: customer.name || "",
      service_address: address === "No service address yet." ? "" : address,
      updated_at: new Date().toISOString(),
    };
    replaceBidDraft(nextDraft);
    renderBids(bidSearch?.value || "");
    if (bidProjectSummary) bidProjectSummary.focus();
    setInlineMessage(bidMsg, "Proposal draft opened from the customer record.", "ok");
  }

  function openCustomerPaymentDraft(customerIdValue) {
    switchTab("payments");
    clearPaymentForm({ customerId: customerIdValue || "" });
    paymentAmount?.focus?.();
    setInlineMessage(paymentMsg, "Payment form opened for this customer.", "ok");
  }

  function openCustomerBookingDraft(customer, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    if (!customer) return;
    const bookingApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
    if (typeof bookingApi.openBookingDraftForCustomer === "function") {
      bookingApi.openBookingDraftForCustomer(customer, {}, blueprint);
      return;
    }
    switchTab("bookings");
    showToast("Bookings opened. Schedule the next visit while this account is still warm.");
  }

  function openCustomerPlanOrder(customer, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } })) {
    if (!customer) return false;
    const planState = customerRepeatPlanState(customer);
    const plan = planState.plan;
    if (!plan) return false;
    const leadPlanApi = global.PROOFLINK_OPERATOR_LEAD_PLAN_WORKSPACE || {};
    if (typeof leadPlanApi.runServicePlanRecord === "function" && planState.canGenerate) {
      showToast("Generating the next booked work from the recurring plan...");
      Promise.resolve(leadPlanApi.runServicePlanRecord(plan))
        .then((result) => {
          if (result?.order?.id) {
            ACTIVE_ORDER_ID = result.order.id;
            switchTab("orders");
          }
          showToast(result?.existing ? "The next booked work already existed, so it was reopened." : "Next booked work generated from the recurring plan.");
        })
        .catch((error) => {
          showToast(error?.message || "Could not generate the next booked work yet.");
        });
      return true;
    }
    ACTIVE_PLAN_ID = plan.id || "";
    switchTab("plans");
    showToast(planState.canGenerate
      ? "Recurring plan opened. Generate the next booked work from here."
      : "Recurring plan opened. Set the next run timing before generating the next booked work.");
    return true;
  }

  function openCustomerRetentionAction(action, customer, blueprint = (typeof currentWorkspaceBlueprint === "function" ? currentWorkspaceBlueprint() : { business: { key: "service_business" } }), options = {}) {
    if (!customer) return false;
    if (action === "generate-next-order") {
      return openCustomerPlanOrder(customer, blueprint);
    }
    if (action === "reactivate-repeat") {
      openCustomerBookingDraft(customer, blueprint);
      return true;
    }
    if (action === "request") {
      openCustomerRequestDraft(customer, options.requestOptions || {}, blueprint);
      return true;
    }
    if (action === "create-request") {
      return createCustomerRequestRecord(customer, options.requestOptions || {}, blueprint);
    }
    if (action === "open-reactivation-customer") {
      ACTIVE_CUSTOMER_ID = customer.id || "";
      CUSTOMER_CREATING = false;
      switchTab("customers");
      return true;
    }
    return false;
  }

  function openCustomerRecordTab(tab, recordId) {
    if (!recordId) return;
    if (tab === "leads") ACTIVE_LEAD_ID = recordId;
    if (tab === "bids") ACTIVE_BID_ID = recordId;
    if (tab === "orders") ACTIVE_ORDER_ID = recordId;
    if (tab === "jobs") ACTIVE_JOB_ID = recordId;
    if (tab === "payments") ACTIVE_PAYMENT_ID = recordId;
    switchTab(tab);
  }

  async function archiveCustomer(customerId) {
    if (!(await showConfirmModal("Archive this customer? They will be hidden from the active list.", "Archive", "Cancel"))) return;
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/manage-customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ id: customerId, is_deleted: true }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to archive customer");
      CUSTOMERS_CACHE = CUSTOMERS_CACHE.filter((c) => c.id !== customerId);
      ACTIVE_CUSTOMER_ID = null;
      CUSTOMER_CREATING = false;
      renderCustomersList(customerSearch?.value || "");
      showToast("Customer archived.");
    } catch (err) {
      showToast("Error: " + err.message);
    }
  }

  async function renderCustomerDetailWorkspace(customerIdValue, customer) {
    if (!customerDetailWrap) return;
    global.CURRENT_CUSTOMER_DETAIL_CUSTOMER = customer || null;
    if (!customer) {
      customerDetailWrap.innerHTML = `
        <div class="detail-card">
          <div class="kicker">${escapeHtml(CUSTOMER_CREATING ? "Customer intake" : "Customer workbench")}</div>
          <div><strong>${escapeHtml(CUSTOMER_CREATING ? "Create the account before the work gets messy." : "Select a customer to open the full record.")}</strong></div>
          <div class="detail-copy">${escapeHtml(CUSTOMER_CREATING
            ? "This record becomes the place to attach requests, proposals, jobs, payment history, and every note the team learns over time."
            : "Once you select a customer, this workbench shows profile details, linked work, money state, and recent activity from one place.")}</div>
        </div>
      `;
      return;
    }

    {
      const workbenchInteractions = await fetchCustomerInteractions(customerIdValue);
      const workbenchContext = normalizeCustomerWorkbenchContext({
        customer,
        customerIdValue,
        interactions: workbenchInteractions,
      });
      const {
        customerRequestsRows: workbenchRequests,
        customerBidRows: workbenchBids,
        customerOrders: workbenchOrders,
        customerJobsRows: workbenchJobs,
        customerPayments: workbenchPayments,
        balance: workbenchBalance,
        openRequestsCount: workbenchOpenRequests,
        openProposalCount: workbenchOpenProposals,
        activeOrderCount: workbenchActiveOrders,
        activeJobCount: workbenchActiveJobs,
        latestInteraction: workbenchLatestInteraction,
        knownAddresses: workbenchAddresses,
        lastTouchValue: workbenchLastTouch,
      } = workbenchContext;
      const workbenchAddress = customerDisplayAddress(customer);
      const hasActiveOrders = CRM_ORDERS_CACHE.some((o) => o.customer_id === customerIdValue && !["completed", "cancelled", "archived"].includes(String(o.status || "").toLowerCase()));
      const hasActiveJobs = JOBS_CACHE.some((job) => job.customer_id === customerIdValue && !["completed", "cancelled", "archived"].includes(String(job.status || "").toLowerCase()));
      const customerQuickActions = [
        { label: "Edit details", className: "btn btn-ghost", data: { "customer-action": "edit" } },
        { label: "New request", className: "btn btn-primary", data: { "customer-action": "request" } },
        { label: "Draft proposal", className: "btn btn-ghost", data: { "customer-action": "bid" } },
        { label: "Money panel", className: "btn btn-ghost", data: { "customer-action": "money" } },
        { label: "Add note", className: "btn btn-ghost", data: { "customer-action": "note" } },
      ];
      if (!hasActiveOrders && !hasActiveJobs) {
        customerQuickActions.push({
          label: "Archive customer",
          className: "btn btn-ghost btn-compact customer-archive-action u-color-warn",
          data: { "customer-action": "archive" },
        });
      }

      workbenchContext.lastAppKey = readCustomerWorkbenchLastApp(customerIdValue);
      global.CURRENT_CUSTOMER_DETAIL_CONTEXT = workbenchContext;

      customerDetailWrap.innerHTML = `
        <div class="customer-record-shell">
          <div class="customer-record-shell__hero">
            ${renderRecordHeroCard({
              eyebrow: "Customer record",
              title: customerPrimaryDisplayLabel(customer),
              badges: [
                { label: `${workbenchOpenRequests} open request${workbenchOpenRequests === 1 ? "" : "s"}` },
                { label: `${workbenchOpenProposals} live proposal${workbenchOpenProposals === 1 ? "" : "s"}` },
                { label: `${workbenchActiveOrders + workbenchActiveJobs} active work item${workbenchActiveOrders + workbenchActiveJobs === 1 ? "" : "s"}` },
                workbenchBalance > 0 ? { label: `${formatUsd(workbenchBalance)} open`, tone: "pill-bad" } : { label: "No balance due", tone: "pill-on" },
              ],
              meta: [
                customerContactSummary(customer),
                workbenchAddress,
              ],
              description: "Keep requests, pricing, field work, and money follow-through attached to one clean account record.",
              summary: [
                { label: "Open requests", value: String(workbenchOpenRequests), note: "Needs response or scope" },
                { label: "Open proposals", value: String(workbenchOpenProposals), note: "Still moving toward approval" },
                { label: "Booked + active work", value: String(workbenchActiveOrders + workbenchActiveJobs), note: "Execution or follow-through still open" },
                { label: "Outstanding balance", value: formatUsd(workbenchBalance), note: "Billed work not fully collected" },
              ],
            })}
          </div>
          ${renderCustomerActionCard({
            customer,
            knownAddresses: workbenchAddresses,
            openRequestsCount: workbenchOpenRequests,
            openProposalCount: workbenchOpenProposals,
            activeOrderCount: workbenchActiveOrders,
            activeJobCount: workbenchActiveJobs,
            balance: workbenchBalance,
            lastTouchValue: workbenchLastTouch,
            latestInteraction: workbenchLatestInteraction,
            customerIdValue,
            actions: customerQuickActions,
          })}
          ${renderCustomerWorkbenchLauncher(workbenchContext)}
          ${renderCustomerOverviewCard({
            customer,
            knownAddresses: workbenchAddresses,
            customerRequestsRows: workbenchRequests,
            customerBidRows: workbenchBids,
            customerOrders: workbenchOrders,
            customerJobsRows: workbenchJobs,
            customerPayments: workbenchPayments,
            balance: workbenchBalance,
          })}
          <div class="customer-record-shell__support-grid">
            ${renderCustomerRecordFocusCard()}
            ${renderCustomerRetentionReactivationCard(workbenchContext)}
          </div>
        </div>
      `;

      customerDetailWrap.querySelectorAll("[data-customer-action]").forEach((button) => {
        button.addEventListener("click", () => {
          handleCustomerWorkbenchAction(button.getAttribute("data-customer-action") || "", workbenchContext);
        });
      });

      customerDetailWrap.querySelectorAll("[data-customer-app-open]").forEach((button) => {
        button.addEventListener("click", () => {
          openCustomerWorkbenchApp(button.getAttribute("data-customer-app-open") || "", workbenchContext);
        });
      });

      customerDetailWrap.querySelectorAll("[data-customer-open-tab][data-customer-open-id]").forEach((button) => {
        button.addEventListener("click", () => {
          const tab = button.getAttribute("data-customer-open-tab") || "";
          const recordId = button.getAttribute("data-customer-open-id") || "";
          if (tab && recordId) openCustomerRecordTab(tab, recordId);
        });
      });
      customerDetailWrap.querySelector("#btnRunCustomerRetentionReview")?.addEventListener("click", () => {
        runCustomerRetentionReactivationReview(customer).catch(console.error);
      });
      customerDetailWrap.querySelector("#btnOpenCustomerRetentionPrimary")?.addEventListener("click", () => {
        const primaryRef = customerRetentionPrimaryRef(CUSTOMER_RETENTION_REACTIVATION_CACHE[String(customer.id || "").trim()]?.report?.findings?.[0] || {});
        openCustomerRetentionRecordRef(primaryRef);
      });
      customerDetailWrap.querySelectorAll("[data-customer-retention-open-record][data-customer-retention-record-id]").forEach((button) => {
        button.addEventListener("click", () => {
          openCustomerRetentionRecordRef({
            record_type: button.getAttribute("data-customer-retention-open-record") || "",
            record_id: button.getAttribute("data-customer-retention-record-id") || "",
            label: button.textContent || "",
          });
        });
      });

      return;
    }

    const customerRequestsRows = customerRequests(customerIdValue).slice(0, 12);
    const customerBidRows = customerBids(customerIdValue).slice(0, 12);
    const customerJobsRows = customerJobs(customerIdValue).slice(0, 12);
    const customerOrders = CRM_ORDERS_CACHE
      .filter((o) => o.customer_id === customerIdValue && !o.is_deleted)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
      .slice(0, 12);
    const interactions = await fetchCustomerInteractions(customerIdValue);
    const customerPayments = sortedPayments(PAYMENTS_CACHE.filter((p) => p.customer_id === customerIdValue)).slice(0, 12);
    const totalBilled = customerOrders.reduce((sum, order) => sum + Number(order.total_cents || 0), 0);
    const totalPaid = customerPayments.reduce((sum, payment) => sum + Math.max(0, paymentRevenueContributionCents(payment)), 0);
    const balance = Math.max(0, totalBilled - totalPaid);
    const openRequestsCount = customerRequestsRows.filter((lead) => !["won", "closed", "archived", "cancelled"].includes(String(lead.status || "").toLowerCase())).length;
    const openProposalCount = customerBidRows.filter((bid) => !["won", "lost", "archived", "rejected"].includes(String(bid.status || "").toLowerCase())).length;
    const activeOrderCount = customerOrders.filter((order) => !["completed", "cancelled", "archived"].includes(String(order.status || "").toLowerCase())).length;
    const activeJobCount = customerJobsRows.filter((job) => !["completed", "cancelled", "archived"].includes(String(job.status || "").toLowerCase())).length;
    const address = customerDisplayAddress(customer);
    const latestInteraction = interactions[0] || null;
    const latestPayment = customerPayments[0] || null;
    const collectionGuidance = customerCollectionGuidance(customer, customerOrders, customerPayments, balance);
    const blueprint = typeof currentWorkspaceBlueprint === "function"
      ? currentWorkspaceBlueprint()
      : { business: { key: "service_business" } };
    const nextMoveGuidance = customerRelationshipGuidance({
      customer,
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      balance,
      latestInteraction,
      latestPayment,
      blueprint,
    });
    const reactivationActions = customerReactivationActions({
      customer,
      openRequestsCount,
      openProposalCount,
      activeOrderCount,
      activeJobCount,
      blueprint,
    });
    const postWorkGuidance = customerPostWorkGuidance({
      customer,
      customerOrders,
      customerJobs: customerJobsRows,
      balance,
      blueprint,
    });
    const postWorkActions = postWorkGuidance && balance <= 0
      ? customerRetentionWorkflowActions({
          customer,
          openRequestsCount,
          openProposalCount,
          activeOrderCount,
          activeJobCount,
          blueprint,
          includeGenerateWork: true,
          includeSchedule: true,
          includeRequest: true,
          requestAction: "create-request",
          requestLabel: customerCreateRequestActionLabel(blueprint),
          includeOpenCustomer: false,
          primaryClassName: "btn btn-primary",
          secondaryClassName: "btn btn-ghost",
        })
      : [];
    const lastTouchValue = customer.last_contact_at || latestInteraction?.created_at || "";
    const knownAddresses = customerKnownAddresses(customerIdValue, customer);
    const activityTimeline = customerActivityTimeline({
      customerRequestsRows,
      customerBidRows,
      customerOrders,
      customerJobsRows,
      customerPayments,
      interactions,
    });
    const hasActiveOrders = CRM_ORDERS_CACHE.some((o) => o.customer_id === customerIdValue && !["completed", "cancelled", "archived"].includes(String(o.status || "").toLowerCase()));
    const hasActiveJobs = JOBS_CACHE.some((job) => job.customer_id === customerIdValue && !["completed", "cancelled", "archived"].includes(String(job.status || "").toLowerCase()));
    const customerQuickActions = [
      { label: "Edit details", className: "btn btn-ghost", data: { "customer-action": "edit" } },
      { label: "New request", className: "btn btn-primary", data: { "customer-action": "request" } },
      { label: "Draft proposal", className: "btn btn-ghost", data: { "customer-action": "bid" } },
      { label: "Record payment", className: "btn btn-ghost", data: { "customer-action": "payment" } },
      { label: "Add note", className: "btn btn-ghost", data: { "customer-action": "note" } },
    ];
    if (!hasActiveOrders && !hasActiveJobs) {
      customerQuickActions.push({
        label: "Archive customer",
        className: "btn btn-ghost btn-compact customer-archive-action u-color-warn",
        data: { "customer-action": "archive" },
      });
    }

    const renderWorkflowList = (rows, options = {}) => {
      if (!rows.length) return `<div class="empty-note">${escapeHtml(options.empty || "Nothing here yet.")}</div>`;
      return `
        <div class="customer-flow-list">
          ${rows.map((row) => {
            const title = options.title ? options.title(row) : "Open record";
            const meta = options.meta ? options.meta(row) : "";
            const badge = options.badge ? options.badge(row) : "";
            return `
              <button type="button" class="customer-flow-item" data-customer-open-tab="${escapeAttr(options.tab || "")}" data-customer-open-id="${escapeAttr(row.id || "")}">
                <span class="customer-flow-item__copy">
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(meta)}</span>
                </span>
                ${badge ? `<span class="pill">${escapeHtml(badge)}</span>` : ""}
              </button>
            `;
          }).join("")}
        </div>
      `;
    };

    customerDetailWrap.innerHTML = `
      ${renderRecordHeroCard({
        eyebrow: "Customer record",
        title: customerPrimaryDisplayLabel(customer),
        badges: [
          { label: `${openRequestsCount} open request${openRequestsCount === 1 ? "" : "s"}` },
          { label: `${openProposalCount} live proposal${openProposalCount === 1 ? "" : "s"}` },
          { label: `${activeOrderCount + activeJobCount} active work item${activeOrderCount + activeJobCount === 1 ? "" : "s"}` },
          balance > 0 ? { label: `${formatUsd(balance)} open`, tone: "pill-bad" } : { label: "No balance due", tone: "pill-on" },
        ],
        meta: [
          customer.company_name && customer.name ? `Primary contact: ${customer.name}` : customerContactSummary(customer),
          `Preferred contact: ${customer.preferred_contact || "email"}`,
          address,
          customer.lead_source ? `Lead source: ${titleCaseWords(String(customer.lead_source).replace(/_/g, " "))}` : "",
        ],
        description: "Open the customer once, then move requests, pricing, field work, and payment follow-through from the same record.",
        summary: [
          { label: "Open requests", value: String(openRequestsCount), note: "Needs response or scope" },
          { label: "Open proposals", value: String(openProposalCount), note: "Still moving toward approval" },
          { label: "Booked + active work", value: String(activeOrderCount + activeJobCount), note: "Execution or follow-through still open" },
          { label: "Outstanding balance", value: formatUsd(balance), note: "Billed work not fully collected" },
        ],
      })}
      ${renderRecordActionRail({
        eyebrow: "Quick actions",
        title: "Move the relationship forward",
        description: "Start the next piece of work, collect money, or capture what just happened without leaving this customer record.",
        actions: customerQuickActions,
      })}
      ${renderCustomerJumpRow()}
      <div class="customer-overview-grid">
        ${renderCustomerProfileCard(customer, {
          knownAddresses,
          latestInteraction,
          lastTouchValue,
        })}
        ${renderCustomerFootprintCard({
          customer,
          customerRequestsRows,
          customerBidRows,
          customerOrders,
          customerJobsRows,
          customerPayments,
          balance,
          knownAddresses,
        })}
      </div>
      ${renderCustomerRecordFocusCard()}

      <div class="customer-flow-grid" id="customerWorkflowSection">
        <div class="customer-flow-card">
          <div class="customer-flow-card__head">
            <div>
              <div class="kicker">Step 1</div>
              <h3>Requests</h3>
            </div>
            <span class="pill">${escapeHtml(String(customerRequestsRows.length))}</span>
          </div>
          <p>Keep every new piece of work attached to this customer, then move it into pricing without rebuilding the record.</p>
          <div class="customer-action-row">
            <button type="button" class="btn btn-primary" data-customer-action="request">New request</button>
            <button type="button" class="btn btn-ghost" data-customer-action="requests">Open requests</button>
          </div>
          ${renderWorkflowList(customerRequestsRows.slice(0, 3), {
            tab: "leads",
            empty: "No requests yet. Start here when a new job comes in.",
            title: (lead) => lead.contact_name || lead.title || lead.requested_service_type || "Request",
            meta: (lead) => `${titleCaseWords(String(lead.status || "new"))} | ${lead.requested_service_type || "Service request"}`,
            badge: (lead) => lead.requested_service_type || "Request",
          })}
        </div>

        <div class="customer-flow-card">
          <div class="customer-flow-card__head">
            <div>
              <div class="kicker">Step 2</div>
              <h3>Proposals</h3>
            </div>
            <span class="pill">${escapeHtml(String(customerBidRows.length))}</span>
          </div>
          <p>Draft the quote, adjust line items, and keep approval status visible before the work gets scheduled.</p>
          <div class="customer-action-row">
            <button type="button" class="btn btn-primary" data-customer-action="bid">Draft proposal</button>
            <button type="button" class="btn btn-ghost" data-customer-action="bids">Open proposals</button>
          </div>
          ${renderWorkflowList(customerBidRows.slice(0, 3), {
            tab: "bids",
            empty: "No proposals yet. Draft one straight from this customer record.",
            title: (bid) => bid.title || "Proposal",
            meta: (bid) => `${titleCaseWords(String(bid.status || "draft"))} | ${formatDateTime(bid.updated_at || bid.created_at)}`,
            badge: (bid) => formatUsd(bidGrandTotalCents(bid)),
          })}
        </div>

        <div class="customer-flow-card">
          <div class="customer-flow-card__head">
            <div>
              <div class="kicker">Step 3</div>
              <h3>Booked work</h3>
            </div>
            <span class="pill">${escapeHtml(String(customerOrders.length))}</span>
          </div>
          <p>See approved work, scheduled work, and what is still waiting on field execution or customer action.</p>
          <div class="customer-action-row">
            <button type="button" class="btn btn-ghost" data-customer-action="orders">Open orders</button>
          </div>
          ${renderWorkflowList(customerOrders.slice(0, 3), {
            tab: "orders",
            empty: "No booked work yet. Approved proposals will land here.",
            title: (order) => order.title || order.customer_name || "Order",
            meta: (order) => `${titleCaseWords(String(order.status || "new"))} | ${order.scheduled_date || getScheduledDateFromOrder(order) || "No scheduled date"}`,
            badge: (order) => formatUsd(order.total_cents || 0),
          })}
        </div>

        <div class="customer-flow-card">
          <div class="customer-flow-card__head">
            <div>
              <div class="kicker">Step 4</div>
              <h3>Active jobs</h3>
            </div>
            <span class="pill">${escapeHtml(String(customerJobsRows.length))}</span>
          </div>
          <p>Track field execution, notes, proof, and completion without losing the customer context.</p>
          <div class="customer-action-row">
            <button type="button" class="btn btn-ghost" data-customer-action="jobs">Open jobs</button>
          </div>
          ${renderWorkflowList(customerJobsRows.slice(0, 3), {
            tab: "jobs",
            empty: "No jobs yet. Once work is ready for the field, it shows up here.",
            title: (job) => job.title || "Job",
            meta: (job) => `${titleCaseWords(String(job.status || "scheduled"))} | ${job.scheduled_date || "No scheduled date"}`,
            badge: (job) => job.service_type || "Execution",
          })}
        </div>

        <div class="customer-flow-card">
          <div class="customer-flow-card__head">
            <div>
              <div class="kicker">Step 5</div>
              <h3>Money</h3>
            </div>
            <span class="pill">${formatUsd(balance)}</span>
          </div>
          <p>Collections stay close to the work so the operator can see what has been billed, what got paid, and what still needs attention.</p>
          <div class="customer-action-row">
            <button type="button" class="btn btn-primary" data-customer-action="payment">Record payment</button>
            <button type="button" class="btn btn-ghost" data-customer-action="payments">Open payments</button>
          </div>
          <div class="detail-copy u-mt-10">${escapeHtml(collectionGuidance.description)}</div>
          <div class="customer-money-grid">
            <div class="customer-money-card">
              <span>Total billed</span>
              <strong>${formatUsd(totalBilled)}</strong>
            </div>
            <div class="customer-money-card">
              <span>Total paid</span>
              <strong>${formatUsd(totalPaid)}</strong>
            </div>
          </div>
          ${renderWorkflowList(customerPayments.slice(0, 3), {
            tab: "payments",
            empty: "No payments recorded yet.",
            title: (payment) => `${formatPaymentMode(payment.payment_mode)} | ${titleCaseWords(String(payment.status || "paid"))}`,
            meta: (payment) => formatDateTime(payment.paid_at || payment.created_at || payment.updated_at),
            badge: (payment) => formatUsd(paymentAmountCents(payment)),
          })}
        </div>
      </div>

      <div class="grid two u-mt-14" id="customerFollowThroughSection">
        <div class="detail-card customer-next-step-card">
          <div class="kicker">Best next move</div>
          <div><strong>${escapeHtml(nextMoveGuidance.title)}</strong></div>
          <div class="detail-copy">${escapeHtml(nextMoveGuidance.description)}</div>
          <div class="workspace-chip-row u-mt-10">
            <span class="pill ${balance > 0 ? "pill-bad" : "pill-good"}">${escapeHtml(balance > 0 ? `${formatUsd(balance)} still open` : "Nothing outstanding")}</span>
            <span class="pill">${escapeHtml(lastTouchValue ? `Last touch ${formatDateTime(lastTouchValue)}` : "No touchpoint logged yet")}</span>
          </div>
          <div class="memory-checklist">
            ${nextMoveGuidance.items.map((item) => `
              <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
                <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
                <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible here.")}</div>
              </div>
            `).join("")}
          </div>
          ${reactivationActions.length ? `
            <div class="customer-action-row action-row--wrap u-mt-10">
              ${reactivationActions.map((action) => `
                <button type="button" class="${escapeAttr(action.className || "btn btn-ghost")}" data-customer-action="${escapeAttr(action.data?.["customer-action"] || "")}">${escapeHtml(action.label || "Take action")}</button>
              `).join("")}
            </div>
          ` : ""}
        </div>
        ${postWorkGuidance ? `
          <div class="detail-card customer-next-step-card">
            <div class="kicker">After the work wraps</div>
            <div><strong>${escapeHtml(postWorkGuidance.title)}</strong></div>
            <div class="detail-copy">${escapeHtml(postWorkGuidance.description)}</div>
            <div class="memory-checklist">
              ${postWorkGuidance.items.map((item) => `
                <div class="memory-checklist__item ${item.ready ? "memory-checklist__item--ready" : ""} ${item.tone === "warn" ? "memory-checklist__item--warn" : ""}">
                  <div class="memory-checklist__label">${escapeHtml(item.label || "Next step")}</div>
                  <div class="memory-checklist__note">${escapeHtml(item.note || "Keep the next move visible here.")}</div>
                </div>
              `).join("")}
            </div>
            ${postWorkActions.length ? `
              <div class="customer-action-row action-row--wrap u-mt-10">
                ${postWorkActions.map((action) => `
                  <button type="button" class="${escapeAttr(action.className || "btn btn-ghost")}" data-customer-action="${escapeAttr(action.action === "reactivate-repeat" ? "booking" : (action.action === "generate-next-order" ? "plan-order" : action.action))}">${escapeHtml(action.label || "Take action")}</button>
                `).join("")}
              </div>
            ` : ""}
          </div>
        ` : ""}
        ${renderRecordFollowThroughCard({
          eyebrow: "Follow-through",
          title: "Keep the relationship warm and collectible",
          description: "Use one place to log touchpoints, see the money picture, and keep the next customer-facing step obvious.",
          summary: [
            { label: "Last touch", value: lastTouchValue ? formatDateTime(lastTouchValue) : "Not recorded", note: latestInteraction ? customerInteractionLabel(latestInteraction.type) : "No interaction logged yet" },
            { label: "Lifetime value", value: formatUsd(customerLifetimeValueCents(customer)), note: "Best available paid history for this customer" },
            { label: "Open balance", value: formatUsd(balance), note: balance > 0 ? "Needs collection follow-through" : "Nothing outstanding" },
            { label: "Recent payment", value: latestPayment ? formatUsd(paymentAmountCents(latestPayment)) : "None yet", note: latestPayment ? formatDateTime(latestPayment.paid_at || latestPayment.created_at || latestPayment.updated_at) : "No payment recorded yet" },
          ],
          controlsHtml: `
            <div class="row">
              <select id="customerInteractionType" class="customer-follow-through-controls__type">
                ${customerInteractionOptionsMarkup("note")}
              </select>
              <input id="customerInteractionSummary" class="input customer-follow-through-controls__summary" placeholder="${escapeHtml(customerInteractionPlaceholder("note"))}" />
              <button id="btnAddCustomerInteraction" class="btn btn-primary" type="button">Add interaction</button>
            </div>
          `,
          actions: [
            { label: "Record payment", className: "btn btn-primary", data: { "customer-action": "payment" } },
            { label: "Open payments", className: "btn btn-ghost", data: { "customer-action": "payments" } },
            { label: "Add note", className: "btn btn-ghost", data: { "customer-action": "note" } },
            { label: "Open jobs", className: "btn btn-ghost", data: { "customer-action": "jobs" } },
          ],
          timelineHtml: interactions.length ? `
            <div class="list">
              ${interactions.slice(0, 6).map((i) => `
                <div class="list-item">
                  <div class="li-main">
                    <div class="li-title">${escapeHtml(customerInteractionLabel(i.type))}</div>
                    <div class="li-sub muted">${escapeHtml(i.summary || "No summary")}</div>
                  </div>
                  <div class="li-meta">
                    <span class="pill">${escapeHtml(formatDateTime(i.created_at))}</span>
                  </div>
                </div>
              `).join("")}
            </div>
          ` : `<div class="muted">No interactions logged yet.</div>`,
        })}

        <div class="card">
          <div class="card-hd">
            <strong>Recent transaction history</strong>
            <span class="muted">A compact money view without leaving the customer.</span>
          </div>
          <div class="card-bd">
            ${customerOrders.length ? `
              <div class="table u-mb-10">
                <div class="tr th"><div>Order</div><div class="right">Amount</div><div class="right">Status</div></div>
                ${customerOrders.slice(0, 4).map((order) => `
                  <div class="tr">
                    <div>${escapeHtml(order.title || order.customer_name || "Order")}</div>
                    <div class="right">${formatUsd(order.total_cents || 0)}</div>
                    <div class="right"><span class="pill">${escapeHtml(titleCaseWords(String(order.status || "new")))}</span></div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="muted u-mb-10">No orders yet for this customer.</div>`}
            ${customerPayments.length ? `
              <div class="table">
                <div class="tr th"><div>Date</div><div class="right">Amount</div><div>Mode</div></div>
                ${customerPayments.slice(0, 4).map((payment) => `
                  <div class="tr">
                    <div class="muted muted-small">${escapeHtml(formatDateTime(payment.paid_at || payment.created_at || payment.updated_at))}</div>
                    <div class="right">${formatUsd(paymentAmountCents(payment))}</div>
                    <div>${escapeHtml(formatPaymentMode(payment.payment_mode))}</div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="muted">No payments recorded yet.</div>`}
          </div>
        </div>
      </div>
      ${renderCustomerActivityTimelineCard(activityTimeline)}
    `;

    customerDetailWrap.querySelectorAll("[data-customer-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-customer-action");
        if (action === "edit") {
          const customerWorkspaceApi = global.PROOFLINK_OPERATOR_CUSTOMERS_WORKSPACE || {};
          if (typeof customerWorkspaceApi.openCustomerRecord === "function") {
            customerWorkspaceApi.openCustomerRecord(customerIdValue, {
              openEditor: true,
              focusFieldId: customer?.company_name ? "customerName" : "customerCompanyName",
              scrollIntoView: true,
            });
          }
          return;
        }
        if (action === "request") return openCustomerRetentionAction("request", customer, blueprint);
        if (action === "create-request") return openCustomerRetentionAction("create-request", customer, blueprint, {
          requestOptions: {
            message: "Follow-up request created from the customer record.",
            successMessage: "Follow-up request created from the customer record.",
            pendingMessage: "Creating follow-up request...",
            sourceRecordType: "customer",
            sourceRecordId: customerIdValue,
          },
        });
        if (action === "bid") return openCustomerBidDraft(customer);
        if (action === "booking") return openCustomerRetentionAction("reactivate-repeat", customer, blueprint);
        if (action === "plan-order") return openCustomerRetentionAction("generate-next-order", customer, blueprint);
        if (action === "payment") return openCustomerPaymentDraft(customerIdValue);
        if (action === "requests") return switchTab("leads");
        if (action === "bids") return switchTab("bids");
        if (action === "orders") return switchTab("orders");
        if (action === "jobs") return switchTab("jobs");
        if (action === "payments") return switchTab("payments");
        if (action === "note") {
          const summaryInput = $("customerInteractionSummary");
          summaryInput?.focus?.();
          summaryInput?.scrollIntoView?.({ behavior: "smooth", block: "center" });
          return;
        }
        if (action === "archive") return archiveCustomer(customerIdValue);
      });
    });

    customerDetailWrap.querySelectorAll("[data-customer-jump-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.getAttribute("data-customer-jump-target") || "";
        document.getElementById(targetId)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      });
    });

    customerDetailWrap.querySelectorAll("[data-customer-open-tab][data-customer-open-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.getAttribute("data-customer-open-tab") || "";
        const recordId = button.getAttribute("data-customer-open-id") || "";
        if (tab && recordId) openCustomerRecordTab(tab, recordId);
      });
    });

    $("customerInteractionType")?.addEventListener("change", () => {
      const type = $("customerInteractionType")?.value || "note";
      const summaryInput = $("customerInteractionSummary");
      if (summaryInput) summaryInput.placeholder = customerInteractionPlaceholder(type);
    });

    $("btnAddCustomerInteraction")?.addEventListener("click", async () => {
      const type = $("customerInteractionType")?.value || "note";
      const summary = $("customerInteractionSummary")?.value?.trim() || "";
      if (!summary) return;

      const nowIso = new Date().toISOString();
      const { error } = await sb.from("customer_interactions").insert(withTenantScope({
        operator_id: opId(),
        customer_id: customerIdValue,
        type,
        summary,
        metadata: {},
        created_at: nowIso,
      }));
      if (error) {
        notifyOperator(error.message || String(error));
        return;
      }

      await sb.from("customers")
        .update({ last_contact_at: nowIso, updated_at: nowIso })
        .eq("id", customerIdValue).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID);

      CUSTOMER_CREATING = false;
      ACTIVE_CUSTOMER_ID = customerIdValue;
      await fetchCustomers();
      renderCustomersList(customerSearch?.value || "");
      renderDashboard();
      renderMoney().catch(console.error);
    });
  }

  const helpers = {
    customerDisplayAddress,
    customerRequests,
    customerBids,
    bidGrandTotalCents,
    customerJobs,
    customerKnownAddresses,
    customerPrimaryDisplayLabel,
    customerContactSummary,
    customerActivityTimeline,
    customerMemoryChecklist,
    customerCollectionGuidance,
    customerWorkbenchDraftKey,
    readCustomerWorkbenchDraft,
    writeCustomerWorkbenchDraft,
    clearCustomerWorkbenchDraft,
    latestCustomerWorkbenchDraftForCustomer,
    customerWorkbenchAppCards,
    customerWorkbenchStageSummary,
    renderCustomerOperatorBriefCard,
    renderCustomerActionCard,
    renderCustomerOverviewCard,
    renderCustomerWorkbenchLauncher,
    handleCustomerWorkbenchAction,
    openCustomerWorkbenchApp,
    customerRepeatCadenceDays,
    customerRepeatCadenceInsight,
    customerRepeatSignalValue,
    customerRepeatNextTouchValue,
    customerRepeatPlanState,
    customerRenewalRiskItem,
    customerRelationshipGuidance,
    customerScheduleActionLabel,
    customerRequestActionLabel,
    customerCreateRequestActionLabel,
    customerGenerateWorkActionLabel,
    customerRetentionWorkflowActions,
    customerReactivationActions,
    customerPostWorkGuidance,
    customerFollowUpRequestDraft,
    openCustomerRequestDraft,
    createCustomerRequestRecord,
    openCustomerBidDraft,
    openCustomerBookingDraft,
    openCustomerPlanOrder,
    openCustomerPaymentDraft,
    openCustomerRetentionAction,
    runCustomerRetentionReactivationReview,
    renderCustomerRetentionReactivationCard,
    renderCustomerRetentionReactivationReport,
    openCustomerRetentionRecordRef,
    openCustomerRecordTab,
    archiveCustomer,
    renderCustomerDetailWorkspace,
  };

  global.PROOFLINK_OPERATOR_CUSTOMER_DETAIL = {
    ...(global.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {}),
    ...helpers,
  };
  Object.assign(global, helpers);
})(window);
