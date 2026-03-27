// Customer detail workflow extracted from operator.js so the operator shell
// can keep shrinking around real business domains.
(function attachOperatorCustomerDetail(global) {
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

    return map[businessKey] || customerTemplateRecordFocus().map((item) => ({
      label: "Relationship memory",
      ready: hasAny(customer?.notes, customer?.service_notes, customer?.preferences),
      note: hasAny(customer?.notes, customer?.service_notes, customer?.preferences)
        ? (customer?.service_notes || customer?.preferences || customer?.notes || item)
        : item,
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

  function renderCustomerRecordFocusCard() {
    const customer = global.CURRENT_CUSTOMER_DETAIL_CUSTOMER || null;
    const blueprint = typeof currentWorkspaceBlueprint === "function"
      ? currentWorkspaceBlueprint()
      : { business: { key: "service_business" } };
    const focus = customerMemoryChecklist(customer, blueprint);
    if (!focus.length) return "";
    return `
      <div class="detail-card detail-card--spaced">
        <div class="kicker">Business-specific memory</div>
        <div><strong>Keep the details this business depends on</strong></div>
        <div class="detail-copy">Use this customer record to hold the repeat details the team should not have to relearn on every visit.</div>
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

  function openCustomerRequestDraft(customer) {
    if (!customer) return;
    switchTab("leads");
    ACTIVE_LEAD_ID = null;
    clearLeadForm();
    renderLeadCustomerOptions(customer.id);
    if (leadCustomerId) leadCustomerId.value = customer.id;
    if (leadContactName) leadContactName.value = customer.name || "";
    if (leadContactEmail) leadContactEmail.value = customer.email || "";
    if (leadContactPhone) leadContactPhone.value = customer.phone || "";
    if (leadPreferredContact) leadPreferredContact.value = customer.preferred_contact || "phone";
    if (leadTitle) leadTitle.value = `${customer.name || "Customer"} request`;
    const address = customerDisplayAddress(customer);
    if (leadServiceAddress) leadServiceAddress.value = address === "No service address yet." ? "" : address;
    if (leadSummary) leadSummary.focus();
    setInlineMessage(leadMsg, "New request draft opened from the customer record.", "ok");
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
          <div class="kicker">Customer intake</div>
          <div><strong>Create the account before the work gets messy.</strong></div>
          <div class="detail-copy">This record becomes the place to attach requests, proposals, jobs, payment history, and every note the team learns over time.</div>
        </div>
      `;
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
    const lastTouchValue = customer.last_contact_at || latestInteraction?.created_at || "";
    const hasActiveOrders = CRM_ORDERS_CACHE.some((o) => o.customer_id === customerIdValue && !["completed", "cancelled", "archived"].includes(String(o.status || "").toLowerCase()));
    const hasActiveJobs = JOBS_CACHE.some((job) => job.customer_id === customerIdValue && !["completed", "cancelled", "archived"].includes(String(job.status || "").toLowerCase()));
    const customerQuickActions = [
      { label: "New request", className: "btn btn-primary", data: { "customer-action": "request" } },
      { label: "Draft proposal", className: "btn btn-ghost", data: { "customer-action": "bid" } },
      { label: "Record payment", className: "btn btn-ghost", data: { "customer-action": "payment" } },
      { label: "Add note", className: "btn btn-ghost", data: { "customer-action": "note" } },
    ];
    if (!hasActiveOrders && !hasActiveJobs) {
      customerQuickActions.push({
        label: "Archive customer",
        className: "btn btn-ghost",
        style: "font-size:.75rem;color:#fbbf24;",
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
        title: customer.name || "Unnamed customer",
        badges: [
          { label: `${openRequestsCount} open request${openRequestsCount === 1 ? "" : "s"}` },
          { label: `${openProposalCount} live proposal${openProposalCount === 1 ? "" : "s"}` },
          { label: `${activeOrderCount + activeJobCount} active work item${activeOrderCount + activeJobCount === 1 ? "" : "s"}` },
          balance > 0 ? { label: `${formatUsd(balance)} open`, tone: "pill-bad" } : { label: "No balance due", tone: "pill-on" },
        ],
        meta: [
          `${customer.email || "No email"} | ${customer.phone || "No phone"}`,
          `Preferred contact: ${customer.preferred_contact || "email"}`,
          address,
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
      ${renderCustomerRecordFocusCard()}

      <div class="customer-flow-grid">
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
          <div class="detail-copy" style="margin-top:10px;">${escapeHtml(collectionGuidance.description)}</div>
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

      <div class="grid two" style="margin-top:14px;">
        <div class="detail-card">
          <div class="kicker">Collection guidance</div>
          <div><strong>${escapeHtml(collectionGuidance.title)}</strong></div>
          <div class="detail-copy">${escapeHtml(collectionGuidance.description)}</div>
          <div class="workspace-chip-row" style="margin-top:10px;">
            <span class="pill ${balance > 0 ? "pill-bad" : "pill-good"}">${escapeHtml(balance > 0 ? `${formatUsd(balance)} still open` : "Nothing outstanding")}</span>
            <span class="pill">${escapeHtml(latestPayment ? `Recent payment ${formatUsd(paymentAmountCents(latestPayment))}` : "No payment recorded yet")}</span>
          </div>
        </div>
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
              <select id="customerInteractionType" style="max-width:200px;">
                ${customerInteractionOptionsMarkup("note")}
              </select>
              <input id="customerInteractionSummary" class="input" style="flex:1;max-width:none;" placeholder="${escapeHtml(customerInteractionPlaceholder("note"))}" />
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
              <div class="table" style="margin-bottom:10px;">
                <div class="tr th"><div>Order</div><div class="right">Amount</div><div class="right">Status</div></div>
                ${customerOrders.slice(0, 4).map((order) => `
                  <div class="tr">
                    <div>${escapeHtml(order.title || order.customer_name || "Order")}</div>
                    <div class="right">${formatUsd(order.total_cents || 0)}</div>
                    <div class="right"><span class="pill">${escapeHtml(titleCaseWords(String(order.status || "new")))}</span></div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="muted" style="margin-bottom:10px;">No orders yet for this customer.</div>`}
            ${customerPayments.length ? `
              <div class="table">
                <div class="tr th"><div>Date</div><div class="right">Amount</div><div>Mode</div></div>
                ${customerPayments.slice(0, 4).map((payment) => `
                  <div class="tr">
                    <div class="muted" style="font-size:.8rem;">${escapeHtml(formatDateTime(payment.paid_at || payment.created_at || payment.updated_at))}</div>
                    <div class="right">${formatUsd(paymentAmountCents(payment))}</div>
                    <div>${escapeHtml(formatPaymentMode(payment.payment_mode))}</div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="muted">No payments recorded yet.</div>`}
          </div>
        </div>
      </div>
    `;

    customerDetailWrap.querySelectorAll("[data-customer-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-customer-action");
        if (action === "request") return openCustomerRequestDraft(customer);
        if (action === "bid") return openCustomerBidDraft(customer);
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
    customerMemoryChecklist,
    customerCollectionGuidance,
    openCustomerRequestDraft,
    openCustomerBidDraft,
    openCustomerPaymentDraft,
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
