// Hydrovac dispatch workspace extracted from operator.js
// so crew assignment and readiness live in one focused module.
function renderDispatchWorkspace() {
  if (!dispatchBoard || !dispatchDetail) return;
  const targetDate = dispatchDate?.value || new Date().toISOString().slice(0, 10);
  if (dispatchDate && !dispatchDate.value) dispatchDate.value = targetDate;

  const hydrovacJobs = (JOBS_CACHE || [])
    .filter((job) => isHydrovacJob(job) && hydrovacJobSortDate(job) === targetDate)
    .sort((a, b) => String(a.scheduled_time || "").localeCompare(String(b.scheduled_time || "")));
  const trucks = (EQUIPMENT_CACHE || []).filter((unit) => unit.is_active !== false);
  const scheduled = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "scheduled").length;
  const dispatched = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "dispatched").length;
  const inProgress = hydrovacJobs.filter((job) => String(job.status || "").toLowerCase() === "in_progress").length;
  const unassigned = hydrovacJobs.filter((job) => !job.assigned_truck_id).length;

  if (dispatchStageStrip) {
    dispatchStageStrip.innerHTML = [
      { eyebrow: "Today", value: hydrovacJobs.length, title: "Hydrovac work", copy: "Scheduled hydrovac jobs on the selected day." },
      { eyebrow: "Queued", value: scheduled, title: "Still waiting", copy: "Scheduled jobs that still need truck or driver confirmation." },
      { eyebrow: "Rolling", value: dispatched + inProgress, title: "In motion", copy: "Jobs already dispatched or currently in progress." },
      { eyebrow: "Open", value: unassigned, title: "Truck not assigned", copy: "Work that still needs a truck before it can roll." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }

  if (dispatchActionBar) {
    dispatchActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-dispatch-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-dispatch-action="locates">Open locate tickets</button>
      <button type="button" class="pipeline-action-chip" data-dispatch-action="team">Open team</button>
      <button type="button" class="pipeline-action-chip" data-dispatch-action="equipment">Open equipment</button>
    `;
    dispatchActionBar.querySelectorAll("[data-dispatch-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-dispatch-action");
        if (action === "jobs") return switchTab("jobs");
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

  dispatchBoard.innerHTML = columns.map((column) => {
    const columnJobs = hydrovacJobs.filter((job) => String(job.assigned_truck_id || "") === column.id);
    const warningCount = column.unit
      ? ((HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE.find((row) => row.id === column.unit.id)?.warnings || []).length)
      : 0;
    return `
      <div class="dispatch-column">
        <div class="dispatch-column__header">
          <div>
            <strong>${escapeHtml(column.label)}</strong>
            <div class="muted">${column.unit ? escapeHtml(column.unit.name || "Equipment record") : "Jobs still waiting on a truck"}</div>
          </div>
          <span class="pill ${warningCount ? "pill-warn" : "pill-on"}">${warningCount ? `${warningCount} watch` : `${columnJobs.length} job${columnJobs.length === 1 ? "" : "s"}`}</span>
        </div>
        <div class="dispatch-column__body">
          ${columnJobs.length ? columnJobs.map((job) => {
            const member = (TEAM_MEMBERS_CACHE || []).find((row) => row.id === job.assigned_member_id) || null;
            const locateCount = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => row.job_id === job.id && ["active", "extended"].includes(String(row.status || "").toLowerCase())).length;
            return `
              <button type="button" class="dispatch-job-card ${job.id === ACTIVE_DISPATCH_JOB_ID ? "is-active" : ""}" data-dispatch-job-id="${escapeAttr(job.id)}">
                <div class="dispatch-job-card__title">${escapeHtml(job.title || "Untitled job")}</div>
                <div class="dispatch-job-card__meta">${escapeHtml(job.customer_name || job.service_address || "Customer not linked")}</div>
                <div class="dispatch-job-card__meta">${escapeHtml(job.scheduled_time || "Time not set")} - ${escapeHtml(titleCaseWords(String(job.status || "scheduled").replace(/_/g, " ")))}</div>
                <div class="dispatch-job-card__chips">
                  <span class="pill ${locateCount ? "pill-on" : "pill-warn"}">${locateCount ? `${locateCount} ticket` : "No locate"}</span>
                  <span class="pill">${escapeHtml(member ? teamMemberLabel(member) : "Driver open")}</span>
                </div>
              </button>
            `;
          }).join("") : `<div class="muted">No jobs in this column for ${escapeHtml(targetDate)}.</div>`}
        </div>
      </div>
    `;
  }).join("");

  Array.from(dispatchBoard.children).forEach((columnEl, index) => {
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

  const activeJob = hydrovacJobs.find((job) => job.id === ACTIVE_DISPATCH_JOB_ID) || null;
  if (!activeJob) {
    dispatchDetail.innerHTML = `<div class="muted">No hydrovac jobs are scheduled on ${escapeHtml(targetDate)} yet.</div>`;
    return;
  }

  const assignedTruck = (EQUIPMENT_CACHE || []).find((unit) => unit.id === activeJob.assigned_truck_id) || null;
  const assignedDriver = (TEAM_MEMBERS_CACHE || []).find((row) => row.id === activeJob.assigned_member_id) || null;
  const activeLocates = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => row.job_id === activeJob.id && ["active", "extended"].includes(String(row.status || "").toLowerCase()));
  const currentTruckId = assignedTruck?.id || activeJob.assigned_truck_id || "";
  const currentDriverId = assignedDriver?.id || activeJob.assigned_member_id || "";
  const activePermits = (HYDROVAC_PERMITS_CACHE || []).filter((row) => row.job_id === activeJob.id && normalizeWorkflowStatusValue(row.status) === "open");
  const manifestSnapshot = hydrovacJobManifestSnapshot(activeJob.id);
  const driverCompliance = currentDriverId
    ? (HYDROVAC_DRIVER_COMPLIANCE_CACHE || []).find((row) => row.member_id === currentDriverId || row.operator_members?.id === currentDriverId) || null
    : null;
  const truckCompliance = currentTruckId
    ? (HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE || []).find((row) => row.id === currentTruckId) || null
    : null;

  dispatchDetail.innerHTML = `
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
      <div class="row" style="margin-top:12px;">
        <button id="btnDispatchJobNow" class="btn btn-primary" type="button">${String(activeJob.status || "").toLowerCase() === "dispatched" ? "Refresh dispatch" : "Dispatch job"}</button>
        <button id="btnDispatchOpenJob" class="btn btn-ghost" type="button">Open job</button>
        <button id="btnDispatchOpenLocates" class="btn btn-ghost" type="button">Open locate tickets</button>
        <button id="btnDispatchOpenCompliance" class="btn btn-ghost" type="button">Open compliance</button>
      </div>
      <div id="dispatchMsg" class="msg"></div>
    </div>
  `;

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
  }

  $("btnDispatchOpenJob")?.addEventListener("click", () => {
    ACTIVE_JOB_ID = activeJob.id;
    switchTab("jobs");
  });
  $("btnDispatchOpenLocates")?.addEventListener("click", () => switchTab("locates"));
  $("btnDispatchOpenCompliance")?.addEventListener("click", () => switchTab("compliance"));
  $("btnDispatchJobNow")?.addEventListener("click", async () => {
    const truckId = $("dispatchTruckSelect")?.value || "";
    const driverId = $("dispatchDriverSelect")?.value || "";
    setInlineMessage($("dispatchMsg"), "Dispatching...");
    try {
      await requestOperatorFunction("dispatch-job", {
        method: "POST",
        body: {
          job_id: activeJob.id,
          assigned_truck_id: truckId,
          driver_member_id: driverId,
          scheduled_date: targetDate,
          scheduled_time: activeJob.scheduled_time || null,
        },
      });
      await Promise.all([fetchJobs(), fetchEquipment(), fetchHydrovacComplianceData()]);
      renderDispatchWorkspace();
      setInlineMessage($("dispatchMsg"), "Job dispatched.", "ok");
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
  renderDispatchWorkspace,
  initDispatchWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_DISPATCH_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_DISPATCH_WORKSPACE || {}),
  ...DISPATCH_WORKSPACE_HELPERS,
};

Object.assign(window, DISPATCH_WORKSPACE_HELPERS);
