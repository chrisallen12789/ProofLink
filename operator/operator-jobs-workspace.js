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

function hydrovacManifestMeta(row) {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function hydrovacManifestPreparedAt(row, key) {
  const metadata = hydrovacManifestMeta(row);
  return String(metadata[key] || row?.[key] || "").trim();
}

function hydrovacManifestBolReference(row) {
  const metadata = hydrovacManifestMeta(row);
  return String(metadata.bol_number || metadata.bill_of_lading_number || row?.bol_number || "").trim();
}

function hydrovacJobCloseoutState(job, order, detailState = null) {
  const hydrovac = !!(job && typeof isHydrovacJob === "function" && isHydrovacJob(job));
  if (!hydrovac) return null;

  const manifestSnapshot = typeof hydrovacJobManifestSnapshot === "function"
    ? hydrovacJobManifestSnapshot(job?.id)
    : { openLoads: 0, confirmedUnbilled: 0, manifests: [] };
  const manifests = Array.isArray(detailState?.manifests)
    ? detailState.manifests
    : (Array.isArray(manifestSnapshot?.manifests) ? manifestSnapshot.manifests : []);
  const hasLoadSignals = hydrovacManifestNeedsCloseout(job) || manifests.length > 0;
  const openLoads = Math.max(
    Number(manifestSnapshot?.openLoads || 0),
    manifests.filter((manifest) => normalizeWorkflowStatusValue(manifest?.status || "") !== "confirmed").length
  );
  const customerRecordsPending = manifests.filter((manifest) => !hydrovacManifestPreparedAt(manifest, "customer_records_prepared_at"));
  const auditPacketPending = manifests.filter((manifest) => !hydrovacManifestPreparedAt(manifest, "audit_packet_prepared_at"));
  const invoicePending = manifests.filter((manifest) => (
    normalizeWorkflowStatusValue(manifest?.status || "") === "confirmed"
    && manifest?.invoiced !== true
  ));
  const recordDetailGaps = manifests.flatMap((manifest) => {
    const number = manifest?.manifest_number || manifest?.id || "load";
    const issues = [];
    if (!hydrovacManifestBolReference(manifest)) {
      issues.push({
        manifest,
        message: `${number} still needs a BOL / load reference before the office packet is clean.`,
      });
    }
    if (!String(manifest?.disposal_facility_id || manifest?.disposal_facility_name || "").trim()) {
      issues.push({
        manifest,
        message: `${number} still needs the disposal facility attached before closeout.`,
      });
    }
    if (normalizeWorkflowStatusValue(manifest?.status || "") === "confirmed" && !String(manifest?.disposal_ticket_number || "").trim()) {
      issues.push({
        manifest,
        message: `${number} is confirmed but the facility ticket is still missing.`,
      });
    }
    if (manifest?.quantity_actual == null && manifest?.quantity_estimated == null) {
      issues.push({
        manifest,
        message: `${number} still needs the hauled quantity logged before records are ready.`,
      });
    }
    return issues;
  });
  const primaryManifest = manifests[0] || null;
  const primaryRecordsManifest = customerRecordsPending[0] || primaryManifest;
  const primaryAuditManifest = auditPacketPending[0] || primaryRecordsManifest || primaryManifest;
  const primaryInvoiceManifest = invoicePending[0] || primaryManifest;
  const orderBalanceCents = Number(orderAmountDueCents(order) || 0);
  const moneyFollowThroughOpen = invoicePending.length > 0 || orderBalanceCents > 0;
  const packetGapCount = customerRecordsPending.length + auditPacketPending.length;
  const clean = !hasLoadSignals || (
    openLoads === 0
    && packetGapCount === 0
    && recordDetailGaps.length === 0
    && !moneyFollowThroughOpen
  );

  return {
    manifests,
    manifestSnapshot,
    hasLoadSignals,
    openLoads,
    customerRecordsPending,
    auditPacketPending,
    invoicePending,
    recordDetailGaps,
    packetGapCount,
    primaryManifest,
    primaryRecordsManifest,
    primaryAuditManifest,
    primaryInvoiceManifest,
    orderBalanceCents,
    moneyFollowThroughOpen,
    clean,
  };
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
  const hydrovacCloseout = hydrovac ? hydrovacJobCloseoutState(job, order, hydrovacState) : null;

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
    const truckLoads = Array.isArray(hydrovacState?.truckLoads)
      ? hydrovacState.truckLoads.filter((manifest) => String(manifest?.job_id || "") !== String(job.id || ""))
      : [];
    const truckCarryoverWarning = truckLoads[0] || null;
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
    if (truckLoads.length) {
      const sameCustomerTruckLoad = truckLoads.find((manifest) => String(manifest?.customer_id || "") === String(job?.customer_id || order?.customer_id || ""));
      addItem(
        "Truck load carryover",
        false,
        sameCustomerTruckLoad
          ? `Truck still carries ${sameCustomerTruckLoad.manifest_number || sameCustomerTruckLoad.id || "a live load"}. Decide whether it stays with this work or needs disposal before start.`
          : `Truck still carries ${truckCarryoverWarning?.manifest_number || "a live load"} from another account. Clear it before this job starts to avoid cross contamination.`
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
    hydrovacCloseout,
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

const JOB_AGENT_REPORT_CACHE = window.PROOFLINK_JOB_AGENT_REPORT_CACHE || (window.PROOFLINK_JOB_AGENT_REPORT_CACHE = {});
const JOB_CLOSEOUT_AGENT_CACHE = window.PROOFLINK_JOB_CLOSEOUT_AGENT_CACHE || (window.PROOFLINK_JOB_CLOSEOUT_AGENT_CACHE = {});
const JOB_SITE_PACKET_AGENT_CACHE = window.PROOFLINK_JOB_SITE_PACKET_AGENT_CACHE || (window.PROOFLINK_JOB_SITE_PACKET_AGENT_CACHE = {});

function jobAgentStatusTone(status) {
  if (status === "ready") return "pill-good";
  if (status === "blocked") return "pill-bad";
  return "pill-warn";
}

function jobAgentPriorityTone(priority) {
  if (priority === "high") return "pill-bad";
  if (priority === "low") return "";
  return "pill-warn";
}

function renderJobAgentReport(report, emptyCopy = "Run the billing audit to review proof, timing, billing blockers, and the exact next actions this job still needs.") {
  if (!report) {
    return `<div class="detail-copy">${escapeHtml(emptyCopy)}</div>`;
  }

  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
  const evidence = Array.isArray(report.evidence) ? report.evidence.slice(0, 6) : [];
  const missingData = Array.isArray(report.missing_data) ? report.missing_data : [];
  const assumptions = Array.isArray(report.assumptions) ? report.assumptions : [];
  const dataUsed = Array.isArray(report.data_used) ? report.data_used.filter((item) => item && item.count > 0) : [];
  const billingReadiness = report.billing_readiness || null;

  return `
    <div class="detail-copy">${escapeHtml(report.summary || "")}</div>
    <div class="workspace-chip-row u-mt-10">
      <span class="pill ${jobAgentStatusTone(report.summary_status || "review_needed")}">${escapeHtml(titleCaseWords(String(report.summary_status || "review needed").replace(/_/g, " ")))}</span>
      ${billingReadiness ? `<span class="pill">${escapeHtml(`Billing readiness ${Number(billingReadiness.score || 0)}/100`)}</span>` : ""}
      ${report.confidence?.label ? `<span class="pill">${escapeHtml(`Confidence ${report.confidence.label}`)}</span>` : ""}
      ${blockers.length ? `<span class="pill pill-bad">${escapeHtml(`${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`)}</span>` : `<span class="pill pill-good">No blockers found</span>`}
    </div>
    ${blockers.length ? `
      <div class="memory-checklist u-mt-10">
        ${blockers.slice(0, 4).map((item) => `
          <div class="memory-checklist__item memory-checklist__item--warn">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Blocker")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${actions.length ? `
      <div class="detail-copy u-mt-10"><strong>Recommended actions</strong></div>
      <div class="workspace-chip-row">
        ${actions.slice(0, 4).map((action) => `<span class="pill ${jobAgentPriorityTone(action.priority || "medium")}">${escapeHtml(titleCaseWords(String(action.priority || "medium")))} priority</span>`).join("")}
      </div>
      <div class="memory-checklist u-mt-10">
        ${actions.slice(0, 4).map((action) => `
          <div class="memory-checklist__item ${action.priority === "high" ? "memory-checklist__item--warn" : ""}">
            <div class="memory-checklist__title">${escapeHtml(action.title || "Recommended action")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(action.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${findings.length ? `
      <div class="detail-copy u-mt-10"><strong>What the audit found</strong></div>
      <div class="memory-checklist u-mt-10">
        ${findings.slice(0, 4).map((item) => `
          <div class="memory-checklist__item ${item.severity === "critical" ? "memory-checklist__item--warn" : ""}">
            <div class="memory-checklist__title">${escapeHtml(item.title || "Finding")}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${missingData.length ? `
      <div class="detail-copy u-mt-10"><strong>Missing data</strong></div>
      <div class="detail-copy">${escapeHtml(missingData.slice(0, 4).map((item) => item.label || item.detail || "").join(" | "))}</div>
    ` : ""}
    ${assumptions.length ? `
      <div class="detail-copy u-mt-10"><strong>Assumptions / environment gaps</strong></div>
      <div class="detail-copy">${escapeHtml(assumptions.slice(0, 3).join(" | "))}</div>
    ` : ""}
    ${dataUsed.length ? `
      <div class="detail-copy u-mt-10"><strong>Data used</strong></div>
      <div class="workspace-chip-row">
        ${dataUsed.slice(0, 6).map((item) => `<span class="pill">${escapeHtml(`${item.label}: ${item.count}`)}</span>`).join("")}
      </div>
    ` : ""}
    ${evidence.length ? `
      <div class="detail-copy u-mt-10"><strong>Evidence</strong></div>
      <div class="detail-copy">${escapeHtml(evidence.map((item) => item.label || item.field || item.id).join(" | "))}</div>
    ` : ""}
    <div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(formatDateTime(report.generated_at || new Date().toISOString()))}</div>
  `;
}

function renderJobAgentAuditCard(job) {
  const cached = JOB_AGENT_REPORT_CACHE[job?.id] || null;
  return `
    <div class="detail-card u-mt-14">
      <div class="kicker">Billing readiness review</div>
      <div><strong>Billing review</strong></div>
      <div class="detail-copy">Review proof, notes, timing, linked billing records, and exact next moves without leaving this job.</div>
      <div class="action-row action-row--wrap u-mt-10">
        <button type="button" class="btn btn-ghost btn-sm" id="btnJobRunAudit">${cached ? "Run again" : "Run billing audit"}</button>
      </div>
      <div id="jobAuditMsg" class="msg u-mt-10"></div>
      <div id="jobAuditReport" class="u-mt-10">
        ${renderJobAgentReport(cached)}
      </div>
    </div>
  `;
}

function summaryReadyCount(summary = null) {
  return Number(summary?.readyCount || 0);
}

function summaryTotalCount(summary = null) {
  return Number(summary?.totalCount || 0);
}

function trackedStatusTone(status) {
  const normalized = normalizeWorkflowStatusValue(status || "scheduled");
  if (normalized === "completed") return "workspace-signal-band__item--good";
  if (["blocked", "cancelled"].includes(normalized)) return "workspace-signal-band__item--danger";
  if (["dispatched", "in_progress"].includes(normalized)) return "workspace-signal-band__item--warn";
  return "";
}

function renderJobExecutionSignalBand({ job, order, readiness, hydrovacState = null, amountDueCents = 0 } = {}) {
  if (!job) return "";
  const hydrovacExecution = typeof isHydrovacJob === "function" && isHydrovacJob(job);
  if (hydrovacExecution) {
    const manifestSnapshot = hydrovacState?.manifestSnapshot || hydrovacJobManifestSnapshot(job.id);
    const carryoverLoads = Array.isArray(hydrovacState?.truckLoads)
      ? hydrovacState.truckLoads.filter((manifest) => String(manifest?.job_id || "") !== String(job.id || ""))
      : [];
    return `
      <div class="workspace-signal-band">
        <div class="workspace-signal-band__item ${readiness?.blockers?.length ? "workspace-signal-band__item--danger" : "workspace-signal-band__item--good"}">
          <span>Dispatch blockers</span>
          <strong>${escapeHtml(String(readiness?.blockers?.length || 0))}</strong>
          <small>${escapeHtml(readiness?.blockers?.length ? "Clear customer, crew, permit, or load blockers before this truck rolls." : "Nothing is blocking the next field move right now.")}</small>
        </div>
        <div class="workspace-signal-band__item ${Number(manifestSnapshot?.openLoads || 0) ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
          <span>Open loads</span>
          <strong>${escapeHtml(String(Number(manifestSnapshot?.openLoads || 0)))}</strong>
          <small>${escapeHtml(Number(manifestSnapshot?.openLoads || 0) ? "Loads are still open on this job and need closeout attention." : "No hauled loads are hanging open on this record.")}</small>
        </div>
        <div class="workspace-signal-band__item ${carryoverLoads.length ? "workspace-signal-band__item--danger" : "workspace-signal-band__item--good"}">
          <span>Truck carryover</span>
          <strong>${escapeHtml(String(carryoverLoads.length))}</strong>
          <small>${escapeHtml(carryoverLoads.length ? "The assigned truck is still carrying pressure from another record." : "No conflicting live-load carryover is attached.")}</small>
        </div>
        <div class="workspace-signal-band__item ${amountDueCents > 0 ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
          <span>Due now</span>
          <strong>${escapeHtml(formatUsd(amountDueCents))}</strong>
          <small>${escapeHtml(amountDueCents > 0 ? "Close the field package and the billing follow-through together." : "No open balance is blocking clean closeout.")}</small>
        </div>
      </div>
    `;
  }

  return `
    <div class="workspace-signal-band">
      <div class="workspace-signal-band__item ${readiness?.blockers?.length ? "workspace-signal-band__item--danger" : "workspace-signal-band__item--good"}">
        <span>Readiness</span>
        <strong>${escapeHtml(`${summaryReadyCount(readiness)} / ${summaryTotalCount(readiness)}`)}</strong>
        <small>${escapeHtml(readiness?.blockers?.length ? "A few basics still need to be cleared before this work feels easy to run." : "The core field details are in place and ready to move.")}</small>
      </div>
      <div class="workspace-signal-band__item ${String(job?.assigned_member_id || job?.assigned_operator_id || "").trim() ? "workspace-signal-band__item--good" : "workspace-signal-band__item--warn"}">
        <span>Assigned crew</span>
        <strong>${escapeHtml(String(job?.assigned_member_id || job?.assigned_operator_id || "").trim() ? "Set" : "Open")}</strong>
        <small>${escapeHtml(String(job?.assigned_member_id || job?.assigned_operator_id || "").trim() ? "A crew owner is already attached to this work." : "Pick the tech or crew owner before the day gets noisy.")}</small>
      </div>
      <div class="workspace-signal-band__item ${amountDueCents > 0 ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Due now</span>
        <strong>${escapeHtml(formatUsd(amountDueCents))}</strong>
        <small>${escapeHtml(amountDueCents > 0 ? "Keep payment or invoice follow-through attached to the field record." : "No balance is still open on this work.")}</small>
      </div>
      <div class="workspace-signal-band__item ${trackedStatusTone(job?.status)}">
        <span>Current stage</span>
        <strong>${escapeHtml(titleCaseWords(String(job?.status || "scheduled").replace(/_/g, " ")))}</strong>
        <small>${escapeHtml(order ? `Booked work is ${formatOrderWorkflowStatus(order.status || "new")}.` : "No booked-work status is attached yet.")}</small>
      </div>
    </div>
  `;
}

function renderJobExecutionFocusCard({
  job,
  order,
  linkedCustomer,
  readiness,
  depositStatus,
  amountDueCents = 0,
  actions = [],
} = {}) {
  if (!job) return "";
  const teamMember = Array.isArray(TEAM_MEMBERS_CACHE)
    ? TEAM_MEMBERS_CACHE.find((member) => member.id === job.assigned_member_id || member.id === job.assigned_operator_id || member.user_id === job.assigned_operator_id)
    : null;
  const nextMove = readiness?.blockers?.length
    ? readiness.nextStep
    : amountDueCents > 0 && normalizeWorkflowStatusValue(job.status || "scheduled") === "completed"
      ? "Collect the open balance while the completed work is still fresh."
      : "Keep field updates, proof, and billing tied to this same job record.";

  return `
    <div class="detail-card detail-card--spaced workspace-focus-card">
      <div class="workspace-focus-card__head">
        <div>
          <div class="kicker">Execution focus</div>
          <div><strong>Keep the next field move obvious</strong></div>
        </div>
        <span class="pill ${readiness?.blockers?.length ? "pill-bad" : "pill-on"}">${escapeHtml(readiness?.blockers?.length ? `${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"}` : "Ready to move")}</span>
      </div>
      <div class="detail-copy">${escapeHtml(nextMove)}</div>
      <div class="workspace-focus-card__meta">
        <div class="workspace-focus-card__item ${readiness?.blockers?.length ? "workspace-focus-card__item--danger" : "workspace-focus-card__item--good"}">
          <span>Next move</span>
          <strong>${escapeHtml(readiness?.blockers?.length ? "Clear blockers" : "Keep momentum")}</strong>
          <small>${escapeHtml(nextMove)}</small>
        </div>
        <div class="workspace-focus-card__item ${teamMember ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn"}">
          <span>Crew owner</span>
          <strong>${escapeHtml(teamMember?.name || teamMember?.email || "Still open")}</strong>
          <small>${escapeHtml(teamMember ? "The field owner is already attached to this work." : "Assign the crew member who will own the field update and closeout.")}</small>
        </div>
        <div class="workspace-focus-card__item ${amountDueCents > 0 ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good"}">
          <span>Money follow-through</span>
          <strong>${escapeHtml(formatUsd(amountDueCents))}</strong>
          <small>${escapeHtml(amountDueCents > 0 ? "Keep invoice, deposit, or collection follow-through attached." : "Nothing is still owed on this work.")}</small>
        </div>
        <div class="workspace-focus-card__item ${depositStatus && depositStatus !== "paid" && depositStatus !== "not_due" ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good"}">
          <span>Deposit state</span>
          <strong>${escapeHtml(order ? formatDepositStatus(depositStatus) : "No booked work")}</strong>
          <small>${escapeHtml(linkedCustomer?.name ? `${linkedCustomer.name} stays tied to the work and money chain.` : "Link a customer to keep future service and payment history together.")}</small>
        </div>
      </div>
      ${actions.length ? `<div class="workspace-focus-card__buttons">${renderRecordActionButtons(actions)}</div>` : ""}
    </div>
  `;
}

function renderJobCloseoutCoachCard(job) {
  const cached = JOB_CLOSEOUT_AGENT_CACHE[job?.id] || null;
  return `
    <div class="detail-card u-mt-14">
      <div class="kicker">Closeout check</div>
      <div><strong>Field closeout review</strong></div>
      <div class="detail-copy">Review the field handoff package before the office has to clean it up later. This keeps proof, timing, signatures, and trade-specific closeout records in one place.</div>
      <div class="action-row action-row--wrap u-mt-10">
        <button type="button" class="btn btn-ghost btn-sm" id="btnJobRunCloseoutCoach">${cached ? "Run again" : "Run closeout review"}</button>
      </div>
      <div id="jobCloseoutCoachMsg" class="msg u-mt-10"></div>
      <div id="jobCloseoutCoachReport" class="u-mt-10">
        ${renderJobAgentReport(cached, "Run the closeout review to see what the field package still needs before the office takes over.")}
      </div>
    </div>
  `;
}

function renderJobSitePacketCard(job) {
  const cached = JOB_SITE_PACKET_AGENT_CACHE[job?.id] || null;
  return `
    <div class="detail-card u-mt-14">
      <div class="kicker">Site packet</div>
      <div><strong>Site packet review</strong></div>
      <div class="detail-copy">Pull the best-known site context together before dispatch: building details, access notes, arrival contacts, and the recent work history the next crew should not have to rediscover.</div>
      <div class="action-row action-row--wrap u-mt-10">
        <button type="button" class="btn btn-ghost btn-sm" id="btnJobRunSitePacket">${cached ? "Run again" : "Build site packet"}</button>
      </div>
      <div id="jobSitePacketMsg" class="msg u-mt-10"></div>
      <div id="jobSitePacketReport" class="u-mt-10">
        ${renderJobAgentReport(cached, "Build the site packet to review access, contact, proof history, and the site-specific context the crew should see before arrival.")}
      </div>
    </div>
  `;
}

function jobCloseoutChecklistItems(job, order, linkedCustomer, blueprint = jobsWorkspaceBlueprint(), amountDueCents = 0, readiness = null) {
  const businessKey = String(blueprint?.business?.key || "service_business").trim().toLowerCase();
  const bookingsApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
  const hydrovac = !!(job && typeof isHydrovacJob === "function" && isHydrovacJob(job, blueprint));
  const fieldStatus = normalizeWorkflowStatusValue(job?.status || "scheduled");
  const hydrovacCloseout = hydrovac ? (readiness?.hydrovacCloseout || hydrovacJobCloseoutState(job, order)) : null;
  const filled = (...values) => values.some((value) => String(value || "").trim());
  const firstFilled = (...values) => values.find((value) => String(value || "").trim()) || "";
  const timingInsight = linkedCustomer && typeof bookingsApi.bookingDraftTimingInsight === "function"
    ? bookingsApi.bookingDraftTimingInsight(linkedCustomer, {}, blueprint)
    : null;
  const detail = (label, ready, readyNote, missingNote) => ({
    label,
    ready: !!ready,
    note: ready ? readyNote : missingNote,
  });

  if (readiness?.blockers?.length && !(hydrovac && fieldStatus === "completed")) {
    return readiness.blockers.slice(0, 3).map((item) => ({
      label: item.label,
      ready: false,
      note: item.note || "Clear this before closeout.",
    }));
  }

  if (hydrovac) {
    const primaryManifest = hydrovacCloseout?.primaryManifest;
    const primaryRecordsManifest = hydrovacCloseout?.primaryRecordsManifest || primaryManifest;
    const primaryAuditManifest = hydrovacCloseout?.primaryAuditManifest || primaryManifest;
    const primaryInvoiceManifest = hydrovacCloseout?.primaryInvoiceManifest || primaryManifest;
    const manifestLabel = (manifest) => manifest?.manifest_number || manifest?.id || "the active load";
    const hasManifestSignals = hydrovacCloseout?.hasLoadSignals;
    const loadRecordsReady = !hasManifestSignals || (
      Number(hydrovacCloseout?.openLoads || 0) === 0
      && Number(hydrovacCloseout?.recordDetailGaps?.length || 0) === 0
    );
    const packetGapCount = Number(hydrovacCloseout?.packetGapCount || 0);
    const orderBalanceCents = Number(hydrovacCloseout?.orderBalanceCents || amountDueCents || 0);
    return [
      detail(
        "Field note saved",
        filled(job?.notes),
        firstFilled(job?.notes),
        "Save the field note before the office package leaves this record so dispatch, compliance, and billing are not guessing later."
      ),
      detail(
        "Load records confirmed",
        loadRecordsReady,
        hasManifestSignals
          ? `${hydrovacCloseout?.manifests?.length || 0} load${hydrovacCloseout?.manifests?.length === 1 ? "" : "s"} are tied down for closeout.`
          : "No hauled loads need closeout on this job.",
        !hasManifestSignals
          ? "Hauled load activity is flagged on the job, but the manifest record still needs to be attached here."
          : Number(hydrovacCloseout?.openLoads || 0) > 0
            ? `${hydrovacCloseout.openLoads} load${hydrovacCloseout.openLoads === 1 ? "" : "s"} still need confirmation before the office packet is clean.`
            : (hydrovacCloseout?.recordDetailGaps?.[0]?.message || `${manifestLabel(primaryManifest)} still needs the final disposal detail attached.`)
      ),
      detail(
        "Customer records ready",
        !packetGapCount || Number(hydrovacCloseout?.customerRecordsPending?.length || 0) === 0,
        hasManifestSignals
          ? "Customer-facing records are already prepared on the current manifest set."
          : "No customer-record package is needed because no hauled load is attached.",
        `Prepare the customer-records email for ${manifestLabel(primaryRecordsManifest)} before the file leaves the office.`
      ),
      detail(
        "Audit packet ready",
        !packetGapCount || Number(hydrovacCloseout?.auditPacketPending?.length || 0) === 0,
        hasManifestSignals
          ? "Audit handoff is already prepared on the current manifest set."
          : "No audit packet is needed because no hauled load is attached.",
        `Prepare the audit handoff for ${manifestLabel(primaryAuditManifest)} before records or compliance archive this job.`
      ),
      detail(
        "Billing handoff",
        !hydrovacCloseout?.moneyFollowThroughOpen && orderBalanceCents <= 0,
        "The hydrovac invoice and payment follow-through are already tied off.",
        hydrovacCloseout?.invoicePending?.length
          ? `Draft the hydrovac invoice for ${manifestLabel(primaryInvoiceManifest)} and keep the money chain attached to this job.`
          : orderBalanceCents > 0
            ? `Keep ${formatUsd(orderBalanceCents)} in follow-through until the balance is cleared.`
            : "Keep the invoice and money follow-through attached to this job until closeout is fully clean."
      ),
    ];
  }

  const repeatSignal = firstFilled(
    linkedCustomer?.service_schedule,
    linkedCustomer?.frequency,
    linkedCustomer?.recurring_notes,
    linkedCustomer?.service_plan_name,
    linkedCustomer?.maintenance_notes,
    linkedCustomer?.seasonal_notes,
    linkedCustomer?.parts_follow_up,
    linkedCustomer?.warranty_notes,
    linkedCustomer?.restoration_notes,
    linkedCustomer?.approval_notes,
    linkedCustomer?.follow_up_notes
  );
  const nextTouch = firstFilled(
    linkedCustomer?.next_service_on,
    linkedCustomer?.follow_up_notes,
    linkedCustomer?.service_plan_name
  );
  const renewalRiskItem = repeatSignal
    ? detail(
        "Renewal risk",
        !!nextTouch,
        `The next repeat step is already visible here: ${nextTouch}.`,
        timingInsight?.reason
          ? `${timingInsight.reason}${timingInsight.bookingDate ? ` Suggested next visit: ${timingInsight.bookingDate}.` : ""}`
          : "This account has repeat-service signals, but the next visit or follow-up step still needs to be attached before it cools off."
      )
    : null;

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
    renewalRiskItem,
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
    renewalRiskItem,
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
    renewalRiskItem,
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
    renewalRiskItem,
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
    renewalRiskItem,
  ];

  return ({
    landscaping,
    property_maintenance: landscaping,
    pressure_washing: landscaping,
    cleaning,
    hvac,
    plumbing,
  })[businessKey]?.filter(Boolean) || fallback.filter(Boolean);
}

function buildJobCloseoutGuidance(job, order, readiness, amountDueCents, linkedCustomer = null, blueprint = jobsWorkspaceBlueprint()) {
  const fieldStatus = normalizeWorkflowStatusValue(job?.status || "scheduled");
  const hydrovac = !!(job && typeof isHydrovacJob === "function" && isHydrovacJob(job, blueprint));
  const hydrovacCloseout = hydrovac ? (readiness?.hydrovacCloseout || hydrovacJobCloseoutState(job, order)) : null;
  if (hydrovac && fieldStatus === "completed" && hydrovacCloseout?.hasLoadSignals) {
    const packetGapCount = Number(hydrovacCloseout.packetGapCount || 0);
    const invoicePendingCount = Number(hydrovacCloseout.invoicePending?.length || 0);
    const orderBalanceCents = Number(hydrovacCloseout.orderBalanceCents || amountDueCents || 0);
    return {
      title: hydrovacCloseout.clean
        ? "Hydrovac closeout is clean and ready to stay closed"
        : "Field work is done. Finish the hydrovac closeout before it leaves the office",
      description: hydrovacCloseout.clean
        ? "The manifest set, customer-facing records, audit handoff, and money follow-through are attached to this same job, so the office can leave it closed with confidence."
        : hydrovacCloseout.openLoads > 0
          ? "The crew is done, but hauled loads still need confirmation and office closeout. Keep the manifest, records, audit handoff, and billing chain on this job until the packet is clean."
          : packetGapCount > 0
            ? "The disposal record is in place, but the office handoff is not. Finish the customer records and audit packet while the load history is still fresh."
            : invoicePendingCount > 0 || orderBalanceCents > 0
              ? "The load records are ready, but the money chain is not. Draft the hydrovac invoice and clear the balance before this closeout disappears into the backlog."
              : "Keep the hydrovac packet tied to this job so dispatch, compliance, and money stay on the same source record.",
      chips: [
        `${hydrovacCloseout.manifests.length} load${hydrovacCloseout.manifests.length === 1 ? "" : "s"} tracked`,
        hydrovacCloseout.openLoads > 0
          ? `${hydrovacCloseout.openLoads} open load${hydrovacCloseout.openLoads === 1 ? "" : "s"}`
          : "Loads confirmed",
        packetGapCount > 0
          ? `${packetGapCount} packet gap${packetGapCount === 1 ? "" : "s"}`
          : "Packet ready",
        invoicePendingCount > 0
          ? `${invoicePendingCount} waiting on invoice`
          : orderBalanceCents > 0
            ? `${formatUsd(orderBalanceCents)} still open`
            : "Money chain ready",
      ],
      items: jobCloseoutChecklistItems(job, order, linkedCustomer, blueprint, amountDueCents, readiness),
    };
  }
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

function buildJobReactivationActions(job, order, linkedCustomer = null, amountDueCents = 0, blueprint = jobsWorkspaceBlueprint()) {
  const fieldStatus = normalizeWorkflowStatusValue(job?.status || "scheduled");
  if (fieldStatus !== "completed" || amountDueCents > 0 || !linkedCustomer) return [];
  const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
  if (typeof customerApi.customerRetentionWorkflowActions === "function") {
    return customerApi.customerRetentionWorkflowActions({
      customer: linkedCustomer,
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

function buildJobCompletionActions(job, order, linkedCustomer = null, amountDueCents = 0, blueprint = jobsWorkspaceBlueprint()) {
  const fieldStatus = normalizeWorkflowStatusValue(job?.status || "scheduled");
  if (fieldStatus !== "completed") return [];
  const reviewEmail = String(order?.customer_email || order?.email || "").trim();
  const hydrovac = !!(job && typeof isHydrovacJob === "function" && isHydrovacJob(job, blueprint));
  const hydrovacCloseout = hydrovac ? hydrovacJobCloseoutState(job, order) : null;

  if (hydrovacCloseout?.hasLoadSignals && !hydrovacCloseout.clean) {
    const actions = [];
    if (hydrovacCloseout.customerRecordsPending.length) {
      actions.push({
        label: "Prepare customer records",
        action: "prepare-customer-records",
        className: "btn btn-primary btn-sm",
      });
    }
    if (hydrovacCloseout.auditPacketPending.length) {
      actions.push({
        label: "Prepare audit handoff",
        action: "prepare-audit-handoff",
        className: actions.length ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm",
      });
    }
    if (hydrovacCloseout.invoicePending.length && order?.id) {
      actions.push({
        label: "Draft hydrovac invoice",
        action: "draft-hydrovac-invoice",
        className: "btn btn-ghost btn-sm",
      });
    }
    if (hydrovacCloseout.moneyFollowThroughOpen) {
      actions.push({
        label: "Open money",
        action: "open-money",
        className: "btn btn-ghost btn-sm",
      });
    }
    actions.push({
      label: "Open hydrovac ops",
      action: "open-hydrovac-ops",
      className: "btn btn-ghost btn-sm",
    });
    return actions;
  }

  const actions = [];
  if (order?.id && reviewEmail && !order?.review_requested_at) {
    actions.push({
      label: "Request review",
      action: "request-review",
      className: "btn btn-ghost btn-sm",
    });
  }

  return [
    ...actions,
    ...buildJobReactivationActions(job, order, linkedCustomer, amountDueCents, blueprint),
  ];
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
  const hydrovacCloseout = isHydrovacJob(job) ? (readiness?.hydrovacCloseout || hydrovacJobCloseoutState(job, order, hydrovacState)) : null;
  const fieldActualMins = job.actual_start_at && job.actual_end_at
    ? Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000)
    : null;
  const fieldStatus = normalizeWorkflowStatusValue(job.status || "scheduled");
  const fieldDueNow = Number(job.amount_due_cents || orderAmountDueCents(order) || 0);
  const closeoutGuidance = buildJobCloseoutGuidance(job, order, readiness, fieldDueNow, linkedCustomer, blueprint);
  const completionActions = buildJobCompletionActions(job, order, linkedCustomer, fieldDueNow, blueprint);
  const fieldActionButtons = [
    ["scheduled", "dispatched"].includes(fieldStatus) ? { label: "Start work", className: "btn btn-primary", data: { "job-field-action": "start" } } : null,
    fieldStatus === "blocked" ? { label: "Resume work", className: "btn btn-primary", data: { "job-field-action": "resume" } } : null,
    ["scheduled", "dispatched", "in_progress"].includes(fieldStatus) ? { label: "Mark blocked", className: "btn btn-ghost", data: { "job-field-action": "block" } } : null,
    !["completed", "cancelled"].includes(fieldStatus) ? { label: "Complete job", className: "btn btn-ghost", data: { "job-field-action": "complete" } } : null,
    { label: "Save field note", id: "btnJobSaveFieldNote", className: "btn btn-ghost" },
  ].filter(Boolean);
  const jobActionButtons = [
    order ? { label: "Open booked work", className: "btn btn-primary", data: { "job-quick-action": "open-order" } } : null,
    isHydrovacJob(job) ? { label: "Open dispatch", className: "btn btn-ghost", data: { "job-quick-action": "open-dispatch" } } : null,
    { label: linkedCustomer ? "Open customer" : "Open customers", className: "btn btn-ghost", data: { "job-quick-action": "open-customer" } },
    { label: "Record payment", className: "btn btn-ghost", data: { "job-quick-action": "record-payment" }, disabled: !order },
    { label: "Log job cost", className: "btn btn-ghost", data: { "job-quick-action": "log-cost" } },
  ].filter(Boolean);
  jobDetailWrap.innerHTML = `
    <div class="workspace-command-center ${isHydrovacJob(job) ? "workspace-command-center--hydrovac" : ""}">
      <div class="workspace-command-center__top">
        <div class="workspace-command-center__hero">
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
        actionsHtml: renderJobExecutionSignalBand({
          job,
          order,
          readiness,
          hydrovacState,
          amountDueCents: fieldDueNow,
        }),
      })}
        </div>
        <div class="workspace-command-center__sidebar">
          ${renderJobExecutionFocusCard({
            job,
            order,
            linkedCustomer,
            readiness,
            depositStatus,
            amountDueCents: fieldDueNow,
            actions: jobActionButtons,
          })}
        </div>
      </div>
      <div class="workspace-command-center__main">
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
    ${renderJobSitePacketCard(job)}
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
      ${completionActions.length ? `
        <div class="action-row action-row--wrap u-mt-10">
          ${completionActions.map((action) => `
            <button type="button" class="${escapeAttr(action.className || "btn btn-ghost btn-sm")}" data-job-reactivation-action="${escapeAttr(action.action || "")}">${escapeHtml(action.label || "Take action")}</button>
          `).join("")}
        </div>
      ` : ""}
    </div>
    ${renderJobCloseoutCoachCard(job)}
    ${renderJobAgentAuditCard(job)}
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
      </div>
    </div>
  `;
  jobDetailWrap.querySelectorAll('[data-job-cost-action="log"]').forEach((button) => {
    button.addEventListener("click", () => openExpenseForJob(job));
  });
  jobDetailWrap.querySelector('#btnJobRunAudit')?.addEventListener("click", async () => {
    const msgEl = jobDetailWrap.querySelector('#jobAuditMsg');
    const reportEl = jobDetailWrap.querySelector('#jobAuditReport');
    if (typeof requestOperatorFunction !== "function") {
      setInlineMessage(msgEl, "Audit tools are not ready yet.", "error");
      return;
    }
    setInlineMessage(msgEl, "Running billing audit...");
    try {
      const result = await requestOperatorFunction("ai-agent-report", {
        method: "POST",
        body: {
          agent_key: "job_record_auditor",
          job_id: job.id,
        },
      });
      JOB_AGENT_REPORT_CACHE[job.id] = result.report || null;
      if (reportEl) reportEl.innerHTML = renderJobAgentReport(result.report || null);
      setInlineMessage(msgEl, "Billing audit ready.", "good");
    } catch (error) {
      setInlineMessage(msgEl, error?.message || "Failed to run the billing audit.", "error");
    }
  });
  jobDetailWrap.querySelector('#btnJobRunCloseoutCoach')?.addEventListener("click", async () => {
    const msgEl = jobDetailWrap.querySelector('#jobCloseoutCoachMsg');
    const reportEl = jobDetailWrap.querySelector('#jobCloseoutCoachReport');
    if (typeof requestOperatorFunction !== "function") {
      setInlineMessage(msgEl, "Closeout review tools are not ready yet.", "error");
      return;
    }
    setInlineMessage(msgEl, "Running closeout review...");
    try {
      const result = await requestOperatorFunction("ai-agent-report", {
        method: "POST",
        body: {
          agent_key: "field_closeout_coach",
          job_id: job.id,
        },
      });
      JOB_CLOSEOUT_AGENT_CACHE[job.id] = result.report || null;
      if (reportEl) reportEl.innerHTML = renderJobAgentReport(result.report || null, "Run the closeout review to see what the field package still needs before the office takes over.");
      setInlineMessage(msgEl, "Closeout review ready.", "good");
    } catch (error) {
      setInlineMessage(msgEl, error?.message || "Failed to run the closeout review.", "error");
    }
  });
  jobDetailWrap.querySelector('#btnJobRunSitePacket')?.addEventListener("click", async () => {
    const msgEl = jobDetailWrap.querySelector('#jobSitePacketMsg');
    const reportEl = jobDetailWrap.querySelector('#jobSitePacketReport');
    if (typeof requestOperatorFunction !== "function") {
      setInlineMessage(msgEl, "Site-packet tools are not ready yet.", "error");
      return;
    }
    setInlineMessage(msgEl, "Building site packet...");
    try {
      const result = await requestOperatorFunction("ai-agent-report", {
        method: "POST",
        body: {
          agent_key: "site_packet_builder",
          job_id: job.id,
        },
      });
      JOB_SITE_PACKET_AGENT_CACHE[job.id] = result.report || null;
      if (reportEl) reportEl.innerHTML = renderJobAgentReport(result.report || null, "Build the site packet to review access, contact, proof history, and the site-specific context the crew should see before arrival.");
      setInlineMessage(msgEl, "Site packet ready.", "good");
    } catch (error) {
      setInlineMessage(msgEl, error?.message || "Failed to build the site packet.", "error");
    }
  });
  const syncFieldJobState = (patch = {}) => {
    if (Object.prototype.hasOwnProperty.call(patch, "status")) job.status = patch.status;
    if (Object.prototype.hasOwnProperty.call(patch, "notes")) job.notes = patch.notes;
    if (Object.prototype.hasOwnProperty.call(patch, "actual_start_at")) job.actual_start_at = patch.actual_start_at;
    if (Object.prototype.hasOwnProperty.call(patch, "actual_end_at")) job.actual_end_at = patch.actual_end_at;
    if (Object.prototype.hasOwnProperty.call(patch, "check_in_lat")) job.check_in_lat = patch.check_in_lat;
    if (Object.prototype.hasOwnProperty.call(patch, "check_in_lng")) job.check_in_lng = patch.check_in_lng;
  };
  const openMoneyFollowThrough = () => {
    ACTIVE_JOB_ID = job.id;
    if (order?.id) {
      ACTIVE_ORDER_ID = order.id;
      clearPaymentForm({
        customerId: job.customer_id || order.customer_id || "",
        orderId: order.id,
        amount: money(Number(job.amount_due_cents || orderAmountDueCents(order) || 0)),
      });
      renderPayments();
    }
    switchTab("payments");
  };
  const openHydrovacOpsCloseout = (manifest = hydrovacCloseout?.primaryManifest || hydrovacCloseout?.primaryRecordsManifest || hydrovacCloseout?.primaryInvoiceManifest) => {
    if (manifest?.id) ACTIVE_MANIFEST_ID = manifest.id;
    switchTab("manifests");
  };
  const prepareHydrovacCustomerRecords = async (manifest = hydrovacCloseout?.primaryRecordsManifest) => {
    if (!manifest) {
      setInlineMessage(jobMsg, "No manifest is ready for customer records yet.", "error");
      return;
    }
    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
    if (typeof hydrovacManifestCustomerRecordsDraft !== "function") {
      setInlineMessage(jobMsg, "Customer-record tools are not ready yet.", "error");
      return;
    }
    const draft = hydrovacManifestCustomerRecordsDraft(manifest, job, order, linkedCustomer);
    if (typeof coreUtils.openManualEmailPrep === "function") {
      const prepared = await coreUtils.openManualEmailPrep({
        title: "Customer records email",
        recipientName: linkedCustomer?.name || order?.customer_name || "Customer",
        recipientEmail: linkedCustomer?.email || order?.customer_email || order?.email || "",
        contextLabel: "Hydrovac load records",
        reason: "Review this records email before you send it. ProofLink prepares the record, but the office still decides when it goes out.",
        subject: draft.subject,
        message: draft.body,
        confirmText: "Mark records ready",
        cancelText: "Keep for later",
      });
      if (!prepared?.confirmed) return;
    } else if (typeof coreUtils.showCopyModal === "function") {
      await coreUtils.showCopyModal("Prepare this customer-records email, then send it manually when you are ready.", `${draft.subject}\n\n${draft.body}`, "Done");
    } else {
      setInlineMessage(jobMsg, "Customer-record tools are not ready yet.", "error");
      return;
    }
    setInlineMessage(jobMsg, "Marking customer records ready...");
    await requestOperatorFunction("manage-waste-manifests", {
      method: "PATCH",
      body: { id: manifest.id, customer_records_prepared_at: new Date().toISOString() },
    });
    await Promise.all([
      fetchJobHydrovacDetails(job.id, { force: true }).catch(() => null),
      fetchJobs().catch(() => null),
    ]);
    await renderJobDetail(job.id);
    setInlineMessage(jobMsg, "Customer records marked ready.", "good");
  };
  const prepareHydrovacAuditHandoff = async (manifest = hydrovacCloseout?.primaryAuditManifest) => {
    if (!manifest) {
      setInlineMessage(jobMsg, "No manifest is ready for audit handoff yet.", "error");
      return;
    }
    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
    if (typeof hydrovacManifestAuditPacket !== "function") {
      setInlineMessage(jobMsg, "Audit-packet tools are not ready yet.", "error");
      return;
    }
    const packet = hydrovacManifestAuditPacket(manifest, job, order, linkedCustomer);
    if (typeof coreUtils.openManualEmailPrep === "function") {
      const prepared = await coreUtils.openManualEmailPrep({
        title: "Audit handoff",
        recipientName: "Auditor or records contact",
        recipientEmail: "",
        contextLabel: "Hydrovac compliance packet",
        reason: "Review this audit handoff before you send it. ProofLink prepares the packet, but audit communication stays manual.",
        subject: `${manifest.manifest_number || manifest.id || "Manifest"} audit packet`,
        message: packet,
        confirmText: "Mark packet ready",
        cancelText: "Keep for later",
      });
      if (!prepared?.confirmed) return;
    } else if (typeof coreUtils.showCopyModal === "function") {
      await coreUtils.showCopyModal("Copy this audit packet into the packet, email, or binder you keep for compliance records.", packet, "Done");
    } else {
      setInlineMessage(jobMsg, "Audit-packet tools are not ready yet.", "error");
      return;
    }
    setInlineMessage(jobMsg, "Marking audit handoff ready...");
    await requestOperatorFunction("manage-waste-manifests", {
      method: "PATCH",
      body: { id: manifest.id, audit_packet_prepared_at: new Date().toISOString() },
    });
    await Promise.all([
      fetchJobHydrovacDetails(job.id, { force: true }).catch(() => null),
      fetchJobs().catch(() => null),
    ]);
    await renderJobDetail(job.id);
    setInlineMessage(jobMsg, "Audit handoff marked ready.", "good");
  };
  const draftHydrovacInvoice = async () => {
    setInlineMessage(jobMsg, "Drafting hydrovac invoice...");
    await postOperatorFunction("generate-hydrovac-invoice", { job_id: job.id });
    await Promise.all([
      fetchCrmOrders(),
      fetchJobs(),
      fetchJobHydrovacDetails(job.id, { force: true }).catch(() => null),
    ]);
    await renderJobDetail(job.id);
    setInlineMessage(jobMsg, "Hydrovac invoice draft created on the linked order.", "good");
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
      if (action === "open-dispatch") {
        ACTIVE_DISPATCH_JOB_ID = job.id;
        if (dispatchDate && job.scheduled_date) dispatchDate.value = job.scheduled_date;
        switchTab("dispatch");
        return;
      }
      if (action === "record-payment") {
        openMoneyFollowThrough();
        return;
      }
      if (action === "log-cost") {
        openExpenseForJob(job);
      }
    });
  });
  jobDetailWrap.querySelectorAll("[data-job-reactivation-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-job-reactivation-action") || "";
      const msgEl = jobDetailWrap.querySelector("#jobFieldUpdateMsg");
      if (action === "prepare-customer-records") {
        await prepareHydrovacCustomerRecords();
        return;
      }
      if (action === "prepare-audit-handoff") {
        await prepareHydrovacAuditHandoff();
        return;
      }
      if (action === "draft-hydrovac-invoice") {
        try {
          await draftHydrovacInvoice();
        } catch (error) {
          setInlineMessage(msgEl, error?.message || "Failed to draft hydrovac invoice.", "error");
        }
        return;
      }
      if (action === "open-money") {
        openMoneyFollowThrough();
        return;
      }
      if (action === "open-hydrovac-ops") {
        openHydrovacOpsCloseout();
        return;
      }
      if (action === "request-review") {
        if (!order?.id) return;
        try {
          const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
          if (typeof coreUtils.requestOrderReview !== "function") {
            throw new Error("Review request tools are not ready yet.");
          }
          const reviewResult = await coreUtils.requestOrderReview(order.id, {
            button,
            setStatus: (message = "", tone = "") => setInlineMessage(msgEl, message, tone),
            customerName: order.customer_name || linkedCustomer?.name || "there",
            businessName: typeof bidBrandContext === "function" ? bidBrandContext().tenantName : "our team",
            onSuccess: async (_payload, reviewRequestedAt) => {
              order.review_requested_at = reviewRequestedAt;
              await fetchCrmOrders();
              renderOrders();
              renderDashboard();
              renderGuidance();
            },
          });
          order.review_requested_at = reviewResult.review_requested_at;
        } catch (error) {
          setInlineMessage(msgEl, error.message || String(error), "error");
        }
        return;
      }
      if (action === "open-reactivation-customer" || action === "reactivate-repeat" || action === "request" || action === "create-request" || action === "generate-next-order") {
        const customerApi = window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL || {};
        if (linkedCustomer && typeof customerApi.openCustomerRetentionAction === "function") {
          customerApi.openCustomerRetentionAction(action, linkedCustomer, blueprint, {
            requestOptions: {
              message: action === "create-request" ? "Follow-up request created from job closeout." : "Follow-up request draft opened from job closeout.",
              successMessage: "Follow-up request created from job closeout.",
              pendingMessage: "Creating follow-up request from job closeout...",
              sourceRecordType: "job",
              sourceRecordId: job.id || "",
            },
          });
          return;
        }
        if (action === "open-reactivation-customer") {
          if (linkedCustomer?.id) {
            ACTIVE_CUSTOMER_ID = linkedCustomer.id;
            CUSTOMER_CREATING = false;
          }
          switchTab("customers");
          return;
        }
        if (action === "reactivate-repeat") {
          const bookingsApi = window.PROOFLINK_OPERATOR_BOOKINGS_WORKSPACE || {};
          if (linkedCustomer && typeof bookingsApi.openBookingDraftForCustomer === "function") {
            bookingsApi.openBookingDraftForCustomer(linkedCustomer, {}, blueprint);
          } else {
            switchTab("bookings");
          }
        }
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
            bol_number: jobDetailWrap.querySelector('#jobHydrovacManifestBol')?.value || "",
            disposal_ready_by: jobDetailWrap.querySelector('#jobHydrovacManifestReadyBy')?.value || "",
            live_load_hold_reason: jobDetailWrap.querySelector('#jobHydrovacManifestHoldReason')?.value || "",
            load_still_in_truck: jobDetailWrap.querySelector('#jobHydrovacManifestStillLive')?.checked === true,
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
    jobDetailWrap.querySelectorAll('[data-hv-customer-records]').forEach((button) => {
      button.addEventListener("click", async () => {
        const manifestId = button.getAttribute("data-hv-customer-records") || "";
        const manifest = (hydrovacState?.manifests || []).find((row) => row.id === manifestId);
        if (!manifest) return;
        try {
          await prepareHydrovacCustomerRecords(manifest);
        } catch (error) {
          setInlineMessage(jobMsg, error?.message || "Failed to prepare customer records.", "error");
        }
      });
    });
    jobDetailWrap.querySelectorAll('[data-hv-audit-summary]').forEach((button) => {
      button.addEventListener("click", async () => {
        const manifestId = button.getAttribute("data-hv-audit-summary") || "";
        const manifest = (hydrovacState?.manifests || []).find((row) => row.id === manifestId);
        if (!manifest) return;
        const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
        if (typeof hydrovacManifestAuditSummary !== "function" || typeof coreUtils.showCopyModal !== "function") {
          setInlineMessage(jobMsg, "Audit-summary tools are not ready yet.", "error");
          return;
        }
        await coreUtils.showCopyModal("Copy this audit summary into the packet, email, or binder you keep for compliance records.", hydrovacManifestAuditSummary(manifest, job, order, linkedCustomer), "Done");
      });
    });
    jobDetailWrap.querySelector('[data-hv-action="invoice"]')?.addEventListener("click", async () => {
      try {
        await draftHydrovacInvoice();
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
  hydrovacJobCloseoutState,
  buildJobCloseoutGuidance,
  buildJobCompletionActions,
  buildJobReactivationActions,
  renderJobDetail,
  renderJobs,
};

window.PROOFLINK_OPERATOR_JOBS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_JOBS_WORKSPACE || {}),
  ...JOBS_WORKSPACE_HELPERS,
};

Object.assign(window, JOBS_WORKSPACE_HELPERS);
