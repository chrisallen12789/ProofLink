// Hydrovac operational workspaces extracted from operator.js
// so facilities, manifests, locates, compliance, permits, and assets stay together.
function parseHydrovacCityState(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { city: null, state_province: null };
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], state_province: parts[1] };
  return { city: raw, state_province: null };
}
function hydrovacCityStateLabel(row) {
  return [row?.city, row?.state_province].filter(Boolean).join(", ");
}
function hydrovacDateTimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function hydrovacWarningTone(severity = "") {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "expired") return "pill-bad";
  if (normalized === "critical") return "pill-warn";
  if (normalized === "warning") return "pill";
  return "pill";
}
function currentHydrovacFacility() {
  return HYDROVAC_FACILITIES_CACHE.find((row) => row.id === ACTIVE_FACILITY_ID) || null;
}
function currentHydrovacManifest() {
  return HYDROVAC_MANIFESTS_CACHE.find((row) => row.id === ACTIVE_MANIFEST_ID) || null;
}
function currentHydrovacLocate() {
  return HYDROVAC_LOCATE_TICKETS_CACHE.find((row) => row.id === ACTIVE_LOCATE_ID) || null;
}
function currentDriverQualification() {
  return HYDROVAC_DRIVER_COMPLIANCE_CACHE.find((row) => row.member_id === ACTIVE_DRIVER_QUAL_MEMBER_ID) || null;
}
function currentHydrovacPermit() {
  return HYDROVAC_PERMITS_CACHE.find((row) => row.id === ACTIVE_PERMIT_ID) || null;
}
function currentHydrovacAsset() {
  return HYDROVAC_ASSETS_CACHE.find((row) => row.id === ACTIVE_ASSET_ID) || null;
}
function hydrovacSeverityRank(severity = "") {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "expired") return 3;
  if (normalized === "critical") return 2;
  if (normalized === "warning") return 1;
  return 0;
}
function teamMemberLabel(member) {
  return member?.display_name || member?.name || member?.email || member?.id || "Crew member";
}
function driverStatusTone(warnings = []) {
  const highest = (warnings || []).reduce((max, warning) => Math.max(max, hydrovacSeverityRank(warning?.severity)), 0);
  if (highest >= 3) return "pill-bad";
  if (highest >= 2) return "pill-warn";
  if (highest >= 1) return "pill";
  return "pill-on";
}
function hydrovacJobSortDate(job) {
  return String(job?.scheduled_date || job?.created_at || "").trim();
}
function clearHydrovacFacilityForm() {
  ACTIVE_FACILITY_ID = null;
  if (hydrovacFacilityFormTitle) hydrovacFacilityFormTitle.textContent = "New facility";
  if (hydrovacFacilityId) hydrovacFacilityId.value = "";
  if (hydrovacFacilityName) hydrovacFacilityName.value = "";
  if (hydrovacFacilityStatus) hydrovacFacilityStatus.value = "active";
  if (hydrovacFacilityType) hydrovacFacilityType.value = "transfer_station";
  if (hydrovacFacilityPermitExpiry) hydrovacFacilityPermitExpiry.value = "";
  if (hydrovacFacilityAddress) hydrovacFacilityAddress.value = "";
  if (hydrovacFacilityCityState) hydrovacFacilityCityState.value = "";
  if (hydrovacFacilityRateGallon) hydrovacFacilityRateGallon.value = "";
  if (hydrovacFacilityRateYard) hydrovacFacilityRateYard.value = "";
  if (hydrovacFacilityMinimumCharge) hydrovacFacilityMinimumCharge.value = "";
  if (hydrovacFacilityContact) hydrovacFacilityContact.value = "";
  if (hydrovacFacilityDispatchPhone) hydrovacFacilityDispatchPhone.value = "";
  if (hydrovacFacilityWasteTypes) hydrovacFacilityWasteTypes.value = "";
  if (hydrovacFacilityNotes) hydrovacFacilityNotes.value = "";
  if (btnClearFacility) btnClearFacility.textContent = "Clear form";
  setInlineMessage(hydrovacFacilityMsg, "");
}
function populateHydrovacFacilityForm(row) {
  if (!row) return clearHydrovacFacilityForm();
  ACTIVE_FACILITY_ID = row.id || null;
  if (hydrovacFacilityFormTitle) hydrovacFacilityFormTitle.textContent = "Edit facility";
  if (hydrovacFacilityId) hydrovacFacilityId.value = row.id || "";
  if (hydrovacFacilityName) hydrovacFacilityName.value = row.name || "";
  if (hydrovacFacilityStatus) hydrovacFacilityStatus.value = row.status || "active";
  if (hydrovacFacilityType) hydrovacFacilityType.value = row.facility_type || "transfer_station";
  if (hydrovacFacilityPermitExpiry) hydrovacFacilityPermitExpiry.value = row.permit_expiry_date || "";
  if (hydrovacFacilityAddress) hydrovacFacilityAddress.value = row.address || "";
  if (hydrovacFacilityCityState) hydrovacFacilityCityState.value = hydrovacCityStateLabel(row);
  if (hydrovacFacilityRateGallon) hydrovacFacilityRateGallon.value = row.price_per_gallon_cents ? (Number(row.price_per_gallon_cents) / 100).toFixed(2) : "";
  if (hydrovacFacilityRateYard) hydrovacFacilityRateYard.value = row.price_per_cubic_yard_cents ? (Number(row.price_per_cubic_yard_cents) / 100).toFixed(2) : "";
  if (hydrovacFacilityMinimumCharge) hydrovacFacilityMinimumCharge.value = row.minimum_charge_cents ? (Number(row.minimum_charge_cents) / 100).toFixed(2) : "";
  if (hydrovacFacilityContact) hydrovacFacilityContact.value = [row.primary_contact_name, row.primary_contact_phone || row.primary_contact_email].filter(Boolean).join(" | ");
  if (hydrovacFacilityDispatchPhone) hydrovacFacilityDispatchPhone.value = row.dispatch_phone || "";
  if (hydrovacFacilityWasteTypes) hydrovacFacilityWasteTypes.value = Array.isArray(row.accepted_waste_types) ? row.accepted_waste_types.join(", ") : "";
  if (hydrovacFacilityNotes) hydrovacFacilityNotes.value = row.notes || "";
  if (btnClearFacility) btnClearFacility.textContent = "New facility";
  setInlineMessage(hydrovacFacilityMsg, "");
}
function renderHydrovacLocateJobOptions(selectedId = "") {
  if (!hydrovacLocateJobId) return;
  hydrovacLocateJobId.innerHTML = `<option value="">Optional</option>${(JOBS_CACHE || []).map((job) => `
    <option value="${escapeAttr(job.id)}"${job.id === selectedId ? " selected" : ""}>${escapeHtml(job.title || job.service_address || "Untitled job")}</option>
  `).join("")}`;
}
function clearHydrovacLocateForm() {
  ACTIVE_LOCATE_ID = null;
  if (hydrovacLocateId) hydrovacLocateId.value = "";
  renderHydrovacLocateJobOptions("");
  if (hydrovacLocateType) hydrovacLocateType.value = "standard";
  if (hydrovacLocateNumber) hydrovacLocateNumber.value = "";
  if (hydrovacLocateStatus) hydrovacLocateStatus.value = "requested";
  if (hydrovacLocateCenter) hydrovacLocateCenter.value = "";
  if (hydrovacLocateState) hydrovacLocateState.value = "";
  if (hydrovacLocateAddress) hydrovacLocateAddress.value = "";
  if (hydrovacLocateValidFrom) hydrovacLocateValidFrom.value = "";
  if (hydrovacLocateValidUntil) hydrovacLocateValidUntil.value = "";
  if (hydrovacLocateNotes) hydrovacLocateNotes.value = "";
  setInlineMessage(hydrovacLocateMsg, "");
}
function populateHydrovacLocateForm(row) {
  if (!row) return clearHydrovacLocateForm();
  ACTIVE_LOCATE_ID = row.id || null;
  if (hydrovacLocateId) hydrovacLocateId.value = row.id || "";
  renderHydrovacLocateJobOptions(row.job_id || "");
  if (hydrovacLocateType) hydrovacLocateType.value = row.ticket_type || "standard";
  if (hydrovacLocateNumber) hydrovacLocateNumber.value = row.ticket_number || "";
  if (hydrovacLocateStatus) hydrovacLocateStatus.value = row.status || "requested";
  if (hydrovacLocateCenter) hydrovacLocateCenter.value = row.one_call_center || "";
  if (hydrovacLocateState) hydrovacLocateState.value = row.state_province || "";
  if (hydrovacLocateAddress) hydrovacLocateAddress.value = row.work_site_address || "";
  if (hydrovacLocateValidFrom) hydrovacLocateValidFrom.value = hydrovacDateTimeInputValue(row.valid_from);
  if (hydrovacLocateValidUntil) hydrovacLocateValidUntil.value = hydrovacDateTimeInputValue(row.valid_until);
  if (hydrovacLocateNotes) hydrovacLocateNotes.value = row.locate_notes || "";
  setInlineMessage(hydrovacLocateMsg, "");
}
async function fetchHydrovacFacilities() {
  const data = await requestOperatorFunction("manage-disposal-facilities");
  HYDROVAC_FACILITIES_CACHE = Array.isArray(data?.facilities) ? data.facilities : [];
  if (!ACTIVE_FACILITY_ID && HYDROVAC_FACILITIES_CACHE[0]) ACTIVE_FACILITY_ID = HYDROVAC_FACILITIES_CACHE[0].id;
  renderHydrovacFacilities();
  return HYDROVAC_FACILITIES_CACHE;
}
async function fetchHydrovacManifests() {
  const data = await requestOperatorFunction("manage-waste-manifests", { query: "action=all&limit=100" });
  HYDROVAC_MANIFESTS_CACHE = Array.isArray(data?.manifests) ? data.manifests : [];
  if (!ACTIVE_MANIFEST_ID && HYDROVAC_MANIFESTS_CACHE[0]) ACTIVE_MANIFEST_ID = HYDROVAC_MANIFESTS_CACHE[0].id;
  renderHydrovacManifests();
  return HYDROVAC_MANIFESTS_CACHE;
}
async function fetchHydrovacLocateTickets() {
  const data = await requestOperatorFunction("manage-locate-tickets", { query: "limit=100" });
  HYDROVAC_LOCATE_TICKETS_CACHE = Array.isArray(data?.tickets) ? data.tickets : [];
  if (!ACTIVE_LOCATE_ID && HYDROVAC_LOCATE_TICKETS_CACHE[0]) ACTIVE_LOCATE_ID = HYDROVAC_LOCATE_TICKETS_CACHE[0].id;
  renderHydrovacLocateWorkspace();
  return HYDROVAC_LOCATE_TICKETS_CACHE;
}
async function fetchHydrovacComplianceData() {
  const [equipmentData, driverData, locateData, manifestData, analyticsData, facilitiesData, locateBoardData, permitData, assetData, alertData] = await Promise.all([
    requestOperatorFunction("manage-equipment", { query: "action=compliance_summary" }),
    requestOperatorFunction("manage-driver-qualifications", { query: "action=compliance_summary" }),
    requestOperatorFunction("manage-locate-tickets", { query: "status=active&days_until_expiry=30&limit=100" }),
    requestOperatorFunction("manage-waste-manifests", { query: "action=unbilled&days=90" }),
    requestOperatorFunction("get-hydrovac-analytics", { query: "days=90" }),
    requestOperatorFunction("manage-disposal-facilities"),
    requestOperatorFunction("manage-locate-tickets", { query: "limit=100" }),
    requestOperatorFunction("manage-confined-space-permits", { query: "limit=100" }),
    requestOperatorFunction("manage-infrastructure-assets"),
    requestOperatorFunction("manage-compliance-alerts", { query: "limit=100" }),
  ]);
  HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE = Array.isArray(equipmentData?.equipment) ? equipmentData.equipment : [];
  HYDROVAC_DRIVER_COMPLIANCE_CACHE = Array.isArray(driverData?.drivers) ? driverData.drivers : [];
  HYDROVAC_ANALYTICS_CACHE = analyticsData?.analytics || null;
  HYDROVAC_ALERTS_CACHE = Array.isArray(alertData?.alerts) ? alertData.alerts : [];
  HYDROVAC_FACILITIES_CACHE = Array.isArray(facilitiesData?.facilities) ? facilitiesData.facilities : HYDROVAC_FACILITIES_CACHE;
  HYDROVAC_LOCATE_TICKETS_CACHE = Array.isArray(locateBoardData?.tickets) ? locateBoardData.tickets : HYDROVAC_LOCATE_TICKETS_CACHE;
  HYDROVAC_PERMITS_CACHE = Array.isArray(permitData?.permits) ? permitData.permits : HYDROVAC_PERMITS_CACHE;
  HYDROVAC_ASSETS_CACHE = Array.isArray(assetData?.assets) ? assetData.assets : HYDROVAC_ASSETS_CACHE;
  renderHydrovacCompliance(
    Array.isArray(locateData?.tickets) ? locateData.tickets : [],
    Array.isArray(manifestData?.manifests) ? manifestData.manifests : [],
  );
}
async function resolveHydrovacAlert(alertId) {
  if (!alertId) return;
  await requestOperatorFunction("manage-compliance-alerts", {
    method: "PATCH",
    body: { id: alertId, resolved: true },
  });
  await fetchHydrovacComplianceData();
}
async function fetchHydrovacDriverQualifications() {
  const driverData = await requestOperatorFunction("manage-driver-qualifications", { query: "action=compliance_summary" });
  HYDROVAC_DRIVER_COMPLIANCE_CACHE = Array.isArray(driverData?.drivers) ? driverData.drivers : [];
  renderHydrovacDriverWorkspace();
  return HYDROVAC_DRIVER_COMPLIANCE_CACHE;
}
async function fetchHydrovacPermits() {
  const permitData = await requestOperatorFunction("manage-confined-space-permits", { query: "limit=100" });
  HYDROVAC_PERMITS_CACHE = Array.isArray(permitData?.permits) ? permitData.permits : [];
  if (!ACTIVE_PERMIT_ID && HYDROVAC_PERMITS_CACHE[0]) ACTIVE_PERMIT_ID = HYDROVAC_PERMITS_CACHE[0].id;
  renderHydrovacPermitsWorkspace();
  return HYDROVAC_PERMITS_CACHE;
}
async function fetchHydrovacAssets() {
  const assetData = await requestOperatorFunction("manage-infrastructure-assets");
  HYDROVAC_ASSETS_CACHE = Array.isArray(assetData?.assets) ? assetData.assets : [];
  if (!ACTIVE_ASSET_ID && HYDROVAC_ASSETS_CACHE[0]) ACTIVE_ASSET_ID = HYDROVAC_ASSETS_CACHE[0].id;
  renderHydrovacAssetsWorkspace();
  return HYDROVAC_ASSETS_CACHE;
}
function renderHydrovacDriverWorkspace() {
  if (!driverQualificationsList || !driverQualificationDetail) return;
  const members = Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [];
  const driverRows = members.map((member) => {
    const qualification = HYDROVAC_DRIVER_COMPLIANCE_CACHE.find((row) => row.member_id === member.id) || null;
    return { member, qualification, warnings: qualification?.warnings || [] };
  });
  const critical = driverRows.filter((row) => row.warnings.some((warning) => ["critical", "expired"].includes(String(warning.severity || "").toLowerCase()))).length;
  const missing = driverRows.filter((row) => !row.qualification).length;
  const ready = driverRows.filter((row) => row.qualification && !(row.warnings || []).length).length;
  if (driverStageStrip) {
    driverStageStrip.innerHTML = [
      { eyebrow: "Roster", value: driverRows.length, title: "Crew records", copy: "Team members the office can dispatch or track against work." },
      { eyebrow: "Ready", value: ready, title: "Driver-ready", copy: "People with qualification records and no current expiry pressure." },
      { eyebrow: "Watch", value: critical, title: "Compliance pressure", copy: "Drivers with expiring or expired documents." },
      { eyebrow: "Missing", value: missing, title: "Needs setup", copy: "Crew records still missing a qualification profile." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (driverActionBar) {
    driverActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-driver-action="invite">Invite member</button>
      <button type="button" class="pipeline-action-chip" data-driver-action="calendar">Open calendar</button>
      <button type="button" class="pipeline-action-chip" data-driver-action="compliance">Open compliance</button>
      <button type="button" class="pipeline-action-chip" data-driver-action="jobs">Open jobs</button>
    `;
    driverActionBar.querySelectorAll("[data-driver-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-driver-action");
        if (action === "invite") return openInviteTeamMemberModal();
        if (action === "calendar") return switchTab("bookings");
        if (action === "compliance") return switchTab("compliance");
        if (action === "jobs") return switchTab("jobs");
      });
    });
  }
  if (!driverRows.length) {
    driverQualificationsList.innerHTML = `<div class="muted">No team members yet. Invite the first crew member so you can track driver docs and dispatch readiness.</div>`;
    driverQualificationDetail.innerHTML = `<div class="muted">The driver qualification form will appear once at least one team member exists.</div>`;
    return;
  }
  if (!ACTIVE_DRIVER_QUAL_MEMBER_ID || !driverRows.some((row) => row.member.id === ACTIVE_DRIVER_QUAL_MEMBER_ID)) ACTIVE_DRIVER_QUAL_MEMBER_ID = driverRows[0].member.id;
  driverQualificationsList.innerHTML = driverRows.map((row) => `
    <button type="button" class="list-item ${row.member.id === ACTIVE_DRIVER_QUAL_MEMBER_ID ? "is-active" : ""}" data-driver-member-id="${escapeAttr(row.member.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(teamMemberLabel(row.member))}</div>
        <div class="li-sub muted">${escapeHtml(row.member.role || row.member.role_title || "Crew member")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${driverStatusTone(row.warnings)}">${row.qualification ? escapeHtml(row.warnings.length ? `${row.warnings.length} warning${row.warnings.length === 1 ? "" : "s"}` : "Ready") : "Needs setup"}</span>
      </div>
    </button>
  `).join("");
  driverQualificationsList.querySelectorAll("[data-driver-member-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_DRIVER_QUAL_MEMBER_ID = button.getAttribute("data-driver-member-id") || null;
      renderHydrovacDriverWorkspace();
    });
  });
  const activeRow = driverRows.find((row) => row.member.id === ACTIVE_DRIVER_QUAL_MEMBER_ID) || driverRows[0];
  const qualification = activeRow?.qualification || null;
  const warnings = qualification?.warnings || [];
  driverQualificationDetail.innerHTML = `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(teamMemberLabel(activeRow.member))}</strong>
        <span class="pill ${driverStatusTone(warnings)}">${qualification ? escapeHtml(warnings.length ? "Needs attention" : "Dispatch-ready") : "New record"}</span>
      </div>
      <div class="detail-grid">
        <label>CDL number
          <input id="driverCdlNumber" value="${escapeAttr(qualification?.cdl_number || "")}" placeholder="License number" />
        </label>
        <label>CDL class
          <select id="driverCdlClass">
            <option value="">Select</option>
            <option value="A"${qualification?.cdl_class === "A" ? " selected" : ""}>Class A</option>
            <option value="B"${qualification?.cdl_class === "B" ? " selected" : ""}>Class B</option>
            <option value="C"${qualification?.cdl_class === "C" ? " selected" : ""}>Class C</option>
          </select>
        </label>
        <label>CDL expiry
          <input id="driverCdlExpiry" type="date" value="${escapeAttr(qualification?.cdl_expiry_date || "")}" />
        </label>
        <label>Medical card expiry
          <input id="driverMedicalExpiry" type="date" value="${escapeAttr(qualification?.medical_certificate_expiry || "")}" />
        </label>
        <label>HOS available (minutes)
          <input id="driverHosMinutes" type="number" min="0" step="1" value="${escapeAttr(qualification?.hos_available_driving_minutes ?? "")}" />
        </label>
        <label>MVR status
          <select id="driverMvrStatus">
            <option value="">Not set</option>
            <option value="clear"${qualification?.mvr_status === "clear" ? " selected" : ""}>Clear</option>
            <option value="violations"${qualification?.mvr_status === "violations" ? " selected" : ""}>Violations</option>
            <option value="disqualified"${qualification?.mvr_status === "disqualified" ? " selected" : ""}>Disqualified</option>
          </select>
        </label>
        <label><input id="driverHazmatCertified" type="checkbox"${qualification?.hazmat_certified ? " checked" : ""} /> Hazmat certified</label>
        <label>Hazmat expiry
          <input id="driverHazmatExpiry" type="date" value="${escapeAttr(qualification?.hazmat_cert_expiry_date || "")}" />
        </label>
        <label><input id="driverConfinedCertified" type="checkbox"${qualification?.confined_space_certified ? " checked" : ""} /> Confined-space certified</label>
        <label>Confined-space expiry
          <input id="driverConfinedExpiry" type="date" value="${escapeAttr(qualification?.confined_space_cert_expiry_date || "")}" />
        </label>
        <label><input id="driverH2sCertified" type="checkbox"${qualification?.h2s_alive_certified ? " checked" : ""} /> H2S certified</label>
        <label>H2S expiry
          <input id="driverH2sExpiry" type="date" value="${escapeAttr(qualification?.h2s_cert_expiry_date || "")}" />
        </label>
      </div>
      ${warnings.length ? `<div class="detail-copy" style="margin-top:12px;">${warnings.map((warning) => `${titleCaseWords(String(warning.field || "").replace(/_/g, " "))}: ${warning.expiry_date || "No date"}`).join(" | ")}</div>` : `<div class="detail-copy" style="margin-top:12px;">No compliance warnings are showing for this driver record right now.</div>`}
      <label style="margin-top:12px;">Notes
        <textarea id="driverQualificationNotes" rows="3" placeholder="CDL notes, med card follow-up, consortium details, or dispatch notes.">${escapeHtml(qualification?.notes || "")}</textarea>
      </label>
      <div class="row" style="margin-top:12px;">
        <button id="btnSaveDriverQualification" class="btn btn-primary" type="button">${qualification ? "Save driver record" : "Create driver record"}</button>
        <button id="btnOpenDriverCalendar" class="btn btn-ghost" type="button">Open calendar</button>
        <button id="btnOpenDriverCompliance" class="btn btn-ghost" type="button">Open compliance</button>
      </div>
      <div id="driverQualificationMsg" class="msg"></div>
    </div>
  `;
  $("btnOpenDriverCalendar")?.addEventListener("click", () => switchTab("bookings"));
  $("btnOpenDriverCompliance")?.addEventListener("click", () => switchTab("compliance"));
  $("btnSaveDriverQualification")?.addEventListener("click", async () => {
    const payload = {
      member_id: activeRow.member.id,
      cdl_number: $("driverCdlNumber")?.value || null,
      cdl_class: $("driverCdlClass")?.value || null,
      cdl_expiry_date: $("driverCdlExpiry")?.value || null,
      medical_certificate_expiry: $("driverMedicalExpiry")?.value || null,
      hos_available_driving_minutes: $("driverHosMinutes")?.value || null,
      mvr_status: $("driverMvrStatus")?.value || null,
      hazmat_certified: $("driverHazmatCertified")?.checked || false,
      hazmat_cert_expiry_date: $("driverHazmatExpiry")?.value || null,
      confined_space_certified: $("driverConfinedCertified")?.checked || false,
      confined_space_cert_expiry_date: $("driverConfinedExpiry")?.value || null,
      h2s_alive_certified: $("driverH2sCertified")?.checked || false,
      h2s_cert_expiry_date: $("driverH2sExpiry")?.value || null,
      notes: $("driverQualificationNotes")?.value || null,
    };
    if (qualification?.id) payload.id = qualification.id;
    setInlineMessage($("driverQualificationMsg"), "Saving...");
    try {
      await requestOperatorFunction("manage-driver-qualifications", {
        method: qualification?.id ? "PATCH" : "POST",
        body: payload,
      });
      await fetchHydrovacDriverQualifications();
      if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
      setInlineMessage($("driverQualificationMsg"), "Driver record saved.", "ok");
    } catch (error) {
      setInlineMessage($("driverQualificationMsg"), error.message || String(error), "error");
    }
  });
}
function renderHydrovacFacilities() {
  if (!hydrovacFacilitiesList) return;
  const rows = Array.isArray(HYDROVAC_FACILITIES_CACHE) ? HYDROVAC_FACILITIES_CACHE : [];
  const expiring = rows.filter((row) => (row.warnings || []).some((warning) => ["warning", "critical", "expired"].includes(String(warning.severity || "").toLowerCase()))).length;
  const preferred = rows.filter((row) => String(row.status || "").toLowerCase() === "preferred").length;
  const missingRates = rows.filter((row) => (row.warnings || []).some((warning) => warning.field === "pricing")).length;
  if (facilityStageStrip) {
    facilityStageStrip.innerHTML = [
      { eyebrow: "Live", value: rows.filter((row) => String(row.status || "").toLowerCase() !== "inactive").length, title: "Active facilities", copy: "Dump sites the office can route work to right now." },
      { eyebrow: "Preferred", value: preferred, title: "Preferred", copy: "Sites the team should default to first." },
      { eyebrow: "Watch", value: expiring, title: "Permit pressure", copy: "Facilities with permit dates or other warnings needing attention." },
      { eyebrow: "Rates", value: missingRates, title: "Pricing missing", copy: "Facilities still missing contracted disposal pricing." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (facilityActionBar) {
    facilityActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-facility-action="new">New facility</button>
      <button type="button" class="pipeline-action-chip" data-facility-action="manifests">Open loads</button>
      <button type="button" class="pipeline-action-chip" data-facility-action="compliance">Open compliance</button>
      <button type="button" class="pipeline-action-chip" data-facility-action="equipment">Open equipment</button>
    `;
    facilityActionBar.querySelectorAll("[data-facility-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-facility-action");
        if (action === "new") return clearHydrovacFacilityForm();
        if (action === "manifests") return switchTab("manifests");
        if (action === "compliance") return switchTab("compliance");
        if (action === "equipment") return switchTab("equipment");
      });
    });
  }
  if (!rows.length) {
    hydrovacFacilitiesList.innerHTML = `<div class="muted">No disposal facilities saved yet. Add the dump sites and contracted rates the office uses most.</div>`;
    clearHydrovacFacilityForm();
    return;
  }
  if (!ACTIVE_FACILITY_ID || !rows.some((row) => row.id === ACTIVE_FACILITY_ID)) ACTIVE_FACILITY_ID = rows[0].id;
  hydrovacFacilitiesList.innerHTML = rows.map((row) => {
    const warning = Array.isArray(row.warnings) ? row.warnings[0] : null;
    return `
      <button type="button" class="list-item ${row.id === ACTIVE_FACILITY_ID ? "is-active" : ""}" data-facility-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.name || "Unnamed facility")}</div>
          <div class="li-sub muted">${escapeHtml(hydrovacCityStateLabel(row) || row.address || "Location not set")}</div>
          <div class="li-sub muted">${escapeHtml(titleCaseWords(String(row.facility_type || "transfer_station").replace(/_/g, " ")))}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${String(row.status || "").toLowerCase() === "preferred" ? "pill-on" : ""}">${escapeHtml(titleCaseWords(String(row.status || "active")))}</span>
          ${warning ? `<span class="pill ${hydrovacWarningTone(warning.severity)}">${escapeHtml(warning.field === "pricing" ? "Needs rates" : "Permit watch")}</span>` : ""}
          <span class="pill">${row.price_per_gallon_cents ? `$${(Number(row.price_per_gallon_cents) / 100).toFixed(2)}/gal` : "No gal rate"}</span>
        </div>
      </button>
    `;
  }).join("");
  hydrovacFacilitiesList.querySelectorAll("[data-facility-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_FACILITY_ID = button.getAttribute("data-facility-id") || null;
      renderHydrovacFacilities();
    });
  });
  populateHydrovacFacilityForm(currentHydrovacFacility());
}
function renderHydrovacManifests() {
  if (!hydrovacManifestsList || !hydrovacManifestDetailWrap) return;
  const rows = Array.isArray(HYDROVAC_MANIFESTS_CACHE) ? HYDROVAC_MANIFESTS_CACHE : [];
  const openLoads = rows.filter((row) => ["in_transit", "delivered"].includes(String(row.status || "").toLowerCase())).length;
  const confirmedUnbilled = rows.filter((row) => String(row.status || "").toLowerCase() === "confirmed" && row.invoiced !== true).length;
  const totalCharge = rows.filter((row) => row.invoiced !== true).reduce((sum, row) => sum + Number(row.disposal_charge_cents || 0), 0);
  const totalCost = rows.reduce((sum, row) => sum + Number(row.disposal_cost_cents || 0), 0);
  if (manifestStageStrip) {
    manifestStageStrip.innerHTML = [
      { eyebrow: "Rolling", value: openLoads, title: "Open loads", copy: "Loads still in transit or waiting to be fully confirmed." },
      { eyebrow: "Billing", value: confirmedUnbilled, title: "Confirmed / uninvoiced", copy: "Disposal charges that still need to make it onto the invoice." },
      { eyebrow: "Charge", value: formatUsd(totalCharge), title: "Unbilled charge", copy: "Customer-facing disposal still waiting to be billed." },
      { eyebrow: "Cost", value: formatUsd(totalCost), title: "Tracked disposal cost", copy: "What the dumps have cost the business so far." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (manifestActionBar) {
    manifestActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-manifest-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-manifest-action="money">Open money</button>
      <button type="button" class="pipeline-action-chip" data-manifest-action="facilities">Open facilities</button>
      <button type="button" class="pipeline-action-chip" data-manifest-action="compliance">Open compliance</button>
    `;
    manifestActionBar.querySelectorAll("[data-manifest-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-manifest-action");
        if (action === "jobs") return switchTab("jobs");
        if (action === "money") return switchTab("payments");
        if (action === "facilities") return switchTab("facilities");
        if (action === "compliance") return switchTab("compliance");
      });
    });
  }
  if (!rows.length) {
    hydrovacManifestsList.innerHTML = `<div class="muted">No loads logged yet. Once the truck starts hauling, manifests will show up here for office review.</div>`;
    hydrovacManifestDetailWrap.innerHTML = `<div class="muted">Select a load to inspect it.</div>`;
    return;
  }
  if (!ACTIVE_MANIFEST_ID || !rows.some((row) => row.id === ACTIVE_MANIFEST_ID)) ACTIVE_MANIFEST_ID = rows[0].id;
  hydrovacManifestsList.innerHTML = rows.map((row) => {
    const job = (JOBS_CACHE || []).find((candidate) => candidate.id === row.job_id) || null;
    const customer = (CUSTOMERS_CACHE || []).find((candidate) => candidate.id === row.customer_id) || null;
    return `
      <button type="button" class="list-item ${row.id === ACTIVE_MANIFEST_ID ? "is-active" : ""}" data-manifest-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.manifest_number || "Draft load")}</div>
          <div class="li-sub muted">${escapeHtml(customer?.name || job?.customer_name || "Unknown customer")}</div>
          <div class="li-sub muted">${escapeHtml(job?.title || row.pickup_address || "Job not linked")}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${hydrovacManifestToneClass(row.status)}">${escapeHtml(titleCaseWords(String(row.status || "in_transit").replace(/_/g, " ")))}</span>
          <span class="pill">${escapeHtml(hydrovacManifestQuantityLabel(row) || "Qty pending")}</span>
        </div>
      </button>
    `;
  }).join("");
  hydrovacManifestsList.querySelectorAll("[data-manifest-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_MANIFEST_ID = button.getAttribute("data-manifest-id") || null;
      renderHydrovacManifests();
    });
  });
  const active = currentHydrovacManifest();
  const linkedJob = active?.job_id ? (JOBS_CACHE || []).find((row) => row.id === active.job_id) || null : null;
  const linkedOrder = active?.order_id ? (CRM_ORDERS_CACHE || []).find((row) => row.id === active.order_id) || null : linkedOrderForJob(linkedJob);
  const linkedCustomer = active?.customer_id
    ? (CUSTOMERS_CACHE || []).find((row) => row.id === active.customer_id) || null
    : (linkedOrder?.customer_id ? (CUSTOMERS_CACHE || []).find((row) => row.id === linkedOrder.customer_id) || null : null);
  const marginCents = Number(active?.disposal_charge_cents || 0) - Number(active?.disposal_cost_cents || 0);
  hydrovacManifestDetailWrap.innerHTML = active ? `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active.manifest_number || "Draft load")}</strong>
        <span class="pill ${hydrovacManifestToneClass(active.status)}">${escapeHtml(titleCaseWords(String(active.status || "in_transit").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-grid">
        <div><span class="muted">Customer</span><div>${escapeHtml(linkedCustomer?.name || linkedOrder?.customer_name || linkedJob?.customer_name || "Not linked")}</div></div>
        <div><span class="muted">Job</span><div>${escapeHtml(linkedJob?.title || "Not linked")}</div></div>
        <div><span class="muted">Material</span><div>${escapeHtml(hydrovacMaterialLabel(active.material_type))}</div></div>
        <div><span class="muted">Quantity</span><div>${escapeHtml(hydrovacManifestQuantityLabel(active) || "Pending")}</div></div>
        <div><span class="muted">Facility</span><div>${escapeHtml(active.disposal_facility_name || "Not set")}</div></div>
        <div><span class="muted">Ticket</span><div>${escapeHtml(active.disposal_ticket_number || "Pending")}</div></div>
        <div><span class="muted">Charge</span><div>${formatUsd(Number(active.disposal_charge_cents || 0))}</div></div>
        <div><span class="muted">Cost</span><div>${formatUsd(Number(active.disposal_cost_cents || 0))}</div></div>
        <div><span class="muted">Margin</span><div>${formatUsd(marginCents)}</div></div>
        <div><span class="muted">Invoice state</span><div>${escapeHtml(active.invoiced === true ? "Already on invoice" : "Waiting for invoice")}</div></div>
        <div><span class="muted">Order balance</span><div>${formatUsd(linkedOrder ? orderAmountDueCents(linkedOrder) : 0)}</div></div>
      </div>
      <div class="detail-copy" style="margin-top:12px;">${escapeHtml(active.notes || active.pickup_address || "No additional manifest notes.")}</div>
      <div class="pipeline-action-bar" style="padding:14px 0 0;">
        ${linkedCustomer ? `<button type="button" class="pipeline-action-chip" data-manifest-open-customer="${escapeAttr(linkedCustomer.id)}">Open customer</button>` : ""}
        ${linkedJob ? `<button type="button" class="pipeline-action-chip" data-manifest-open-job="${escapeAttr(linkedJob.id)}">Open job</button>` : ""}
        ${linkedOrder ? `<button type="button" class="pipeline-action-chip" data-manifest-open-order="${escapeAttr(linkedOrder.id)}">Open pipeline record</button>` : ""}
        ${linkedJob ? `<button type="button" class="pipeline-action-chip" data-manifest-open-invoice="${escapeAttr(linkedJob.id)}">Open invoice draft</button>` : ""}
        ${["in_transit", "delivered"].includes(String(active.status || "").toLowerCase()) ? `<button type="button" class="pipeline-action-chip" data-manifest-confirm="${escapeAttr(active.id)}">Confirm load</button>` : ""}
        ${active.invoiced !== true ? `<button type="button" class="pipeline-action-chip" data-manifest-open-money="1">Open money</button>` : ""}
      </div>
    </div>
  ` : `<div class="muted">Select a load to inspect it.</div>`;
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-customer]")?.addEventListener("click", (event) => {
    ACTIVE_CUSTOMER_ID = event.currentTarget.getAttribute("data-manifest-open-customer") || null;
    switchTab("customers");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-job]")?.addEventListener("click", (event) => {
    ACTIVE_JOB_ID = event.currentTarget.getAttribute("data-manifest-open-job") || null;
    switchTab("jobs");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-order]")?.addEventListener("click", (event) => {
    ACTIVE_ORDER_ID = event.currentTarget.getAttribute("data-manifest-open-order") || null;
    switchTab("orders");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-invoice]")?.addEventListener("click", (event) => {
    ACTIVE_JOB_ID = event.currentTarget.getAttribute("data-manifest-open-invoice") || null;
    switchTab("payments");
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-open-money]")?.addEventListener("click", () => switchTab("payments"));
  hydrovacManifestDetailWrap.querySelector("[data-manifest-confirm]")?.addEventListener("click", async (event) => {
    const id = event.currentTarget.getAttribute("data-manifest-confirm");
    if (!id) return;
    await requestOperatorFunction("manage-waste-manifests", {
      method: "PATCH",
      body: { id, status: "confirmed", disposal_confirmed_at: new Date().toISOString() },
    });
    await fetchHydrovacManifests();
    if (TABS_LOADED.has("jobs")) await fetchJobs();
  });
}
function renderHydrovacLocateWorkspace() {
  if (!hydrovacLocateList) return;
  const rows = Array.isArray(HYDROVAC_LOCATE_TICKETS_CACHE) ? HYDROVAC_LOCATE_TICKETS_CACHE : [];
  const expiringSoon = rows.filter((row) => {
    const days = daysUntil(row.valid_until);
    return days != null && days >= 0 && days <= 3;
  }).length;
  const expired = rows.filter((row) => {
    const days = daysUntil(row.valid_until);
    return days != null && days < 0;
  }).length;
  const verified = rows.filter((row) => row.verified_on_site === true).length;
  if (locateStageStrip) {
    locateStageStrip.innerHTML = [
      { eyebrow: "Live", value: rows.filter((row) => ["active", "extended"].includes(String(row.status || "").toLowerCase())).length, title: "Active coverage", copy: "Tickets currently covering excavation or potholing work." },
      { eyebrow: "Watch", value: expiringSoon, title: "Expiring soon", copy: "Coverage the office should extend before the crew gets jammed up." },
      { eyebrow: "Risk", value: expired, title: "Expired", copy: "Tickets already out of date and worth immediate attention." },
      { eyebrow: "Field", value: verified, title: "Verified on site", copy: "Tickets the crew has already confirmed in the field." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (locateActionBar) {
    locateActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-locate-action="new">New ticket</button>
      <button type="button" class="pipeline-action-chip" data-locate-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-locate-action="compliance">Open compliance</button>
      <button type="button" class="pipeline-action-chip" data-locate-action="pipeline">Open pipeline</button>
    `;
    locateActionBar.querySelectorAll("[data-locate-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-locate-action");
        if (action === "new") return clearHydrovacLocateForm();
        if (action === "jobs") return switchTab("jobs");
        if (action === "compliance") return switchTab("compliance");
        if (action === "pipeline") return switchTab("orders");
      });
    });
  }
  renderHydrovacLocateJobOptions(currentHydrovacLocate()?.job_id || "");
  if (!rows.length) {
    hydrovacLocateList.innerHTML = `<div class="muted">No locate tickets logged yet. Add 811 coverage here or from the linked job.</div>`;
    clearHydrovacLocateForm();
    return;
  }
  if (!ACTIVE_LOCATE_ID || !rows.some((row) => row.id === ACTIVE_LOCATE_ID)) ACTIVE_LOCATE_ID = rows[0].id;
  hydrovacLocateList.innerHTML = rows.map((row) => {
    const job = (JOBS_CACHE || []).find((candidate) => candidate.id === row.job_id) || null;
    return `
      <button type="button" class="list-item ${row.id === ACTIVE_LOCATE_ID ? "is-active" : ""}" data-locate-id="${escapeAttr(row.id)}">
        <div class="li-main">
          <div class="li-title">${escapeHtml(row.ticket_number || "Ticket pending")}</div>
          <div class="li-sub muted">${escapeHtml(job?.title || row.work_site_address || "Job not linked")}</div>
          <div class="li-sub muted">${escapeHtml(row.one_call_center || "One-call center not set")}</div>
        </div>
        <div class="li-meta">
          <span class="pill ${hydrovacLocateToneClass(row)}">${escapeHtml(titleCaseWords(String(row.status || "requested").replace(/_/g, " ")))}</span>
          <span class="pill">${escapeHtml(hydrovacLocateExpiryLabel(row) || "No expiry")}</span>
        </div>
      </button>
    `;
  }).join("");
  hydrovacLocateList.querySelectorAll("[data-locate-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_LOCATE_ID = button.getAttribute("data-locate-id") || null;
      renderHydrovacLocateWorkspace();
    });
  });
  populateHydrovacLocateForm(currentHydrovacLocate());
}
function renderHydrovacCompliance(expiringTickets = [], unbilledManifests = []) {
  if (!hydrovacComplianceSummary || !hydrovacComplianceUrgent || !hydrovacComplianceCoverage) return;
  const equipmentWarnings = HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE.flatMap((row) => (row.warnings || []).map((warning) => ({ ...warning, type: "equipment", row })));
  const driverWarnings = HYDROVAC_DRIVER_COMPLIANCE_CACHE.flatMap((row) => (row.warnings || []).map((warning) => ({ ...warning, type: "driver", row })));
  const loggedAlerts = Array.isArray(HYDROVAC_ALERTS_CACHE) ? HYDROVAC_ALERTS_CACHE.filter((row) => row && row.resolved !== true) : [];
  const criticalCount = equipmentWarnings.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length
    + driverWarnings.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length
    + expiringTickets.filter((row) => {
      const days = daysUntil(row.valid_until);
      return days != null && days <= 3;
    }).length
    + loggedAlerts.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length;
  const warningCount = equipmentWarnings.filter((row) => String(row.severity || "").toLowerCase() === "warning").length
    + driverWarnings.filter((row) => String(row.severity || "").toLowerCase() === "warning").length
    + loggedAlerts.filter((row) => String(row.severity || "").toLowerCase() === "warning").length;
  const avgMargin = HYDROVAC_ANALYTICS_CACHE?.avg_job_margin != null
    ? `${Math.round(Number(HYDROVAC_ANALYTICS_CACHE.avg_job_margin || 0) * 100)}%`
    : "N/A";
  if (complianceStageStrip) {
    complianceStageStrip.innerHTML = [
      { eyebrow: "Critical", value: criticalCount, title: "Act now", copy: "Items that can stop dispatch, compliance, or billing if ignored." },
      { eyebrow: "Watch", value: warningCount, title: "Expiring soon", copy: "Documents and permits the office should get in front of this month." },
      { eyebrow: "Logged", value: loggedAlerts.length, title: "Audit trail", copy: "Blocked starts, closeout issues, and forced dispatches still waiting on follow-through." },
      { eyebrow: "Billing", value: unbilledManifests.length, title: "Uninvoiced disposal", copy: "Confirmed manifests still waiting to make it onto an invoice." },
      { eyebrow: "Margin", value: avgMargin, title: "Average job margin", copy: "Recent hydrovac margin based on tracked costs already in the system." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (complianceActionBar) {
    complianceActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-compliance-action="locates">Open locate tickets</button>
      <button type="button" class="pipeline-action-chip" data-compliance-action="manifests">Open manifests</button>
      <button type="button" class="pipeline-action-chip" data-compliance-action="equipment">Open equipment</button>
      <button type="button" class="pipeline-action-chip" data-compliance-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-compliance-action="refresh">Refresh alerts</button>
    `;
    complianceActionBar.querySelectorAll("[data-compliance-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-compliance-action");
        if (action === "locates") return switchTab("locates");
        if (action === "manifests") return switchTab("manifests");
        if (action === "equipment") return switchTab("equipment");
        if (action === "jobs") return switchTab("jobs");
        if (action === "refresh") return fetchHydrovacComplianceData().catch(console.error);
      });
    });
  }
  hydrovacComplianceSummary.innerHTML = `
    <div class="card stat-card"><div class="card-hd"><strong>Critical items</strong><span class="muted">Today</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(criticalCount))}</div></div></div>
    <div class="card stat-card"><div class="card-hd"><strong>Driver warnings</strong><span class="muted">CDL / med / certs</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(driverWarnings.length))}</div></div></div>
    <div class="card stat-card"><div class="card-hd"><strong>Equipment warnings</strong><span class="muted">Inspections / docs</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(equipmentWarnings.length))}</div></div></div>
    <div class="card stat-card"><div class="card-hd"><strong>Logged alerts</strong><span class="muted">Blocked / forced work</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(loggedAlerts.length))}</div></div></div>
    <div class="card stat-card"><div class="card-hd"><strong>Uninvoiced disposal</strong><span class="muted">Confirmed manifests</span></div><div class="card-bd"><div class="money-big">${escapeHtml(String(unbilledManifests.length))}</div></div></div>
  `;
  const urgentItems = [];
  expiringTickets.forEach((ticket) => {
    const days = daysUntil(ticket.valid_until);
    urgentItems.push({
      label: `Locate ${ticket.ticket_number || "ticket"}${days != null ? ` (${days < 0 ? "expired" : `${days}d left`})` : ""}`,
      sub: ticket.work_site_address || "Ticket coverage",
      tone: days != null && days < 0 ? "pill-bad" : "pill-warn",
      actionTab: "locates",
    });
  });
  equipmentWarnings.forEach((warning) => {
    urgentItems.push({
      label: `${warning.row?.unit_number || warning.row?.name || "Truck"}: ${titleCaseWords(String(warning.field || "").replace(/_/g, " "))}`,
      sub: warning.row?.name || "Equipment compliance",
      tone: hydrovacWarningTone(warning.severity),
      actionTab: "equipment",
    });
  });
  driverWarnings.forEach((warning) => {
    urgentItems.push({
      label: `${warning.row?.operator_members?.display_name || "Driver"}: ${titleCaseWords(String(warning.field || "").replace(/_/g, " "))}`,
      sub: "Driver compliance",
      tone: hydrovacWarningTone(warning.severity),
      actionTab: "compliance",
    });
  });
  unbilledManifests.forEach((manifest) => {
    urgentItems.push({
      label: `Uninvoiced ${manifest.manifest_number || "manifest"} (${formatUsd(Number(manifest.disposal_charge_cents || 0))})`,
      sub: manifest.disposal_facility_name || manifest.material_type || "Disposal charge waiting for billing",
      tone: "pill-warn",
      actionTab: "manifests",
    });
  });
  loggedAlerts.forEach((alert) => {
    urgentItems.push({
      id: alert.id,
      label: titleCaseWords(String(alert.alert_type || "alert").replace(/_/g, " ")),
      sub: alert.message || "Compliance alert logged",
      tone: hydrovacWarningTone(alert.severity),
      actionTab: alert.reference_type === "manifest" ? "manifests" : "jobs",
      canResolve: true,
    });
  });
  hydrovacComplianceUrgent.innerHTML = urgentItems.length ? urgentItems.slice(0, 20).map((item) => `
    <div class="list-item">
      <button type="button" class="li-main" data-compliance-tab="${escapeAttr(item.actionTab)}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;">
        <div class="li-title">${escapeHtml(item.label)}</div>
        <div class="li-sub muted">${escapeHtml(item.sub)}</div>
      </button>
      <div class="li-meta">
        <span class="pill ${item.tone}">${item.canResolve ? "Logged" : "Review"}</span>
        ${item.canResolve ? `<button type="button" class="btn btn-ghost btn-sm" data-compliance-resolve="${escapeAttr(item.id || "")}">Resolve</button>` : ""}
      </div>
    </div>
  `).join("") : `<div class="muted">No urgent compliance issues are showing right now.</div>`;
  hydrovacComplianceUrgent.querySelectorAll("[data-compliance-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.getAttribute("data-compliance-tab") || "compliance"));
  });
  hydrovacComplianceUrgent.querySelectorAll("[data-compliance-resolve]").forEach((button) => {
    button.addEventListener("click", async () => {
      const alertId = button.getAttribute("data-compliance-resolve") || "";
      if (!alertId) return;
      button.disabled = true;
      try {
        await resolveHydrovacAlert(alertId);
      } catch (error) {
        console.error("[resolveHydrovacAlert]", error);
      } finally {
        button.disabled = false;
      }
    });
  });
  hydrovacComplianceCoverage.innerHTML = `
    <div class="list-item">
      <div class="li-main"><div class="li-title">Hydrovac jobs tracked</div><div class="li-sub muted">Recent completed jobs in analytics</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String(HYDROVAC_ANALYTICS_CACHE?.total_jobs || 0))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Tracked disposal cost</div><div class="li-sub muted">Recent period</div></div>
      <div class="li-meta"><span class="pill">${formatUsd(Number(HYDROVAC_ANALYTICS_CACHE?.total_disposal_cost_cents || 0))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Preferred facilities</div><div class="li-sub muted">Ready for dispatch</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String((HYDROVAC_FACILITIES_CACHE || []).filter((row) => String(row.status || "").toLowerCase() === "preferred").length))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Active tickets in cache</div><div class="li-sub muted">Recent office view</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String((HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => ["active", "extended"].includes(String(row.status || "").toLowerCase())).length))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Open compliance alerts</div><div class="li-sub muted">Issues the office still needs to clear or acknowledge after a block or forced dispatch.</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String(loggedAlerts.length))}</span></div>
    </div>
  `;
  renderHydrovacPermitsWorkspace();
  renderHydrovacAssetsWorkspace();
}

function renderHydrovacPermitsWorkspace() {
  if (!hydrovacPermitList || !hydrovacPermitDetail) return;
  const rows = Array.isArray(HYDROVAC_PERMITS_CACHE) ? HYDROVAC_PERMITS_CACHE : [];
  if (!ACTIVE_PERMIT_ID && rows[0]) ACTIVE_PERMIT_ID = rows[0].id;
  if (ACTIVE_PERMIT_ID && rows.length && !rows.some((row) => row.id === ACTIVE_PERMIT_ID)) ACTIVE_PERMIT_ID = rows[0].id;
  const openCount = rows.filter((row) => String(row.status || "").toLowerCase() === "open").length;
  const expiredCount = rows.filter((row) => {
    const days = daysUntil(row.permit_valid_until);
    return days != null && days < 0 && String(row.status || "").toLowerCase() === "open";
  }).length;
  const needsReading = rows.filter((row) => !Array.isArray(row.atmospheric_readings) || !row.atmospheric_readings.length).length;
  if (permitStageStrip) {
    permitStageStrip.innerHTML = [
      { eyebrow: "Open", value: openCount, title: "Active permits", copy: "Permit-required entries still open in the field." },
      { eyebrow: "Risk", value: expiredCount, title: "Expired", copy: "Open permits past their valid-until window." },
      { eyebrow: "Readings", value: needsReading, title: "Atmosphere missing", copy: "Permits that still need a full atmosphere reading logged." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (permitActionBar) {
    permitActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-permit-action="new">New permit</button>
      <button type="button" class="pipeline-action-chip" data-permit-action="jobs">Open jobs</button>
      <button type="button" class="pipeline-action-chip" data-permit-action="refresh">Refresh</button>
    `;
    permitActionBar.querySelectorAll("[data-permit-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-permit-action");
        if (action === "new") {
          ACTIVE_PERMIT_ID = null;
          renderHydrovacPermitsWorkspace();
          return;
        }
        if (action === "jobs") return switchTab("jobs");
        if (action === "refresh") return fetchHydrovacPermits().catch(console.error);
      });
    });
  }
  hydrovacPermitList.innerHTML = rows.length ? rows.map((row) => `
    <button type="button" class="list-item ${row.id === ACTIVE_PERMIT_ID ? "is-active" : ""}" data-permit-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.permit_number || row.space_description || "Permit")}</div>
        <div class="li-sub muted">${escapeHtml(row.space_description || "Space description missing")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${String(row.status || "").toLowerCase() === "open" ? "pill-warn" : "pill-on"}">${escapeHtml(titleCaseWords(String(row.status || "open").replace(/_/g, " ")))}</span>
      </div>
    </button>
  `).join("") : `<div class="muted">No confined-space permits logged yet.</div>`;
  hydrovacPermitList.querySelectorAll("[data-permit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_PERMIT_ID = button.getAttribute("data-permit-id") || null;
      renderHydrovacPermitsWorkspace();
    });
  });
  const active = currentHydrovacPermit();
  const reading = Array.isArray(active?.atmospheric_readings) && active.atmospheric_readings.length ? active.atmospheric_readings[active.atmospheric_readings.length - 1] : {};
  hydrovacPermitDetail.innerHTML = `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active?.permit_number || "New permit")}</strong>
        <span class="pill ${active ? hydrovacManifestToneClass(active.status) : "pill"}">${escapeHtml(titleCaseWords(String(active?.status || "draft").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-grid">
        <label>Job
          <select id="permitJobId">
            <option value="">Select job</option>
            ${(JOBS_CACHE || []).filter((job) => isHydrovacJob(job)).map((job) => `<option value="${escapeAttr(job.id)}"${job.id === active?.job_id ? " selected" : ""}>${escapeHtml(job.title || "Untitled job")}</option>`).join("")}
          </select>
        </label>
        <label>Space description
          <input id="permitSpaceDescription" value="${escapeAttr(active?.space_description || "")}" placeholder="Wet well, manhole, tank, or vault" />
        </label>
        <label>Supervisor
          <input id="permitSupervisor" value="${escapeAttr(active?.entry_supervisor_name || "")}" placeholder="Entry supervisor" />
        </label>
        <label>Attendant
          <input id="permitAttendant" value="${escapeAttr(active?.attendant_name || "")}" placeholder="Attendant" />
        </label>
        <label>Valid until
          <input id="permitValidUntil" type="datetime-local" value="${escapeAttr(hydrovacDateTimeInputValue(active?.permit_valid_until))}" />
        </label>
        <label>Status
          <select id="permitStatusSelect">
            <option value="open"${String(active?.status || "").toLowerCase() === "open" ? " selected" : ""}>Open</option>
            <option value="closed"${String(active?.status || "").toLowerCase() === "closed" ? " selected" : ""}>Closed</option>
            <option value="cancelled"${String(active?.status || "").toLowerCase() === "cancelled" ? " selected" : ""}>Cancelled</option>
          </select>
        </label>
        <label>O2 %
          <input id="permitOxygen" type="number" step="0.1" value="${escapeAttr(reading?.oxygen_pct ?? "")}" />
        </label>
        <label>LEL %
          <input id="permitLel" type="number" step="0.1" value="${escapeAttr(reading?.lel_pct ?? "")}" />
        </label>
        <label>H2S ppm
          <input id="permitH2s" type="number" step="0.1" value="${escapeAttr(reading?.h2s_ppm ?? "")}" />
        </label>
        <label>CO ppm
          <input id="permitCo" type="number" step="0.1" value="${escapeAttr(reading?.co_ppm ?? "")}" />
        </label>
      </div>
      <label style="margin-top:12px;">Known hazards
        <input id="permitHazards" value="${escapeAttr(Array.isArray(active?.known_hazards) ? active.known_hazards.join(", ") : "")}" placeholder="h2s, engulfment, electrical" />
      </label>
      <label style="margin-top:12px;">Rescue procedure
        <textarea id="permitRescueProcedure" rows="2" placeholder="How rescue is staged for this entry.">${escapeHtml(active?.rescue_procedure || "")}</textarea>
      </label>
      <div class="row" style="margin-top:12px;">
        <button id="btnSavePermit" class="btn btn-primary" type="button">${active ? "Save permit" : "Create permit"}</button>
        ${active?.job_id ? `<button id="btnOpenPermitJob" class="btn btn-ghost" type="button">Open job</button>` : ""}
      </div>
      <div id="permitMsg" class="msg"></div>
    </div>
  `;
  $("btnOpenPermitJob")?.addEventListener("click", () => {
    if (!active?.job_id) return;
    ACTIVE_JOB_ID = active.job_id;
    switchTab("jobs");
  });
  $("btnSavePermit")?.addEventListener("click", async () => {
    const oxygen = Number($("permitOxygen")?.value || "");
    const lel = Number($("permitLel")?.value || "");
    const h2s = Number($("permitH2s")?.value || "");
    const co = Number($("permitCo")?.value || "");
    const readingPayload = [oxygen, lel, h2s, co].some((value) => Number.isFinite(value)) ? [{
      tested_at: new Date().toISOString(),
      oxygen_pct: Number.isFinite(oxygen) ? oxygen : null,
      lel_pct: Number.isFinite(lel) ? lel : null,
      h2s_ppm: Number.isFinite(h2s) ? h2s : null,
      co_ppm: Number.isFinite(co) ? co : null,
      tester_name: CURRENT_OPERATOR?.name || "",
      monitor_serial: null,
    }] : (Array.isArray(active?.atmospheric_readings) ? active.atmospheric_readings : []);
    const oxygenOk = readingPayload.length ? (Number.isFinite(oxygen) ? (oxygen >= 19.5 && oxygen <= 23.5) : active?.oxygen_acceptable !== false) : true;
    const lelOk = readingPayload.length ? (Number.isFinite(lel) ? lel < 10 : active?.lel_acceptable !== false) : true;
    const h2sOk = readingPayload.length ? (Number.isFinite(h2s) ? h2s < 10 : active?.h2s_acceptable !== false) : true;
    const coOk = readingPayload.length ? (Number.isFinite(co) ? co < 35 : active?.co_acceptable !== false) : true;
    const payload = {
      job_id: $("permitJobId")?.value || null,
      space_description: $("permitSpaceDescription")?.value || "",
      entry_supervisor_name: $("permitSupervisor")?.value || null,
      attendant_name: $("permitAttendant")?.value || null,
      permit_valid_until: $("permitValidUntil")?.value ? new Date($("permitValidUntil").value).toISOString() : null,
      known_hazards: String($("permitHazards")?.value || "").split(",").map((part) => part.trim()).filter(Boolean),
      rescue_procedure: $("permitRescueProcedure")?.value || null,
      atmospheric_readings: readingPayload,
      oxygen_acceptable: oxygenOk,
      lel_acceptable: lelOk,
      h2s_acceptable: h2sOk,
      co_acceptable: coOk,
      status: $("permitStatusSelect")?.value || "open",
    };
    if (active?.id) payload.id = active.id;
    setInlineMessage($("permitMsg"), "Saving...");
    try {
      await requestOperatorFunction("manage-confined-space-permits", {
        method: active?.id ? "PATCH" : "POST",
        body: payload,
      });
      await fetchHydrovacPermits();
      if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
      setInlineMessage($("permitMsg"), "Permit saved.", "ok");
    } catch (error) {
      setInlineMessage($("permitMsg"), error.message || String(error), "error");
    }
  });
}

function renderHydrovacAssetsWorkspace() {
  if (!hydrovacAssetList || !hydrovacAssetDetail) return;
  const rows = Array.isArray(HYDROVAC_ASSETS_CACHE) ? HYDROVAC_ASSETS_CACHE : [];
  if (!ACTIVE_ASSET_ID && rows[0]) ACTIVE_ASSET_ID = rows[0].id;
  if (ACTIVE_ASSET_ID && rows.length && !rows.some((row) => row.id === ACTIVE_ASSET_ID)) ACTIVE_ASSET_ID = rows[0].id;
  const dueSoon = rows.filter((row) => {
    const days = daysUntil(row.next_service_due_date);
    return days != null && days >= 0 && days <= 14 && String(row.status || "").toLowerCase() !== "decommissioned";
  }).length;
  const withDefects = rows.filter((row) => row.has_defects === true).length;
  const activeRows = rows.filter((row) => String(row.status || "").toLowerCase() === "active").length;
  if (assetStageStrip) {
    assetStageStrip.innerHTML = [
      { eyebrow: "Live", value: activeRows, title: "Active assets", copy: "Catch basins, manholes, tanks, and structures still in service." },
      { eyebrow: "Due", value: dueSoon, title: "Needs service soon", copy: "Assets with maintenance due in the next two weeks." },
      { eyebrow: "Watch", value: withDefects, title: "Defects flagged", copy: "Assets carrying condition or defect notes." },
    ].map((stage) => `
      <div class="pipeline-stage-card is-active">
        <div class="pipeline-stage-card__eyebrow">${escapeHtml(stage.eyebrow)}</div>
        <div class="pipeline-stage-card__value">${escapeHtml(String(stage.value))}</div>
        <div class="pipeline-stage-card__title">${escapeHtml(stage.title)}</div>
        <div class="pipeline-stage-card__copy">${escapeHtml(stage.copy)}</div>
      </div>
    `).join("");
  }
  if (assetActionBar) {
    assetActionBar.innerHTML = `
      <button type="button" class="pipeline-action-chip" data-asset-action="new">New asset</button>
      <button type="button" class="pipeline-action-chip" data-asset-action="customers">Open customers</button>
      <button type="button" class="pipeline-action-chip" data-asset-action="calendar">Open calendar</button>
    `;
    assetActionBar.querySelectorAll("[data-asset-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-asset-action");
        if (action === "new") {
          ACTIVE_ASSET_ID = null;
          renderHydrovacAssetsWorkspace();
          return;
        }
        if (action === "customers") return switchTab("customers");
        if (action === "calendar") return switchTab("bookings");
      });
    });
  }
  hydrovacAssetList.innerHTML = rows.length ? rows.map((row) => `
    <button type="button" class="list-item ${row.id === ACTIVE_ASSET_ID ? "is-active" : ""}" data-asset-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.asset_name || row.external_asset_id || titleCaseWords(String(row.asset_type || "asset").replace(/_/g, " ")))}</div>
        <div class="li-sub muted">${escapeHtml(row.address || row.location_description || "Address not set")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${row.has_defects ? "pill-warn" : "pill-on"}">${row.has_defects ? "Defects" : escapeHtml(titleCaseWords(String(row.status || "active")))}</span>
      </div>
    </button>
  `).join("") : `<div class="muted">No infrastructure assets saved yet.</div>`;
  hydrovacAssetList.querySelectorAll("[data-asset-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_ASSET_ID = button.getAttribute("data-asset-id") || null;
      renderHydrovacAssetsWorkspace();
    });
  });
  const active = currentHydrovacAsset();
  hydrovacAssetDetail.innerHTML = `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active?.asset_name || "New asset")}</strong>
        <span class="pill ${active?.has_defects ? "pill-warn" : "pill-on"}">${escapeHtml(titleCaseWords(String(active?.status || "active").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-grid">
        <label>Customer
          <select id="assetCustomerId">
            <option value="">Optional</option>
            ${(CUSTOMERS_CACHE || []).map((customer) => `<option value="${escapeAttr(customer.id)}"${customer.id === active?.customer_id ? " selected" : ""}>${escapeHtml(customer.name || customer.email || "Customer")}</option>`).join("")}
          </select>
        </label>
        <label>Asset type
          <select id="assetType">
            ${["catch_basin","manhole","lift_station","wet_well","storm_drain","grease_trap","industrial_tank","vault","sump","pipe_segment","other"].map((type) => `<option value="${type}"${type === (active?.asset_type || "catch_basin") ? " selected" : ""}>${escapeHtml(titleCaseWords(type.replace(/_/g, " ")))}</option>`).join("")}
          </select>
        </label>
        <label>Asset name
          <input id="assetName" value="${escapeAttr(active?.asset_name || "")}" placeholder="CB-047 / Main & Oak NW" />
        </label>
        <label>External asset ID
          <input id="assetExternalId" value="${escapeAttr(active?.external_asset_id || "")}" placeholder="Customer or GIS asset ID" />
        </label>
        <label>Address
          <input id="assetAddress" value="${escapeAttr(active?.address || "")}" placeholder="Asset location" />
        </label>
        <label>Service frequency (days)
          <input id="assetServiceFrequency" type="number" min="0" step="1" value="${escapeAttr(active?.service_frequency_days ?? "")}" />
        </label>
        <label>Next due date
          <input id="assetNextDueDate" type="date" value="${escapeAttr(active?.next_service_due_date || "")}" />
        </label>
        <label>Condition
          <select id="assetConditionRating">
            <option value="">Not set</option>
            <option value="good"${active?.last_condition_rating === "good" ? " selected" : ""}>Good</option>
            <option value="fair"${active?.last_condition_rating === "fair" ? " selected" : ""}>Fair</option>
            <option value="poor"${active?.last_condition_rating === "poor" ? " selected" : ""}>Poor</option>
            <option value="critical"${active?.last_condition_rating === "critical" ? " selected" : ""}>Critical</option>
          </select>
        </label>
      </div>
      <label style="margin-top:12px;"><input id="assetHasDefects" type="checkbox"${active?.has_defects ? " checked" : ""} /> Defects present</label>
      <label style="margin-top:12px;">Defect codes
        <input id="assetDefectCodes" value="${escapeAttr(Array.isArray(active?.defect_codes) ? active.defect_codes.join(", ") : "")}" placeholder="Broken frame, collapsed wall, heavy sediment" />
      </label>
      <label style="margin-top:12px;">Notes
        <textarea id="assetNotes" rows="3" placeholder="Condition notes, site access, or municipal context.">${escapeHtml(active?.notes || "")}</textarea>
      </label>
      <div class="detail-copy" style="margin-top:12px;">Service count: ${escapeHtml(String(active?.service_count_total || 0))} total • Last serviced ${escapeHtml(active?.last_service_date || "Not yet recorded")}</div>
      <div class="row" style="margin-top:12px;">
        <button id="btnSaveAsset" class="btn btn-primary" type="button">${active ? "Save asset" : "Create asset"}</button>
        ${active?.customer_id ? `<button id="btnOpenAssetCustomer" class="btn btn-ghost" type="button">Open customer</button>` : ""}
      </div>
      <div id="assetMsg" class="msg"></div>
    </div>
  `;
  $("btnOpenAssetCustomer")?.addEventListener("click", () => {
    if (!active?.customer_id) return;
    ACTIVE_CUSTOMER_ID = active.customer_id;
    CUSTOMER_CREATING = false;
    switchTab("customers");
  });
  $("btnSaveAsset")?.addEventListener("click", async () => {
    const payload = {
      customer_id: $("assetCustomerId")?.value || null,
      asset_type: $("assetType")?.value || "catch_basin",
      asset_name: $("assetName")?.value || null,
      external_asset_id: $("assetExternalId")?.value || null,
      address: $("assetAddress")?.value || null,
      service_frequency_days: $("assetServiceFrequency")?.value || null,
      next_service_due_date: $("assetNextDueDate")?.value || null,
      last_condition_rating: $("assetConditionRating")?.value || null,
      has_defects: $("assetHasDefects")?.checked || false,
      defect_codes: String($("assetDefectCodes")?.value || "").split(",").map((part) => part.trim()).filter(Boolean),
      notes: $("assetNotes")?.value || null,
      status: active?.status || "active",
    };
    if (active?.id) payload.id = active.id;
    setInlineMessage($("assetMsg"), "Saving...");
    try {
      await requestOperatorFunction("manage-infrastructure-assets", {
        method: active?.id ? "PATCH" : "POST",
        body: payload,
      });
      await fetchHydrovacAssets();
      if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
      setInlineMessage($("assetMsg"), "Asset saved.", "ok");
    } catch (error) {
      setInlineMessage($("assetMsg"), error.message || String(error), "error");
    }
  });
}

let HYDROVAC_OPS_WORKSPACE_BINDINGS_BOUND = false;
function initHydrovacOpsWorkspaceBindings() {
  if (HYDROVAC_OPS_WORKSPACE_BINDINGS_BOUND) return;
  HYDROVAC_OPS_WORKSPACE_BINDINGS_BOUND = true;

btnRefreshFacilities?.addEventListener("click", () => fetchHydrovacFacilities().catch(console.error));
btnNewFacility?.addEventListener("click", () => clearHydrovacFacilityForm());
btnSaveAndAddFacility?.addEventListener("click", () => {
  FACILITY_SAVE_ADD_ANOTHER = true;
  hydrovacFacilityForm?.requestSubmit?.();
});
btnClearFacility?.addEventListener("click", () => clearHydrovacFacilityForm());
hydrovacFacilityForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setInlineMessage(hydrovacFacilityMsg, "Saving...");
  const shouldAddAnother = FACILITY_SAVE_ADD_ANOTHER;
  FACILITY_SAVE_ADD_ANOTHER = false;
  try {
    const cityState = parseHydrovacCityState(hydrovacFacilityCityState?.value || "");
    const payload = {
      id: hydrovacFacilityId?.value || undefined,
      name: hydrovacFacilityName?.value || "",
      status: hydrovacFacilityStatus?.value || "active",
      facility_type: hydrovacFacilityType?.value || "transfer_station",
      permit_expiry_date: hydrovacFacilityPermitExpiry?.value || null,
      address: hydrovacFacilityAddress?.value || null,
      city: cityState.city,
      state_province: cityState.state_province,
      price_per_gallon_cents: Math.round((parseFloat(hydrovacFacilityRateGallon?.value || "0") || 0) * 100),
      price_per_cubic_yard_cents: Math.round((parseFloat(hydrovacFacilityRateYard?.value || "0") || 0) * 100),
      minimum_charge_cents: Math.round((parseFloat(hydrovacFacilityMinimumCharge?.value || "0") || 0) * 100),
      primary_contact_name: hydrovacFacilityContact?.value || null,
      dispatch_phone: hydrovacFacilityDispatchPhone?.value || null,
      accepted_waste_types: String(hydrovacFacilityWasteTypes?.value || "").split(",").map((part) => part.trim()).filter(Boolean),
      notes: hydrovacFacilityNotes?.value || null,
    };
    const response = await requestOperatorFunction("manage-disposal-facilities", {
      method: hydrovacFacilityId?.value ? "PATCH" : "POST",
      body: payload,
    });
    if (response?.facility?.id) ACTIVE_FACILITY_ID = response.facility.id;
    await fetchHydrovacFacilities();
    if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
    if (shouldAddAnother) {
      clearHydrovacFacilityForm();
      setInlineMessage(hydrovacFacilityMsg, "Facility saved. Ready for the next one.", "ok");
      hydrovacFacilityName?.focus?.();
    } else {
      setInlineMessage(hydrovacFacilityMsg, "Facility saved.", "ok");
    }
  } catch (error) {
    setInlineMessage(hydrovacFacilityMsg, error.message || String(error), "error");
  }
});
btnRefreshManifests?.addEventListener("click", () => fetchHydrovacManifests().catch(console.error));
btnRefreshLocates?.addEventListener("click", () => fetchHydrovacLocateTickets().catch(console.error));
btnNewLocate?.addEventListener("click", () => clearHydrovacLocateForm());
btnClearLocate?.addEventListener("click", () => clearHydrovacLocateForm());
btnVerifyLocate?.addEventListener("click", async () => {
  const id = hydrovacLocateId?.value || "";
  if (!id) return;
  setInlineMessage(hydrovacLocateMsg, "Marking verified...");
  try {
    await requestOperatorFunction("manage-locate-tickets", {
      method: "PATCH",
      body: { id, verified_on_site: true },
    });
    await fetchHydrovacLocateTickets();
    if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
    setInlineMessage(hydrovacLocateMsg, "Ticket marked verified.", "ok");
  } catch (error) {
    setInlineMessage(hydrovacLocateMsg, error.message || String(error), "error");
  }
});
hydrovacLocateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setInlineMessage(hydrovacLocateMsg, "Saving...");
  try {
    const payload = {
      id: hydrovacLocateId?.value || undefined,
      job_id: hydrovacLocateJobId?.value || null,
      ticket_number: hydrovacLocateNumber?.value || "",
      ticket_type: hydrovacLocateType?.value || "standard",
      status: hydrovacLocateStatus?.value || "requested",
      one_call_center: hydrovacLocateCenter?.value || null,
      state_province: hydrovacLocateState?.value || null,
      work_site_address: hydrovacLocateAddress?.value || "",
      valid_from: hydrovacLocateValidFrom?.value ? new Date(hydrovacLocateValidFrom.value).toISOString() : null,
      valid_until: hydrovacLocateValidUntil?.value ? new Date(hydrovacLocateValidUntil.value).toISOString() : null,
      locate_notes: hydrovacLocateNotes?.value || null,
    };
    await requestOperatorFunction("manage-locate-tickets", {
      method: hydrovacLocateId?.value ? "PATCH" : "POST",
      body: payload,
    });
    await fetchHydrovacLocateTickets();
    if (TABS_LOADED.has("compliance")) await fetchHydrovacComplianceData();
    if (TABS_LOADED.has("jobs")) await fetchJobs();
    setInlineMessage(hydrovacLocateMsg, "Ticket saved.", "ok");
  } catch (error) {
    setInlineMessage(hydrovacLocateMsg, error.message || String(error), "error");
  }
});
btnRefreshCompliance?.addEventListener("click", () => fetchHydrovacComplianceData().catch(console.error));
}

const HYDROVAC_OPS_WORKSPACE_HELPERS = {
  parseHydrovacCityState,
  hydrovacCityStateLabel,
  hydrovacDateTimeInputValue,
  hydrovacWarningTone,
  currentHydrovacFacility,
  currentHydrovacManifest,
  currentHydrovacLocate,
  currentDriverQualification,
  currentHydrovacPermit,
  currentHydrovacAsset,
  hydrovacSeverityRank,
  teamMemberLabel,
  driverStatusTone,
  hydrovacJobSortDate,
  clearHydrovacFacilityForm,
  populateHydrovacFacilityForm,
  renderHydrovacLocateJobOptions,
  clearHydrovacLocateForm,
  populateHydrovacLocateForm,
  fetchHydrovacFacilities,
  fetchHydrovacManifests,
  fetchHydrovacLocateTickets,
  fetchHydrovacComplianceData,
  fetchHydrovacDriverQualifications,
  fetchHydrovacPermits,
  fetchHydrovacAssets,
  renderHydrovacDriverWorkspace,
  renderHydrovacFacilities,
  renderHydrovacManifests,
  renderHydrovacLocateWorkspace,
  renderHydrovacCompliance,
  renderHydrovacPermitsWorkspace,
  renderHydrovacAssetsWorkspace,
  initHydrovacOpsWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_HYDROVAC_OPS_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_HYDROVAC_OPS_WORKSPACE || {}),
  ...HYDROVAC_OPS_WORKSPACE_HELPERS,
};

Object.assign(window, HYDROVAC_OPS_WORKSPACE_HELPERS);
