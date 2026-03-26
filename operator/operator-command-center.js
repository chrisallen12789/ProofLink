// Command-center workspace helpers extracted from operator.js so Today, money,
// workflow guidance, and pipeline orchestration live in one domain module.
function renderDashboard() {
  if (!dashboardWrap) return;

  const blueprint = currentWorkspaceBlueprint();
  const summary = workspaceSummaryData(blueprint);
  const pipeline = servicePipelineSnapshot();
  const todayActions = todayActionItems();
  const trackedClients = dashboardClientTrackerRows(todayActions);
  const followUps = buildFollowUpQueue();
  CURRENT_FOLLOW_UP_QUEUE = followUps;
  const currentExpenses = currentMonthExpenseCents();
  const quotedRevenue = quotedRevenueCents();
  const activeOfferings = PRODUCTS_CACHE.filter((p) => !!p.is_active).length;
  const topCustomer = sortedCustomers(CUSTOMERS_CACHE)[0] || null;
  const staleLeadRows = staleLeads();
  const completedUnpaid = completedUnpaidOrders();
  const duePlans = dueServicePlans();
  const depositRiskOrders = ordersMissingDeposits();
  const completedUnpaidBalance = completedUnpaid.reduce((sum, row) => sum + orderAmountDueCents(row), 0);
  const outstandingBalance = outstandingBalanceCents();
  const overdueBalance = overdueBalanceCents();
  const missingDepositBalance = depositRiskOrders.reduce((sum, row) => sum + orderDepositGapCents(row), 0);
  const orderLabel = workspaceOrderLabelLower(blueprint);
  const catalogLabel = workspaceCatalogLabelLower(blueprint);
  const hydrovacToday = isHydrovacWorkspace(blueprint) ? hydrovacDashboardSnapshot() : null;
  const alerts = [];

  if (!CUSTOMERS_CACHE.length) alerts.push("No customers are in CRM yet. As real work lands here, relationship memory and follow-up get stronger.");
  if (!CRM_ORDERS_CACHE.length) alerts.push(`No tracked ${orderLabel} exist yet. That means customer value and operational visibility are still shallow.`);
  if (!EXPENSES_CACHE.length) alerts.push("No expenses are logged yet, so profit visibility is still weak.");
  if (duePlans.length) alerts.push(`${duePlans.length} recurring plan${duePlans.length === 1 ? "" : "s"} are due right now. Generate the next work record before repeat revenue slips.`);
  if (missingDepositBalance > 0) alerts.push(`${formatUsd(missingDepositBalance)} in deposits is still open on booked work. Make the deposit expectation visible before the schedule gets ahead of the cash.`);

  const metricsHtml = window.ProofLinkAnalyticsWidgets?.renderCards
    ? window.ProofLinkAnalyticsWidgets.renderCards({
        revenueThisMonth: currentMonthRevenueCents() / 100,
        revenueLastMonth: lastMonthRevenueCents() / 100,
        orderCountThisMonth: currentMonthOrderCount(),
        averageOrderValue: averageOrderValueCents() / 100,
        newCustomersThisMonth: currentMonthCustomerCount(),
        expensesThisMonth: currentExpenses / 100,
        outstandingOrders: openOrdersCount()
      })
    : '';

  const checklistHtml = window.ProofLinkChecklistEngine?.renderServerChecklist
    ? window.ProofLinkChecklistEngine.renderServerChecklist(DASHBOARD_LAUNCH_CHECKLIST || { steps: [], percent: 0, launch_ready: false })
    : '';

  const paymentHtml = window.ProofLinkStripeReadiness?.render && DASHBOARD_PAYMENT_STATE
    ? window.ProofLinkStripeReadiness.render({
        billing_status: DASHBOARD_PAYMENT_STATE.billingStatus,
        connect_status: DASHBOARD_PAYMENT_STATE.connectStatus,
        online_payments_enabled: DASHBOARD_PAYMENT_STATE.onlinePaymentsEligible
      })
    : '';

  // â”€â”€ Onboarding checklist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const onboardingDismissed = localStorage.getItem("pl_onboarding_dismissed") === "true";
  const step1Done = CUSTOMERS_CACHE.length > 0;
  const step2Done = CRM_ORDERS_CACHE.length > 0;
  const step3Done = localStorage.getItem("pl_invoice_sent") === "true" || PAYMENTS_CACHE.some((p) => p.invoice_sent_at || p.invoice_url);
  const step4Done = BOOKINGS_CACHE.length > 0;
  const stepsComplete = [step1Done, step2Done, step3Done, step4Done].filter(Boolean).length;
  const showOnboarding = !onboardingDismissed && stepsComplete < 3;

  const onboardingHtml = showOnboarding ? `
    <div class="card" id="onboardingCard" style="margin-bottom:16px;border:1px solid rgba(200,75,47,.3);background:rgba(200,75,47,.04);">
      <div class="card-hd">
        <strong>Get started with ProofLink</strong>
        <button id="btnDismissOnboarding" style="font-size:.75rem;color:rgba(255,255,255,.3);background:none;border:none;cursor:pointer;">Dismiss</button>
      </div>
      <div class="card-bd">
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.1rem;color:${step1Done ? "#4ade80" : "rgba(255,255,255,.3)"};">${step1Done ? "âœ“" : "â—‹"}</span>
            <span style="color:${step1Done ? "rgba(255,255,255,.5)" : "inherit"};text-decoration:${step1Done ? "line-through" : "none"};">Add your first customer</span>
            ${!step1Done ? `<button data-tab="customers" class="btn btn-ghost" style="margin-left:auto;font-size:.75rem;padding:3px 10px;">Go â†’</button>` : ""}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.1rem;color:${step2Done ? "#4ade80" : "rgba(255,255,255,.3)"};">${step2Done ? "âœ“" : "â—‹"}</span>
            <span style="color:${step2Done ? "rgba(255,255,255,.5)" : "inherit"};text-decoration:${step2Done ? "line-through" : "none"};">Capture your first request</span>
            ${!step2Done ? `<button data-tab="leads" class="btn btn-ghost" style="margin-left:auto;font-size:.75rem;padding:3px 10px;">Go â†’</button>` : ""}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.1rem;color:${step3Done ? "#4ade80" : "rgba(255,255,255,.3)"};">${step3Done ? "âœ“" : "â—‹"}</span>
            <span style="color:${step3Done ? "rgba(255,255,255,.5)" : "inherit"};text-decoration:${step3Done ? "line-through" : "none"};">Send your first invoice</span>
            ${!step3Done ? `<button data-tab="payments" class="btn btn-ghost" style="margin-left:auto;font-size:.75rem;padding:3px 10px;">Go â†’</button>` : ""}
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.1rem;color:${step4Done ? "#4ade80" : "rgba(255,255,255,.3)"};">${step4Done ? "âœ“" : "â—‹"}</span>
            <span style="color:${step4Done ? "rgba(255,255,255,.5)" : "inherit"};text-decoration:${step4Done ? "line-through" : "none"};">Schedule a booking</span>
            ${!step4Done ? `<button data-tab="bookings" class="btn btn-ghost" style="margin-left:auto;font-size:.75rem;padding:3px 10px;">Go â†’</button>` : ""}
          </div>
        </div>
        <div style="margin-top:12px;background:rgba(255,255,255,.06);border-radius:4px;height:4px;overflow:hidden;">
          <div style="width:${Math.round(stepsComplete / 4 * 100)}%;height:100%;background:var(--accent);border-radius:4px;"></div>
        </div>
        <div style="font-size:.75rem;color:rgba(255,255,255,.3);margin-top:4px;">${stepsComplete} of 4 steps complete</div>
      </div>
    </div>` : "";

  dashboardWrap.innerHTML = `
    ${onboardingHtml}
    ${metricsHtml}
    ${renderTodayFocusSection({
      todayActions,
      followUps,
      staleLeadRows,
      duePlans,
      depositRiskOrders: depositRiskOrders,
      completedUnpaid,
      blueprint,
    })}

    <div class="workflow-strip">
      <div class="workflow-stage">
        <span class="workflow-stage__label">Requests</span>
        <strong>${pipeline.leads}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Quoted</span>
        <strong>${pipeline.quoted}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Booked</span>
        <strong>${pipeline.booked}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">In progress</span>
        <strong>${pipeline.inProgress}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Completed</span>
        <strong>${pipeline.completed}</strong>
      </div>
      <div class="workflow-stage">
        <span class="workflow-stage__label">Paid</span>
        <strong>${pipeline.paid}</strong>
      </div>
    </div>

    <div class="cards">
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Open ${escapeHtml(orderLabel)}</div>
          <div class="money">${openOrdersCount()}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Outstanding money</div>
          <div class="money">${formatUsd(outstandingBalance)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Requests waiting 24h+</div>
          <div class="money">${staleLeadRows.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Completed work unpaid</div>
          <div class="money">${formatUsd(completedUnpaidBalance)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Recurring work due</div>
          <div class="money">${duePlans.length}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Booked without deposit</div>
          <div class="money">${formatUsd(missingDepositBalance)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">Overdue money</div>
          <div class="money">${formatUsd(overdueBalance)}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">This month revenue</div>
          <div class="money">${formatUsd(currentMonthRevenueCents())}</div>
          <div class="muted" style="font-size:.75rem;margin-top:2px;">${(function(){ const mk = yyyymm(new Date()); return PAYMENTS_CACHE.filter((r) => monthKeyFromDate(r.paid_at || r.created_at || r.updated_at || new Date()) === mk).length; })()} payments collected</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">This week revenue</div>
          <div class="money">${formatUsd((function(){ const now = new Date(); const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0); return PAYMENTS_CACHE.filter((r) => new Date(r.paid_at || r.created_at || r.updated_at || 0) >= weekStart).reduce((s, r) => s + paymentRevenueContributionCents(r), 0); })())}</div>
        </div>
      </div>
      <div class="card mini">
        <div class="card-bd">
          <div class="muted">MRR (active plans)</div>
          <div class="money">${formatUsd(SERVICE_PLANS_CACHE.filter((p) => String(p.status || "").toLowerCase() === "active").reduce((s, p) => s + Number(p.amount_cents || 0), 0))}</div>
          <div class="muted" style="font-size:.75rem;margin-top:2px;">${SERVICE_PLANS_CACHE.filter((p) => String(p.status || "").toLowerCase() === "active").length} active plan${SERVICE_PLANS_CACHE.filter((p) => String(p.status || "").toLowerCase() === "active").length === 1 ? "" : "s"}</div>
        </div>
      </div>
    </div>

    ${(function() {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const todayBookings = BOOKINGS_CACHE.filter((b) => b.starts_at && b.starts_at.slice(0, 10) === todayStr && b.status !== 'cancelled');
      const overdueOrders = CRM_ORDERS_CACHE.filter((o) => {
        if (["paid", "cancelled"].includes(String(o.status || "").toLowerCase())) return false;
        const due = o.due_date || o.scheduled_date;
        return due && new Date(due) < today;
      });
      const overduePayments = CRM_ORDERS_CACHE.filter((o) => {
        if (["paid", "cancelled"].includes(String(o.status || "").toLowerCase())) return false;
        if (!o.payment_due_date) return false;
        return new Date(o.payment_due_date) < today && orderPaymentState(o) !== 'paid';
      });
      const unpaidCompleted = CRM_ORDERS_CACHE.filter((o) => ["completed", "fulfilled"].includes(String(o.status || "").toLowerCase()));
      const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
      return `
        <div style="margin-bottom:20px;">
          <div class="kicker" style="margin-bottom:10px;">Today at a glance</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
            <div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;">
              <div class="muted" style="font-size:.78rem;margin-bottom:4px;">Today's appointments</div>
              <div style="font-size:1.4rem;font-weight:700;">${todayBookings.length}</div>
              ${todayBookings.length ? `<div style="margin-top:8px;font-size:.78rem;">${todayBookings.slice(0,3).map((b) => `<div style="color:var(--muted);">${fmtTime(b.starts_at)} Â· ${escapeHtml(b.customer_name || "Customer")}</div>`).join("")}${todayBookings.length > 3 ? `<div class="muted">+${todayBookings.length - 3} more</div>` : ""}</div>` : `<div class="muted" style="font-size:.78rem;margin-top:4px;">No appointments today</div>`}
            </div>
            <div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;">
              <div class="muted" style="font-size:.78rem;margin-bottom:4px;">Overdue orders</div>
              <div style="font-size:1.4rem;font-weight:700;${overdueOrders.length ? 'color:#f87171;' : ''}">${overdueOrders.length}</div>
              ${overdueOrders.length ? `<div class="muted" style="font-size:.78rem;margin-top:4px;">${overdueOrders.slice(0,2).map((o) => escapeHtml(o.customer_name || o.name || "Order")).join(", ")}${overdueOrders.length > 2 ? ` +${overdueOrders.length - 2} more` : ""}</div>` : `<div class="muted" style="font-size:.78rem;margin-top:4px;">None overdue</div>`}
            </div>
            <div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;">
              <div class="muted" style="font-size:.78rem;margin-bottom:4px;">Completed, unpaid</div>
              <div style="font-size:1.4rem;font-weight:700;${unpaidCompleted.length ? 'color:#fbbf24;' : ''}">${unpaidCompleted.length}</div>
              ${unpaidCompleted.length ? `<div class="muted" style="font-size:.78rem;margin-top:4px;">${formatUsd(unpaidCompleted.reduce((s, o) => s + Number(o.total_cents || 0), 0))} outstanding</div>` : `<div class="muted" style="font-size:.78rem;margin-top:4px;">All paid up</div>`}
            </div>
            <div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;${overduePayments.length ? 'border-color:#f87171;' : ''}">
              <div class="muted" style="font-size:.78rem;margin-bottom:4px;">Past payment due date <span style="color:#f87171;font-size:.7rem;vertical-align:middle;">${overduePayments.length ? 'â—' : ''}</span></div>
              <div style="font-size:1.4rem;font-weight:700;${overduePayments.length ? 'color:#f87171;' : ''}">${overduePayments.length}</div>
              ${overduePayments.length ? `<div class="muted" style="font-size:.78rem;margin-top:4px;">${formatUsd(overduePayments.reduce((s, o) => s + orderAmountDueCents(o), 0))} past due</div>` : `<div class="muted" style="font-size:.78rem;margin-top:4px;">None past payment date</div>`}
            </div>
          </div>
        </div>
      `;
    })()}

    ${hydrovacToday ? `
      <div class="hydrovac-pressure">
        <div class="hydrovac-pressure__head">
          <div>
            <div class="kicker">Hydrovac pressure points</div>
            <h3>Keep dispatch, disposal, and compliance in the same field of view.</h3>
            <p>These are the items most likely to stop a truck, delay billing, or create cleanup work for the office later.</p>
          </div>
          <div class="workspace-chip-row">
            <button type="button" class="pipeline-action-chip" data-hydrovac-today-tab="locates">Locate tickets</button>
            <button type="button" class="pipeline-action-chip" data-hydrovac-today-tab="manifests">Loads & manifests</button>
            <button type="button" class="pipeline-action-chip" data-hydrovac-today-tab="dispatch">Dispatch</button>
            <button type="button" class="pipeline-action-chip" data-hydrovac-today-tab="compliance">Compliance</button>
          </div>
        </div>
        <div class="hydrovac-pressure__stats">
          <div class="hydrovac-pressure__stat">
            <span class="muted">Open loads</span>
            <strong>${escapeHtml(String(hydrovacToday.openLoads.length))}</strong>
            <div class="muted">Still in transit or waiting to confirm.</div>
          </div>
          <div class="hydrovac-pressure__stat">
            <span class="muted">Uninvoiced disposal</span>
            <strong>${formatUsd(hydrovacToday.uninvoicedChargeCents)}</strong>
            <div class="muted">${escapeHtml(String(hydrovacToday.uninvoicedManifests.length))} confirmed manifest${hydrovacToday.uninvoicedManifests.length === 1 ? "" : "s"} still waiting on billing.</div>
          </div>
          <div class="hydrovac-pressure__stat">
            <span class="muted">Tickets expiring</span>
            <strong>${escapeHtml(String(hydrovacToday.expiringTickets.length + hydrovacToday.expiredTickets.length))}</strong>
            <div class="muted">${escapeHtml(String(hydrovacToday.expiredTickets.length))} already expired, ${escapeHtml(String(hydrovacToday.expiringTickets.length))} inside the 3-day window.</div>
          </div>
          <div class="hydrovac-pressure__stat">
            <span class="muted">Dispatch blockers</span>
            <strong>${escapeHtml(String(hydrovacToday.dispatchBlockedJobs.length))}</strong>
            <div class="muted">${escapeHtml(String(hydrovacToday.todayJobs.length))} hydrovac job${hydrovacToday.todayJobs.length === 1 ? "" : "s"} on the board today.</div>
          </div>
        </div>
        <div class="hydrovac-pressure__list">
          ${[
            ...hydrovacToday.dispatchBlockedJobs.slice(0, 4).map((job) => ({
              tab: "dispatch",
              id: job.id,
              title: `${job.title || "Hydrovac job"} is not dispatch-ready`,
              copy: `${job.customer_name || job.service_address || "Customer not linked"} â€¢ assign truck/driver and clear required compliance before the crew rolls.`,
              tone: "pill-bad",
            })),
            ...hydrovacToday.expiredTickets.slice(0, 3).map((ticket) => ({
              tab: "locates",
              id: ticket.id,
              title: `Locate ${ticket.ticket_number || "ticket"} is expired`,
              copy: ticket.work_site_address || "Coverage needs attention before excavation work continues.",
              tone: "pill-bad",
            })),
            ...hydrovacToday.uninvoicedManifests.slice(0, 3).map((manifest) => ({
              tab: "manifests",
              id: manifest.id,
              title: `${manifest.manifest_number || "Manifest"} is ready to bill`,
              copy: `${hydrovacMaterialLabel(manifest.material_type)} â€¢ ${formatUsd(Number(manifest.disposal_charge_cents || 0))} still not on the invoice.`,
              tone: "pill-warn",
            })),
            ...hydrovacToday.expiredPermits.slice(0, 2).map((permit) => ({
              tab: "permits",
              id: permit.id,
              title: `${permit.permit_number || "Permit"} is past due`,
              copy: permit.space_description || "Permit-required confined space entry needs a fresh review.",
              tone: "pill-bad",
            })),
          ].slice(0, 8).map((item) => `
            <button type="button" class="hydrovac-pressure-row" data-hydrovac-today-tab="${escapeAttr(item.tab)}" data-hydrovac-today-id="${escapeAttr(item.id || "")}">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <div class="muted">${escapeHtml(item.copy)}</div>
              </div>
              <span class="pill ${item.tone}">Review</span>
            </button>
          `).join("") || `<div class="detail-card"><div class="kicker">Hydrovac office view</div><div><strong>No urgent hydrovac blockers are showing right now.</strong></div><div class="detail-copy">Dispatch, disposal, and compliance all look steady from the current data in ProofLink.</div></div>`}
        </div>
      </div>
    ` : ""}

    <div class="dashboard-tracker">
      <div class="dashboard-tracker__head">
        <div>
          <div class="kicker">Active client tracker</div>
          <h3>See who is active, what stage they are in, and where the money still sits.</h3>
          <p>Open the client, quoted work, job, or request directly from the tracking row instead of hunting across the system.</p>
        </div>
        <div class="workspace-chip-row">
          <span class="pill">${escapeHtml(String(trackedClients.length))} clients in focus</span>
          <span class="pill">${escapeHtml(String(todayActions.length))} live pressure points</span>
        </div>
      </div>
      <div class="dashboard-tracker__list">
        ${trackedClients.length ? trackedClients.map((item) => `
          <button type="button" class="dashboard-tracker-row${item.isPriority ? " is-priority" : ""}" data-today-tab="${escapeAttr(item.targetTab)}" data-today-id="${escapeAttr(item.targetId || "")}">
            <div class="dashboard-tracker-row__main">
              <div class="dashboard-tracker-row__title">
                <strong>${escapeHtml(item.customerName)}</strong>
                <span class="pill${item.isPriority ? " pill-bad" : ""}">${escapeHtml(item.statusLabel)}</span>
              </div>
              <div class="dashboard-tracker-row__copy">${escapeHtml(item.summary)}${item.serviceAddress ? ` &middot; ${escapeHtml(item.serviceAddress)}` : ""}</div>
            </div>
            <div class="dashboard-tracker-row__meta">
              <span>${escapeHtml(item.monetaryLabel)}</span>
              <span>${escapeHtml(item.actionHint)}</span>
            </div>
          </button>
        `).join("") : `<div class="detail-card"><div class="kicker">Client tracker</div><div><strong>No active clients are being tracked yet.</strong></div><div class="detail-copy">As customers, jobs, and payments land in ProofLink, the dashboard will keep the live records visible here.</div></div>`}
      </div>
    </div>

    <div class="follow-up-queue">
      <div class="follow-up-queue__head">
        <div>
          <div class="kicker">Guarded follow-up queue</div>
          <h3>Helpful follow-up without spam</h3>
          <p>These follow-ups are generated from real workflow events, capped by cooldowns, and stop mattering as soon as the work state changes.</p>
        </div>
        <div class="follow-up-queue__meta">
          <span class="pill">${escapeHtml(String(followUps.length))} queued</span>
          <span class="pill">No bulk blasts</span>
          <span class="pill">Operator visible</span>
        </div>
      </div>
      ${FOLLOW_UP_QUEUE_MESSAGE ? `<div class="msg ${escapeAttr(FOLLOW_UP_QUEUE_MESSAGE.tone || "")}">${escapeHtml(FOLLOW_UP_QUEUE_MESSAGE.text || "")}</div>` : ""}
      <div class="follow-up-grid">
        ${followUps.length ? followUps.map((item, index) => `
          <article class="follow-up-card">
            <div class="follow-up-card__top">
              <div>
                <div class="kicker">${escapeHtml(item.kindLabel)}</div>
                <strong>${escapeHtml(item.title)}</strong>
              </div>
              <span class="pill ${["payment_reminder", "deposit_reminder"].includes(item.kind) ? "pill-bad" : (item.kind === "review_request" ? "pill-on" : "")}">${escapeHtml(item.channel === "email" ? "Email ready" : "Call script ready")}</span>
            </div>
            <div class="detail-copy">${escapeHtml(item.detail)}</div>
            <div class="follow-up-card__reason">${escapeHtml(item.reason)}</div>
            <div class="follow-up-card__contact">${escapeHtml(item.customerName || item.contactName || "Customer")}${item.contactEmail ? ` &middot; ${escapeHtml(item.contactEmail)}` : ""}${item.contactPhone ? ` &middot; ${escapeHtml(item.contactPhone)}` : ""}</div>
            ${item.reviewLinkUrl ? `<div class="workspace-chip-row"><span class="pill pill-on">${escapeHtml(item.reviewLinkLabel || "Review link ready")}</span></div>` : ""}
            <div class="follow-up-card__actions">
              <button type="button" class="btn btn-primary btn-sm" data-follow-up-action="copy" data-follow-up-index="${escapeAttr(index)}">${escapeHtml(item.channel === "email" ? "Copy email" : "Copy call script")}</button>
              ${item.canSend ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="send" data-follow-up-index="${escapeAttr(index)}">Send email</button>` : ""}
              ${item.reviewLinkUrl ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="copy-link" data-follow-up-index="${escapeAttr(index)}">Copy review link</button>` : ""}
              ${item.reviewLinkUrl ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="open-link" data-follow-up-index="${escapeAttr(index)}">Open review link</button>` : ""}
              ${item.customerId ? `<button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="handled" data-follow-up-index="${escapeAttr(index)}">Mark contacted</button>` : ""}
              <button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="open" data-follow-up-index="${escapeAttr(index)}">Open record</button>
              <button type="button" class="btn btn-ghost btn-sm" data-follow-up-action="snooze" data-follow-up-index="${escapeAttr(index)}">Snooze 24h</button>
            </div>
          </article>
        `).join("") : `<div class="detail-card"><div class="kicker">Queue</div><div><strong>No safe follow-up is queued right now.</strong></div><div class="detail-copy">That means requests are being worked, money is caught up, or recent contact already happened.</div></div>`}
      </div>
    </div>

    <div class="insight-grid">
      <div class="insight">
        <h3>What needs attention</h3>
        <p>${alerts.length ? alerts.map((x) => escapeHtml(x)).join("<br>") : "Core operator signals look stable right now."}</p>
      </div>
      <div class="insight">
        <h3>Owner pressure points</h3>
        <p>Stale requests: <strong>${staleLeadRows.length}</strong> | Completed but unpaid: <strong>${completedUnpaid.length}</strong></p>
        <p>Quoted pipeline waiting on decision: <strong>${pipeline.quoted}</strong> | Due recurring work: <strong>${duePlans.length}</strong> | Missing deposits: <strong>${formatUsd(missingDepositBalance)}</strong></p>
      </div>
      <div class="insight">
        <h3>CRM value</h3>
        <p>Top customer today: <strong>${escapeHtml(topCustomer?.name || "None yet")}</strong>${topCustomer ? ` | ${formatUsd(customerLifetimeValueCents(topCustomer))}` : ""}</p>
        <p>Active ${escapeHtml(catalogLabel)}: <strong>${activeOfferings}</strong></p>
      </div>
      <div class="insight">
        <h3>Cash awareness</h3>
        <p>Tracked expenses this month: <strong>${formatUsd(currentExpenses)}</strong></p>
        <p>Forecasted month ${escapeHtml(orderLabel)}: <strong>${forecastMonthOrders()}</strong></p>
      </div>
    </div>

    ${(function() {
      const referralCounts = {};
      CRM_ORDERS_CACHE.forEach((o) => {
        const src = o.referral_source || 'Direct';
        referralCounts[src] = (referralCounts[src] || 0) + 1;
      });
      const withSource = CRM_ORDERS_CACHE.filter((o) => o.referral_source).length;
      if (withSource < 3) return '';
      const sorted = Object.entries(referralCounts).sort((a, b) => b[1] - a[1]);
      const total = CRM_ORDERS_CACHE.length;
      return `
        <div style="margin-bottom:20px;">
          <div class="kicker" style="margin-bottom:10px;">How customers find you</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${sorted.map(([src, count]) => `
              <div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 14px;min-width:130px;">
                <div style="font-size:.75rem;color:var(--muted);margin-bottom:2px;">${escapeHtml(src)}</div>
                <div style="font-size:1.1rem;font-weight:700;">${count} <span style="font-size:.75rem;font-weight:400;color:var(--muted);">(${Math.round(count / total * 100)}%)</span></div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    })()}

    <div class="insight-grid">
      <div class="insight">${checklistHtml || '<h3>First wins</h3><p>Checklist unavailable right now.</p>'}</div>
      <div class="insight">${paymentHtml || '<h3>Payment readiness</h3><p>Payment truth will appear here once tenant state loads.</p>'}</div>
      <div class="insight">
        <h3>Operating posture</h3>
        <p>${escapeHtml(summary.priorityOutcomes[0] || "Keep the team inside one operating system instead of scattered memory.")}</p>
        <p><strong>Next move:</strong> finish the highest-priority pending checklist step before adding new complexity.</p>
      </div>
      <div class="insight">
        <h3>Booking link</h3>
        <p style="word-break:break-all;font-size:.8rem;margin-bottom:8px;">${TENANT_ID ? `${location.origin}/book.html?tenant=${encodeURIComponent(TENANT_ID)}` : "Tenant ID not loaded yet."}</p>
        ${TENANT_ID ? `<button type="button" class="btn btn-ghost btn-sm" id="dashboardCopyBookingLink">Copy booking link</button>` : ""}
      </div>
    </div>
  `;

  // Revenue this month
  const monthRevEl = $("monthRevenueStat");
  if (monthRevEl) {
    const mk = yyyymm(new Date());
    const monthRev = PAYMENTS_CACHE
      .filter(p => p.paid_at && yyyymm(new Date(p.paid_at)) === mk)
      .reduce((s, p) => s + Number(p.amount_total_cents || p.amount_cents || 0), 0);
    monthRevEl.textContent = monthRev ? money(monthRev / 100) : '$0';
  }

  // MRR from active service plans
  const mrrEl = $("mrrStat");
  if (mrrEl) {
    const mrr = SERVICE_PLANS_CACHE
      .filter(p => p.active !== false && p.amount_cents)
      .reduce((s, p) => s + Number(p.amount_cents || 0), 0);
    mrrEl.textContent = mrr ? money(mrr / 100) + '/mo' : 'â€”';
  }

  // Make pipeline stages clickable
  dashboardWrap.querySelectorAll('.workflow-stage').forEach((el) => {
    el.style.cursor = 'pointer';
    el.style.transition = 'opacity .15s';
    el.addEventListener('mouseenter', () => { el.style.opacity = '.8'; });
    el.addEventListener('mouseleave', () => { el.style.opacity = '1'; });
    el.addEventListener('click', () => {
      const label = (el.querySelector('.workflow-stage__label, .stage-label, [class*="label"]')?.textContent || '').toLowerCase();
      if      (label.includes('lead'))                     switchTab('leads');
      else if (label.includes('quote'))                    switchTab(isServiceWorkspace(currentWorkspaceBlueprint()) ? 'bids' : 'quotes');
      else if (label.includes('book') || label.includes('scheduled')) switchTab('bookings');
      else if (label.includes('progress') || label.includes('active')) { switchTab('orders'); }
      else if (label.includes('complet'))                  { switchTab('orders'); }
      else if (label.includes('paid'))                     switchTab('payments');
      else                                                 switchTab('orders');
    });
  });

  dashboardWrap.querySelectorAll("[data-today-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateWorkspaceTarget(
        btn.getAttribute("data-today-tab") || "dashboard",
        btn.getAttribute("data-today-id") || ""
      );
    });
  });
  dashboardWrap.querySelector("#dashboardCopyBookingLink")?.addEventListener("click", async () => {
    const siteUrl = window.location.origin;
    const link = `${siteUrl}/book.html?tenant=${encodeURIComponent(TENANT_ID)}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    const btn = dashboardWrap.querySelector("#dashboardCopyBookingLink");
    if (btn) { const orig = btn.textContent; btn.textContent = "âœ“ Copied!"; setTimeout(() => { btn.textContent = orig; }, 2000); }
  });

  // Onboarding card wiring
  dashboardWrap.querySelector("#btnDismissOnboarding")?.addEventListener("click", () => {
    localStorage.setItem("pl_onboarding_dismissed", "true");
    const card = dashboardWrap.querySelector("#onboardingCard");
    if (card) card.remove();
  });
  dashboardWrap.querySelectorAll("#onboardingCard [data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) switchTab(tab);
    });
  });

  dashboardWrap.querySelectorAll("[data-dashboard-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-dashboard-action");
      if (action === "import") {
        switchTab("import");
        return;
      }
      if (action === "new-lead") {
        ACTIVE_LEAD_ID = null;
        clearLeadForm();
        renderLeadDetail(null).catch(console.error);
        switchTab("leads");
        return;
      }
      if (action === "new-bid") {
        startNewBid(preferredBidProfile());
        switchTab("bids");
        return;
      }
      if (action === "new-customer") {
        startNewCustomer();
        switchTab("customers");
        return;
      }
      if (action === "record-payment") {
        clearPaymentForm({ customerId: ACTIVE_CUSTOMER_ID || "" });
        renderPayments();
        switchTab("payments");
        return;
      }
      if (action === "new-plan") {
        ACTIVE_PLAN_ID = null;
        clearPlanForm();
        renderPlanDetail(null).catch(console.error);
        switchTab("plans");
      }
    });
  });
  dashboardWrap.querySelectorAll("[data-hydrovac-today-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateWorkspaceTarget(
        btn.getAttribute("data-hydrovac-today-tab") || "dashboard",
        btn.getAttribute("data-hydrovac-today-id") || ""
      );
    });
  });
  dashboardWrap.querySelectorAll("[data-follow-up-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-follow-up-action");
      const index = Number(btn.getAttribute("data-follow-up-index"));
      const item = CURRENT_FOLLOW_UP_QUEUE[index];
      if (!item) return;
      try {
        if (action === "copy") {
          await copyTextValue(item.message || "");
          setFollowUpQueueMessage(item.channel === "email" ? "Follow-up email copied to the clipboard." : "Call script copied to the clipboard.", "ok");
          renderDashboard();
          return;
        }
        if (action === "send") {
          setFollowUpQueueMessage("Sending follow-up...", "");
          renderDashboard();
          await sendQueuedFollowUp(item);
          return;
        }
        if (action === "copy-link") {
          if (!item.reviewLinkUrl) throw new Error("This follow-up does not have a review link yet.");
          await copyTextValue(item.reviewLinkUrl);
          setFollowUpQueueMessage("Review link copied to the clipboard.", "ok");
          renderDashboard();
          return;
        }
        if (action === "open-link") {
          if (!item.reviewLinkUrl) throw new Error("This follow-up does not have a review link yet.");
          window.open(item.reviewLinkUrl, "_blank", "noopener,noreferrer");
          setFollowUpQueueMessage("Review link opened in a new tab.", "ok");
          renderDashboard();
          return;
        }
        if (action === "handled") {
          await markQueuedFollowUpContacted(item);
          return;
        }
        if (action === "open") {
          openQueuedFollowUp(item);
          return;
        }
        if (action === "snooze") {
          snoozeFollowUpItem(item.id, 24);
          setFollowUpQueueMessage("Follow-up snoozed for 24 hours.", "ok");
          renderDashboard();
        }
      } catch (err) {
        setFollowUpQueueMessage(err.message || String(err), "error");
        renderDashboard();
      }
    });
  });
}
function renderMoneyWorkspace() {
  const unpaidOrders = (CRM_ORDERS_CACHE || []).filter((order) => {
    const state = normalizeWorkflowStatusValue(orderPaymentState(order));
    return !["paid"].includes(state) && !["cancelled"].includes(normalizeWorkflowStatusValue(order.status || "new"));
  });
  const overdueOrders = unpaidOrders.filter((order) => normalizeWorkflowStatusValue(orderPaymentState(order)) === "overdue");
  const depositOpenOrders = unpaidOrders.filter((order) => orderDepositGapCents(order) > 0);
  const recordedPayments = sortedPayments(PAYMENTS_CACHE || []).length;
  const activePayment = currentPayment();
  const activeOrder = activePayment?.order_id ? (CRM_ORDERS_CACHE.find((row) => row.id === activePayment.order_id) || null) : null;
  const activeJob = activePayment?.job_id ? (JOBS_CACHE.find((row) => row.id === activePayment.job_id) || null) : null;
  const activeCustomer = activePayment?.customer_id ? (CUSTOMERS_CACHE.find((row) => row.id === activePayment.customer_id) || null) : null;
  if (moneyStageStrip) {
    const cards = [
      { tab: "payments", eyebrow: "Collection", value: unpaidOrders.length, title: "Open balances", copy: "Quoted or completed work that still has money left to collect." },
      { tab: "payments", eyebrow: "Urgent", value: overdueOrders.length, title: "Overdue", copy: "Balances that have slipped past the expected collection window." },
      { tab: "payments", eyebrow: "Deposit", value: depositOpenOrders.length, title: "Deposits open", copy: "Orders that still need a required deposit before work should move ahead." },
      { tab: "payments", eyebrow: "Recorded", value: recordedPayments, title: "Payments logged", copy: "Manual and synced payment records already in the ledger." },
    ];
    moneyStageStrip.innerHTML = cards.map((stage) => `
      <button type="button" class="pipeline-stage-card is-active" data-money-stage-tab="${escapeAttr(stage.tab)}">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </button>
    `).join("");
    moneyStageStrip.querySelectorAll("[data-money-stage-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.getAttribute("data-money-stage-tab") || "payments"));
    });
  }
  if (moneyActionBar) {
    moneyActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-money-action="new-payment">Record payment</button>
      <button type="button" class="pipeline-action-chip" data-money-action="open-pipeline">${activeOrder ? "Open quoted / booked" : "Open pipeline"}</button>
      <button type="button" class="pipeline-action-chip" data-money-action="open-job">${activeJob ? "Open active job" : "Open jobs"}</button>
      <button type="button" class="pipeline-action-chip" data-money-action="open-customer">${activeCustomer ? "Open customer" : "Open customers"}</button>
    `;
    moneyActionBar.querySelectorAll("[data-money-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-money-action");
        if (action === "new-payment") {
          clearPaymentForm();
          renderPayments();
          return;
        }
        if (action === "open-pipeline") {
          if (activeOrder?.id) ACTIVE_ORDER_ID = activeOrder.id;
          switchTab("orders");
          return;
        }
        if (action === "open-job") {
          if (activeJob?.id) ACTIVE_JOB_ID = activeJob.id;
          switchTab("jobs");
          return;
        }
        if (action === "open-customer") {
          if (activeCustomer?.id) {
            ACTIVE_CUSTOMER_ID = activeCustomer.id;
            CUSTOMER_CREATING = false;
          }
          switchTab("customers");
        }
      });
    });
  }
}
function renderPipelineWorkspace() {
  const stages = pipelineStageStats();
  renderWorkCommandCenter();
  if (pipelineStageStrip) {
    pipelineStageStrip.innerHTML = stages.map((stage) => `
      <button
        type="button"
        class="pipeline-stage-card ${stage.tab === "orders" ? "is-active" : ""}"
        data-pipeline-tab="${escapeAttr(stage.tab)}"
      >
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </button>
    `).join("");
    pipelineStageStrip.querySelectorAll("[data-pipeline-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.getAttribute("data-pipeline-tab") || "orders"));
    });
  }
  if (pipelineActionBar) {
    pipelineActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-pipeline-action="new-request">New request</button>
      <button type="button" class="pipeline-action-chip" data-pipeline-action="draft-proposal">Draft proposal</button>
      <button type="button" class="pipeline-action-chip" data-pipeline-action="open-jobs">Open active jobs</button>
      <button type="button" class="pipeline-action-chip" data-pipeline-action="record-payment">Record payment</button>
    `;
    pipelineActionBar.querySelectorAll("[data-pipeline-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-pipeline-action");
        if (action === "new-request") {
          ACTIVE_LEAD_ID = null;
          clearLeadForm();
          renderLeadDetail(null).catch(console.error);
          switchTab("leads");
          return;
        }
        if (action === "draft-proposal") {
          startNewBid(preferredBidProfile());
          switchTab("bids");
          return;
        }
        if (action === "open-jobs") {
          switchTab("jobs");
          return;
        }
        if (action === "record-payment") {
          clearPaymentForm({ customerId: ACTIVE_CUSTOMER_ID || "" });
          renderPayments();
          switchTab("payments");
        }
      });
    });
  }
}
function renderGuidance() {
  if (!guidanceWrap) return;
  const blueprint = currentWorkspaceBlueprint();
  const rubric = blueprint?.workflowRubric || {};
  const operatorNeeds = Array.isArray(blueprint?.business?.operatorNeeds) ? blueprint.business.operatorNeeds.filter(Boolean) : [];
  const groups = [
    {
      title: "Keep work moving",
      copy: "Everything tied to the active customer workflow lives here.",
      actions: [
        { tab: "leads", label: "Requests" },
        { tab: "bids", label: workspaceBidLabel(blueprint) },
        { tab: "orders", label: workspaceTabLabel("orders", blueprint) },
        { tab: "jobs", label: workspaceJobsNavLabel(blueprint) },
        { tab: "plans", label: "Recurring Plans" },
      ],
    },
    {
      title: "Money and follow-through",
      copy: "Collect, review margin, and close the loop without leaving the customer story behind.",
      actions: [
        { tab: "payments", label: workspaceTabLabel("payments", blueprint) },
        { tab: "expenses", label: "Expenses" },
        { tab: "money", label: workspaceTabLabel("money", blueprint) },
        { tab: "reviews", label: "Reviews" },
      ],
    },
    {
      title: "Website and launch",
      copy: "Change what customers see, what they can request, and how the business presents itself.",
      actions: [
        { tab: "setup", label: workspaceTabLabel("setup", blueprint) },
        { tab: "products", label: workspaceCatalogLabel(blueprint) },
        { tab: "pricing", label: workspaceTabLabel("pricing", blueprint) },
        { tab: "availability", label: workspaceTabLabel("availability", blueprint) },
        { tab: "domains", label: "Domains" },
        { tab: "import", label: workspaceTabLabel("import", blueprint) },
      ],
    },
    {
      title: "Operations and support",
      copy: "Reach the back-office tools without forcing them into the daily sidebar.",
      actions: [
        { tab: "vendors", label: "Vendors" },
        { tab: "inventory", label: "Inventory" },
        { tab: "contracts", label: "Contracts" },
        { tab: "equipment", label: "Equipment" },
        { tab: "team", label: "Team" },
      ],
    },
  ];
  if (isHydrovacWorkspace(blueprint)) {
    groups.splice(3, 0, {
      title: "Hydrovac operations",
      copy: "Daily truck, disposal, locate, and compliance tools stay grouped here.",
      actions: [
        { tab: "facilities", label: "Facilities" },
        { tab: "manifests", label: "Loads & Manifests" },
        { tab: "locates", label: "Locate Tickets" },
        { tab: "compliance", label: "Compliance" },
      ],
    });
  }
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      actions: group.actions.filter((item) => isTabVisibleInWorkspace(item.tab, blueprint)),
    }))
    .filter((group) => group.actions.length);
  const noteCards = [
    {
      title: "Daily shell",
      copy: `Use Today, ${workspaceTabLabel("orders", blueprint)}, Customers, Calendar, and ${workspaceTabLabel("payments", blueprint)} as the main operating rhythm.`,
    },
    {
      title: "Current pressure",
      copy: LEADS_CACHE.length || CRM_ORDERS_CACHE.length || JOBS_CACHE.length
        ? `You have ${LEADS_CACHE.length} request(s), ${BIDS_CACHE.length} proposal(s), ${CRM_ORDERS_CACHE.length} approved-work record(s), and ${JOBS_CACHE.length} active job(s) in play.`
        : "Start with one customer and one real request. The flow gets easier once live work is moving through it.",
    },
    {
      title: "Template intake",
      copy: rubric.intake || "Capture the real customer need clearly before the work starts moving.",
    },
    {
      title: "Template delivery",
      copy: [rubric.scheduling, rubric.field].filter(Boolean).join(" "),
    },
    {
      title: "Template retention",
      copy: [rubric.payment, rubric.repeatWork].filter(Boolean).join(" "),
    },
    {
      title: "Template records",
      copy: operatorNeeds.length
        ? operatorNeeds.slice(0, 3).join(" ")
        : "Make the record hold the customer context, delivery details, and payment follow-through your team would otherwise keep in memory.",
    },
  ];
  guidanceWrap.innerHTML = `
    <div class="operations-hub">
      ${visibleGroups.map((group) => `
        <section class="operations-group">
          <div class="operations-group__head">
            <div class="kicker">${escapeHtml(group.title)}</div>
            <div class="guidance-copy">${escapeHtml(group.copy)}</div>
          </div>
          <div class="operations-actions">
            ${group.actions.map((action) => `
              <button class="btn btn-ghost btn-sm operations-action" type="button" data-ops-tab="${escapeAttr(action.tab)}">
                ${escapeHtml(action.label)}
              </button>
            `).join("")}
          </div>
        </section>
      `).join("")}
      <div class="guidance-grid">
        ${noteCards.map((card) => `
          <div class="guidance-card">
            <div class="kicker">${escapeHtml(card.title)}</div>
            <div class="guidance-copy">${escapeHtml(card.copy)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  guidanceWrap.querySelectorAll("[data-ops-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.getAttribute("data-ops-tab") || "dashboard";
      switchTab(tab);
    });
  });
}

const COMMAND_CENTER_HELPERS = {
  renderDashboard,
  renderMoneyWorkspace,
  renderPipelineWorkspace,
  renderGuidance,
};

window.PROOFLINK_OPERATOR_COMMAND_CENTER = {
  ...(window.PROOFLINK_OPERATOR_COMMAND_CENTER || {}),
  ...COMMAND_CENTER_HELPERS,
};

Object.assign(window, COMMAND_CENTER_HELPERS);
