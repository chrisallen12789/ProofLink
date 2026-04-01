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


  const CUSTOMER_WORKSPACE_FILTERS_BY_CUSTOMER = new Map();

  function customerWorkspaceQueryString(customerIdValue, filters = {}) {
    if (!customerIdValue) return "";
    const params = [
      `customer_id=${encodeURIComponent(customerIdValue)}`,
      `include_closed=${filters.include_closed === false ? "false" : "true"}`,
    ];
    if (filters.building) params.push(`building=${encodeURIComponent(filters.building)}`);
    if (filters.job_type) params.push(`job_type=${encodeURIComponent(filters.job_type)}`);
    if (filters.date_from) params.push(`date_from=${encodeURIComponent(filters.date_from)}`);
    if (filters.date_to) params.push(`date_to=${encodeURIComponent(filters.date_to)}`);
    if (filters.search) params.push(`search=${encodeURIComponent(filters.search)}`);
    return params.join("&");
  }

  function getCustomerWorkspaceFilters(customerIdValue) {
    return CUSTOMER_WORKSPACE_FILTERS_BY_CUSTOMER.get(customerIdValue) || {};
  }

  function setCustomerWorkspaceFilters(customerIdValue, filters = {}) {
    if (!customerIdValue) return;
    CUSTOMER_WORKSPACE_FILTERS_BY_CUSTOMER.set(customerIdValue, {
      ...getCustomerWorkspaceFilters(customerIdValue),
      ...filters,
    });
  }

  function clearCustomerWorkspaceFilters(customerIdValue) {
    if (!customerIdValue) return;
    CUSTOMER_WORKSPACE_FILTERS_BY_CUSTOMER.delete(customerIdValue);
  }

  async function fetchCustomerWorkspaceData(customerIdValue, filters = {}) {
    if (!customerIdValue || typeof fetch !== "function") return null;
    try {
      const tok = await getAccessToken();
      const query = customerWorkspaceQueryString(customerIdValue, filters);
      const response = await fetch(`/.netlify/functions/get-customer-workspace?${query}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn("[customer-detail] get-customer-workspace failed:", error?.message || error);
      return null;
    }
  }

  function addDaysToIsoDate(baseDateValue, daysValue) {
    const base = String(baseDateValue || "").slice(0, 10);
    const days = Number(daysValue || 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base) || !Number.isFinite(days)) return "";
    const date = new Date(`${base}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Math.max(0, Math.round(days)));
    return date.toISOString().slice(0, 10);
  }

  async function applyCustomerJobMaintenanceWindow({ assetId, intervalDays, nextServiceDate }) {
    if (!assetId) throw new Error("Asset id is required to set maintenance window.");
    const tok = await getAccessToken();
    const response = await fetch("/.netlify/functions/manage-infrastructure-assets", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
      body: JSON.stringify({
        id: assetId,
        service_frequency_days: Number(intervalDays) || null,
        next_service_due_date: nextServiceDate || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to update maintenance window");
    }
    return payload;
  }

  function customerMaintenanceQueueBuckets(assets, now = new Date()) {
    const rows = Array.isArray(assets) ? assets : [];
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dueSoonCutoff = new Date(today);
    dueSoonCutoff.setUTCDate(dueSoonCutoff.getUTCDate() + 30);

    const overdue = [];
    const dueSoon = [];
    const scheduledLater = [];

    rows.forEach((asset) => {
      const due = String(asset?.next_service_due_date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return;
      const dueDate = new Date(`${due}T00:00:00Z`);
      const entry = {
        id: asset.id,
        asset_name: asset.asset_name || asset.asset_type || "Asset",
        building: asset.address || "Unspecified building",
        due_date: due,
      };
      if (dueDate < today) {
        overdue.push(entry);
      } else if (dueDate <= dueSoonCutoff) {
        dueSoon.push(entry);
      } else {
        scheduledLater.push(entry);
      }
    });

    overdue.sort((a, b) => a.due_date.localeCompare(b.due_date));
    dueSoon.sort((a, b) => a.due_date.localeCompare(b.due_date));
    scheduledLater.sort((a, b) => a.due_date.localeCompare(b.due_date));

    return { overdue, dueSoon, scheduledLater };
  }

  function renderCustomerWorkspaceOpsCard(workspace) {
    if (!workspace) return "";
    const buildings = Array.isArray(workspace.buildings) ? workspace.buildings.slice(0, 6) : [];
    const jobs = Array.isArray(workspace.jobs) ? workspace.jobs.slice(0, 6) : [];
    const assets = Array.isArray(workspace.assets) ? workspace.assets : [];
    const maintenanceQueue = customerMaintenanceQueueBuckets(assets);
    const summary = workspace.summary || {};

    return `
      <div class="detail-card u-mt-14">
        <div class="kicker">Customer operations hub</div>
        <div><strong>Buildings, jobs, expenses, and service cadence in one timeline.</strong></div>
        <div class="detail-copy">Use this to review service history by building and jump straight into the jobs tab for full records.</div>

        <div class="grid two u-mt-10">
          <label>
            <span class="kicker">Building filter</span>
            <input id="customerWorkspaceBuilding" class="input" value="${escapeAttr(workspace.filters?.building || "")}" placeholder="Engineering Building" />
          </label>
          <label>
            <span class="kicker">Job type filter</span>
            <input id="customerWorkspaceJobType" class="input" value="${escapeAttr(workspace.filters?.job_type || "")}" placeholder="Ejection pit cleanout" />
          </label>
          <label>
            <span class="kicker">From date</span>
            <input id="customerWorkspaceDateFrom" class="input" type="date" value="${escapeAttr(workspace.filters?.date_from || "")}" />
          </label>
          <label>
            <span class="kicker">To date</span>
            <input id="customerWorkspaceDateTo" class="input" type="date" value="${escapeAttr(workspace.filters?.date_to || "")}" />
          </label>
        </div>
        <div class="customer-action-row u-mt-10">
          <button type="button" class="btn btn-primary" id="btnApplyCustomerWorkspaceFilters">Apply filters</button>
          <button type="button" class="btn btn-ghost" id="btnClearCustomerWorkspaceFilters">Clear filters</button>
        </div>

        <div class="workspace-chip-row u-mt-10">
          <span class="pill">${escapeHtml(String(summary.total_buildings || 0))} buildings</span>
          <span class="pill">${escapeHtml(String(summary.total_assets || 0))} assets</span>
          <span class="pill">${escapeHtml(String(summary.total_jobs || 0))} jobs</span>
          <span class="pill pill-on">${escapeHtml(formatUsd(summary.total_expense_cents || 0))} expenses</span>
        </div>

        <div class="detail-card u-mt-10 customer-maintenance-queue">
          <div class="kicker">Maintenance queue</div>
          <div><strong>Know what is overdue and what is due in the next 30 days.</strong></div>
          <div class="workspace-chip-row u-mt-8">
            <span class="pill pill-bad">${escapeHtml(String(maintenanceQueue.overdue.length))} overdue</span>
            <span class="pill">${escapeHtml(String(maintenanceQueue.dueSoon.length))} due in 30 days</span>
            <span class="pill">${escapeHtml(String(maintenanceQueue.scheduledLater.length))} scheduled later</span>
          </div>
          <div class="grid two u-mt-10">
            <div>
              <div class="kicker">Overdue assets</div>
              ${maintenanceQueue.overdue.length ? `
                <div class="list u-mt-6">
                  ${maintenanceQueue.overdue.slice(0, 5).map((asset) => `
                    <div class="list-item">
                      <div class="li-main">
                        <div class="li-title">${escapeHtml(asset.asset_name)}</div>
                        <div class="li-sub muted">${escapeHtml(asset.building)}</div>
                      </div>
                      <div class="li-meta"><span class="pill pill-bad">${escapeHtml(asset.due_date)}</span></div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div class="muted u-mt-6">No overdue maintenance assets.</div>`}
            </div>
            <div>
              <div class="kicker">Due soon</div>
              ${maintenanceQueue.dueSoon.length ? `
                <div class="list u-mt-6">
                  ${maintenanceQueue.dueSoon.slice(0, 5).map((asset) => `
                    <div class="list-item">
                      <div class="li-main">
                        <div class="li-title">${escapeHtml(asset.asset_name)}</div>
                        <div class="li-sub muted">${escapeHtml(asset.building)}</div>
                      </div>
                      <div class="li-meta"><span class="pill">${escapeHtml(asset.due_date)}</span></div>
                    </div>
                  `).join("")}
                </div>
              ` : `<div class="muted u-mt-6">No assets due in the next 30 days.</div>`}
            </div>
          </div>
        </div>

        <div class="grid two u-mt-10">
          <div>
            <div class="kicker">Buildings</div>
            ${buildings.length ? `
              <div class="list u-mt-6">
                ${buildings.map((building) => `
                  <div class="list-item">
                    <div class="li-main">
                      <div class="li-title">${escapeHtml(building.building_key || "Unspecified building")}</div>
                      <div class="li-sub muted">${escapeHtml(String(building.job_count || 0))} jobs &middot; ${escapeHtml(formatUsd(building.expense_total_cents || 0))}</div>
                    </div>
                    <div class="li-meta">
                      <span class="pill">${escapeHtml(building.last_service_at ? formatDateTime(building.last_service_at) : "No service yet")}</span>
                    </div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="muted u-mt-6">No building-linked jobs yet.</div>`}
          </div>
          <div>
            <div class="kicker">Recent jobs</div>
            ${jobs.length ? `
              <div class="list u-mt-6">
                ${jobs.map((job) => {
                  const expenseRows = Array.isArray(job.expenses) ? [...job.expenses].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))) : [];
                  const photoRows = Array.isArray(job.photos) ? [...job.photos].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))) : [];
                  return `
                    <details class="detail-card u-mt-6 customer-job-detail-card">
                      <summary class="customer-job-detail-summary">
                        <span>
                          <strong>${escapeHtml(job.title || "Job")}</strong>
                          <span class="muted">${escapeHtml(job.service_address || "No building on file")} &middot; ${escapeHtml(job.job_type || "Service")}</span>
                        </span>
                        <span class="pill">${escapeHtml(job.scheduled_date || "No date")}</span>
                      </summary>

                      <div class="u-mt-10 customer-job-detail-grid">
                        <div>
                          <div class="kicker">Expenses</div>
                          <div class="muted u-mb-6">${escapeHtml(formatUsd(job.expense_total_cents || 0))} total</div>
                          ${expenseRows.length ? `
                            <div class="list">
                              ${expenseRows.slice(0, 6).map((expense) => `
                                <div class="list-item">
                                  <div class="li-main">
                                    <div class="li-title">${escapeHtml(expense.expense_type || "Expense")}</div>
                                    <div class="li-sub muted">${escapeHtml(expense.description || "No description")}</div>
                                  </div>
                                  <div class="li-meta">
                                    <span class="pill">${escapeHtml(expense.date || "")}</span>
                                    <span class="pill">${escapeHtml(formatUsd(expense.amount_cents || 0))}</span>
                                  </div>
                                </div>
                              `).join("")}
                            </div>
                          ` : `<div class="muted">No expenses captured for this job yet.</div>`}
                        </div>
                        <div>
                          <div class="kicker">Photos & docs</div>
                          <div class="muted u-mb-6">${escapeHtml(String(photoRows.length))} photo${photoRows.length === 1 ? "" : "s"} logged</div>
                          ${photoRows.length ? `
                            <div class="list">
                              ${photoRows.slice(0, 6).map((photo) => `
                                <a class="list-item" href="${escapeAttr(photo.url || "#")}" target="_blank" rel="noopener">
                                  <div class="li-main">
                                    <div class="li-title">${escapeHtml(photo.caption || "Job photo")}</div>
                                    <div class="li-sub muted">${escapeHtml(photo.created_at ? formatDateTime(photo.created_at) : "Unknown date")}</div>
                                  </div>
                                  <div class="li-meta"><span class="pill">Open</span></div>
                                </a>
                              `).join("")}
                            </div>
                          ` : `<div class="muted">No photos/docs linked yet for this job.</div>`}
                        </div>
                      </div>

                      ${job.asset_id ? `
                        <div class="u-mt-10">
                          <div class="kicker">Maintenance follow-up</div>
                          <div class="grid two u-mt-6">
                            <label>
                              <span class="muted muted-small">Recommended interval (days)</span>
                              <input class="input" id="jobMaintenanceDays_${escapeAttr(job.id || "")}" type="number" min="1" step="1" value="${escapeAttr(String(job.asset?.service_frequency_days || 90))}" />
                            </label>
                            <label>
                              <span class="muted muted-small">Next maintenance date</span>
                              <input class="input" id="jobMaintenanceDate_${escapeAttr(job.id || "")}" type="date" value="${escapeAttr(job.asset?.next_service_due_date || "")}" />
                            </label>
                          </div>
                          <div class="customer-action-row u-mt-6">
                            <button type="button" class="btn btn-primary" data-maintenance-apply="${escapeAttr(job.id || "")}" data-maintenance-asset-id="${escapeAttr(job.asset_id || "")}" data-maintenance-base-date="${escapeAttr(job.completed_at || job.scheduled_date || "")}">Save maintenance window</button>
                          </div>
                        </div>
                      ` : `<div class="muted u-mt-10">Link this job to an asset to schedule the next maintenance window.</div>`}

                      <div class="customer-action-row u-mt-10">
                        <button type="button" class="btn btn-ghost" data-customer-open-tab="jobs" data-customer-open-id="${escapeAttr(job.id || "")}">Open full job workspace</button>
                      </div>
                    </details>
                  `;
                }).join("")}
              </div>
            ` : `<div class="muted u-mt-6">No jobs yet for this customer.</div>`}
          </div>
        </div>

        ${(workspace.warnings || []).length ? `
          <div class="muted u-mt-10">${escapeHtml((workspace.warnings || []).join(" | "))}</div>
        ` : ""}
      </div>
    `;
  }



  function bindCustomerJobMaintenanceControls(customerIdValue) {
    customerDetailWrap?.querySelectorAll("[data-maintenance-apply]").forEach((button) => {
      button.addEventListener("click", async () => {
        const jobId = button.getAttribute("data-maintenance-apply") || "";
        const assetId = button.getAttribute("data-maintenance-asset-id") || "";
        const baseDate = button.getAttribute("data-maintenance-base-date") || "";
        const daysInput = $(`jobMaintenanceDays_${jobId}`);
        const dateInput = $(`jobMaintenanceDate_${jobId}`);
        const intervalDays = Number(daysInput?.value || 0);
        const computedDate = dateInput?.value || addDaysToIsoDate(baseDate, intervalDays);

        try {
          await applyCustomerJobMaintenanceWindow({
            assetId,
            intervalDays,
            nextServiceDate: computedDate,
          });
          showToast("Maintenance window saved.");
          setCustomerWorkspaceFilters(customerIdValue, { ...getCustomerWorkspaceFilters(customerIdValue) });
          await renderCustomerDetailWorkspace(customerIdValue, global.CURRENT_CUSTOMER_DETAIL_CUSTOMER);
        } catch (error) {
          notifyOperator(error?.message || String(error));
        }
      });
    });
  }

  function bindCustomerWorkspaceFilterControls(customerIdValue) {
    const applyButton = $("btnApplyCustomerWorkspaceFilters");
    const clearButton = $("btnClearCustomerWorkspaceFilters");

    applyButton?.addEventListener("click", async () => {
      const filters = {
        building: $("customerWorkspaceBuilding")?.value?.trim() || "",
        job_type: $("customerWorkspaceJobType")?.value?.trim() || "",
        date_from: $("customerWorkspaceDateFrom")?.value || "",
        date_to: $("customerWorkspaceDateTo")?.value || "",
      };
      setCustomerWorkspaceFilters(customerIdValue, filters);
      await renderCustomerDetailWorkspace(customerIdValue, global.CURRENT_CUSTOMER_DETAIL_CUSTOMER);
    });

    clearButton?.addEventListener("click", async () => {
      clearCustomerWorkspaceFilters(customerIdValue);
      await renderCustomerDetailWorkspace(customerIdValue, global.CURRENT_CUSTOMER_DETAIL_CUSTOMER);
    });
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

    const workspaceFilters = getCustomerWorkspaceFilters(customerIdValue);
    const customerWorkspaceData = await fetchCustomerWorkspaceData(customerIdValue, workspaceFilters);
    const customerWorkspaceCard = renderCustomerWorkspaceOpsCard(customerWorkspaceData);

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
      ${customerWorkspaceCard}

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

      <div class="grid two u-mt-14">
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
    `;

    bindCustomerWorkspaceFilterControls(customerIdValue);
    bindCustomerJobMaintenanceControls(customerIdValue);

    customerDetailWrap.querySelectorAll("[data-customer-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-customer-action");
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
    openCustomerRecordTab,
    archiveCustomer,
    customerWorkspaceQueryString,
    getCustomerWorkspaceFilters,
    setCustomerWorkspaceFilters,
    clearCustomerWorkspaceFilters,
    fetchCustomerWorkspaceData,
    addDaysToIsoDate,
    applyCustomerJobMaintenanceWindow,
    customerMaintenanceQueueBuckets,
    renderCustomerWorkspaceOpsCard,
    bindCustomerJobMaintenanceControls,
    bindCustomerWorkspaceFilterControls,
    renderCustomerDetailWorkspace,
  };

  global.PROOFLINK_OPERATOR_CUSTOMER_DETAIL = {
    ...(global.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {}),
    ...helpers,
  };
  Object.assign(global, helpers);
})(window);
