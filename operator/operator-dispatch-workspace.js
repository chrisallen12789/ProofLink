// Hydrovac dispatch workspace extracted from operator.js
// so crew assignment and readiness live in one focused module.
const DISPATCH_TRUCK_LOAD_CACHE = new Map();
const DISPATCH_AGENT_REVIEW_CACHE = window.PROOFLINK_DISPATCH_AGENT_REVIEW_CACHE || (window.PROOFLINK_DISPATCH_AGENT_REVIEW_CACHE = {});

function dispatchManifestMeta(row) {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function dispatchManifestIsLive(row) {
  const metadata = dispatchManifestMeta(row);
  if (metadata.load_still_in_truck === true) return true;
  return String(metadata.load_state || "").trim().toLowerCase() === "live_in_truck";
}

function dispatchManifestBolNumber(row) {
  const metadata = dispatchManifestMeta(row);
  return String(metadata.bol_number || metadata.bill_of_lading_number || "").trim();
}

function dispatchManifestHoldReason(row) {
  const metadata = dispatchManifestMeta(row);
  return String(metadata.live_load_hold_reason || metadata.hold_reason || "").trim();
}

function dispatchManifestReadyBy(row) {
  const metadata = dispatchManifestMeta(row);
  return String(metadata.disposal_ready_by || "").trim();
}

function dispatchManifestLifecycleLabel(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  const metadata = dispatchManifestMeta(row);
  if (String(metadata.audit_archived_at || "").trim() || status === "archived") return "Archived for audit";
  if (row?.invoiced === true) return "Billed";
  if (dispatchManifestIsLive(row)) return "Live in truck";
  if (status === "confirmed") return "Disposed";
  if (["delivered", "in_transit"].includes(status)) return "Ready for disposal";
  return "Loaded";
}

function dispatchTruckLoadState(truckId) {
  return DISPATCH_TRUCK_LOAD_CACHE.get(String(truckId || "").trim()) || {
    truckId: String(truckId || "").trim(),
    rows: [],
    loading: false,
    error: "",
    loadedAt: 0,
  };
}

function setDispatchTruckLoadState(truckId, nextState = {}) {
  const truckKey = String(truckId || "").trim();
  const current = dispatchTruckLoadState(truckKey);
  const merged = { ...current, ...nextState, truckId: truckKey };
  DISPATCH_TRUCK_LOAD_CACHE.set(truckKey, merged);
  return merged;
}

async function fetchDispatchTruckLoads(truckId, options = {}) {
  const truckKey = String(truckId || "").trim();
  if (!truckKey) return dispatchTruckLoadState("");
  const existing = dispatchTruckLoadState(truckKey);
  const freshEnough = existing.loadedAt && (Date.now() - existing.loadedAt) < 20000;
  if (!options.force && (existing.loading || freshEnough)) return existing;

  setDispatchTruckLoadState(truckKey, { loading: true, error: "" });
  try {
    const payload = await requestOperatorFunction("manage-waste-manifests", {
      query: `action=all&truck_id=${encodeURIComponent(truckKey)}&live_only=1&limit=100`,
    });
    return setDispatchTruckLoadState(truckKey, {
      rows: Array.isArray(payload?.manifests) ? payload.manifests : [],
      loading: false,
      error: "",
      loadedAt: Date.now(),
    });
  } catch (error) {
    return setDispatchTruckLoadState(truckKey, {
      loading: false,
      error: error?.message || "Failed to load truck manifests.",
      loadedAt: Date.now(),
    });
  }
}

function dispatchTruckPlanner(truck, job = null, targetDate = "") {
  const truckId = String(truck?.id || truck || "").trim();
  const state = dispatchTruckLoadState(truckId);
  const rows = Array.isArray(state.rows) ? state.rows : [];
  const liveLoads = rows.filter((row) => dispatchManifestIsLive(row));
  const carryoverLoads = liveLoads.filter((row) => String(row?.job_id || "") !== String(job?.id || ""));
  const jobCustomerId = String(job?.customer_id || "").trim();
  const sameCustomerLoads = carryoverLoads.filter((row) => jobCustomerId && String(row?.customer_id || "") === jobCustomerId);
  const crossCustomerLoads = carryoverLoads.filter((row) => !jobCustomerId || String(row?.customer_id || "") !== jobCustomerId);
  const undocumentedLoads = carryoverLoads.filter((row) => !dispatchManifestBolNumber(row) || !dispatchManifestHoldReason(row));
  const overdueLoads = carryoverLoads.filter((row) => {
    const readyBy = dispatchManifestReadyBy(row);
    return readyBy && targetDate && readyBy < targetDate;
  });
  const dueLoads = carryoverLoads.filter((row) => {
    const readyBy = dispatchManifestReadyBy(row);
    return readyBy && targetDate && readyBy === targetDate;
  });
  const gallons = rows.reduce((sum, row) => (
    sum + Number(row?.quantity_actual || row?.quantity_estimated || 0)
  ), 0);
  const capacityGallons = Number(truck?.debris_tank_capacity_gallons || 0);
  const fillPercent = capacityGallons > 0
    ? Math.max(0, Math.min(100, Math.round((gallons / capacityGallons) * 100)))
    : 0;

  const warnings = [];
  if (crossCustomerLoads.length) {
    warnings.push({
      label: "Cross-contamination risk",
      blocking: true,
      note: `${crossCustomerLoads[0].manifest_number || crossCustomerLoads[0].id || "A live load"} still belongs to another account. Clear or dispose that load before this truck is assigned.`,
    });
  }
  if (undocumentedLoads.length) {
    warnings.push({
      label: "Load records incomplete",
      blocking: true,
      note: `${undocumentedLoads[0].manifest_number || undocumentedLoads[0].id || "A live load"} still needs a BOL and live-load hold reason before it can stay on the truck.`,
    });
  }
  if (sameCustomerLoads.length) {
    warnings.push({
      label: "Live load still attached",
      blocking: false,
      note: `${sameCustomerLoads[0].manifest_number || sameCustomerLoads[0].id || "A live load"} is still tied to this customer. Keep it isolated, confirm the waste stream, and decide whether it stays with this work or goes to disposal first.`,
    });
  }
  if (overdueLoads.length) {
    warnings.push({
      label: "Disposal overdue",
      blocking: false,
      note: `${overdueLoads[0].manifest_number || overdueLoads[0].id || "A live load"} was supposed to be handled before today. Clear it before this truck becomes tomorrow's problem too.`,
    });
  } else if (dueLoads.length) {
    warnings.push({
      label: "Disposal due today",
      blocking: false,
      note: `${dueLoads[0].manifest_number || dueLoads[0].id || "A live load"} is marked ready for disposal today. Plan the dump run so this truck does not stall later in the day.`,
    });
  }

  return {
    truckId,
    rows,
    liveLoads,
    carryoverLoads,
    sameCustomerLoads,
    crossCustomerLoads,
    undocumentedLoads,
    overdueLoads,
    dueLoads,
    warnings,
    gallons,
    capacityGallons,
    fillPercent,
    loading: state.loading,
    error: state.error,
  };
}

function dispatchTruckAuditPacket(truck, planner, jobs = JOBS_CACHE, customers = CUSTOMERS_CACHE) {
  const rows = Array.isArray(planner?.rows) ? planner.rows : [];
  return [
    `Truck: ${truck?.unit_number || truck?.name || truck?.id || "Truck"}`,
    `Live loads on board: ${planner?.liveLoads?.length || 0}`,
    `Carryover loads: ${planner?.carryoverLoads?.length || 0}`,
    `Tank load: ${planner?.capacityGallons ? `${Math.round(planner.gallons)} / ${planner.capacityGallons} gal` : `${Math.round(planner?.gallons || 0)} gal tracked`}`,
    "",
    ...rows.map((row) => {
      const job = (jobs || []).find((candidate) => candidate.id === row.job_id) || null;
      const customer = (customers || []).find((candidate) => candidate.id === row.customer_id) || null;
      return [
        `Manifest: ${row.manifest_number || row.id || "Pending"}`,
        `Lifecycle: ${dispatchManifestLifecycleLabel(row)}`,
        `Customer: ${customer?.name || job?.customer_name || "Unknown"}`,
        `Job: ${job?.title || row.pickup_address || "Not linked"}`,
        `BOL: ${dispatchManifestBolNumber(row) || "Pending"}`,
        `Ready by: ${dispatchManifestReadyBy(row) || "Not set"}`,
        `Hold reason: ${dispatchManifestHoldReason(row) || "Not documented"}`,
        `Quantity: ${Number(row?.quantity_actual || row?.quantity_estimated || 0) || "Pending"}`,
        "",
      ].join("\n");
    }),
  ].join("\n");
}

function dispatchAgentStatusTone(status) {
  if (status === "ready") return "pill-good";
  if (status === "blocked") return "pill-bad";
  return "pill-warn";
}

function dispatchAgentPriorityTone(priority) {
  if (priority === "high") return "pill-bad";
  if (priority === "low") return "";
  return "pill-warn";
}

function dispatchAgentTimestamp(value) {
  if (typeof formatDateTime === "function") return formatDateTime(value || new Date().toISOString());
  return String(value || "");
}

function dispatchAgentPrimaryRef(item = {}) {
  return (Array.isArray(item.record_refs) ? item.record_refs : []).find((ref) => ref && ref.record_type === "job" && ref.record_id) || null;
}

function openDispatchAgentJob(jobId, targetDate = "") {
  if (!jobId) return;
  const matchingHydrovacJob = (JOBS_CACHE || []).find((job) => job.id === jobId && isHydrovacJob(job) && (!targetDate || hydrovacJobSortDate(job) === targetDate));
  if (matchingHydrovacJob) {
    ACTIVE_DISPATCH_JOB_ID = jobId;
    renderDispatchWorkspace();
    return;
  }
  ACTIVE_JOB_ID = jobId;
  if (typeof switchTab === "function") switchTab("jobs");
}

function renderDispatchAgentReview(state = null, targetDate = "") {
  const report = state?.report || null;
  const titleCopy = targetDate ? `Run a grounded review for ${targetDate}` : "Run a grounded review of the upcoming dispatch plan";
  if (!report) {
    return `
      <div class="detail-card detail-card--spaced">
        <div class="kicker">Dispatch review</div>
        <div><strong>Dispatch / Scheduling Assistant</strong></div>
        <div class="detail-copy">${escapeHtml(titleCopy)} so missing dates, missing assignments, and same-day route opportunities are surfaced before the crew rolls.</div>
        <div class="action-row action-row--wrap u-mt-10">
          <button id="btnRunDispatchAgentReview" class="btn btn-ghost btn-sm" type="button">Run dispatch review</button>
        </div>
        <div id="dispatchAgentMsg" class="msg u-mt-10"></div>
        <div id="dispatchAgentReviewReport" class="u-mt-10"></div>
      </div>
    `;
  }

  const findings = Array.isArray(report.findings) ? report.findings : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const actions = Array.isArray(report.recommended_actions) ? report.recommended_actions : [];
  const dataUsed = Array.isArray(report.data_used) ? report.data_used.filter((item) => item && item.count > 0) : [];
  const summary = state?.context_summary || {};

  return `
    <div class="detail-card detail-card--spaced">
      <div class="kicker">Dispatch review</div>
      <div><strong>Dispatch / Scheduling Assistant</strong></div>
      <div class="detail-copy">${escapeHtml(report.summary || titleCopy)}</div>
      <div class="action-row action-row--wrap u-mt-10">
        <button id="btnRunDispatchAgentReview" class="btn btn-ghost btn-sm" type="button">Refresh dispatch review</button>
        ${findings.length ? `<button id="btnOpenDispatchAgentFirst" class="btn btn-ghost btn-sm" type="button">Open first job</button>` : ""}
      </div>
      <div id="dispatchAgentMsg" class="msg u-mt-10"></div>
      <div id="dispatchAgentReviewReport" class="u-mt-10">
        <div class="workspace-chip-row">
          <span class="pill ${dispatchAgentStatusTone(report.summary_status || "review_needed")}">${escapeHtml(titleCaseWords(String(report.summary_status || "review needed").replace(/_/g, " ")))}</span>
          ${summary.upcoming_jobs ? `<span class="pill">${escapeHtml(`${summary.upcoming_jobs} reviewed`)}</span>` : ""}
          ${summary.assignment_conflicts ? `<span class="pill pill-bad">${escapeHtml(`${summary.assignment_conflicts} conflict${summary.assignment_conflicts === 1 ? "" : "s"}`)}</span>` : ""}
          ${summary.bundle_opportunities ? `<span class="pill pill-warn">${escapeHtml(`${summary.bundle_opportunities} bundle opportunity${summary.bundle_opportunities === 1 ? "" : "ies"}`)}</span>` : ""}
          ${report.confidence?.label ? `<span class="pill">${escapeHtml(`Confidence ${report.confidence.label}`)}</span>` : ""}
        </div>
        ${blockers.length ? `
          <div class="memory-checklist u-mt-10">
            ${blockers.slice(0, 3).map((item) => `
              <div class="memory-checklist__item memory-checklist__item--warn">
                <div class="memory-checklist__title">${escapeHtml(item.title || "Dispatch blocker")}</div>
                <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="detail-copy u-mt-10">No hard dispatch blockers were returned in this pass.</div>`}
        ${findings.length ? `
          <div class="detail-copy u-mt-10"><strong>Findings</strong></div>
          <div class="memory-checklist u-mt-10">
            ${findings.slice(0, 5).map((item) => {
              const ref = dispatchAgentPrimaryRef(item);
              return `
                <div class="memory-checklist__item ${item.severity === "warning" || item.severity === "critical" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
                  <div class="memory-checklist__title">${escapeHtml(item.title || "Finding")}</div>
                  <div class="detail-copy memory-checklist__note">${escapeHtml(item.detail || "")}</div>
                  ${ref?.record_id ? `
                    <div class="action-row action-row--wrap u-mt-10">
                      <button type="button" class="btn btn-ghost btn-sm" data-dispatch-ai-open-job="${escapeAttr(ref.record_id)}">Open job</button>
                    </div>
                  ` : ``}
                </div>
              `;
            }).join("")}
          </div>
        ` : ""}
        ${actions.length ? `
          <div class="detail-copy u-mt-10"><strong>Recommended actions</strong></div>
          <div class="workspace-chip-row">
            ${actions.slice(0, 3).map((action) => `<span class="pill ${dispatchAgentPriorityTone(action.priority || "medium")}">${escapeHtml(titleCaseWords(String(action.priority || "medium")))} priority</span>`).join("")}
          </div>
          <div class="memory-checklist u-mt-10">
            ${actions.slice(0, 3).map((action) => `
              <div class="memory-checklist__item ${action.priority === "high" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
                <div class="memory-checklist__title">${escapeHtml(action.title || "Recommended action")}</div>
                <div class="detail-copy memory-checklist__note">${escapeHtml(action.detail || "")}</div>
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${dataUsed.length ? `
          <div class="detail-copy u-mt-10"><strong>Data used</strong></div>
          <div class="workspace-chip-row">
            ${dataUsed.slice(0, 4).map((item) => `<span class="pill">${escapeHtml(`${item.label}: ${item.count}`)}</span>`).join("")}
          </div>
        ` : ""}
        <div class="detail-copy u-mt-10 muted">Generated ${escapeHtml(dispatchAgentTimestamp(report.generated_at || state?.generated_at || new Date().toISOString()))}</div>
      </div>
    </div>
  `;
}

function buildDispatchWorkspaceSnapshot({ hydrovacJobs = [], trucks = [], targetDate = "" } = {}) {
  const scheduled = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "scheduled").length;
  const dispatched = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "dispatched").length;
  const inProgress = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "in_progress").length;
  const unassigned = hydrovacJobs.filter((job) => !job.assigned_truck_id).length;
  const carryoverRisk = hydrovacJobs.filter((job) => {
    if (!job.assigned_truck_id) return false;
    return dispatchTruckPlanner(job.assigned_truck_id, job, targetDate).warnings.some((item) => item.blocking);
  }).length;
  const disposalDue = trucks.reduce((sum, truck) => sum + dispatchTruckPlanner(truck, null, targetDate).dueLoads.length, 0);
  const liveLoads = trucks.reduce((sum, truck) => sum + dispatchTruckPlanner(truck, null, targetDate).liveLoads.length, 0);

  return {
    totalJobs: hydrovacJobs.length,
    scheduled,
    dispatched,
    inProgress,
    moving: dispatched + inProgress,
    unassigned,
    carryoverRisk,
    disposalDue,
    liveLoads,
    activeTrucks: trucks.length,
  };
}

function renderDispatchWorkspaceSignalBand(snapshot = {}) {
  return `
    <div class="workspace-signal-band">
      <div class="workspace-signal-band__item ${snapshot.totalJobs ? "workspace-signal-band__item--good" : ""}">
        <span>Hydrovac work</span>
        <strong>${escapeHtml(String(snapshot.totalJobs || 0))}</strong>
        <small>${escapeHtml(snapshot.totalJobs ? "Jobs tied to the selected dispatch day." : "No hydrovac jobs are scheduled on this day yet.")}</small>
      </div>
      <div class="workspace-signal-band__item ${snapshot.unassigned ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Truck still open</span>
        <strong>${escapeHtml(String(snapshot.unassigned || 0))}</strong>
        <small>${escapeHtml(snapshot.unassigned ? "These jobs still need a truck before the route is real." : "Every visible job already has a truck assigned.")}</small>
      </div>
      <div class="workspace-signal-band__item ${snapshot.carryoverRisk ? "workspace-signal-band__item--danger" : "workspace-signal-band__item--good"}">
        <span>Carryover risk</span>
        <strong>${escapeHtml(String(snapshot.carryoverRisk || 0))}</strong>
        <small>${escapeHtml(snapshot.carryoverRisk ? "Assigned trucks are still carrying conflicting live-load pressure." : "No assigned truck is blocked by conflicting live loads.")}</small>
      </div>
      <div class="workspace-signal-band__item ${snapshot.disposalDue ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Disposal due</span>
        <strong>${escapeHtml(String(snapshot.disposalDue || 0))}</strong>
        <small>${escapeHtml(snapshot.disposalDue ? "Loads already marked ready for disposal today still need a plan." : "No ready-for-disposal loads are due today.")}</small>
      </div>
    </div>
  `;
}

function renderDispatchWorkspaceActionCard(snapshot = {}, targetDate = "", dispatchAgentState = null) {
  const reviewReport = dispatchAgentState?.report || null;
  const blockers = Array.isArray(reviewReport?.blockers) ? reviewReport.blockers.length : 0;
  return `
    <div class="detail-card detail-card--spaced workspace-focus-card">
      <div class="workspace-focus-card__head">
        <div>
          <div class="kicker">Dispatch focus</div>
          <div><strong>Keep the route executable in the real world</strong></div>
        </div>
        <span class="pill ${blockers ? "pill-bad" : "pill-on"}">${escapeHtml(blockers ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : "No hard blockers")}</span>
      </div>
      <div class="detail-copy">${escapeHtml(snapshot.totalJobs ? `Use ${targetDate || "the selected date"}, live-load state, and crew assignment to make the route feel calm before trucks roll.` : "When jobs land on this day, ProofLink will surface truck, disposal, and crew pressure here first.")}</div>
      <div class="workspace-focus-card__meta">
        <div class="workspace-focus-card__item ${snapshot.moving ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn"}">
          <span>Rolling now</span>
          <strong>${escapeHtml(String(snapshot.moving || 0))}</strong>
          <small>${escapeHtml(snapshot.moving ? "Jobs are already dispatched or in progress." : "Nothing is currently rolling from this dispatch board.")}</small>
        </div>
        <div class="workspace-focus-card__item ${snapshot.liveLoads ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good"}">
          <span>Live loads tracked</span>
          <strong>${escapeHtml(String(snapshot.liveLoads || 0))}</strong>
          <small>${escapeHtml(snapshot.liveLoads ? "Truck load state is still active and needs audit discipline." : "No live loads are still active across the current truck set.")}</small>
        </div>
        <div class="workspace-focus-card__item ${snapshot.activeTrucks ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn"}">
          <span>Active trucks</span>
          <strong>${escapeHtml(String(snapshot.activeTrucks || 0))}</strong>
          <small>${escapeHtml(snapshot.activeTrucks ? "Available trucks on this board right now." : "No active equipment is showing up on the dispatch board.")}</small>
        </div>
        <div class="workspace-focus-card__item ${blockers ? "workspace-focus-card__item--danger" : "workspace-focus-card__item--good"}">
          <span>AI dispatch review</span>
          <strong>${escapeHtml(reviewReport ? titleCaseWords(String(reviewReport.summary_status || "review needed").replace(/_/g, " ")) : "Not run yet")}</strong>
          <small>${escapeHtml(reviewReport?.summary || "Run the dispatch review to surface assignment conflicts and route opportunities before the day gets noisy.")}</small>
        </div>
      </div>
      <div class="workspace-focus-card__buttons">
        <button type="button" class="btn btn-primary" data-dispatch-action="jobs">Open jobs</button>
        <button type="button" class="btn btn-ghost" data-dispatch-action="manifests">Open disposal board</button>
        <button type="button" class="btn btn-ghost" data-dispatch-action="locates">Open locate tickets</button>
        <button type="button" class="btn btn-ghost" data-dispatch-action="team">Open team</button>
        <button type="button" class="btn btn-ghost" data-dispatch-action="equipment">Open equipment</button>
      </div>
    </div>
  `;
}

function renderDispatchJobSignalBand({
  activeLocates = [],
  activePermits = [],
  manifestSnapshot = null,
  truckPlanner = null,
  dispatchBlocked = false,
} = {}) {
  return `
    <div class="workspace-signal-band">
      <div class="workspace-signal-band__item ${dispatchBlocked ? "workspace-signal-band__item--danger" : "workspace-signal-band__item--good"}">
        <span>Dispatch state</span>
        <strong>${escapeHtml(dispatchBlocked ? "Blocked" : "Ready")}</strong>
        <small>${escapeHtml(dispatchBlocked ? "Truck or compliance pressure still blocks dispatch." : "This job can move if the selected truck and driver stay clean.")}</small>
      </div>
      <div class="workspace-signal-band__item ${activeLocates.length ? "workspace-signal-band__item--good" : "workspace-signal-band__item--warn"}">
        <span>Locate coverage</span>
        <strong>${escapeHtml(String(activeLocates.length))}</strong>
        <small>${escapeHtml(activeLocates.length ? "Active locate coverage is already on file." : "This job still needs locate coverage confirmed here.")}</small>
      </div>
      <div class="workspace-signal-band__item ${activePermits.length ? "workspace-signal-band__item--good" : "workspace-signal-band__item--warn"}">
        <span>Open permits</span>
        <strong>${escapeHtml(String(activePermits.length))}</strong>
        <small>${escapeHtml(activePermits.length ? "Permit coverage is already attached to this work." : "No open permit is attached on this record yet.")}</small>
      </div>
      <div class="workspace-signal-band__item ${truckPlanner?.carryoverLoads?.length ? "workspace-signal-band__item--danger" : Number(manifestSnapshot?.openLoads || 0) ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Truck load pressure</span>
        <strong>${escapeHtml(String(truckPlanner?.carryoverLoads?.length || Number(manifestSnapshot?.openLoads || 0)))}</strong>
        <small>${escapeHtml(truckPlanner?.carryoverLoads?.length ? "The selected truck is still carrying load pressure from other work." : Number(manifestSnapshot?.openLoads || 0) ? "This job still has open hauled loads attached." : "No live-load pressure is hanging on this assignment.")}</small>
      </div>
    </div>
  `;
}

function renderDispatchExecutionFocusCard({
  activeJob = null,
  assignedTruck = null,
  assignedDriver = null,
  dispatchBlocked = false,
  truckPlanner = null,
  manifestSnapshot = null,
} = {}) {
  if (!activeJob) return "";
  const nextMove = dispatchBlocked
    ? (truckPlanner?.warnings?.[0]?.note || "Clear the blocking truck or compliance issue before dispatch.")
    : "Truck, driver, and paperwork are lined up closely enough to dispatch from here.";
  return `
    <div class="detail-card detail-card--spaced workspace-focus-card">
      <div class="workspace-focus-card__head">
        <div>
          <div class="kicker">Dispatch move</div>
          <div><strong>Keep the next truck move obvious</strong></div>
        </div>
        <span class="pill ${dispatchBlocked ? "pill-bad" : "pill-on"}">${escapeHtml(dispatchBlocked ? "Blocked" : "Ready")}</span>
      </div>
      <div class="detail-copy">${escapeHtml(nextMove)}</div>
      <div class="workspace-focus-card__meta">
        <div class="workspace-focus-card__item ${assignedTruck ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn"}">
          <span>Truck</span>
          <strong>${escapeHtml(assignedTruck?.unit_number || assignedTruck?.name || "Still open")}</strong>
          <small>${escapeHtml(assignedTruck ? "This is the truck currently tied to the job." : "Pick the truck that can actually roll this work.")}</small>
        </div>
        <div class="workspace-focus-card__item ${assignedDriver ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn"}">
          <span>Driver</span>
          <strong>${escapeHtml(assignedDriver ? teamMemberLabel(assignedDriver) : "Still open")}</strong>
          <small>${escapeHtml(assignedDriver ? "A driver is already attached to the dispatch plan." : "Assign the driver who owns the route and the paperwork.")}</small>
        </div>
        <div class="workspace-focus-card__item ${Number(manifestSnapshot?.unbilledChargeCents || 0) > 0 ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good"}">
          <span>Disposal to bill</span>
          <strong>${escapeHtml(formatUsd(Number(manifestSnapshot?.unbilledChargeCents || 0)))}</strong>
          <small>${escapeHtml(Number(manifestSnapshot?.unbilledChargeCents || 0) > 0 ? "Confirmed disposal is still waiting on invoice capture." : "No disposal charge is waiting to be pushed into billing.")}</small>
        </div>
        <div class="workspace-focus-card__item ${truckPlanner?.warnings?.length ? "workspace-focus-card__item--danger" : "workspace-focus-card__item--good"}">
          <span>Load warnings</span>
          <strong>${escapeHtml(String(truckPlanner?.warnings?.length || 0))}</strong>
          <small>${escapeHtml(truckPlanner?.warnings?.length ? truckPlanner.warnings[0].note : "No truck-load warnings are attached to this assignment.")}</small>
        </div>
      </div>
      <div class="workspace-focus-card__buttons">
        <button id="btnDispatchOpenJob" class="btn btn-primary" type="button">Open job</button>
        <button id="btnDispatchOpenLocates" class="btn btn-ghost" type="button">Open locate tickets</button>
        <button id="btnDispatchOpenCompliance" class="btn btn-ghost" type="button">Open compliance</button>
        <button id="btnDispatchOpenManifests" class="btn btn-ghost" type="button">Open disposal board</button>
      </div>
    </div>
  `;
}

function dispatchCrewAcknowledgementSummary(activeJob, assignedDriver) {
  const normalizedStatus = normalizeWorkflowStatusValue(activeJob?.status || "scheduled");
  const driverLabel = assignedDriver ? teamMemberLabel(assignedDriver) : "the assigned crew";
  const lastFieldUpdate = activeJob?.actual_end_at || activeJob?.actual_start_at || activeJob?.updated_at || "";
  if (!String(activeJob?.assigned_member_id || activeJob?.assigned_operator_id || "").trim()) {
    return {
      label: "No driver assigned",
      tone: "pill-warn",
      detail: "Assign a driver before expecting a field acknowledgment.",
      lastFieldUpdate,
    };
  }
  if (normalizedStatus === "completed") {
    return {
      label: "Crew completed this dispatch",
      tone: "pill-on",
      detail: activeJob?.actual_end_at
        ? `${driverLabel} closed the work at ${formatDateTime(activeJob.actual_end_at)}.`
        : `${driverLabel} marked the dispatch complete.`,
      lastFieldUpdate,
    };
  }
  if (normalizedStatus === "blocked") {
    return {
      label: "Crew reported a blocker",
      tone: "pill-bad",
      detail: String(activeJob?.blocker_note || "").trim()
        ? `${driverLabel} reported: ${String(activeJob.blocker_note).trim()}`
        : `${driverLabel} paused the work and needs office follow-up.`,
      lastFieldUpdate,
    };
  }
  if (normalizedStatus === "in_progress" || activeJob?.actual_start_at) {
    return {
      label: "Crew acknowledged and started",
      tone: "pill-on",
      detail: activeJob?.actual_start_at
        ? `${driverLabel} started at ${formatDateTime(activeJob.actual_start_at)}${activeJob?.check_in_lat ? " and a field check-in is attached." : "."}`
        : `${driverLabel} has moved this dispatch into active field work.`,
      lastFieldUpdate,
    };
  }
  return {
    label: "Waiting on crew acknowledgment",
    tone: "pill-warn",
    detail: `${driverLabel} is assigned, but dispatch has not seen a field update yet.`,
    lastFieldUpdate,
  };
}

function dispatchJobEstimatedMinutes(job = null) {
  const minimumHours = Number(job?.minimum_hours || 0);
  const billableHours = Number(job?.billable_hours || 0);
  const travelHours = Number(job?.travel_hours || 0);
  const workingHours = billableHours > 0 ? billableHours : Math.max(minimumHours, 0);
  return Math.max(0, Math.round((workingHours + Math.max(travelHours, 0)) * 60));
}

function dispatchMinutesLabel(totalMinutes = 0) {
  const minutes = Math.max(0, Number(totalMinutes || 0));
  const hours = minutes / 60;
  return `${Number(hours.toFixed(hours >= 10 ? 0 : 1))}h`;
}

function dispatchCompoundRouteSummary(activeJob, hydrovacJobs = [], driverId = "", targetDate = "") {
  const cleanDriverId = String(driverId || "").trim();
  const relevantJobs = Array.isArray(hydrovacJobs) ? hydrovacJobs : [];
  if (!activeJob || !cleanDriverId) {
    return {
      jobs: [],
      totalEstimatedMinutes: dispatchJobEstimatedMinutes(activeJob),
      activeEstimatedMinutes: dispatchJobEstimatedMinutes(activeJob),
      minimumBlockMinutes: Math.max(240, Math.round(Number(activeJob?.minimum_hours || 0) * 60)),
      overrideAvailable: false,
      hardConflict: false,
      label: "Crew still open",
      tone: "pill-warn",
      note: "Assign the crew member first so ProofLink can measure whether this route still fits the minimum block.",
    };
  }

  const sameDriverJobs = relevantJobs.filter((job) => {
    if (!job || String(job.id || "") === String(activeJob.id || "")) return false;
    if ((targetDate && String(job.scheduled_date || "") !== String(targetDate)) || (!targetDate && String(job.scheduled_date || "") !== String(activeJob.scheduled_date || ""))) return false;
    const status = String(job.status || "").toLowerCase();
    if (["completed", "cancelled"].includes(status)) return false;
    const assignmentIds = [
      job.assigned_member_id,
      job.assigned_operator_id,
    ].map((value) => String(value || "").trim()).filter(Boolean);
    return assignmentIds.includes(cleanDriverId);
  });

  const allJobs = [activeJob, ...sameDriverJobs];
  const totalEstimatedMinutes = allJobs.reduce((sum, job) => sum + dispatchJobEstimatedMinutes(job), 0);
  const minimumBlockMinutes = Math.max(
    240,
    ...allJobs.map((job) => Math.round(Number(job?.minimum_hours || 0) * 60) || 0)
  );
  const activeEstimatedMinutes = dispatchJobEstimatedMinutes(activeJob);

  if (!sameDriverJobs.length) {
    return {
      jobs: [],
      totalEstimatedMinutes,
      activeEstimatedMinutes,
      minimumBlockMinutes,
      overrideAvailable: false,
      hardConflict: false,
      label: "Crew load is clear",
      tone: "pill-on",
      note: `This job is carrying about ${dispatchMinutesLabel(activeEstimatedMinutes)} against a ${dispatchMinutesLabel(minimumBlockMinutes)} minimum block.`,
    };
  }

  if (totalEstimatedMinutes <= minimumBlockMinutes) {
    return {
      jobs: sameDriverJobs,
      totalEstimatedMinutes,
      activeEstimatedMinutes,
      minimumBlockMinutes,
      overrideAvailable: true,
      hardConflict: false,
      label: "Compound route available",
      tone: "pill-warn",
      note: `${sameDriverJobs.length + 1} same-day jobs add up to about ${dispatchMinutesLabel(totalEstimatedMinutes)}, so the office can compound them inside the ${dispatchMinutesLabel(minimumBlockMinutes)} minimum if the route is intentional.`,
    };
  }

  return {
    jobs: sameDriverJobs,
    totalEstimatedMinutes,
    activeEstimatedMinutes,
    minimumBlockMinutes,
    overrideAvailable: false,
    hardConflict: true,
    label: "Crew load is over the minimum block",
    tone: "pill-bad",
    note: `${sameDriverJobs.length + 1} same-day jobs add up to about ${dispatchMinutesLabel(totalEstimatedMinutes)}, which runs past the ${dispatchMinutesLabel(minimumBlockMinutes)} minimum block.`,
  };
}

function dispatchColumnCrewCapacity(columnJobs = [], hydrovacJobs = [], targetDate = "") {
  const jobs = Array.isArray(columnJobs) ? columnJobs : [];
  const allJobs = Array.isArray(hydrovacJobs) ? hydrovacJobs : [];
  const summaries = jobs
    .map((job) => {
      const driverId = String(job?.assigned_member_id || job?.assigned_operator_id || "").trim();
      if (!driverId) return null;
      return dispatchCompoundRouteSummary(job, allJobs, driverId, targetDate);
    })
    .filter(Boolean);

  if (!summaries.length) {
    return {
      label: "Crew open",
      tone: "pill-good",
      note: "No driver is tied to this column yet.",
    };
  }

  const hardConflict = summaries.some((summary) => summary.hardConflict);
  if (hardConflict) {
    return {
      label: "Crew block tapped out",
      tone: "pill-bad",
      note: "One or more assigned crews are already running past their visible minimum block.",
    };
  }

  const overrideAvailable = summaries.some((summary) => summary.overrideAvailable);
  if (overrideAvailable) {
    return {
      label: "Crew block available",
      tone: "pill-warn",
      note: "At least one assigned crew can still absorb another compounded stop inside the current block.",
    };
  }

  return {
    label: "Crew load clear",
    tone: "pill-on",
    note: "Assigned crews look clear without same-day overlap pressure in this column.",
  };
}

function dispatchTruckRouteSummary(activeJob, hydrovacJobs = [], truckId = "", targetDate = "") {
  const cleanTruckId = String(truckId || "").trim();
  const relevantJobs = Array.isArray(hydrovacJobs) ? hydrovacJobs : [];
  const activeEstimatedMinutes = dispatchJobEstimatedMinutes(activeJob);
  if (!activeJob || !cleanTruckId) {
    return {
      jobs: [],
      totalEstimatedMinutes: activeEstimatedMinutes,
      activeEstimatedMinutes,
      minimumBlockMinutes: Math.max(240, Math.round(Number(activeJob?.minimum_hours || 0) * 60)),
      hardConflict: false,
      label: "Truck still open",
      tone: "pill-warn",
      note: "Assign a truck so ProofLink can show whether this route is stacking too much work onto one unit.",
    };
  }

  const sameTruckJobs = relevantJobs.filter((job) => {
    if (!job || String(job.id || "") === String(activeJob.id || "")) return false;
    if ((targetDate && String(job.scheduled_date || "") !== String(targetDate)) || (!targetDate && String(job.scheduled_date || "") !== String(activeJob.scheduled_date || ""))) return false;
    const status = String(job.status || "").toLowerCase();
    if (["completed", "cancelled"].includes(status)) return false;
    return String(job.assigned_truck_id || "").trim() === cleanTruckId;
  });

  const totalEstimatedMinutes = [activeJob, ...sameTruckJobs].reduce((sum, job) => sum + dispatchJobEstimatedMinutes(job), 0);
  const minimumBlockMinutes = Math.max(
    240,
    ...[activeJob, ...sameTruckJobs].map((job) => Math.round(Number(job?.minimum_hours || 0) * 60) || 0)
  );

  if (!sameTruckJobs.length) {
    return {
      jobs: [],
      totalEstimatedMinutes,
      activeEstimatedMinutes,
      minimumBlockMinutes,
      hardConflict: false,
      label: "Truck route is clear",
      tone: "pill-on",
      note: `This truck is only carrying about ${dispatchMinutesLabel(activeEstimatedMinutes)} on the visible route.`,
    };
  }

  if (totalEstimatedMinutes <= minimumBlockMinutes) {
    return {
      jobs: sameTruckJobs,
      totalEstimatedMinutes,
      activeEstimatedMinutes,
      minimumBlockMinutes,
      hardConflict: false,
      label: "Truck can compound this route",
      tone: "pill-warn",
      note: `${sameTruckJobs.length + 1} same-day stops on this truck still fit inside about ${dispatchMinutesLabel(minimumBlockMinutes)} of planned work.`,
    };
  }

  return {
    jobs: sameTruckJobs,
    totalEstimatedMinutes,
    activeEstimatedMinutes,
    minimumBlockMinutes,
    hardConflict: true,
    label: "Truck route is overloaded",
    tone: "pill-bad",
    note: `${sameTruckJobs.length + 1} same-day stops are stacking about ${dispatchMinutesLabel(totalEstimatedMinutes)} onto this truck, which is past the visible minimum block.`,
  };
}

function dispatchAssignmentConflictSummary(activeJob, hydrovacJobs = [], selectedTruckId = "", selectedDriverId = "", targetDate = "") {
  const crewRoute = dispatchCompoundRouteSummary(activeJob, hydrovacJobs, selectedDriverId, targetDate);
  const truckRoute = dispatchTruckRouteSummary(activeJob, hydrovacJobs, selectedTruckId, targetDate);
  const warnings = [];
  if (crewRoute.jobs.length) {
    warnings.push({
      type: crewRoute.hardConflict ? "crew-hard-conflict" : "crew-bundle",
      tone: crewRoute.hardConflict ? "pill-bad" : "pill-warn",
      label: crewRoute.hardConflict ? "Crew double-booked" : "Crew route can compound",
      note: crewRoute.note,
    });
  }
  if (truckRoute.jobs.length) {
    warnings.push({
      type: truckRoute.hardConflict ? "truck-hard-conflict" : "truck-bundle",
      tone: truckRoute.hardConflict ? "pill-bad" : "pill-warn",
      label: truckRoute.hardConflict ? "Truck double-booked" : "Truck route can compound",
      note: truckRoute.note,
    });
  }
  return {
    crewRoute,
    truckRoute,
    warnings,
    hardConflict: warnings.some((warning) => warning.type === "crew-hard-conflict" || warning.type === "truck-hard-conflict"),
  };
}

async function saveDispatchCrewPlanning(activeJob = null, options = {}) {
  if (!activeJob || typeof saveJobRecord !== "function") {
    throw new Error("Crew-planning tools are not ready yet.");
  }
  const parseHours = (value, fallback = null) => {
    const next = parseFloat(String(value || "").trim());
    return Number.isFinite(next) ? next : fallback;
  };
  const patch = {
    id: activeJob.id,
    billable_hours: parseHours(options.billableHours, null),
    minimum_hours: parseHours(options.minimumHours, null),
    travel_hours: parseHours(options.travelHours, null),
  };
  return saveJobRecord(patch);
}

async function saveDispatchAssignment(activeJob = null, options = {}) {
  if (!activeJob || typeof saveJobRecord !== "function") {
    throw new Error("Dispatch assignment tools are not ready yet.");
  }
  const cleanMemberId = String(options.memberId || "").trim();
  const cleanTruckId = String(options.truckId || "").trim();
  const selectedMember = (TEAM_MEMBERS_CACHE || []).find((member) => String(member?.id || "").trim() === cleanMemberId) || null;
  return saveJobRecord({
    id: activeJob.id,
    assigned_truck_id: cleanTruckId || null,
    assigned_member_id: cleanMemberId || null,
    assigned_operator_id: cleanMemberId
      ? (selectedMember?.operator_id || selectedMember?.user_id || cleanMemberId)
      : null,
  });
}

function renderDispatchWorkspace() {
  if (!dispatchBoard || !dispatchDetail) return;
  const targetDate = dispatchDate?.value || new Date().toISOString().slice(0, 10);
  const dispatchAgentState = DISPATCH_AGENT_REVIEW_CACHE[targetDate] || null;
  if (dispatchDate && !dispatchDate.value) dispatchDate.value = targetDate;

  const hydrovacJobs = (JOBS_CACHE || [])
    .filter((job) => isHydrovacJob(job) && hydrovacJobSortDate(job) === targetDate)
    .sort((a, b) => String(a.scheduled_time || "").localeCompare(String(b.scheduled_time || "")));
  const trucks = (EQUIPMENT_CACHE || []).filter((unit) => unit.is_active !== false);
  const snapshot = buildDispatchWorkspaceSnapshot({
    hydrovacJobs,
    trucks,
    targetDate,
  });

  if (dispatchStageStrip) {
    dispatchStageStrip.innerHTML = renderRecordHeroCard({
      eyebrow: "Dispatch board",
      title: hydrovacJobs.length ? `Hydrovac dispatch for ${targetDate}` : `No hydrovac dispatch queued for ${targetDate}`,
      badges: [
        { label: `${snapshot.totalJobs} job${snapshot.totalJobs === 1 ? "" : "s"}` },
        { label: `${snapshot.activeTrucks} truck${snapshot.activeTrucks === 1 ? "" : "s"} active` },
        snapshot.carryoverRisk
          ? { label: `${snapshot.carryoverRisk} carryover risk`, tone: "pill-bad" }
          : { label: "No carryover conflict", tone: "pill-on" },
      ],
      meta: [
        hydrovacJobs.length
          ? "Use one board to keep truck assignment, load pressure, and compliance aligned."
          : "The board is clear right now. When jobs land here, truck and disposal pressure will show up first.",
      ],
      description: "Dispatch should stay easy to understand on both phone and desktop, especially when live loads and crew assignment can change the whole day.",
      summary: [
        { label: "Still waiting", value: String(snapshot.scheduled), note: "Jobs not yet dispatched" },
        { label: "In motion", value: String(snapshot.moving), note: "Dispatched or in progress" },
        { label: "Truck still open", value: String(snapshot.unassigned), note: "Needs a truck before it can roll" },
        { label: "Disposal due", value: String(snapshot.disposalDue), note: "Ready-for-disposal loads due today" },
      ],
      actionsHtml: renderDispatchWorkspaceSignalBand(snapshot),
    });
  }

  if (dispatchActionBar) {
    dispatchActionBar.innerHTML = renderDispatchWorkspaceActionCard(snapshot, targetDate, dispatchAgentState);
    dispatchActionBar.querySelectorAll("[data-dispatch-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-dispatch-action");
        if (action === "jobs") return switchTab("jobs");
        if (action === "manifests") return switchTab("manifests");
        if (action === "locates") return switchTab("locates");
        if (action === "team") return switchTab("team");
        if (action === "equipment") return switchTab("equipment");
      });
    });
  }

  const columns = [{ id: "", label: "Unassigned", unit: null }, ...trucks.map((truck) => ({
    id: truck.id,
    label: truck.unit_number || truck.name || "Truck",
    unit: truck,
  }))];

  dispatchBoard.innerHTML = `
    <div class="workspace-board dispatch-workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Truck board</div>
          <strong>See truck assignment, load pressure, and open work together</strong>
        </div>
        <div class="detail-copy">${escapeHtml(snapshot.totalJobs ? "Each column should answer one question fast: can this truck actually roll this work without creating the next problem?" : "When work lands here, the truck board will show assignment, load pressure, and compliance tension at a glance.")}</div>
      </div>
      <div class="workspace-board__grid dispatch-workspace-board__grid">
        ${columns.map((column) => {
          const columnJobs = hydrovacJobs.filter((job) => String(job.assigned_truck_id || "") === column.id);
          const planner = column.unit ? dispatchTruckPlanner(column.unit, null, targetDate) : null;
          const crewCapacity = dispatchColumnCrewCapacity(columnJobs, hydrovacJobs, targetDate);
          const warningCount = column.unit
            ? ((HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE.find((row) => row.id === column.unit.id)?.warnings || []).length) + (planner?.warnings?.length || 0)
            : 0;
          return `
            <div class="dispatch-column workspace-board-card dispatch-workspace-board__column">
              <div class="dispatch-column__header">
                <div>
                  <strong>${escapeHtml(column.label)}</strong>
                  <div class="muted">${column.unit ? escapeHtml(column.unit.name || "Equipment record") : "Jobs still waiting on a truck"}</div>
                  ${column.unit && planner?.carryoverLoads?.length ? `<div class="muted">${escapeHtml(`${planner.carryoverLoads.length} live load${planner.carryoverLoads.length === 1 ? "" : "s"} still attached`)}</div>` : ``}
                  ${columnJobs.length ? `<div class="muted">${escapeHtml(crewCapacity.note)}</div>` : ``}
                </div>
                <span class="pill ${warningCount ? "pill-warn" : "pill-on"}">${warningCount ? `${warningCount} watch` : `${columnJobs.length} job${columnJobs.length === 1 ? "" : "s"}`}</span>
              </div>
              <div class="dispatch-column__body">
                ${columnJobs.length ? columnJobs.map((job) => {
                  const member = (TEAM_MEMBERS_CACHE || []).find((row) => row.id === job.assigned_member_id) || null;
                  const locateCount = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => row.job_id === job.id && ["active", "extended"].includes(String(row.status || "").toLowerCase())).length;
                  const plannerWarnings = column.unit ? dispatchTruckPlanner(column.unit, job, targetDate).warnings : [];
                  const conflictSummary = dispatchAssignmentConflictSummary(
                    job,
                    hydrovacJobs,
                    column.id,
                    String(job.assigned_member_id || job.assigned_operator_id || "").trim(),
                    targetDate
                  );
                  return `
                    <button type="button" class="dispatch-job-card ${job.id === ACTIVE_DISPATCH_JOB_ID ? "is-active" : ""}" data-dispatch-job-id="${escapeAttr(job.id)}">
                      <div class="dispatch-job-card__title">${escapeHtml(job.title || "Untitled job")}</div>
                      <div class="dispatch-job-card__meta">${escapeHtml(job.customer_name || job.service_address || "Customer not linked")}</div>
                      <div class="dispatch-job-card__meta">${escapeHtml(job.scheduled_time || "Time not set")} - ${escapeHtml(titleCaseWords(String(job.status || "scheduled").replace(/_/g, " ")))}</div>
                      <div class="dispatch-job-card__chips">
                        <span class="pill ${locateCount ? "pill-on" : "pill-warn"}">${locateCount ? `${locateCount} ticket` : "No locate"}</span>
                        <span class="pill">${escapeHtml(member ? teamMemberLabel(member) : "Driver open")}</span>
                        ${conflictSummary.warnings.slice(0, 1).map((warning) => `<span class="pill ${warning.tone}">${escapeHtml(warning.label)}</span>`).join("")}
                        ${plannerWarnings.some((item) => item.blocking) ? `<span class="pill pill-bad">Truck blocked</span>` : ``}
                      </div>
                    </button>
                  `;
                }).join("") : `<div class="muted">No jobs in this column for ${escapeHtml(targetDate)}.</div>`}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  Array.from(dispatchBoard.querySelectorAll(".dispatch-column")).forEach((columnEl, index) => {
    const column = columns[index];
    if (!column?.unit) return;
    const columnJobs = hydrovacJobs.filter((job) => String(job.assigned_truck_id || "") === column.id);
    const openLoadGallons = columnJobs.reduce((sum, job) => sum + hydrovacJobManifestSnapshot(job.id).openGallons, 0);
    const openLoadCount = columnJobs.reduce((sum, job) => sum + hydrovacJobManifestSnapshot(job.id).openLoads, 0);
    const capacityGallons = Number(column.unit?.debris_tank_capacity_gallons || 0);
    const fillPercent = capacityGallons > 0
      ? Math.max(0, Math.min(100, Math.round((openLoadGallons / capacityGallons) * 100)))
      : 0;
    const headerMain = columnEl.querySelector(".dispatch-column__header > div");
    if (headerMain) {
      const stats = document.createElement("div");
      stats.className = "dispatch-column__stats";
      stats.innerHTML = `
        <span>${escapeHtml(String(columnJobs.length))} job${columnJobs.length === 1 ? "" : "s"}</span>
        <span>${escapeHtml(String(openLoadCount))} open load${openLoadCount === 1 ? "" : "s"}</span>
        <span>${escapeHtml(capacityGallons ? `${Math.round(openLoadGallons)} / ${capacityGallons} gal` : "Tank capacity not set")}</span>
        <span class="${escapeAttr(dispatchColumnCrewCapacity(columnJobs, hydrovacJobs, targetDate).tone)}">${escapeHtml(dispatchColumnCrewCapacity(columnJobs, hydrovacJobs, targetDate).label)}</span>
      `;
      headerMain.appendChild(stats);

      const fill = document.createElement("div");
      fill.className = "dispatch-fill";
      fill.innerHTML = `
        <div class="dispatch-fill__bar"><span style="width:${fillPercent}%;"></span></div>
        <div class="dispatch-fill__label">${escapeHtml(capacityGallons ? `${fillPercent}% tank pressure from open manifests` : "Set truck tank capacity to see load pressure")}</div>
      `;
      headerMain.appendChild(fill);
    }

    columnJobs.forEach((job) => {
      const card = columnEl.querySelector(`[data-dispatch-job-id="${job.id}"] .dispatch-job-card__chips`);
      if (!card) return;
      const manifestSnapshot = hydrovacJobManifestSnapshot(job.id);
      const chip = document.createElement("span");
      chip.className = `pill${manifestSnapshot.openLoads ? " pill-warn" : ""}`;
      chip.textContent = manifestSnapshot.openLoads
        ? `${manifestSnapshot.openLoads} open load${manifestSnapshot.openLoads === 1 ? "" : "s"}`
        : "No open loads";
      card.appendChild(chip);
    });
  });

  dispatchBoard.querySelectorAll("[data-dispatch-job-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_DISPATCH_JOB_ID = button.getAttribute("data-dispatch-job-id") || null;
      renderDispatchWorkspace();
    });
  });

  if (!ACTIVE_DISPATCH_JOB_ID || !hydrovacJobs.some((job) => job.id === ACTIVE_DISPATCH_JOB_ID)) {
    ACTIVE_DISPATCH_JOB_ID = hydrovacJobs[0]?.id || null;
  }

  const bindDispatchAgentActions = () => {
    dispatchDetail.querySelectorAll?.("[data-dispatch-ai-open-job]").forEach((button) => {
      button.addEventListener("click", () => openDispatchAgentJob(button.getAttribute("data-dispatch-ai-open-job") || "", targetDate));
    });
    dispatchDetail.querySelector?.("#btnOpenDispatchAgentFirst")?.addEventListener("click", () => {
      const firstFinding = DISPATCH_AGENT_REVIEW_CACHE[targetDate]?.report?.findings?.[0] || null;
      const firstRef = dispatchAgentPrimaryRef(firstFinding || {});
      if (firstRef?.record_id) openDispatchAgentJob(firstRef.record_id, targetDate);
    });
    const msgEl = dispatchDetail.querySelector?.("#dispatchAgentMsg") || null;
    const reportHost = dispatchDetail.querySelector?.("#dispatchAgentReviewReport") || null;
    dispatchDetail.querySelector?.("#btnRunDispatchAgentReview")?.addEventListener("click", async () => {
      if (typeof setInlineMessage === "function") {
        setInlineMessage(msgEl, "Reviewing dispatch plan...");
      } else if (msgEl) {
        msgEl.textContent = "Reviewing dispatch plan...";
      }
      try {
        const payload = await requestOperatorFunction("ai-agent-report", {
          method: "POST",
          body: {
            agent_key: "dispatch_scheduling_assistant",
            target_date: targetDate,
            job_type: "hydrovac",
            days: 3,
          },
        });
        DISPATCH_AGENT_REVIEW_CACHE[targetDate] = {
          report: payload?.report || null,
          context_summary: payload?.context_summary || null,
          generated_at: payload?.generated_at || payload?.report?.generated_at || "",
        };
        renderDispatchWorkspace();
        if (typeof setInlineMessage === "function") {
          setInlineMessage(
            dispatchDetail.querySelector?.("#dispatchAgentMsg") || msgEl,
            DISPATCH_AGENT_REVIEW_CACHE[targetDate]?.report?.blockers?.length
              ? "Dispatch review refreshed."
              : "Dispatch review refreshed with no hard blockers.",
            DISPATCH_AGENT_REVIEW_CACHE[targetDate]?.report?.blockers?.length ? "warn" : "ok"
          );
        } else if (reportHost) {
          reportHost.textContent = "";
        }
      } catch (error) {
        if (typeof setInlineMessage === "function") {
          setInlineMessage(msgEl, error.message || String(error), "error");
        } else if (msgEl) {
          msgEl.textContent = error.message || String(error);
        }
      }
    });
  };

  const activeJob = hydrovacJobs.find((job) => job.id === ACTIVE_DISPATCH_JOB_ID) || null;
  if (!activeJob) {
    dispatchDetail.innerHTML = `
      ${renderDispatchAgentReview(dispatchAgentState, targetDate)}
      <div class="detail-card">
        <div class="detail-copy">No hydrovac jobs are scheduled on ${escapeHtml(targetDate)} yet.</div>
      </div>
    `;
    bindDispatchAgentActions();
    return;
  }

  const assignedTruck = (EQUIPMENT_CACHE || []).find((unit) => unit.id === activeJob.assigned_truck_id) || null;
  const assignedDriver = (TEAM_MEMBERS_CACHE || []).find((row) => (
    row.id === activeJob.assigned_member_id
    || row.id === activeJob.assigned_operator_id
    || row.user_id === activeJob.assigned_operator_id
    || row.operator_id === activeJob.assigned_operator_id
  )) || null;
  const activeLocates = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => row.job_id === activeJob.id && ["active", "extended"].includes(String(row.status || "").toLowerCase()));
  const currentTruckId = assignedTruck?.id || activeJob.assigned_truck_id || "";
  const currentDriverId = assignedDriver?.id || activeJob.assigned_member_id || activeJob.assigned_operator_id || "";
  const activePermits = (HYDROVAC_PERMITS_CACHE || []).filter((row) => row.job_id === activeJob.id && normalizeWorkflowStatusValue(row.status) === "open");
  const manifestSnapshot = hydrovacJobManifestSnapshot(activeJob.id);
  const driverCompliance = currentDriverId
    ? (HYDROVAC_DRIVER_COMPLIANCE_CACHE || []).find((row) => row.member_id === currentDriverId || row.operator_members?.id === currentDriverId) || null
    : null;
  const truckCompliance = currentTruckId
    ? (HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE || []).find((row) => row.id === currentTruckId) || null
    : null;
  const truckLoadState = currentTruckId ? dispatchTruckLoadState(currentTruckId) : null;
  const truckLoadsFresh = truckLoadState?.loadedAt && (Date.now() - truckLoadState.loadedAt) < 20000;
  if (currentTruckId && !truckLoadState?.loading && !truckLoadsFresh) {
    fetchDispatchTruckLoads(currentTruckId).then(() => renderDispatchWorkspace()).catch(() => {});
  }
  const truckPlanner = dispatchTruckPlanner(assignedTruck || currentTruckId, activeJob, targetDate);
  const dispatchBlocked = truckPlanner.warnings.some((item) => item.blocking);
  const crewAck = dispatchCrewAcknowledgementSummary(activeJob, assignedDriver);
  const crewRoute = dispatchCompoundRouteSummary(activeJob, hydrovacJobs, currentDriverId, targetDate);
  const assignmentConflicts = dispatchAssignmentConflictSummary(activeJob, hydrovacJobs, currentTruckId, currentDriverId, targetDate);

  dispatchDetail.innerHTML = `
    <div class="workspace-command-center workspace-command-center--hydrovac">
      <div class="workspace-command-center__top">
        <div class="workspace-command-center__hero">
          ${renderRecordHeroCard({
            eyebrow: "Dispatch record",
            title: activeJob.title || "Untitled hydrovac job",
            badges: [
              { label: titleCaseWords(String(activeJob.status || "scheduled").replace(/_/g, " ")) },
              assignedTruck ? { label: assignedTruck.unit_number || assignedTruck.name || "Truck assigned" } : { label: "Truck open", tone: "pill-warn" },
              assignedDriver ? { label: teamMemberLabel(assignedDriver), tone: "pill-on" } : { label: "Driver open", tone: "pill-warn" },
              dispatchBlocked ? { label: "Dispatch blocked", tone: "pill-bad" } : { label: "Ready to dispatch", tone: "pill-on" },
            ],
            meta: [
              activeJob.customer_name || activeJob.service_address || "Customer not linked",
              `${activeJob.scheduled_date || targetDate}${activeJob.scheduled_time ? ` | ${activeJob.scheduled_time}` : ""}`,
              activeJob.service_address || "No service address recorded",
            ],
            description: "Keep the truck, the driver, the paperwork, and the live-load state tied to one dispatch record so the route does not fall apart on the way out the door.",
            summary: [
              { label: "Locate tickets", value: String(activeLocates.length), note: activeLocates.length ? "Coverage is already on file." : "Coverage still needs attention." },
              { label: "Open permits", value: String(activePermits.length), note: activePermits.length ? "Permit coverage is attached." : "No open permit is attached." },
              { label: "Open loads", value: String(manifestSnapshot.openLoads), note: manifestSnapshot.openLoads ? "Hauled loads are still active on this job." : "No hauled loads are still open." },
              { label: "Unbilled disposal", value: formatUsd(manifestSnapshot.unbilledChargeCents), note: manifestSnapshot.unbilledChargeCents ? "Billing still needs disposal closeout." : "No disposal charge is waiting on billing." },
              { label: "Crew load", value: dispatchMinutesLabel(crewRoute.totalEstimatedMinutes), note: crewRoute.note },
            ],
            actionsHtml: renderDispatchJobSignalBand({
              activeLocates,
              activePermits,
              manifestSnapshot,
              truckPlanner,
              dispatchBlocked,
            }),
          })}
        </div>
        <div class="workspace-command-center__sidebar">
          ${renderDispatchExecutionFocusCard({
            activeJob,
            assignedTruck,
            assignedDriver,
            dispatchBlocked,
            truckPlanner,
            manifestSnapshot,
          })}
        </div>
      </div>
      <div class="workspace-command-center__main">
        ${renderDispatchAgentReview(dispatchAgentState, targetDate)}
        <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(activeJob.title || "Untitled hydrovac job")}</strong>
        <span class="pill ${hydrovacManifestToneClass(activeJob.status)}">${escapeHtml(titleCaseWords(String(activeJob.status || "scheduled").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-copy">${escapeHtml(activeJob.customer_name || activeJob.service_address || "Customer not linked")}</div>
      <div class="detail-grid" style="margin-top:12px;">
        <div><span class="muted">Scheduled</span><div>${escapeHtml(activeJob.scheduled_date || targetDate)} ${escapeHtml(activeJob.scheduled_time || "")}</div></div>
        <div><span class="muted">Locate tickets</span><div>${escapeHtml(String(activeLocates.length))}</div></div>
        <div><span class="muted">Open loads</span><div>${escapeHtml(String(manifestSnapshot.openLoads))}</div></div>
        <div><span class="muted">Unbilled disposal</span><div>${formatUsd(manifestSnapshot.unbilledChargeCents)}</div></div>
      </div>
      <div class="detail-grid" style="margin-top:12px;">
        <label>Truck
          <select id="dispatchTruckSelect">
            <option value="">Select truck</option>
            ${(EQUIPMENT_CACHE || []).filter((unit) => unit.is_active !== false).map((unit) => `<option value="${escapeAttr(unit.id)}"${unit.id === currentTruckId ? " selected" : ""}>${escapeHtml(unit.unit_number || unit.name || "Truck")}</option>`).join("")}
          </select>
        </label>
        <label>Driver
          <select id="dispatchDriverSelect">
            <option value="">Select driver</option>
            ${(TEAM_MEMBERS_CACHE || []).map((member) => `<option value="${escapeAttr(member.id)}"${member.id === currentDriverId ? " selected" : ""}>${escapeHtml(teamMemberLabel(member))}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="detail-grid" style="margin-top:12px;">
        <label>Expected hours
          <input id="dispatchExpectedHours" type="number" min="0" step="0.25" value="${escapeAttr(activeJob.billable_hours ?? "")}" />
        </label>
        <label>Minimum block
          <input id="dispatchMinimumHours" type="number" min="0" step="0.25" value="${escapeAttr(activeJob.minimum_hours ?? "")}" />
        </label>
        <label>Travel hours
          <input id="dispatchTravelHours" type="number" min="0" step="0.25" value="${escapeAttr(activeJob.travel_hours ?? "")}" />
        </label>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="btnDispatchSaveAssignment" class="btn btn-ghost" type="button">Save assignment</button>
        <button id="btnDispatchAssignAndOpenCrew" class="btn btn-ghost" type="button">Assign and open crew portal</button>
        <button id="btnDispatchSaveCrewPlan" class="btn btn-ghost" type="button">Save planning</button>
        <button id="btnDispatchJobNow" class="btn btn-primary" type="button"${dispatchBlocked ? " disabled" : ""}>${String(activeJob.status || "").toLowerCase() === "dispatched" ? "Refresh dispatch" : "Dispatch job"}</button>
        <button id="btnDispatchOpenCrew" class="btn btn-ghost" type="button">Open in crew portal</button>
        <button id="btnDispatchRefreshLoads" class="btn btn-ghost" type="button">Refresh truck loads</button>
      </div>
      <div id="dispatchMsg" class="msg"></div>
        </div>
        <div class="detail-card detail-card--spaced">
      <div class="kicker">Crew acknowledgment</div>
      <div><strong>${escapeHtml(crewAck.label)}</strong> <span class="pill ${escapeAttr(crewAck.tone)}">${escapeHtml(titleCaseWords(String(activeJob.status || "scheduled").replace(/_/g, " ")))}</span></div>
      <div class="detail-copy">${escapeHtml(crewAck.detail)}</div>
      ${crewAck.lastFieldUpdate ? `<div class="detail-copy muted muted-small">Last field update: ${escapeHtml(formatDateTime(crewAck.lastFieldUpdate))}</div>` : ""}
      ${String(activeJob.blocker_note || "").trim() ? `<div class="detail-copy muted muted-small">Blocker note: ${escapeHtml(String(activeJob.blocker_note).trim())}</div>` : ""}
      ${activeJob.check_in_lat ? `<div class="detail-copy muted muted-small">Last check-in: ${escapeHtml(String(activeJob.check_in_lat))}, ${escapeHtml(String(activeJob.check_in_lng || ""))}</div>` : ""}
        </div>
        <div class="detail-card detail-card--spaced">
      <div class="kicker">Assignment pressure</div>
      <div><strong>${escapeHtml(assignmentConflicts.hardConflict ? "Assignment conflict needs attention" : "Assignment is workable")}</strong></div>
      <div class="detail-copy">${escapeHtml(assignmentConflicts.warnings.length ? assignmentConflicts.warnings[0].note : "The selected truck and crew are not showing same-day overlap pressure right now.")}</div>
      <div class="workspace-chip-row u-mt-10">
        <span class="pill ${escapeAttr(assignmentConflicts.crewRoute.tone)}">${escapeHtml(assignmentConflicts.crewRoute.label)}</span>
        <span class="pill ${escapeAttr(assignmentConflicts.truckRoute.tone)}">${escapeHtml(assignmentConflicts.truckRoute.label)}</span>
      </div>
      ${assignmentConflicts.warnings.length ? `
        <div class="memory-checklist u-mt-10">
          ${assignmentConflicts.warnings.map((warning) => `
            <div class="memory-checklist__item ${warning.tone === "pill-bad" ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
              <div class="memory-checklist__title">${escapeHtml(warning.label)}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(warning.note)}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
        </div>
        <div class="detail-card detail-card--spaced">
      <div class="kicker">Crew workload</div>
      <div><strong>${escapeHtml(crewRoute.label)}</strong> <span class="pill ${escapeAttr(crewRoute.tone)}">${escapeHtml(dispatchMinutesLabel(crewRoute.totalEstimatedMinutes))}</span></div>
      <div class="detail-copy">${escapeHtml(crewRoute.note)}</div>
      <div class="workspace-chip-row u-mt-10">
        <span class="pill">${escapeHtml(`This job ${dispatchMinutesLabel(crewRoute.activeEstimatedMinutes)}`)}</span>
        <span class="pill">${escapeHtml(`Minimum block ${dispatchMinutesLabel(crewRoute.minimumBlockMinutes)}`)}</span>
        ${crewRoute.jobs.length ? `<span class="pill ${crewRoute.overrideAvailable ? "pill-warn" : "pill-bad"}">${escapeHtml(`${crewRoute.jobs.length} other same-day assignment${crewRoute.jobs.length === 1 ? "" : "s"}`)}</span>` : ""}
      </div>
      ${crewRoute.jobs.length ? `
        <div class="memory-checklist u-mt-10">
          ${crewRoute.jobs.map((job) => `
            <div class="memory-checklist__item ${crewRoute.overrideAvailable ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}">
              <div class="memory-checklist__title">${escapeHtml(job.title || "Assigned work")}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(`${job.scheduled_time || "Time not set"} · ${dispatchMinutesLabel(dispatchJobEstimatedMinutes(job))} estimated`)}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${crewRoute.overrideAvailable ? `
        <label class="field u-mt-10">
          <span>Compound route override</span>
          <div class="detail-copy">Use this when the same crew and truck can cover these jobs inside the sold 4-hour minimum block.</div>
          <div class="row u-mt-10">
            <input id="dispatchCompoundOverride" type="checkbox" />
            <span>Allow this crew to compound the same-day route</span>
          </div>
        </label>
      ` : ""}
        </div>
      </div>
    </div>
  `;
  bindDispatchAgentActions();

  const dispatchCard = dispatchDetail.querySelector(".detail-card");
  if (dispatchCard) {
    const readiness = [
      { label: "Truck assigned", ok: !!currentTruckId },
      { label: "Driver assigned", ok: !!currentDriverId },
      { label: "Locate coverage", ok: !hydrovacJobNeedsLocate(activeJob) || activeLocates.length > 0 },
      { label: "Permit coverage", ok: !hydrovacJobNeedsPermit(activeJob) || activePermits.length > 0 },
      { label: "Driver docs", ok: !driverCompliance || !(driverCompliance.warnings || []).some((warning) => ["critical", "expired"].includes(String(warning.severity || "").toLowerCase())) },
      { label: "Truck docs", ok: !truckCompliance || !(truckCompliance.warnings || []).some((warning) => ["critical", "expired"].includes(String(warning.severity || "").toLowerCase())) },
    ];
    const readinessEl = document.createElement("div");
    readinessEl.className = "dispatch-readiness";
    readinessEl.innerHTML = readiness.map((item) => `
      <div class="dispatch-readiness__item${item.ok ? "" : " is-blocked"}">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="pill ${item.ok ? "pill-on" : "pill-bad"}">${item.ok ? "Ready" : "Needs work"}</span>
      </div>
    `).join("");
    const secondGrid = dispatchCard.querySelectorAll(".detail-grid")[1];
    if (secondGrid) dispatchCard.insertBefore(readinessEl, secondGrid);

    const plannerEl = document.createElement("div");
    plannerEl.className = "detail-card detail-card--spaced";
    plannerEl.innerHTML = `
      <div class="kicker">Truck load planner</div>
      <div><strong>${escapeHtml(currentTruckId ? "What is still in this truck?" : "Pick a truck to inspect the live-load plan")}</strong></div>
      <div class="detail-copy">${escapeHtml(
        currentTruckId
          ? "ProofLink tracks live loads, BOLs, and disposal timing here so the office can prevent cross contamination before dispatch."
          : "Once a truck is selected, this card shows live-load carryover, disposal timing, and the audit packet you should keep with the truck."
      )}</div>
      <div class="workspace-chip-row u-mt-10">
        <span class="pill ${truckPlanner.carryoverLoads.length ? "pill-warn" : "pill-on"}">${escapeHtml(`${truckPlanner.carryoverLoads.length} carryover load${truckPlanner.carryoverLoads.length === 1 ? "" : "s"}`)}</span>
        <span class="pill">${escapeHtml(truckPlanner.capacityGallons ? `${Math.round(truckPlanner.gallons)} / ${truckPlanner.capacityGallons} gal` : `${Math.round(truckPlanner.gallons)} gal tracked`)}</span>
        <span class="pill ${truckPlanner.overdueLoads.length ? "pill-bad" : truckPlanner.dueLoads.length ? "pill-warn" : "pill"}">${escapeHtml(truckPlanner.overdueLoads.length ? `${truckPlanner.overdueLoads.length} overdue` : truckPlanner.dueLoads.length ? `${truckPlanner.dueLoads.length} due today` : "No disposal due today")}</span>
      </div>
      ${truckPlanner.loading ? `<div class="detail-copy u-mt-10">Loading truck loads...</div>` : ``}
      ${truckPlanner.error ? `<div class="detail-copy u-mt-10">${escapeHtml(truckPlanner.error)}</div>` : ``}
      <div class="memory-checklist u-mt-10">
        ${(truckPlanner.warnings.length ? truckPlanner.warnings : [{
          label: "Truck ready",
          blocking: false,
          note: currentTruckId ? "No conflicting live loads are currently attached to this truck." : "Choose a truck to see live-load guidance before dispatch.",
        }]).map((item) => `
          <div class="memory-checklist__item ${item.blocking ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
            <div class="memory-checklist__title">${escapeHtml(item.label)}</div>
            <div class="detail-copy memory-checklist__note">${escapeHtml(item.note)}</div>
          </div>
        `).join("")}
      </div>
      ${truckPlanner.rows.length ? `
        <div class="memory-checklist u-mt-10">
          ${truckPlanner.rows.map((row) => `
            <div class="memory-checklist__item ${dispatchManifestIsLive(row) ? "memory-checklist__item--warn" : "memory-checklist__item--ready"}">
              <div class="memory-checklist__title">${escapeHtml(`${row.manifest_number || row.id || "Load"} - ${dispatchManifestLifecycleLabel(row)}`)}</div>
              <div class="detail-copy memory-checklist__note">${escapeHtml(`BOL: ${dispatchManifestBolNumber(row) || "Pending"} | Ready by: ${dispatchManifestReadyBy(row) || "Not set"} | Hold reason: ${dispatchManifestHoldReason(row) || "Not documented"}`)}</div>
            </div>
          `).join("")}
        </div>
      ` : ``}
      <div class="row u-mt-10">
        <button id="btnDispatchCopyAuditPacket" class="btn btn-ghost" type="button"${currentTruckId ? "" : " disabled"}>Copy audit packet</button>
      </div>
    `;
    dispatchCard.appendChild(plannerEl);
  }

  $("btnDispatchOpenJob")?.addEventListener("click", () => {
    ACTIVE_JOB_ID = activeJob.id;
    switchTab("jobs");
  });
  $("btnDispatchOpenCrew")?.addEventListener("click", () => {
    const target = activeJob?.id
      ? `/crew/?job=${encodeURIComponent(activeJob.id)}&source=operator`
      : "/crew/?source=operator";
    if (window?.open) {
      window.open(target, "_blank", "noopener");
      return;
    }
    window.location.href = target;
  });
  $("btnDispatchOpenLocates")?.addEventListener("click", () => switchTab("locates"));
  $("btnDispatchOpenCompliance")?.addEventListener("click", () => switchTab("compliance"));
  $("btnDispatchOpenManifests")?.addEventListener("click", () => switchTab("manifests"));
  $("btnDispatchRefreshLoads")?.addEventListener("click", async () => {
    if (!currentTruckId) return;
    await fetchDispatchTruckLoads(currentTruckId, { force: true });
    renderDispatchWorkspace();
  });
  $("btnDispatchSaveAssignment")?.addEventListener("click", async () => {
    try {
      setInlineMessage($("dispatchMsg"), "Saving assignment...");
      await saveDispatchAssignment(activeJob, {
        truckId: $("dispatchTruckSelect")?.value,
        memberId: $("dispatchDriverSelect")?.value,
      });
      await Promise.all([fetchJobs(), fetchEquipment()]);
      renderDispatchWorkspace();
      setInlineMessage($("dispatchMsg"), "Assignment saved.", "ok");
    } catch (error) {
      setInlineMessage($("dispatchMsg"), error.message || String(error), "error");
    }
  });
  $("btnDispatchAssignAndOpenCrew")?.addEventListener("click", async () => {
    try {
      setInlineMessage($("dispatchMsg"), "Saving assignment and opening crew portal...");
      await saveDispatchAssignment(activeJob, {
        truckId: $("dispatchTruckSelect")?.value,
        memberId: $("dispatchDriverSelect")?.value,
      });
      await Promise.all([fetchJobs(), fetchEquipment()]);
      renderDispatchWorkspace();
      const target = activeJob?.id
        ? `/crew/?job=${encodeURIComponent(activeJob.id)}&source=operator`
        : "/crew/?source=operator";
      if (window?.open) {
        window.open(target, "_blank", "noopener");
      } else {
        window.location.href = target;
      }
      setInlineMessage($("dispatchMsg"), "Assignment saved and crew portal opened.", "ok");
    } catch (error) {
      setInlineMessage($("dispatchMsg"), error.message || String(error), "error");
    }
  });
  $("btnDispatchSaveCrewPlan")?.addEventListener("click", async () => {
    try {
      setInlineMessage($("dispatchMsg"), "Saving crew planning...");
      await saveDispatchCrewPlanning(activeJob, {
        billableHours: $("dispatchExpectedHours")?.value,
        minimumHours: $("dispatchMinimumHours")?.value,
        travelHours: $("dispatchTravelHours")?.value,
      });
      await fetchJobs();
      renderDispatchWorkspace();
      setInlineMessage($("dispatchMsg"), "Crew planning saved.", "ok");
    } catch (error) {
      setInlineMessage($("dispatchMsg"), error.message || String(error), "error");
    }
  });
  $("btnDispatchCopyAuditPacket")?.addEventListener("click", async () => {
    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
    if (typeof coreUtils.showCopyModal !== "function" || !currentTruckId) return;
    await coreUtils.showCopyModal(
      "Copy this truck-load audit packet into the binder, dispatch packet, or compliance email you keep for the truck.",
      dispatchTruckAuditPacket(assignedTruck || { id: currentTruckId }, truckPlanner, JOBS_CACHE, CUSTOMERS_CACHE),
      "Done"
    );
  });
  $("btnDispatchJobNow")?.addEventListener("click", async () => {
    const truckId = $("dispatchTruckSelect")?.value || "";
    const driverId = $("dispatchDriverSelect")?.value || "";
    const compoundOverride = $("dispatchCompoundOverride")?.checked === true;
    if (!truckId) {
      setInlineMessage($("dispatchMsg"), "Pick a truck before dispatch.", "error");
      return;
    }
    const selectedCrewRoute = dispatchCompoundRouteSummary(activeJob, hydrovacJobs, driverId || currentDriverId, targetDate);
    if (selectedCrewRoute.hardConflict) {
      setInlineMessage($("dispatchMsg"), selectedCrewRoute.note, "error");
      return;
    }
    if (selectedCrewRoute.overrideAvailable && !compoundOverride) {
      setInlineMessage($("dispatchMsg"), "Confirm the compound route override before dispatching this same-day crew block.", "error");
      return;
    }
    const selectedTruck = (EQUIPMENT_CACHE || []).find((unit) => unit.id === truckId) || { id: truckId };
    const selectedPlannerState = await fetchDispatchTruckLoads(truckId, { force: true });
    const selectedPlanner = dispatchTruckPlanner(selectedTruck, activeJob, targetDate);
    const blockingWarning = selectedPlanner.warnings.find((item) => item.blocking);
    if (selectedPlannerState.error) {
      setInlineMessage($("dispatchMsg"), selectedPlannerState.error, "error");
      return;
    }
    if (blockingWarning) {
      setInlineMessage($("dispatchMsg"), blockingWarning.note, "error");
      renderDispatchWorkspace();
      return;
    }
    setInlineMessage($("dispatchMsg"), "Dispatching...");
    try {
      const response = await requestOperatorFunction("dispatch-job", {
        method: "POST",
        body: {
          job_id: activeJob.id,
          assigned_truck_id: truckId,
          driver_member_id: driverId,
          scheduled_date: targetDate,
          scheduled_time: activeJob.scheduled_time || null,
          compound_route_override: compoundOverride,
          force_dispatch: compoundOverride,
        },
      });
      await Promise.all([fetchJobs(), fetchEquipment(), fetchHydrovacComplianceData(), fetchDispatchTruckLoads(truckId, { force: true })]);
      renderDispatchWorkspace();
      const warningMessage = Array.isArray(response?.warnings) && response.warnings.length
        ? response.warnings.map((warning) => warning.message || warning.type || "").filter(Boolean).join(" ")
        : "";
      setInlineMessage($("dispatchMsg"), warningMessage || "Job dispatched.", warningMessage ? "warn" : "ok");
    } catch (error) {
      setInlineMessage($("dispatchMsg"), error.message || String(error), "error");
    }
  });
}

let DISPATCH_WORKSPACE_BINDINGS_BOUND = false;
function initDispatchWorkspaceBindings() {
  if (DISPATCH_WORKSPACE_BINDINGS_BOUND) return;
  DISPATCH_WORKSPACE_BINDINGS_BOUND = true;

  btnRefreshDispatchBoard?.addEventListener("click", async () => {
    await Promise.all([fetchJobs(), fetchEquipment(), fetchHydrovacLocateTickets()]);
    renderDispatchWorkspace();
  });
  dispatchDate?.addEventListener("change", () => renderDispatchWorkspace());
}

const DISPATCH_WORKSPACE_HELPERS = {
  dispatchManifestMeta,
  dispatchManifestIsLive,
  dispatchManifestBolNumber,
  dispatchManifestHoldReason,
  dispatchManifestReadyBy,
  dispatchManifestLifecycleLabel,
  dispatchTruckLoadState,
  setDispatchTruckLoadState,
  fetchDispatchTruckLoads,
  dispatchTruckPlanner,
  dispatchTruckAuditPacket,
  dispatchJobEstimatedMinutes,
  dispatchMinutesLabel,
  dispatchCompoundRouteSummary,
  dispatchTruckRouteSummary,
  dispatchAssignmentConflictSummary,
  dispatchColumnCrewCapacity,
  saveDispatchCrewPlanning,
  saveDispatchAssignment,
  renderDispatchAgentReview,
  renderDispatchWorkspace,
  initDispatchWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_DISPATCH_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_DISPATCH_WORKSPACE || {}),
  ...DISPATCH_WORKSPACE_HELPERS,
};

Object.assign(window, DISPATCH_WORKSPACE_HELPERS);
