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
function hydrovacManifestMeta(row) {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}
function hydrovacManifestBolNumber(row) {
  const metadata = hydrovacManifestMeta(row);
  return String(metadata.bol_number || metadata.bill_of_lading_number || "").trim();
}
function hydrovacManifestIsLive(row) {
  const metadata = hydrovacManifestMeta(row);
  if (metadata.load_still_in_truck === true) return true;
  return String(metadata.load_state || "").trim().toLowerCase() === "live_in_truck";
}
function hydrovacManifestHoldReason(row) {
  const metadata = hydrovacManifestMeta(row);
  return String(metadata.live_load_hold_reason || metadata.hold_reason || "").trim();
}
function hydrovacManifestReadyBy(row) {
  const metadata = hydrovacManifestMeta(row);
  return String(metadata.disposal_ready_by || "").trim();
}
function hydrovacManifestPreparedAt(row, key) {
  const metadata = hydrovacManifestMeta(row);
  return String(metadata[key] || "").trim();
}
function hydrovacManifestLifecycleLabel(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (hydrovacManifestPreparedAt(row, "audit_archived_at") || status === "archived") return "Archived for audit";
  if (row?.invoiced === true) return "Billed";
  if (status === "confirmed") return "Disposed";
  if (hydrovacManifestIsLive(row)) return "Live in truck";
  if (["in_transit", "delivered"].includes(status)) return hydrovacManifestReadyBy(row) ? "Ready for disposal" : "Loaded";
  return "Loaded";
}
function hydrovacManifestAuditIssues(row) {
  const issues = [];
  const status = String(row?.status || "").trim().toLowerCase();
  if (!hydrovacManifestBolNumber(row)) issues.push("BOL missing");
  if (hydrovacManifestIsLive(row) && !hydrovacManifestHoldReason(row)) issues.push("Live-load reason missing");
  if (!hydrovacManifestIsLive(row) && ["confirmed", "delivered", "in_transit"].includes(status)) {
    if (!String(row?.disposal_facility_name || row?.disposal_facility_id || "").trim()) issues.push("Facility missing");
    if (!String(row?.disposal_ticket_number || "").trim() && status === "confirmed") issues.push("Disposal ticket missing");
  }
  if (!hydrovacManifestPreparedAt(row, "customer_records_prepared_at")) issues.push("Customer records not prepared");
  if (!hydrovacManifestPreparedAt(row, "audit_packet_prepared_at")) issues.push("Audit packet not prepared");
  return issues;
}
function hydrovacJobCloseout(row = null) {
  if (!row?.completion_handoff || typeof row.completion_handoff !== "object" || Array.isArray(row.completion_handoff)) {
    const metadata = row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata
      : {};
    if (metadata.crew_closeout && typeof metadata.crew_closeout === "object" && !Array.isArray(metadata.crew_closeout)) {
      return metadata.crew_closeout;
    }
    const customFields = row?.custom_fields && typeof row.custom_fields === "object" && !Array.isArray(row.custom_fields)
      ? row.custom_fields
      : {};
    return customFields.crew_closeout && typeof customFields.crew_closeout === "object" && !Array.isArray(customFields.crew_closeout)
      ? customFields.crew_closeout
      : null;
  }
  return row.completion_handoff;
}
function hydrovacCloseoutLocateSummary(jobId) {
  const tickets = (HYDROVAC_LOCATE_TICKETS_CACHE || []).filter((row) => String(row?.job_id || "") === String(jobId || ""));
  const expired = tickets.filter((row) => {
    const until = Date.parse(row?.extended_until || row?.valid_until || "");
    const status = String(row?.status || "").trim().toLowerCase();
    return status === "expired" || (Number.isFinite(until) && until < Date.now());
  }).length;
  const verified = tickets.filter((row) => row?.verified_on_site === true).length;
  return {
    tickets,
    expired,
    verified,
  };
}
function hydrovacCloseoutPermitSummary(jobId) {
  const permits = (HYDROVAC_PERMITS_CACHE || []).filter((row) => String(row?.job_id || "") === String(jobId || ""));
  const open = permits.filter((row) => String(row?.status || "").trim().toLowerCase() === "open");
  return {
    permits,
    openCount: open.length,
    primary: open[0] || permits[0] || null,
  };
}
function hydrovacCloseoutLoadLabel(handoff = null, row = null) {
  const status = String(handoff?.load_status || "").trim();
  if (status === "truck_clear") return "Truck clear";
  if (status === "no_load") return "No load hauled";
  if (status === "live_load_remaining") return "Live load remaining";
  if (hydrovacManifestIsLive(row)) return "Live load still in truck";
  return hydrovacManifestLifecycleLabel(row);
}
function hydrovacCloseoutPermitLabel(handoff = null, permitSummary = null) {
  const status = String(handoff?.permit_status || "").trim();
  if (status === "open_and_safe") return "Open and safe";
  if (status === "closed") return "Closed";
  if (status === "needs_office_followup") return "Needs office follow-up";
  if (status === "not_required") return "Not required";
  return permitSummary?.openCount ? "Permit open" : "Not captured";
}
function hydrovacCloseoutLocateLabel(handoff = null, locateSummary = null) {
  if (handoff?.locates_verified_on_site === true) return "Verified on site";
  if (handoff?.locates_verified_on_site === false) return "Needs office follow-up";
  if (locateSummary?.expired) return "Expired locate";
  return locateSummary?.tickets?.length ? "Not captured" : "No locate ticket";
}
function hydrovacCloseoutFollowUpLabels(handoff = null) {
  const keys = Array.isArray(handoff?.office_follow_up) ? handoff.office_follow_up : [];
  return keys.map((item) => {
    if (item === "customer_records") return "Customer records";
    if (item === "audit_packet") return "Audit packet";
    if (item === "invoice") return "Invoice";
    if (item === "disposal_ticket") return "Disposal ticket";
    if (item === "site_return") return "Site return";
    return titleCaseWords(String(item || "").replace(/_/g, " "));
  }).filter(Boolean);
}
function hydrovacCloseoutFieldIssues(row, linkedJob, handoff, locateSummary, permitSummary) {
  const issues = [];
  const requiresPermit = linkedJob?.requires_confined_space_permit === true || (permitSummary?.permits?.length || 0) > 0;
  if (!handoff) issues.push("Crew closeout missing");
  if (!String(handoff?.field_summary || "").trim()) issues.push("Field summary missing");
  if (!String(handoff?.load_status || "").trim()) issues.push("Load status missing");
  if (String(handoff?.load_status || "").trim() === "live_load_remaining") {
    if (!String(handoff?.live_load_hold_reason || "").trim()) issues.push("Live-load hold reason missing");
    if (!String(handoff?.disposal_ready_by || "").trim()) issues.push("Disposal-ready date missing");
  }
  if (requiresPermit && !String(handoff?.permit_status || "").trim()) issues.push("Permit status missing");
  if (requiresPermit && String(handoff?.permit_status || "").trim() === "not_required") issues.push("Permit status conflicts with permit pressure");
  if ((locateSummary?.tickets?.length || 0) > 0 && handoff?.locates_verified_on_site == null) issues.push("Locate confirmation missing");
  if (handoff && ["truck_clear", "no_load"].includes(String(handoff.load_status || "").trim()) && String(row?.status || "").trim().toLowerCase() !== "confirmed" && row?.invoiced !== true) {
    issues.push("Disposal still needs office confirmation");
  }
  return issues;
}
function hydrovacCloseoutReleaseBlockers(row, linkedJob, handoff, locateSummary, permitSummary) {
  const blockers = [];
  const readyBy = hydrovacManifestReadyBy(row);
  const todayKey = new Date().toISOString().slice(0, 10);
  if (hydrovacManifestIsLive(row) && readyBy && readyBy < todayKey) {
    blockers.push({
      label: "Live load overdue",
      note: `${row?.manifest_number || "This load"} is still in the truck past its ready-by date.`,
      tone: "pill-bad",
    });
  }
  if (permitSummary?.openCount) {
    blockers.push({
      label: "Permit still open",
      note: permitSummary.primary?.permit_number ? `Permit ${permitSummary.primary.permit_number} is still open.` : "A confined-space permit is still open on this job.",
      tone: "pill-warn",
    });
  }
  if (locateSummary?.expired) {
    blockers.push({
      label: "Locate expired",
      note: "Locate coverage is expired and should be cleared before the next move.",
      tone: "pill-bad",
    });
  } else if ((locateSummary?.tickets?.length || 0) > 0 && handoff?.locates_verified_on_site === false) {
    blockers.push({
      label: "Locate unverified",
      note: "Crew called out locate follow-through, so the office still needs to clear it.",
      tone: "pill-warn",
    });
  }
  if (!hydrovacManifestPreparedAt(row, "audit_packet_prepared_at")) {
    blockers.push({
      label: "Audit packet incomplete",
      note: "Audit packet prep is still missing on this manifest.",
      tone: "pill-warn",
    });
  }
  return blockers;
}
function hydrovacManifestCloseoutSnapshot(row) {
  const linkedJob = row?.job_id ? (JOBS_CACHE || []).find((job) => String(job?.id || "") === String(row.job_id)) || null : null;
  const linkedOrder = row?.order_id ? (CRM_ORDERS_CACHE || []).find((order) => String(order?.id || "") === String(row.order_id)) || null : linkedOrderForJob(linkedJob);
  const linkedCustomer = row?.customer_id
    ? (CUSTOMERS_CACHE || []).find((customer) => String(customer?.id || "") === String(row.customer_id)) || null
    : (linkedOrder?.customer_id ? (CUSTOMERS_CACHE || []).find((customer) => String(customer?.id || "") === String(linkedOrder.customer_id)) || null : null);
  const handoff = hydrovacJobCloseout(linkedJob);
  const locateSummary = hydrovacCloseoutLocateSummary(linkedJob?.id);
  const permitSummary = hydrovacCloseoutPermitSummary(linkedJob?.id);
  const auditIssues = hydrovacManifestAuditIssues(row);
  const fieldIssues = hydrovacCloseoutFieldIssues(row, linkedJob, handoff, locateSummary, permitSummary);
  const releaseBlockers = hydrovacCloseoutReleaseBlockers(row, linkedJob, handoff, locateSummary, permitSummary);
  let bucketKey = "needs_field_handoff";
  if (row?.invoiced === true && !auditIssues.length && !releaseBlockers.length) {
    bucketKey = "closed";
  } else if (fieldIssues.length) {
    bucketKey = "needs_field_handoff";
  } else if (!hydrovacManifestPreparedAt(row, "customer_records_prepared_at")) {
    bucketKey = "needs_customer_records";
  } else if (!hydrovacManifestPreparedAt(row, "audit_packet_prepared_at")) {
    bucketKey = "needs_audit_packet";
  } else if (String(row?.status || "").trim().toLowerCase() === "confirmed" && row?.invoiced !== true) {
    bucketKey = "ready_to_invoice";
  }
  return {
    row,
    linkedJob,
    linkedOrder,
    linkedCustomer,
    handoff,
    locateSummary,
    permitSummary,
    auditIssues,
    fieldIssues,
    releaseBlockers,
    bucketKey,
  };
}
function hydrovacManifestCloseoutBoard(rows = HYDROVAC_MANIFESTS_CACHE) {
  const snapshots = (Array.isArray(rows) ? rows : []).map((row) => hydrovacManifestCloseoutSnapshot(row));
  const buckets = [
    { key: "needs_field_handoff", label: "Needs field handoff", tone: "pill-warn", description: "Crew closeout or disposal confirmation is still missing." },
    { key: "needs_customer_records", label: "Needs customer records", tone: "pill", description: "Field closeout is done, but the customer record package is not." },
    { key: "needs_audit_packet", label: "Needs audit packet", tone: "pill", description: "Customer records are ready, but the audit packet is still open." },
    { key: "ready_to_invoice", label: "Ready to invoice", tone: "pill-on", description: "Confirmed disposal is lined up for money." },
    { key: "closed", label: "Closed", tone: "pill-on", description: "Invoiced and not carrying audit or live-load drift." },
  ].map((bucket) => ({
    ...bucket,
    items: snapshots.filter((snapshot) => snapshot.bucketKey === bucket.key),
  }));
  return {
    snapshots,
    buckets,
    releaseBlockers: snapshots.filter((snapshot) => snapshot.releaseBlockers.length),
  };
}
function hydrovacManifestBoardSummary(rows = HYDROVAC_MANIFESTS_CACHE, jobs = JOBS_CACHE) {
  const manifests = Array.isArray(rows) ? rows : [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const tomorrowKey = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const liveLoads = manifests.filter((row) => hydrovacManifestIsLive(row));
  const readyLoads = liveLoads.filter((row) => !!hydrovacManifestReadyBy(row));
  const dueToday = readyLoads.filter((row) => hydrovacManifestReadyBy(row) === todayKey);
  const overdue = readyLoads.filter((row) => hydrovacManifestReadyBy(row) && hydrovacManifestReadyBy(row) < todayKey);
  const auditIncomplete = manifests.filter((row) => hydrovacManifestAuditIssues(row).length);
  const jobRows = Array.isArray(jobs) ? jobs : [];
  const tomorrowCarryover = jobRows.filter((job) => {
    if (String(job?.scheduled_date || "") !== tomorrowKey) return false;
    const truckId = String(job?.assigned_truck_id || "").trim();
    if (!truckId) return false;
    return liveLoads.some((row) => String(row?.truck_id || "").trim() === truckId && String(row?.job_id || "") !== String(job?.id || ""));
  });
  const truckMap = new Map();
  liveLoads.forEach((row) => {
    const truckId = String(row?.truck_id || "").trim() || "unassigned";
    const current = truckMap.get(truckId) || {
      truckId,
      rows: [],
      dueToday: 0,
      overdue: 0,
      auditIncomplete: 0,
      customerIds: new Set(),
    };
    current.rows.push(row);
    if (hydrovacManifestReadyBy(row) === todayKey) current.dueToday += 1;
    if (hydrovacManifestReadyBy(row) && hydrovacManifestReadyBy(row) < todayKey) current.overdue += 1;
    if (hydrovacManifestAuditIssues(row).length) current.auditIncomplete += 1;
    if (row?.customer_id) current.customerIds.add(String(row.customer_id));
    truckMap.set(truckId, current);
  });
  const trucks = Array.from(truckMap.values()).map((entry) => ({
    ...entry,
    mixedCustomerRisk: entry.customerIds.size > 1,
  })).sort((a, b) => (
    (b.overdue - a.overdue)
    || (b.dueToday - a.dueToday)
    || (b.auditIncomplete - a.auditIncomplete)
    || String(a.truckId).localeCompare(String(b.truckId))
  ));
  return {
    liveLoads,
    readyLoads,
    dueToday,
    overdue,
    auditIncomplete,
    tomorrowCarryover,
    trucks,
  };
}
function hydrovacManifestCustomerRecordsDraft(row, job = null, order = null, customer = null) {
  return {
    subject: `${job?.title || "Hydrovac work"} load record`,
    body: [
      `Hi ${customer?.name || order?.customer_name || "there"},`,
      "",
      `For your records, here is the load and disposal summary tied to ${job?.title || "your hydrovac work"}.`,
      "",
      `Manifest / load reference: ${row?.manifest_number || row?.id || "Pending"}`,
      `BOL / load reference: ${hydrovacManifestBolNumber(row) || "Pending"}`,
      `Material: ${hydrovacMaterialLabel(row?.material_type)}`,
      `Quantity: ${hydrovacManifestQuantityLabel(row)}`,
      hydrovacManifestIsLive(row)
        ? `Load status: Still live in the truck${hydrovacManifestReadyBy(row) ? ` until ${hydrovacManifestReadyBy(row)}` : ""}.`
        : `Load status: ${titleCaseWords(String(row?.status || "in_transit").replace(/_/g, " "))}.`,
      row?.disposal_facility_name ? `Disposal facility: ${row.disposal_facility_name}` : "Disposal facility: Pending",
      row?.disposal_ticket_number ? `Facility ticket: ${row.disposal_ticket_number}` : "Facility ticket: Pending",
      "",
      "If you need the signed record package, just reply and we will send it over.",
    ].join("\n"),
  };
}
function hydrovacManifestAuditPacket(row, job = null, order = null, customer = null) {
  return [
    "Hydrovac audit packet",
    "====================",
    "",
    hydrovacManifestAuditSummary(row, job, order, customer),
    "",
    "Customer-record email draft",
    "---------------------------",
    hydrovacManifestCustomerRecordsDraft(row, job, order, customer).subject,
    "",
    hydrovacManifestCustomerRecordsDraft(row, job, order, customer).body,
  ].join("\n");
}
function hydrovacManifestAuditSummary(row, job = null, order = null, customer = null) {
  return [
    `Manifest: ${row?.manifest_number || row?.id || "Pending"}`,
    `Customer: ${customer?.name || order?.customer_name || "Unknown"}`,
    `Job: ${job?.title || "Unlinked job"}`,
    `Truck: ${row?.truck_id || "Not linked"}`,
    `Material: ${hydrovacMaterialLabel(row?.material_type)}`,
    `Quantity: ${hydrovacManifestQuantityLabel(row)}`,
    `BOL / load reference: ${hydrovacManifestBolNumber(row) || "Pending"}`,
    `Status: ${titleCaseWords(String(row?.status || "in_transit").replace(/_/g, " "))}`,
    `Still in truck: ${hydrovacManifestIsLive(row) ? "Yes" : "No"}`,
    `Hold reason: ${hydrovacManifestHoldReason(row) || "Not documented"}`,
    `Disposal ready by: ${hydrovacManifestReadyBy(row) || "Not set"}`,
    `Disposal facility: ${row?.disposal_facility_name || "Pending"}`,
    `Facility ticket: ${row?.disposal_ticket_number || "Pending"}`,
    `Notes: ${row?.notes || "None"}`,
  ].join("\n");
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
function hydrovacWorkspaceSignalBand(items = []) {
  const rows = (Array.isArray(items) ? items : []).filter((item) => item && item.label);
  if (!rows.length) return "";
  return `
    <div class="workspace-signal-band">
      ${rows.map((item) => `
        <div class="workspace-signal-band__item ${escapeAttr(item.tone || "")}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(String(item.value ?? ""))}</strong>
          ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}
function hydrovacWorkspaceHero({
  eyebrow = "",
  title = "",
  description = "",
  badges = [],
  meta = [],
  summary = [],
  signals = [],
} = {}) {
  const badgeHtml = (Array.isArray(badges) ? badges : [])
    .filter((badge) => badge && badge.label)
    .map((badge) => `<span class="pill ${escapeAttr(badge.tone || "")}">${escapeHtml(badge.label)}</span>`)
    .join("");
  const metaHtml = (Array.isArray(meta) ? meta : [])
    .filter(Boolean)
    .map((line) => `<div class="record-hero__meta-line">${escapeHtml(line)}</div>`)
    .join("");
  const summaryHtml = (Array.isArray(summary) ? summary : [])
    .filter((item) => item && item.label)
    .map((item) => `
      <div class="record-hero__metric">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(String(item.value ?? ""))}</strong>
        ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
      </div>
    `).join("");
  return `
    <div class="record-hero detail-card">
      <div class="record-hero__head">
        <div class="record-hero__main">
          <div class="kicker">${escapeHtml(eyebrow)}</div>
          <h3>${escapeHtml(title)}</h3>
          ${metaHtml ? `<div class="record-hero__meta">${metaHtml}</div>` : ""}
          ${description ? `<div class="detail-copy">${escapeHtml(description)}</div>` : ""}
        </div>
        ${badgeHtml ? `<div class="record-hero__badges workspace-chip-row">${badgeHtml}</div>` : ""}
      </div>
      ${summaryHtml ? `<div class="record-hero__summary">${summaryHtml}</div>` : ""}
    </div>
    ${hydrovacWorkspaceSignalBand(signals)}
  `;
}
function hydrovacWorkspaceFocusCard({
  eyebrow = "",
  title = "",
  description = "",
  statusLabel = "",
  statusTone = "",
  items = [],
  buttons = [],
} = {}) {
  const metaHtml = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.label)
    .map((item) => `
      <div class="workspace-focus-card__item ${escapeAttr(item.tone || "")}">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(String(item.value ?? ""))}</strong>
        ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
      </div>
    `).join("");
  const buttonsHtml = (Array.isArray(buttons) ? buttons : [])
    .filter((button) => button && button.label && button.attr && button.value != null)
    .map((button) => `
      <button
        type="button"
        class="btn ${escapeAttr(button.variant === "primary" ? "btn-primary" : "btn-ghost")}"
        ${escapeAttr(button.attr)}="${escapeAttr(button.value)}"
      >${escapeHtml(button.label)}</button>
    `).join("");
  return `
    <div class="detail-card detail-card--spaced workspace-focus-card">
      <div class="workspace-focus-card__head">
        <div>
          <div class="kicker">${escapeHtml(eyebrow)}</div>
          <div><strong>${escapeHtml(title)}</strong></div>
        </div>
        ${statusLabel ? `<span class="pill ${escapeAttr(statusTone || "")}">${escapeHtml(statusLabel)}</span>` : ""}
      </div>
      ${description ? `<div class="detail-copy">${escapeHtml(description)}</div>` : ""}
      ${metaHtml ? `<div class="workspace-focus-card__meta">${metaHtml}</div>` : ""}
      ${buttonsHtml ? `<div class="workspace-focus-card__buttons">${buttonsHtml}</div>` : ""}
    </div>
  `;
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
  const activeRows = rows.filter((row) => String(row.status || "").toLowerCase() !== "inactive");
  const warningRows = rows.filter((row) => (row.warnings || []).some((warning) => ["warning", "critical", "expired"].includes(String(warning.severity || "").toLowerCase())));
  const expiring = warningRows.length;
  const preferred = rows.filter((row) => String(row.status || "").toLowerCase() === "preferred").length;
  const missingRates = rows.filter((row) => (row.warnings || []).some((warning) => warning.field === "pricing")).length;
  const wasteProfiles = new Set(rows.flatMap((row) => Array.isArray(row.accepted_waste_types) ? row.accepted_waste_types : []));
  const preferredNames = rows
    .filter((row) => String(row.status || "").toLowerCase() === "preferred")
    .slice(0, 3)
    .map((row) => row.name || "Unnamed facility");
  const permitWatch = warningRows
    .filter((row) => (row.warnings || []).some((warning) => warning.field === "permit_expiry_date"))
    .slice(0, 3)
    .map((row) => row.name || "Unnamed facility");
  if (facilityStageStrip) {
    facilityStageStrip.innerHTML = hydrovacWorkspaceHero({
      eyebrow: "Disposal routing",
      title: "Keep the dump plan real before the truck leaves the yard",
      description: rows.length
        ? "This workspace keeps approved dump sites, contracted pricing, permit watch, and waste compatibility in one place so dispatch is not guessing."
        : "Start with the facilities your office actually uses so disposal, billing, and dispatch decisions stay anchored to reality.",
      badges: [
        { label: `${activeRows.length} active facilities`, tone: activeRows.length ? "pill-on" : "pill" },
        preferred ? { label: `${preferred} preferred`, tone: "pill-on" } : { label: "No preferred default", tone: "pill-warn" },
        expiring ? { label: `${expiring} watch item${expiring === 1 ? "" : "s"}`, tone: "pill-warn" } : { label: "Permit watch clear", tone: "pill-on" },
      ],
      meta: [
        activeRows.length ? `${activeRows.length} routeable sites are live for hydrovac loads.` : "No disposal sites are ready for dispatch yet.",
        preferredNames.length ? `Preferred route: ${preferredNames.join(" | ")}` : "Pick a preferred dump site so dispatch has a clear first choice.",
      ],
      summary: [
        { label: "Ready now", value: String(activeRows.length), note: "Facilities the office can route work to today." },
        { label: "Preferred", value: String(preferred), note: preferred ? "These sites should win the first routing decision." : "No first-choice site is set yet." },
        { label: "Pricing gaps", value: String(missingRates), note: missingRates ? "Rates are still missing on at least one facility." : "Contracted rates are recorded across the current list." },
        { label: "Waste coverage", value: String(wasteProfiles.size || 0), note: wasteProfiles.size ? "Unique waste types documented across active sites." : "Waste profile coverage has not been documented yet." },
      ],
      signals: [
        { label: "Active facilities", value: String(activeRows.length), note: activeRows.length ? "Dispatch can route to these sites now." : "No live dump sites are saved yet.", tone: activeRows.length ? "is-good" : "is-warn" },
        { label: "Permit watch", value: String(expiring), note: expiring ? "Renew or confirm these permits before the office loses flexibility." : "No facility permit pressure is visible right now.", tone: expiring ? "is-warn" : "is-good" },
        { label: "Missing rates", value: String(missingRates), note: missingRates ? "Lock down the pricing before uninvoiced disposal starts leaking margin." : "Rate capture looks healthy across the current board.", tone: missingRates ? "is-danger" : "is-good" },
        { label: "Waste profiles", value: String(wasteProfiles.size || 0), note: wasteProfiles.size ? "Accepted waste types are already mapped across the board." : "Add accepted waste types so dispatch avoids bad dump matches.", tone: wasteProfiles.size ? "is-good" : "is-warn" },
      ],
    });
  }
  if (facilityActionBar) {
    facilityActionBar.innerHTML = hydrovacWorkspaceFocusCard({
      eyebrow: "Next move",
      title: "Keep routing, pricing, and compliance attached",
      description: !rows.length
        ? "Add the first facility with real rates and the actual dispatch contact so the team is not inventing the disposal plan job by job."
        : missingRates
          ? "Close the rate gaps first. Disposal gets expensive fast when the office cannot see the real dump cost before the truck rolls."
          : permitWatch.length
            ? `${permitWatch[0]} is already on permit watch. Keep that renewal in motion before it becomes a dispatch scramble.`
            : "Preferred sites, rates, and permit coverage look steady. Use this board to keep the routing default obvious as the book of work grows.",
      statusLabel: !rows.length ? "Needs setup" : missingRates ? "Rates missing" : expiring ? "Permit watch" : "Routing ready",
      statusTone: !rows.length ? "pill" : missingRates ? "pill-bad" : expiring ? "pill-warn" : "pill-on",
      items: [
        { label: "Default site", value: preferredNames[0] || "Choose one", note: preferredNames.length ? "Dispatch has a clear first routing choice." : "Set the dump site the office should reach for first.", tone: preferredNames.length ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn" },
        { label: "Permit pressure", value: String(expiring), note: expiring ? "Facilities on watch should be reviewed before the next busy dispatch day." : "No facility warnings are crowding the board.", tone: expiring ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Pricing captured", value: `${Math.max(rows.length - missingRates, 0)} / ${rows.length || 0}`, note: rows.length ? "How much of the board is carrying real rate data." : "This fills in as facilities are added.", tone: missingRates ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Loads linked", value: String((HYDROVAC_MANIFESTS_CACHE || []).filter((row) => String(row.disposal_facility_id || "").trim()).length), note: "Tracked manifests already tied back to a disposal facility.", tone: (HYDROVAC_MANIFESTS_CACHE || []).length ? "workspace-focus-card__item--good" : "" },
      ],
      buttons: [
        { label: "New facility", attr: "data-facility-action", value: "new", variant: "primary" },
        { label: "Open loads", attr: "data-facility-action", value: "manifests" },
        { label: "Open compliance", attr: "data-facility-action", value: "compliance" },
        { label: "Open equipment", attr: "data-facility-action", value: "equipment" },
      ],
    });
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
    hydrovacFacilitiesList.innerHTML = `
      <div class="workspace-board">
        <div class="workspace-board__head">
          <div>
            <div class="kicker">Routing board</div>
            <strong>Start with the dump sites your office actually uses</strong>
          </div>
          <div class="detail-copy">Add the receiving sites, rates, and permit details your dispatch team reaches for most so disposal planning starts from real options.</div>
        </div>
        <div class="workspace-board__grid">
          <div class="workspace-board-card">
            <div class="workspace-board-card__head">
              <div>
                <div class="kicker">First move</div>
                <strong>Capture the primary dump site</strong>
              </div>
              <span class="pill pill-warn">Needs setup</span>
            </div>
            <div class="workspace-board-card__list">
              <div class="workspace-board-card__item">
                <strong>No facilities saved yet</strong>
                <small>Start with the site crews use most often, then add overflow and specialty disposal options once the default route is clear.</small>
              </div>
            </div>
          </div>
          <div class="workspace-board-card">
            <div class="workspace-board-card__head">
              <div>
                <div class="kicker">What to capture</div>
                <strong>Rates, permit dates, and accepted waste</strong>
              </div>
              <span class="pill">Field notes</span>
            </div>
            <div class="workspace-board-card__list">
              <div class="workspace-board-card__item">
                <strong>Keep dispatch and billing attached</strong>
                <small>When rates and waste compatibility live here, the office can route the truck and price disposal without hunting through old notes.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    clearHydrovacFacilityForm();
    return;
  }
  if (!ACTIVE_FACILITY_ID || !rows.some((row) => row.id === ACTIVE_FACILITY_ID)) ACTIVE_FACILITY_ID = rows[0].id;
  hydrovacFacilitiesList.innerHTML = `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Routing board</div>
          <strong>See who is ready, who needs rates, and who is about to expire</strong>
        </div>
        <div class="detail-copy">${escapeHtml(preferredNames.length ? `Preferred sites should soak up the easy routing decisions first: ${preferredNames.join(" | ")}.` : "Use this board to mark the sites dispatch should prefer before the day gets noisy.")}</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Preferred lane</div>
              <strong>${escapeHtml(preferredNames.length ? "Sites dispatch should reach for first" : "No preferred site yet")}</strong>
            </div>
            <span class="pill ${preferredNames.length ? "pill-on" : "pill-warn"}">${escapeHtml(preferredNames.length ? `${preferredNames.length} preferred` : "Needs default")}</span>
          </div>
          <div class="workspace-board-card__list">
            ${(preferredNames.length ? preferredNames : ["Mark a facility preferred so routing stays easy for the team."]).map((name) => `
              <div class="workspace-board-card__item">
                <strong>${escapeHtml(name)}</strong>
                <small>${escapeHtml(preferredNames.length ? "This facility is ready to anchor a dispatch decision." : "Preferred dump sites keep crews from guessing at the yard.")}</small>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Permit watch</div>
              <strong>${escapeHtml(permitWatch.length ? "Facilities that need office attention soon" : "No permit heat right now")}</strong>
            </div>
            <span class="pill ${permitWatch.length ? "pill-warn" : "pill-on"}">${escapeHtml(permitWatch.length ? `${permitWatch.length} watch` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            ${(permitWatch.length ? permitWatch : ["No facility permit watch items are currently on the board."]).map((name) => `
              <div class="workspace-board-card__item">
                <strong>${escapeHtml(name)}</strong>
                <small>${escapeHtml(permitWatch.length ? "Review permit dates and receiving rules before the next route stacks up." : "Keep this view clean so dispatch has options when the schedule tightens.")}</small>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
    ${rows.map((row) => {
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
  }).join("")}`;
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
  const board = hydrovacManifestBoardSummary(rows, JOBS_CACHE);
  const closeoutBoard = hydrovacManifestCloseoutBoard(rows);
  const openLoads = rows.filter((row) => ["in_transit", "delivered"].includes(String(row.status || "").toLowerCase())).length;
  const liveLoads = board.liveLoads.length;
  const confirmedUnbilled = rows.filter((row) => String(row.status || "").toLowerCase() === "confirmed" && row.invoiced !== true).length;
  const totalCharge = rows.filter((row) => row.invoiced !== true).reduce((sum, row) => sum + Number(row.disposal_charge_cents || 0), 0);
  const totalCost = rows.reduce((sum, row) => sum + Number(row.disposal_cost_cents || 0), 0);
  if (manifestStageStrip) {
    manifestStageStrip.innerHTML = hydrovacWorkspaceHero({
      eyebrow: "Disposal workflow",
      title: "Keep truck loads, audit packet prep, and billing attached to the same record",
      description: rows.length
        ? "This board is where the office decides what must dump now, what can stay live in the truck, and which disposal costs still need to hit the invoice."
        : "As soon as loads start moving, this board will keep disposal timing, BOLs, and packet prep from slipping between dispatch and billing.",
      badges: [
        { label: `${openLoads} open load${openLoads === 1 ? "" : "s"}`, tone: openLoads ? "pill-warn" : "pill-on" },
        liveLoads ? { label: `${liveLoads} live in truck`, tone: "pill-warn" } : { label: "No live carryover", tone: "pill-on" },
        confirmedUnbilled ? { label: `${confirmedUnbilled} waiting on invoice`, tone: "pill-warn" } : { label: "Billing caught up", tone: "pill-on" },
      ],
      meta: [
        board.overdue.length
          ? `${board.overdue.length} load${board.overdue.length === 1 ? "" : "s"} already missed the planned disposal date.`
          : "No live load is already past its disposal-ready date.",
        board.tomorrowCarryover.length
          ? `${board.tomorrowCarryover.length} tomorrow job${board.tomorrowCarryover.length === 1 ? "" : "s"} still share a truck with an open live load.`
          : "Tomorrow's hydrovac schedule is not currently carrying a truck-load conflict.",
      ],
      summary: [
        { label: "Open loads", value: String(openLoads), note: "Loads still moving through the disposal workflow." },
        { label: "Live loads", value: String(liveLoads), note: liveLoads ? "Still riding in the truck with a documented hold plan." : "No load is still being carried forward." },
        { label: "Unbilled charge", value: formatUsd(totalCharge), note: confirmedUnbilled ? "Confirmed disposal still waiting for invoice capture." : "No disposal charge is stuck outside billing." },
        { label: "Tracked cost", value: formatUsd(totalCost), note: "Facility cost tracked across the current manifest set." },
      ],
      signals: [
        { label: "Disposal due", value: String(board.overdue.length + board.dueToday.length), note: board.overdue.length ? "At least one live load should have dumped already." : board.dueToday.length ? "Loads are ready for disposal today." : "No ready-by pressure is on the board right now.", tone: board.overdue.length ? "is-danger" : board.dueToday.length ? "is-warn" : "is-good" },
        { label: "Truck carryover", value: String(board.tomorrowCarryover.length), note: board.tomorrowCarryover.length ? "Tomorrow's jobs are sharing trucks with open load pressure." : "No tomorrow route is blocked by a carryover load.", tone: board.tomorrowCarryover.length ? "is-danger" : "is-good" },
        { label: "Packet gaps", value: String(board.auditIncomplete.length), note: board.auditIncomplete.length ? "Audit or customer-record prep is still missing on active manifests." : "Record prep looks current across the board.", tone: board.auditIncomplete.length ? "is-warn" : "is-good" },
        { label: "Confirmed / uninvoiced", value: String(confirmedUnbilled), note: confirmedUnbilled ? "Disposal has been confirmed but not pushed into money yet." : "Confirmed disposal is already reflected in billing.", tone: confirmedUnbilled ? "is-warn" : "is-good" },
      ],
    });
  }
  if (manifestActionBar) {
    manifestActionBar.innerHTML = hydrovacWorkspaceFocusCard({
      eyebrow: "Next move",
      title: "Clear the load pressure before it infects dispatch tomorrow",
      description: !rows.length
        ? "When the first load lands here, the office should be able to clear disposal timing, BOL discipline, and billing follow-through from one place."
        : board.overdue.length
          ? `${board.overdue[0].manifest_number || "A live load"} is already overdue for disposal. Clear it first before another truck day stacks on top of it.`
          : board.auditIncomplete.length
            ? `${board.auditIncomplete[0].manifest_number || "A manifest"} still needs customer-record or audit prep before the file is actually clean.`
            : confirmedUnbilled
              ? "The disposal is done, but the money chain is not. Push confirmed loads into billing while the records are still fresh."
              : "The disposal workflow is in rhythm right now. Keep the live-load plan, BOL, and records package tied together as more loads come in.",
      statusLabel: !rows.length ? "No loads yet" : board.overdue.length ? "Overdue disposal" : board.auditIncomplete.length ? "Packet gaps" : confirmedUnbilled ? "Billing follow-through" : "On pace",
      statusTone: !rows.length ? "pill" : board.overdue.length ? "pill-bad" : board.auditIncomplete.length || confirmedUnbilled ? "pill-warn" : "pill-on",
      items: [
        { label: "Live loads", value: String(liveLoads), note: liveLoads ? "Still sitting in a truck with active hold logic." : "No truck is carrying a live load right now.", tone: liveLoads ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Due now", value: String(board.overdue.length + board.dueToday.length), note: board.overdue.length ? "Overdue loads should be cleared before anything else." : board.dueToday.length ? "Loads are due for disposal today." : "No dump deadline is crowding the board.", tone: board.overdue.length ? "workspace-focus-card__item--danger" : board.dueToday.length ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Audit prep", value: String(board.auditIncomplete.length), note: board.auditIncomplete.length ? "Customer records or audit packet prep is still missing." : "Record handoff prep looks current.", tone: board.auditIncomplete.length ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Disposal to bill", value: formatUsd(totalCharge), note: confirmedUnbilled ? "Confirmed disposal is still outside the invoice." : "Nothing confirmed is waiting on billing.", tone: confirmedUnbilled ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
      ],
      buttons: [
        { label: "Open dispatch", attr: "data-manifest-action", value: "dispatch", variant: "primary" },
        { label: "Open jobs", attr: "data-manifest-action", value: "jobs" },
        { label: "Open money", attr: "data-manifest-action", value: "money" },
        { label: "Open facilities", attr: "data-manifest-action", value: "facilities" },
        { label: "Open compliance", attr: "data-manifest-action", value: "compliance" },
      ],
    });
    manifestActionBar.querySelectorAll("[data-manifest-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-manifest-action");
        if (action === "dispatch") return switchTab("dispatch");
        if (action === "jobs") return switchTab("jobs");
        if (action === "money") return switchTab("payments");
        if (action === "facilities") return switchTab("facilities");
        if (action === "compliance") return switchTab("compliance");
      });
    });
  }
  if (!rows.length) {
    hydrovacManifestsList.innerHTML = `
      <div class="workspace-board">
        <div class="workspace-board__head">
          <div>
            <div class="kicker">Office board</div>
            <strong>Loads will land here as soon as crews start hauling</strong>
          </div>
          <div class="detail-copy">Use this workspace to keep disposal timing, truck carryover, and billing tied to the same load record from the start.</div>
        </div>
        <div class="workspace-board__grid">
          <div class="workspace-board-card">
            <div class="workspace-board-card__head">
              <div>
                <div class="kicker">Ready state</div>
                <strong>No live manifests yet</strong>
              </div>
              <span class="pill pill-on">Clear</span>
            </div>
            <div class="workspace-board-card__list">
              <div class="workspace-board-card__item">
                <strong>Haul records will show up automatically</strong>
                <small>As the team logs or imports manifests, this board will start calling out disposal pressure, carryover risk, and unbilled loads.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    hydrovacManifestDetailWrap.innerHTML = `<div class="detail-card"><div class="kicker">Manifest detail</div><div class="detail-copy">Select a load once manifests are flowing to inspect disposal timing, linked jobs, and billing readiness.</div></div>`;
    return;
  }
  if (!ACTIVE_MANIFEST_ID || !rows.some((row) => row.id === ACTIVE_MANIFEST_ID)) ACTIVE_MANIFEST_ID = rows[0].id;
  hydrovacManifestsList.innerHTML = `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Office board</div>
          <strong>Decide what must dump today, what can stay live, and what still needs records work</strong>
        </div>
        <div class="detail-copy">${escapeHtml(board.overdue.length ? "Start with the overdue load pressure, then clear carryover risk and billing gaps while the record is still fresh." : "Use this board to keep disposal timing, truck carryover, and record prep from turning into separate problems.")}</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Disposal pressure</div>
              <strong>${escapeHtml(board.overdue.length ? "Overdue loads need to move first" : board.dueToday.length ? "Loads due today" : "No ready-by pressure")}</strong>
            </div>
            <span class="pill ${board.overdue.length ? "pill-bad" : board.dueToday.length ? "pill-warn" : "pill-on"}">${escapeHtml(board.overdue.length ? `${board.overdue.length} overdue` : board.dueToday.length ? `${board.dueToday.length} due today` : "On pace")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(board.overdue.length ? (board.overdue[0].manifest_number || board.overdue[0].id || "A load") : board.dueToday.length ? (board.dueToday[0].manifest_number || board.dueToday[0].id || "A load") : "No ready-by deadline is driving the board right now.")}</strong>
              <small>${escapeHtml(board.overdue.length ? "This load already missed its ready-by date and should be cleared before another truck day stacks on top of it." : board.dueToday.length ? "This live load is due for disposal today and should stay visible until it clears." : "When a load gets a ready-by date, it will surface here first.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Carryover risk</div>
              <strong>${escapeHtml(board.tomorrowCarryover.length ? "Tomorrow's route still shares a truck with an open load" : "Tomorrow's schedule is clear")}</strong>
            </div>
            <span class="pill ${board.tomorrowCarryover.length ? "pill-warn" : "pill-on"}">${escapeHtml(board.tomorrowCarryover.length ? `${board.tomorrowCarryover.length} watch` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(board.tomorrowCarryover.length ? (board.tomorrowCarryover[0].title || "A scheduled hydrovac job") : "No tomorrow carryover conflict is showing.")}</strong>
              <small>${escapeHtml(board.tomorrowCarryover.length ? "Clear or document the live-load plan before tomorrow dispatch starts with a blocked truck." : "If a live load blocks tomorrow's truck, this card will call it out here.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Packet prep</div>
              <strong>${escapeHtml(board.auditIncomplete.length ? "Customer or audit handoff is still missing" : "Packet prep is current")}</strong>
            </div>
            <span class="pill ${board.auditIncomplete.length ? "pill-warn" : "pill-on"}">${escapeHtml(board.auditIncomplete.length ? `${board.auditIncomplete.length} gap${board.auditIncomplete.length === 1 ? "" : "s"}` : "Ready")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(board.auditIncomplete.length ? (board.auditIncomplete[0].manifest_number || board.auditIncomplete[0].id || "A manifest") : "Records are staying attached to the current load set.")}</strong>
              <small>${escapeHtml(board.auditIncomplete.length ? "Finish the customer-record email or audit packet prep before the manifest leaves the office record trail." : "Audit and customer-record prep is already on track across the visible manifests.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Truck view</div>
              <strong>${escapeHtml(board.trucks.length ? "Live-load pressure by truck" : "No live truck loads")}</strong>
            </div>
            <span class="pill ${board.trucks.length ? "pill" : "pill-on"}">${escapeHtml(board.trucks.length ? `${board.trucks.length} truck${board.trucks.length === 1 ? "" : "s"}` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            ${board.trucks.length ? board.trucks.slice(0, 3).map((truck) => `
              <div class="workspace-board-card__item">
                <strong>${escapeHtml(truck.truckId === "unassigned" ? "Truck not linked" : truck.truckId)}</strong>
                <small>${escapeHtml(`${truck.rows.length} live load${truck.rows.length === 1 ? "" : "s"}${truck.mixedCustomerRisk ? " across multiple customers" : ""}${truck.overdue ? ` | ${truck.overdue} overdue` : truck.dueToday ? ` | ${truck.dueToday} due today` : truck.auditIncomplete ? ` | ${truck.auditIncomplete} packet gap${truck.auditIncomplete === 1 ? "" : "s"}` : " | No immediate pressure"}`)}</small>
              </div>
            `).join("") : `
              <div class="workspace-board-card__item">
                <strong>No live truck loads</strong>
                <small>All tracked manifests are already cleared or confirmed.</small>
              </div>
            `}
          </div>
        </div>
      </div>
    </div>
    <div class="workspace-board hydrovac-closeout-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Closeout lane</div>
          <strong>Keep crew handoff, records, audit prep, and money in one office sequence</strong>
        </div>
        <div class="detail-copy">${escapeHtml(closeoutBoard.releaseBlockers.length ? `${closeoutBoard.releaseBlockers.length} load${closeoutBoard.releaseBlockers.length === 1 ? "" : "s"} still carry release blockers even after the field handoff.` : "As the crew closes work, this lane should tell the office what is still waiting on records, audit prep, or billing.")}</div>
      </div>
      <div class="hydrovac-closeout-grid">
        ${closeoutBoard.buckets.map((bucket) => `
          <div class="workspace-board-card hydrovac-closeout-column">
            <div class="workspace-board-card__head">
              <div>
                <div class="kicker">${escapeHtml(bucket.label)}</div>
                <strong>${escapeHtml(bucket.items.length ? bucket.description : `Nothing is parked in ${bucket.label.toLowerCase()} right now.`)}</strong>
              </div>
              <span class="pill ${escapeAttr(bucket.tone)}">${escapeHtml(String(bucket.items.length))}</span>
            </div>
            <div class="workspace-board-card__list">
              ${bucket.items.length ? bucket.items.slice(0, 3).map((snapshot) => `
                <div class="hydrovac-closeout-card ${snapshot.row.id === ACTIVE_MANIFEST_ID ? "is-active" : ""}">
                  <button type="button" class="hydrovac-closeout-card__open" data-closeout-open-id="${escapeAttr(snapshot.row.id)}">
                    <strong>${escapeHtml(snapshot.row.manifest_number || snapshot.row.id || "Manifest")}</strong>
                    <small>${escapeHtml([
                      snapshot.linkedCustomer?.name || snapshot.linkedOrder?.customer_name || snapshot.linkedJob?.customer_name || "Unknown customer",
                      snapshot.linkedJob?.title || "Job not linked",
                    ].filter(Boolean).join(" | "))}</small>
                  </button>
                  <div class="hydrovac-closeout-card__tags">
                    <span class="pill">${escapeHtml(hydrovacCloseoutLoadLabel(snapshot.handoff, snapshot.row))}</span>
                    <span class="pill ${snapshot.locateSummary.expired ? "pill-bad" : snapshot.handoff?.locates_verified_on_site === true ? "pill-on" : "pill"}">${escapeHtml(hydrovacCloseoutLocateLabel(snapshot.handoff, snapshot.locateSummary))}</span>
                    <span class="pill ${snapshot.permitSummary.openCount ? "pill-warn" : "pill"}">${escapeHtml(hydrovacCloseoutPermitLabel(snapshot.handoff, snapshot.permitSummary))}</span>
                    ${hydrovacManifestBolNumber(snapshot.row) || snapshot.handoff?.bol_number ? `<span class="pill">${escapeHtml(`BOL ${hydrovacManifestBolNumber(snapshot.row) || snapshot.handoff?.bol_number}`)}</span>` : ""}
                    ${hydrovacCloseoutFollowUpLabels(snapshot.handoff).map((label) => `<span class="pill pill-on">${escapeHtml(label)}</span>`).join("")}
                  </div>
                  <div class="hydrovac-closeout-card__summary">
                    ${escapeHtml(snapshot.handoff?.field_summary || snapshot.fieldIssues[0] || snapshot.auditIssues[0] || "Office handoff is not attached yet.")}
                  </div>
                  <div class="hydrovac-closeout-card__actions">
                    <button type="button" class="pipeline-action-chip" data-closeout-action="focus" data-closeout-manifest="${escapeAttr(snapshot.row.id)}">Open load</button>
                    ${snapshot.linkedJob ? `<button type="button" class="pipeline-action-chip" data-closeout-action="job" data-closeout-job="${escapeAttr(snapshot.linkedJob.id)}" data-closeout-manifest="${escapeAttr(snapshot.row.id)}">Open job</button>` : ""}
                    ${bucket.key === "needs_customer_records" ? `<button type="button" class="pipeline-action-chip" data-closeout-action="records" data-closeout-manifest="${escapeAttr(snapshot.row.id)}">Customer records</button>` : ""}
                    ${bucket.key === "needs_audit_packet" ? `<button type="button" class="pipeline-action-chip" data-closeout-action="audit" data-closeout-manifest="${escapeAttr(snapshot.row.id)}">Audit packet</button>` : ""}
                    ${bucket.key === "ready_to_invoice" && snapshot.row.invoiced !== true ? `<button type="button" class="pipeline-action-chip" data-closeout-action="money" data-closeout-manifest="${escapeAttr(snapshot.row.id)}">Open money</button>` : ""}
                  </div>
                </div>
              `).join("") : `
                <div class="workspace-board-card__item">
                  <strong>${escapeHtml(bucket.label)} is clear</strong>
                  <small>${escapeHtml(bucket.description)}</small>
                </div>
              `}
            </div>
            ${bucket.items.length > 3 ? `<div class="workspace-board-card__footer"><small>${escapeHtml(`+${bucket.items.length - 3} more ${bucket.label.toLowerCase()} load${bucket.items.length - 3 === 1 ? "" : "s"}`)}</small></div>` : ""}
          </div>
        `).join("")}
      </div>
    </div>
    ${rows.map((row) => {
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
          <span class="pill ${hydrovacManifestToneClass(row.status)}">${escapeHtml(hydrovacManifestLifecycleLabel(row))}</span>
          ${hydrovacManifestIsLive(row) ? `<span class="pill pill-warn">Still in truck</span>` : ""}
          ${hydrovacManifestAuditIssues(row).length ? `<span class="pill pill-warn">${escapeHtml(`${hydrovacManifestAuditIssues(row).length} packet gap${hydrovacManifestAuditIssues(row).length === 1 ? "" : "s"}`)}</span>` : ""}
          <span class="pill">${escapeHtml(hydrovacManifestQuantityLabel(row) || "Qty pending")}</span>
        </div>
      </button>
    `;
  }).join("")}`;
  hydrovacManifestsList.querySelectorAll("[data-manifest-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_MANIFEST_ID = button.getAttribute("data-manifest-id") || null;
      renderHydrovacManifests();
    });
  });
  hydrovacManifestsList.querySelectorAll("[data-closeout-open-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_MANIFEST_ID = button.getAttribute("data-closeout-open-id") || null;
      renderHydrovacManifests();
    });
  });
  hydrovacManifestsList.querySelectorAll("[data-closeout-action]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_MANIFEST_ID = button.getAttribute("data-closeout-manifest") || ACTIVE_MANIFEST_ID;
      const action = button.getAttribute("data-closeout-action");
      if (action === "job") {
        ACTIVE_JOB_ID = button.getAttribute("data-closeout-job") || null;
        switchTab("jobs");
        return;
      }
      renderHydrovacManifests();
      if (action === "money") {
        switchTab("payments");
        return;
      }
      if (action === "records") {
        hydrovacManifestDetailWrap.querySelector("[data-manifest-records]")?.click();
        return;
      }
      if (action === "audit") {
        hydrovacManifestDetailWrap.querySelector("[data-manifest-audit-email]")?.click();
      }
    });
  });
  const active = currentHydrovacManifest();
  const activeSnapshot = active ? hydrovacManifestCloseoutSnapshot(active) : null;
  const linkedJob = activeSnapshot?.linkedJob || null;
  const linkedOrder = activeSnapshot?.linkedOrder || null;
  const linkedCustomer = activeSnapshot?.linkedCustomer || null;
  const marginCents = Number(active?.disposal_charge_cents || 0) - Number(active?.disposal_cost_cents || 0);
  hydrovacManifestDetailWrap.innerHTML = active ? `
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active.manifest_number || "Draft load")}</strong>
        <span class="pill ${hydrovacManifestToneClass(active.status)}">${escapeHtml(titleCaseWords(String(active.status || "in_transit").replace(/_/g, " ")))}</span>
      </div>
      ${hydrovacWorkspaceSignalBand([
        {
          label: "Load state",
          value: hydrovacManifestLifecycleLabel(active),
          note: hydrovacManifestIsLive(active) ? "Truck is still carrying this load forward." : "The load is no longer riding live in the truck.",
          tone: hydrovacManifestIsLive(active) ? "is-warn" : "is-good",
        },
        {
          label: "Packet gaps",
          value: String(hydrovacManifestAuditIssues(active).length),
          note: hydrovacManifestAuditIssues(active).length ? hydrovacManifestAuditIssues(active)[0] : "Customer records and audit prep look current.",
          tone: hydrovacManifestAuditIssues(active).length ? "is-warn" : "is-good",
        },
        {
          label: "Margin",
          value: formatUsd(marginCents),
          note: linkedOrder ? "Compared against the linked booked-work balance." : "Tracked disposal charge minus tracked disposal cost.",
          tone: marginCents < 0 ? "is-danger" : marginCents > 0 ? "is-good" : "",
        },
        {
          label: "Order balance",
          value: formatUsd(linkedOrder ? orderAmountDueCents(linkedOrder) : 0),
          note: linkedOrder ? "Keep billing follow-through attached while this load is still open." : "No linked booked-work balance is attached.",
          tone: linkedOrder && orderAmountDueCents(linkedOrder) > 0 ? "is-warn" : "is-good",
        },
      ])}
      <div class="detail-grid">
        <div><span class="muted">Customer</span><div>${escapeHtml(linkedCustomer?.name || linkedOrder?.customer_name || linkedJob?.customer_name || "Not linked")}</div></div>
        <div><span class="muted">Job</span><div>${escapeHtml(linkedJob?.title || "Not linked")}</div></div>
        <div><span class="muted">Material</span><div>${escapeHtml(hydrovacMaterialLabel(active.material_type))}</div></div>
        <div><span class="muted">Quantity</span><div>${escapeHtml(hydrovacManifestQuantityLabel(active) || "Pending")}</div></div>
        <div><span class="muted">Facility</span><div>${escapeHtml(active.disposal_facility_name || "Not set")}</div></div>
        <div><span class="muted">Ticket</span><div>${escapeHtml(active.disposal_ticket_number || "Pending")}</div></div>
        <div><span class="muted">BOL</span><div>${escapeHtml(hydrovacManifestBolNumber(active) || "Pending")}</div></div>
        <div><span class="muted">Load state</span><div>${escapeHtml(hydrovacManifestLifecycleLabel(active))}</div></div>
        <div><span class="muted">Ready by</span><div>${escapeHtml(hydrovacManifestReadyBy(active) || "Not set")}</div></div>
        <div><span class="muted">Hold reason</span><div>${escapeHtml(hydrovacManifestHoldReason(active) || "Not documented")}</div></div>
        <div><span class="muted">Charge</span><div>${formatUsd(Number(active.disposal_charge_cents || 0))}</div></div>
        <div><span class="muted">Cost</span><div>${formatUsd(Number(active.disposal_cost_cents || 0))}</div></div>
        <div><span class="muted">Margin</span><div>${formatUsd(marginCents)}</div></div>
        <div><span class="muted">Invoice state</span><div>${escapeHtml(active.invoiced === true ? "Already on invoice" : "Waiting for invoice")}</div></div>
        <div><span class="muted">Order balance</span><div>${formatUsd(linkedOrder ? orderAmountDueCents(linkedOrder) : 0)}</div></div>
      </div>
      <div class="detail-copy" style="margin-top:12px;">${escapeHtml(active.notes || active.pickup_address || "No additional manifest notes.")}</div>
      <div class="hydrovac-closeout-detail">
        <div class="kicker">Crew handoff</div>
        <strong>${escapeHtml(activeSnapshot?.handoff ? "Use the structured field handoff before you send records, prep audit, or move money." : "Field closeout is not structured yet")}</strong>
        <div class="detail-grid u-mt-10">
          <div><span class="muted">Load handoff</span><div>${escapeHtml(hydrovacCloseoutLoadLabel(activeSnapshot?.handoff, active))}</div></div>
          <div><span class="muted">Locate</span><div>${escapeHtml(hydrovacCloseoutLocateLabel(activeSnapshot?.handoff, activeSnapshot?.locateSummary))}</div></div>
          <div><span class="muted">Permit</span><div>${escapeHtml(hydrovacCloseoutPermitLabel(activeSnapshot?.handoff, activeSnapshot?.permitSummary))}</div></div>
          <div><span class="muted">Captured</span><div>${escapeHtml(String(activeSnapshot?.handoff?.captured_at || "").trim() ? new Date(activeSnapshot.handoff.captured_at).toLocaleString() : "Not captured")}</div></div>
        </div>
        ${hydrovacCloseoutFollowUpLabels(activeSnapshot?.handoff).length ? `
          <div class="hydrovac-closeout-card__tags u-mt-10">
            ${hydrovacCloseoutFollowUpLabels(activeSnapshot?.handoff).map((label) => `<span class="pill pill-on">${escapeHtml(label)}</span>`).join("")}
          </div>
        ` : ""}
        <div class="detail-copy u-mt-10">${escapeHtml(activeSnapshot?.handoff?.field_summary || activeSnapshot?.fieldIssues?.[0] || "The office still needs the crew to close this job out in a structured way.")}</div>
        ${activeSnapshot?.handoff?.customer_note ? `<div class="detail-copy u-mt-6">${escapeHtml(`Customer note: ${activeSnapshot.handoff.customer_note}`)}</div>` : ""}
      </div>
      <div class="memory-checklist u-mt-10">
        ${hydrovacManifestAuditIssues(active).length ? hydrovacManifestAuditIssues(active).map((issue) => `
          <div class="memory-checklist__item memory-checklist__item--warn">
            <strong>${escapeHtml(issue)}</strong>
            <div>${escapeHtml(issue === "Customer records not prepared" ? "Prepare the customer-facing records email before this manifest leaves the office." : issue === "Audit packet not prepared" ? "Prepare the audit packet before this manifest is archived or handed to compliance." : "Clear this manifest detail before dispatch, closeout, or audit handoff.")}</div>
          </div>
        `).join("") : `
          <div class="memory-checklist__item memory-checklist__item--ready">
            <strong>Packet prep on track</strong>
            <div>This manifest already has the key record handoff pieces attached for customer records and audit prep.</div>
          </div>
        `}
      </div>
      <div class="workspace-focus-card__buttons">
        ${linkedCustomer ? `<button type="button" class="pipeline-action-chip" data-manifest-open-customer="${escapeAttr(linkedCustomer.id)}">Open customer</button>` : ""}
        ${linkedJob ? `<button type="button" class="pipeline-action-chip" data-manifest-open-job="${escapeAttr(linkedJob.id)}">Open job</button>` : ""}
        ${linkedOrder ? `<button type="button" class="pipeline-action-chip" data-manifest-open-order="${escapeAttr(linkedOrder.id)}">Open pipeline record</button>` : ""}
        ${linkedJob ? `<button type="button" class="pipeline-action-chip" data-manifest-open-invoice="${escapeAttr(linkedJob.id)}">Open invoice draft</button>` : ""}
        ${["in_transit", "delivered"].includes(String(active.status || "").toLowerCase()) ? `<button type="button" class="pipeline-action-chip" data-manifest-confirm="${escapeAttr(active.id)}">Confirm load</button>` : ""}
        <button type="button" class="pipeline-action-chip" data-manifest-records="1">Prepare customer records email</button>
        <button type="button" class="pipeline-action-chip" data-manifest-audit-email="1">Prepare audit handoff</button>
        <button type="button" class="pipeline-action-chip" data-manifest-audit="1">Copy full audit packet</button>
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
  hydrovacManifestDetailWrap.querySelector("[data-manifest-records]")?.addEventListener("click", async () => {
    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
    if (typeof coreUtils.openManualEmailPrep !== "function") return;
    const draft = hydrovacManifestCustomerRecordsDraft(active, linkedJob, linkedOrder, linkedCustomer);
    const prepared = await coreUtils.openManualEmailPrep({
      title: "Customer records email",
      recipientName: linkedCustomer?.name || linkedOrder?.customer_name || "Customer",
      recipientEmail: linkedCustomer?.email || linkedOrder?.customer_email || linkedOrder?.email || "",
      contextLabel: "Hydrovac load records",
      reason: "Review this records email before you send it. ProofLink prepares the record, but the office still decides when it goes out.",
      subject: draft.subject,
      message: draft.body,
      confirmText: "Mark records ready",
      cancelText: "Keep for later",
    });
    if (!prepared?.confirmed) return;
    await requestOperatorFunction("manage-waste-manifests", {
      method: "PATCH",
      body: { id: active.id, customer_records_prepared_at: new Date().toISOString() },
    });
    await fetchHydrovacManifests();
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-audit-email]")?.addEventListener("click", async () => {
    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
    if (typeof coreUtils.openManualEmailPrep !== "function") return;
    const packet = hydrovacManifestAuditPacket(active, linkedJob, linkedOrder, linkedCustomer);
    const prepared = await coreUtils.openManualEmailPrep({
      title: "Audit handoff",
      recipientName: "Auditor or records contact",
      recipientEmail: "",
      contextLabel: "Hydrovac compliance packet",
      reason: "Review this audit handoff before you send it. ProofLink prepares the packet, but audit communication stays manual.",
      subject: `${active.manifest_number || active.id || "Manifest"} audit packet`,
      message: packet,
      confirmText: "Mark packet ready",
      cancelText: "Keep for later",
    });
    if (!prepared?.confirmed) return;
    await requestOperatorFunction("manage-waste-manifests", {
      method: "PATCH",
      body: { id: active.id, audit_packet_prepared_at: new Date().toISOString() },
    });
    await fetchHydrovacManifests();
  });
  hydrovacManifestDetailWrap.querySelector("[data-manifest-audit]")?.addEventListener("click", async () => {
    const coreUtils = window.PROOFLINK_OPERATOR_UTILS || {};
    if (typeof coreUtils.showCopyModal !== "function") return;
    await coreUtils.showCopyModal("Copy this audit packet into the packet, email, or binder you keep for compliance records.", hydrovacManifestAuditPacket(active, linkedJob, linkedOrder, linkedCustomer), "Done");
    await requestOperatorFunction("manage-waste-manifests", {
      method: "PATCH",
      body: { id: active.id, audit_packet_prepared_at: new Date().toISOString() },
    });
    await fetchHydrovacManifests();
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
  const activeCoverage = rows.filter((row) => ["active", "extended"].includes(String(row.status || "").toLowerCase())).length;
  const linkedJobs = rows.filter((row) => String(row.job_id || "").trim()).length;
  const nextExpiry = rows
    .filter((row) => daysUntil(row.valid_until) != null && daysUntil(row.valid_until) >= 0)
    .sort((a, b) => (daysUntil(a.valid_until) ?? 9999) - (daysUntil(b.valid_until) ?? 9999))[0] || null;
  if (locateStageStrip) {
    locateStageStrip.innerHTML = hydrovacWorkspaceHero({
      eyebrow: "Locate control",
      title: "Keep 811 coverage visible before excavation turns into a field blocker",
      description: rows.length
        ? "This workspace keeps active coverage, expiry pressure, and field verification in one office view so excavation jobs do not leave with a paperwork blind spot."
        : "As jobs start needing locates, this board will keep ticket coverage and expiry timing from hiding in notes or memory.",
      badges: [
        { label: `${activeCoverage} active`, tone: activeCoverage ? "pill-on" : "pill" },
        expiringSoon ? { label: `${expiringSoon} expiring soon`, tone: "pill-warn" } : { label: "No near-term expiry", tone: "pill-on" },
        expired ? { label: `${expired} expired`, tone: "pill-bad" } : { label: "No expired tickets", tone: "pill-on" },
      ],
      meta: [
        nextExpiry ? `${nextExpiry.ticket_number || "A ticket"} expires next on ${hydrovacLocateExpiryLabel(nextExpiry).replace(/^Expires\s+/i, "")}.` : "No active locate expiry is currently driving this board.",
        linkedJobs ? `${linkedJobs} ticket${linkedJobs === 1 ? "" : "s"} are already linked directly to a job record.` : "No locate ticket is linked to a job yet.",
      ],
      summary: [
        { label: "Active coverage", value: String(activeCoverage), note: "Tickets currently covering excavation work." },
        { label: "Expiring soon", value: String(expiringSoon), note: expiringSoon ? "Coverage the office should extend before the crew gets squeezed." : "Nothing is about to roll off the board." },
        { label: "Expired", value: String(expired), note: expired ? "Tickets already out of date and worth immediate attention." : "No ticket is already expired." },
        { label: "Field verified", value: String(verified), note: verified ? "Tickets the crew already confirmed on site." : "Field verification has not been captured yet." },
      ],
      signals: [
        { label: "Linked to jobs", value: String(linkedJobs), note: linkedJobs ? "Job records can open straight into their ticket coverage." : "Link tickets to jobs so dispatch can trust what it sees.", tone: linkedJobs ? "is-good" : "is-warn" },
        { label: "Expiring soon", value: String(expiringSoon), note: expiringSoon ? "These tickets should be extended before they turn into dispatch noise." : "No ticket is close to expiring.", tone: expiringSoon ? "is-warn" : "is-good" },
        { label: "Expired", value: String(expired), note: expired ? "Expired tickets should be renewed or explicitly cleared from upcoming work." : "No expired coverage is sitting on the board.", tone: expired ? "is-danger" : "is-good" },
        { label: "Verified on site", value: String(verified), note: verified ? "The field has already validated some of the current ticket coverage." : "Use field verification when the crew confirms marks on site.", tone: verified ? "is-good" : "" },
      ],
    });
  }
  if (locateActionBar) {
    locateActionBar.innerHTML = hydrovacWorkspaceFocusCard({
      eyebrow: "Next move",
      title: "Stay ahead of locate expiry before it becomes a truck-day surprise",
      description: !rows.length
        ? "Create the first locate ticket here or from the job so excavation work never leaves the office without visible coverage."
        : expired
          ? "Start with the expired ticket. If coverage is dead, the crew should not be improvising around it in the field."
          : expiringSoon
            ? `${expiringSoon} ticket${expiringSoon === 1 ? "" : "s"} are close to expiry. Extend them while the paperwork is still easy to recover.`
            : "Coverage looks steady right now. Use this board to keep tickets linked to jobs and visible to the office before the day gets noisy.",
      statusLabel: !rows.length ? "No tickets yet" : expired ? "Coverage expired" : expiringSoon ? "Expiry watch" : "Coverage healthy",
      statusTone: !rows.length ? "pill" : expired ? "pill-bad" : expiringSoon ? "pill-warn" : "pill-on",
      items: [
        { label: "Coverage live", value: String(activeCoverage), note: activeCoverage ? "Excavation tickets currently active or extended." : "No live coverage is visible yet.", tone: activeCoverage ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn" },
        { label: "Job-linked", value: String(linkedJobs), note: linkedJobs ? "These tickets are already anchored to a job." : "Link tickets to jobs so dispatch can trust what it sees.", tone: linkedJobs ? "workspace-focus-card__item--good" : "workspace-focus-card__item--warn" },
        { label: "Expired", value: String(expired), note: expired ? "Expired coverage should be treated like a dispatch blocker." : "No locate ticket is already expired.", tone: expired ? "workspace-focus-card__item--danger" : "workspace-focus-card__item--good" },
        { label: "Field verified", value: String(verified), note: verified ? "The crew has already confirmed some current tickets on site." : "Verification is still missing on every visible ticket.", tone: verified ? "workspace-focus-card__item--good" : "" },
      ],
      buttons: [
        { label: "New ticket", attr: "data-locate-action", value: "new", variant: "primary" },
        { label: "Open jobs", attr: "data-locate-action", value: "jobs" },
        { label: "Open compliance", attr: "data-locate-action", value: "compliance" },
        { label: "Open pipeline", attr: "data-locate-action", value: "pipeline" },
      ],
    });
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
    hydrovacLocateList.innerHTML = `
      <div class="workspace-board">
        <div class="workspace-board__head">
          <div>
            <div class="kicker">Coverage board</div>
            <strong>Keep 811 coverage visible before excavation pressure shows up</strong>
          </div>
          <div class="detail-copy">Add the active locate tickets here or from the linked job so expiration, verification, and job linkage stay in one queue.</div>
        </div>
        <div class="workspace-board__grid">
          <div class="workspace-board-card">
            <div class="workspace-board-card__head">
              <div>
                <div class="kicker">Ready state</div>
                <strong>No locate tickets logged yet</strong>
              </div>
              <span class="pill pill-warn">Needs coverage</span>
            </div>
            <div class="workspace-board-card__list">
              <div class="workspace-board-card__item">
                <strong>Start with the next excavation job</strong>
                <small>Add the ticket number, valid window, and service address here so the office can see coverage before dispatch has to ask.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    clearHydrovacLocateForm();
    return;
  }
  if (!ACTIVE_LOCATE_ID || !rows.some((row) => row.id === ACTIVE_LOCATE_ID)) ACTIVE_LOCATE_ID = rows[0].id;
  hydrovacLocateList.innerHTML = `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Coverage board</div>
          <strong>See active, expiring, and field-verified coverage together</strong>
        </div>
        <div class="detail-copy">${escapeHtml(nextExpiry ? `${nextExpiry.ticket_number || "A ticket"} is the next locate to expire, so it should stay visible before the next dispatch wave.` : "Use this board to keep locate timing and field verification from hiding in notes.")}</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Expiry watch</div>
              <strong>${escapeHtml(expiringSoon ? "Coverage is getting tight" : "No near-term expiry")}</strong>
            </div>
            <span class="pill ${expiringSoon ? "pill-warn" : "pill-on"}">${escapeHtml(expiringSoon ? `${expiringSoon} soon` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(nextExpiry?.ticket_number || "No locate is close to expiry.")}</strong>
              <small>${escapeHtml(nextExpiry ? `${hydrovacLocateExpiryLabel(nextExpiry)}. Extend or refresh it before the field team loses coverage.` : "When a locate gets close to expiry, it will surface here first.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Expired risk</div>
              <strong>${escapeHtml(expired ? "Expired tickets need immediate review" : "No expired coverage")}</strong>
            </div>
            <span class="pill ${expired ? "pill-bad" : "pill-on"}">${escapeHtml(expired ? `${expired} expired` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(expired ? "Dispatch should not trust expired tickets." : "Expired locate risk is clear.")}</strong>
              <small>${escapeHtml(expired ? "Renew, replace, or explicitly clear the expired records before the next excavation move." : "Keep this board clear so the office can trust the locate view fast.")}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
    ${rows.map((row) => {
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
  }).join("")}`;
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
  const manifestBoard = hydrovacManifestBoardSummary(HYDROVAC_MANIFESTS_CACHE, JOBS_CACHE);
  const closeoutBoard = hydrovacManifestCloseoutBoard(HYDROVAC_MANIFESTS_CACHE);
  const releaseBlockers = closeoutBoard.releaseBlockers;
  const equipmentWarnings = HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE.flatMap((row) => (row.warnings || []).map((warning) => ({ ...warning, type: "equipment", row })));
  const driverWarnings = HYDROVAC_DRIVER_COMPLIANCE_CACHE.flatMap((row) => (row.warnings || []).map((warning) => ({ ...warning, type: "driver", row })));
  const loggedAlerts = Array.isArray(HYDROVAC_ALERTS_CACHE) ? HYDROVAC_ALERTS_CACHE.filter((row) => row && row.resolved !== true) : [];
  const criticalCount = equipmentWarnings.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length
    + driverWarnings.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length
    + expiringTickets.filter((row) => {
      const days = daysUntil(row.valid_until);
      return days != null && days <= 3;
    }).length
    + releaseBlockers.length
    + loggedAlerts.filter((row) => ["critical", "expired"].includes(String(row.severity || "").toLowerCase())).length;
  const warningCount = equipmentWarnings.filter((row) => String(row.severity || "").toLowerCase() === "warning").length
    + driverWarnings.filter((row) => String(row.severity || "").toLowerCase() === "warning").length
    + loggedAlerts.filter((row) => String(row.severity || "").toLowerCase() === "warning").length;
  const avgMargin = HYDROVAC_ANALYTICS_CACHE?.avg_job_margin != null
    ? `${Math.round(Number(HYDROVAC_ANALYTICS_CACHE.avg_job_margin || 0) * 100)}%`
    : "N/A";
  const upcomingCarryoverJobs = manifestBoard.tomorrowCarryover;
  const nextLoggedAlert = loggedAlerts[0] || null;
  if (complianceStageStrip) {
    complianceStageStrip.innerHTML = hydrovacWorkspaceHero({
      eyebrow: "Operations risk",
      title: "Keep dispatch, compliance, and billing pressure visible before it turns into a fire drill",
      description: "This is the operator's hydrovac risk board. It should answer one question fast: what can stop the next truck move or leak margin if the office ignores it today?",
      badges: [
        criticalCount ? { label: `${criticalCount} critical`, tone: "pill-bad" } : { label: "No critical blockers", tone: "pill-on" },
        warningCount ? { label: `${warningCount} watch`, tone: "pill-warn" } : { label: "Expiry watch clear", tone: "pill-on" },
        loggedAlerts.length ? { label: `${loggedAlerts.length} logged alert${loggedAlerts.length === 1 ? "" : "s"}`, tone: "pill-warn" } : { label: "Audit trail clean", tone: "pill-on" },
      ],
        meta: [
          nextLoggedAlert ? `Latest alert: ${nextLoggedAlert.message || titleCaseWords(String(nextLoggedAlert.alert_type || "alert").replace(/_/g, " "))}` : "No unresolved compliance alert is currently sitting in the audit trail.",
          releaseBlockers.length
            ? `${releaseBlockers.length} near-complete load${releaseBlockers.length === 1 ? "" : "s"} still need office release work before the file is actually clean.`
            : "No near-complete load is still carrying a release blocker.",
          upcomingCarryoverJobs.length
            ? `${upcomingCarryoverJobs.length} tomorrow job${upcomingCarryoverJobs.length === 1 ? "" : "s"} still share a truck with an open load.`
            : "Tomorrow's truck plan is not currently carrying a live-load conflict.",
        ],
        summary: [
          { label: "Act now", value: String(criticalCount), note: "Items that can stop dispatch, compliance, or billing." },
          { label: "Release blockers", value: String(releaseBlockers.length), note: releaseBlockers.length ? "Completed or near-complete loads still need office release work." : "No closeout record is still carrying a release blocker." },
          { label: "Expiring soon", value: String(warningCount), note: "Documents and records the office should get ahead of." },
          { label: "Uninvoiced disposal", value: String(unbilledManifests.length), note: unbilledManifests.length ? "Confirmed manifests still outside billing." : "No confirmed disposal is missing from billing." },
          { label: "Average margin", value: avgMargin, note: "Recent hydrovac margin from tracked cost data." },
        ],
        signals: [
          { label: "Carryover risk", value: String(upcomingCarryoverJobs.length), note: upcomingCarryoverJobs.length ? "Tomorrow's jobs still share a truck with an open load." : "No tomorrow route is blocked by a carryover load.", tone: upcomingCarryoverJobs.length ? "is-danger" : "is-good" },
          { label: "Release blockers", value: String(releaseBlockers.length), note: releaseBlockers.length ? "Near-complete jobs still need permit, locate, live-load, or audit cleanup." : "No closeout record is still carrying a release blocker.", tone: releaseBlockers.length ? "is-warn" : "is-good" },
          { label: "Disposal due", value: String(manifestBoard.overdue.length + manifestBoard.dueToday.length), note: manifestBoard.overdue.length ? "Some live loads already missed disposal-ready timing." : manifestBoard.dueToday.length ? "Loads are due for disposal today." : "No ready-by load is crowding the board.", tone: manifestBoard.overdue.length ? "is-danger" : manifestBoard.dueToday.length ? "is-warn" : "is-good" },
          { label: "Logged alerts", value: String(loggedAlerts.length), note: loggedAlerts.length ? "Blocked starts and forced dispatches still need office follow-through." : "No unresolved alert is waiting in the audit trail.", tone: loggedAlerts.length ? "is-warn" : "is-good" },
          { label: "Facilities ready", value: String((HYDROVAC_FACILITIES_CACHE || []).filter((row) => String(row.status || "").toLowerCase() === "preferred").length), note: "Preferred dump sites currently visible to dispatch.", tone: (HYDROVAC_FACILITIES_CACHE || []).filter((row) => String(row.status || "").toLowerCase() === "preferred").length ? "is-good" : "is-warn" },
      ],
    });
  }
  if (complianceActionBar) {
    complianceActionBar.innerHTML = hydrovacWorkspaceFocusCard({
      eyebrow: "Operator move",
      title: "Clear the next blocker before it becomes field churn",
      description: criticalCount
        ? "Start with the highest-severity blocker on this board, then clear disposal and billing drift while the operator context is still fresh."
        : loggedAlerts.length
          ? "The board is not on fire, but the audit trail still needs a clean follow-through so forced moves do not become the new normal."
          : "Compliance, dispatch, and billing are moving together right now. Keep it that way by reviewing the watch items before they become surprises.",
      statusLabel: criticalCount ? "Critical follow-through" : loggedAlerts.length ? "Audit follow-through" : "Board healthy",
      statusTone: criticalCount ? "pill-bad" : loggedAlerts.length ? "pill-warn" : "pill-on",
      items: [
        { label: "Driver warnings", value: String(driverWarnings.length), note: driverWarnings.length ? "CDL, med card, or cert follow-through is due." : "No driver record is currently in warning territory.", tone: driverWarnings.length ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Equipment warnings", value: String(equipmentWarnings.length), note: equipmentWarnings.length ? "Truck inspections or documents still need attention." : "Equipment compliance is not crowding the board.", tone: equipmentWarnings.length ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Release blockers", value: String(releaseBlockers.length), note: releaseBlockers.length ? "Near-complete loads still need permit, locate, live-load, or audit cleanup." : "No closeout record is still carrying a release blocker.", tone: releaseBlockers.length ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Disposal to bill", value: formatUsd(unbilledManifests.reduce((sum, manifest) => sum + Number(manifest.disposal_charge_cents || 0), 0)), note: unbilledManifests.length ? "Confirmed disposal that still has not made it onto an invoice." : "No confirmed disposal is still waiting on billing.", tone: unbilledManifests.length ? "workspace-focus-card__item--warn" : "workspace-focus-card__item--good" },
        { label: "Tomorrow carryover", value: String(upcomingCarryoverJobs.length), note: upcomingCarryoverJobs.length ? "Jobs tomorrow are still sharing trucks with live-load pressure." : "Tomorrow's route is not blocked by a carryover load.", tone: upcomingCarryoverJobs.length ? "workspace-focus-card__item--danger" : "workspace-focus-card__item--good" },
      ],
      buttons: [
        { label: "Open dispatch", attr: "data-compliance-action", value: "dispatch", variant: "primary" },
        { label: "Open locate tickets", attr: "data-compliance-action", value: "locates" },
        { label: "Open manifests", attr: "data-compliance-action", value: "manifests" },
        { label: "Open equipment", attr: "data-compliance-action", value: "equipment" },
        { label: "Open jobs", attr: "data-compliance-action", value: "jobs" },
        { label: "Refresh alerts", attr: "data-compliance-action", value: "refresh" },
      ],
    });
    complianceActionBar.querySelectorAll("[data-compliance-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.getAttribute("data-compliance-action");
        if (action === "dispatch") return switchTab("dispatch");
        if (action === "locates") return switchTab("locates");
        if (action === "manifests") return switchTab("manifests");
        if (action === "equipment") return switchTab("equipment");
        if (action === "jobs") return switchTab("jobs");
        if (action === "refresh") return fetchHydrovacComplianceData().catch(console.error);
      });
    });
  }
  hydrovacComplianceSummary.innerHTML = `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Why this matters</div>
          <strong>Hydrovac pressure only stays manageable when the office can see all of it together</strong>
        </div>
        <div class="detail-copy">${escapeHtml(criticalCount ? "Dispatch blockers, ticket expiry, disposal timing, and uninvoiced loads should show up here before they become a second trip or a margin leak." : "This summary keeps the operator oriented even when the board is calm, so the next risk never has to start from scratch.")}</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Immediate risk</div>
              <strong>${escapeHtml(criticalCount ? "Critical items are live on the board" : "No critical blocker right now")}</strong>
            </div>
            <span class="pill ${criticalCount ? "pill-bad" : "pill-on"}">${escapeHtml(String(criticalCount))}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(criticalCount ? "Clear the blocker that can stop the next truck move first." : "The board is not carrying a hard stop at the moment.")}</strong>
              <small>${escapeHtml(criticalCount ? "Critical items combine tickets, equipment, driver docs, and logged alerts." : "Stay ahead of watch items so the board keeps feeling calm.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Document pressure</div>
              <strong>${escapeHtml(warningCount ? "Expiry watch is building" : "Expiry watch is clear")}</strong>
            </div>
            <span class="pill ${warningCount ? "pill-warn" : "pill-on"}">${escapeHtml(String(warningCount))}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(driverWarnings.length ? "Driver records need follow-through." : equipmentWarnings.length ? "Equipment records need follow-through." : "Driver and equipment records are currently steady.")}</strong>
              <small>${escapeHtml("Keep CDL, medical, cert, and truck document pressure visible before it becomes a dispatch surprise.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Release blockers</div>
              <strong>${escapeHtml(releaseBlockers.length ? "Near-complete jobs still need office release work" : "Closeout release is clear")}</strong>
            </div>
            <span class="pill ${releaseBlockers.length ? "pill-warn" : "pill-on"}">${escapeHtml(String(releaseBlockers.length))}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(releaseBlockers[0]?.row?.manifest_number || "No release blocker is parked on a closeout record.")}</strong>
              <small>${escapeHtml(releaseBlockers.length ? releaseBlockers[0].releaseBlockers[0]?.note || "Permit, locate, audit, or live-load cleanup is still attached to a near-complete file." : "Once the crew handoff is in, any leftover permit, locate, audit, or live-load blocker will surface here.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Money leak watch</div>
              <strong>${escapeHtml(unbilledManifests.length ? "Confirmed disposal is still outside billing" : "Disposal billing is caught up")}</strong>
            </div>
            <span class="pill ${unbilledManifests.length ? "pill-warn" : "pill-on"}">${escapeHtml(String(unbilledManifests.length))}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(formatUsd(unbilledManifests.reduce((sum, manifest) => sum + Number(manifest.disposal_charge_cents || 0), 0)))}</strong>
              <small>${escapeHtml(unbilledManifests.length ? "Dispose, confirm, then bill. This board keeps those steps from drifting apart." : "No confirmed disposal charge is waiting to be captured on an invoice.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Audit trail</div>
              <strong>${escapeHtml(loggedAlerts.length ? "Unresolved alerts still need office follow-through" : "Audit trail is clean")}</strong>
            </div>
            <span class="pill ${loggedAlerts.length ? "pill-warn" : "pill-on"}">${escapeHtml(String(loggedAlerts.length))}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(nextLoggedAlert?.message || "No unresolved blocked-start or forced-dispatch alert is sitting open.")}</strong>
              <small>${escapeHtml(loggedAlerts.length ? "Resolve logged alerts so exceptions do not turn into the team's default workflow." : "When the team overrides a block, the follow-through will stay visible here.")}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
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
  releaseBlockers.forEach((snapshot) => {
    snapshot.releaseBlockers.forEach((blocker) => {
      urgentItems.push({
        label: `${snapshot.row?.manifest_number || "Manifest"}: ${blocker.label}`,
        sub: blocker.note,
        tone: blocker.tone,
        actionTab: blocker.label.toLowerCase().includes("permit") ? "permits" : blocker.label.toLowerCase().includes("locate") ? "locates" : "manifests",
      });
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
  upcomingCarryoverJobs.forEach((job) => {
    urgentItems.push({
      label: `${job.title || "Hydrovac job"} needs the truck cleared`,
      sub: "A live load is still assigned to the truck planned for tomorrow.",
      tone: "pill-warn",
      actionTab: "dispatch",
    });
  });
  manifestBoard.overdue.forEach((manifest) => {
    urgentItems.push({
      label: `${manifest.manifest_number || "Live load"} is overdue for disposal`,
      sub: `${manifest.truck_id || "Truck not linked"} is still carrying this load past the ready-by date.`,
      tone: "pill-bad",
      actionTab: "manifests",
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
    <div class="list-item">
      <div class="li-main"><div class="li-title">Closeout release blockers</div><div class="li-sub muted">Near-complete jobs still carrying live-load, locate, permit, or audit cleanup.</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String(releaseBlockers.length))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Tomorrow's carryover warnings</div><div class="li-sub muted">Jobs that should not roll without disposal follow-through or a documented live-load plan.</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String(upcomingCarryoverJobs.length))}</span></div>
    </div>
    <div class="list-item">
      <div class="li-main"><div class="li-title">Disposal workflow board</div><div class="li-sub muted">Live loads, due dumps, and missing packets by truck.</div></div>
      <div class="li-meta"><span class="pill">${escapeHtml(String(manifestBoard.trucks.length))}</span></div>
    </div>
    ${manifestBoard.trucks.slice(0, 4).map((truck) => `
      <div class="list-item">
        <div class="li-main"><div class="li-title">${escapeHtml(truck.truckId === "unassigned" ? "Truck not linked" : truck.truckId)}</div><div class="li-sub muted">${escapeHtml(`${truck.rows.length} live load${truck.rows.length === 1 ? "" : "s"}${truck.mixedCustomerRisk ? " across multiple customers" : ""}`)}</div></div>
        <div class="li-meta"><span class="pill ${truck.overdue ? "pill-bad" : truck.dueToday ? "pill-warn" : truck.auditIncomplete ? "pill" : "pill-on"}">${escapeHtml(truck.overdue ? `${truck.overdue} overdue` : truck.dueToday ? `${truck.dueToday} due today` : truck.auditIncomplete ? `${truck.auditIncomplete} packet gap${truck.auditIncomplete === 1 ? "" : "s"}` : "Clear")}</span></div>
      </div>
    `).join("")}
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
  const nextExpiring = rows
    .filter((row) => String(row.status || "").toLowerCase() === "open" && row.permit_valid_until)
    .slice()
    .sort((a, b) => String(a.permit_valid_until || "").localeCompare(String(b.permit_valid_until || "")))[0] || null;
  const expiringSoon = rows.filter((row) => {
    const days = daysUntil(row.permit_valid_until);
    return days != null && days >= 0 && days <= 2 && String(row.status || "").toLowerCase() === "open";
  }).length;
  if (permitStageStrip) {
    permitStageStrip.innerHTML = hydrovacWorkspaceHero({
      eyebrow: "Permit watch",
      title: "Confined-space coverage should never hide in notes",
      description: "Keep open permits, expiry pressure, and missing atmosphere checks visible before the crew inherits the risk in the field.",
      badges: [
        { label: expiredCount ? "Expired open permits" : "Permit board steady", tone: expiredCount ? "pill-bad" : "pill-on" },
        { label: needsReading ? "Atmosphere gaps open" : "Atmosphere current", tone: needsReading ? "pill-warn" : "pill-on" },
      ],
      summary: [
        { label: "Open", value: openCount, note: "Permit-required entries still active." },
        { label: "Expired", value: expiredCount, note: "Open permits past their valid window." },
        { label: "Readings missing", value: needsReading, note: "Entries still missing atmosphere logs." },
      ],
      signals: [
        { label: "Next expiring", value: nextExpiring?.permit_number || "None", note: nextExpiring?.permit_valid_until || "No open permit is close to expiry.", tone: expiringSoon || expiredCount ? "is-warn" : "is-good" },
        { label: "Expiry watch", value: expiringSoon, note: "Open permits inside the next 48 hours.", tone: expiringSoon ? "is-warn" : "is-good" },
      ],
    });
  }
  if (permitActionBar) {
    permitActionBar.innerHTML = hydrovacWorkspaceFocusCard({
      eyebrow: "Office move",
      title: expiredCount ? "Clear the oldest expired permit first" : (nextExpiring ? "Keep the next permit expiry obvious" : "Start the next permit from the job board"),
      description: expiredCount
        ? "Expired open permits should get resolved or closed before the field has to guess whether entry is still covered."
        : (nextExpiring
          ? `${nextExpiring.permit_number || "A permit"} is the next permit on the clock, so keep it attached to the job record before dispatch shifts.`
          : "When a job needs confined-space coverage, start the permit here so the office owns the paperwork before the field does."),
      statusLabel: expiredCount ? "Entry risk" : (openCount ? "Coverage live" : "Ready"),
      statusTone: expiredCount ? "pill-bad" : (openCount ? "pill-warn" : "pill-on"),
      items: [
        { label: "Open coverage", value: openCount, note: "Live permits the office is still carrying." },
        { label: "Atmosphere gaps", value: needsReading, note: "Permits with no reading logged yet.", tone: needsReading ? "is-warn" : "" },
        { label: "Next permit", value: nextExpiring?.permit_number || "None", note: nextExpiring?.space_description || "No expiring permit is leading the board." },
      ],
      buttons: [
        { label: "New permit", attr: "data-permit-action", value: "new", variant: "primary" },
        { label: "Open jobs", attr: "data-permit-action", value: "jobs" },
        { label: "Refresh", attr: "data-permit-action", value: "refresh" },
      ],
    });
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
  hydrovacPermitList.innerHTML = rows.length ? `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Entry board</div>
          <strong>Keep permit expiry, atmosphere readiness, and job linkage together</strong>
        </div>
        <div class="detail-copy">${escapeHtml(expiredCount ? "Expired permits should be resolved first, then atmosphere gaps, then the rest of the entry queue." : "This board keeps the office ahead of the entry paperwork before the crew ever has to wonder if coverage exists.")}</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Expiry watch</div>
              <strong>${escapeHtml(expiredCount ? "Expired permits are still open" : expiringSoon ? "Open permits are getting close" : "Permit timing is steady")}</strong>
            </div>
            <span class="pill ${expiredCount ? "pill-bad" : expiringSoon ? "pill-warn" : "pill-on"}">${escapeHtml(expiredCount ? `${expiredCount} expired` : expiringSoon ? `${expiringSoon} soon` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(nextExpiring?.permit_number || "No permit is close to expiry.")}</strong>
              <small>${escapeHtml(nextExpiring ? `Valid until ${nextExpiring.permit_valid_until || "not set"}. Keep it visible before the field day starts.` : "Open permits with approaching expiry will surface here first.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Atmosphere checks</div>
              <strong>${escapeHtml(needsReading ? "Some permits still need readings" : "Atmosphere checks are logged")}</strong>
            </div>
            <span class="pill ${needsReading ? "pill-warn" : "pill-on"}">${escapeHtml(needsReading ? `${needsReading} missing` : "Ready")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(needsReading ? "Do not let the field own missing readings." : "Each visible permit already has an atmosphere log.")}</strong>
              <small>${escapeHtml(needsReading ? "Log the atmosphere result before the permit becomes the crew's problem on site." : "Keep the reading habit tight so entries stay defensible.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Entry coverage</div>
              <strong>${escapeHtml(openCount ? "Open permits are tied to live work" : "No live permit coverage yet")}</strong>
            </div>
            <span class="pill ${openCount ? "pill" : "pill-on"}">${escapeHtml(openCount ? `${openCount} open` : "Idle")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(rows[0]?.space_description || "Start the next permit from a job that requires entry.")}</strong>
              <small>${escapeHtml(openCount ? "Use the permit queue to keep entry context attached to the right job before dispatch moves on." : "Create the first permit here when the next job needs confined-space coverage.")}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
    ${rows.map((row) => `
    <button type="button" class="list-item ${row.id === ACTIVE_PERMIT_ID ? "is-active" : ""}" data-permit-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.permit_number || row.space_description || "Permit")}</div>
        <div class="li-sub muted">${escapeHtml(row.space_description || "Space description missing")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${String(row.status || "").toLowerCase() === "open" ? "pill-warn" : "pill-on"}">${escapeHtml(titleCaseWords(String(row.status || "open").replace(/_/g, " ")))}</span>
        <span class="pill ${(() => {
          const days = daysUntil(row.permit_valid_until);
          return days != null && days < 0 ? "pill-bad" : days != null && days <= 2 ? "pill-warn" : "pill";
        })()}">${escapeHtml(row.permit_valid_until ? `${row.permit_valid_until}` : "No expiry")}</span>
      </div>
    </button>
  `).join("")}` : `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Entry board</div>
          <strong>Start the permit queue before the field needs to improvise</strong>
        </div>
        <div class="detail-copy">Create the first confined-space permit here so entry coverage, atmosphere checks, and closeout all start from one office-owned record.</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Ready state</div>
              <strong>No confined-space permits logged yet</strong>
            </div>
            <span class="pill pill-on">Clear</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>Open coverage will show here</strong>
              <small>As permits are created, this board will surface expiry risk, reading gaps, and the jobs that still need entry paperwork.</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">First move</div>
              <strong>Start with the next entry-required job</strong>
            </div>
            <span class="pill pill-warn">Needs setup</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>Keep the office ahead of the risk</strong>
              <small>Create the permit before dispatch rolls so the field does not inherit missing atmosphere logs or rescue details on site.</small>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  hydrovacPermitList.querySelectorAll("[data-permit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_PERMIT_ID = button.getAttribute("data-permit-id") || null;
      renderHydrovacPermitsWorkspace();
    });
  });
  const active = currentHydrovacPermit();
  const reading = Array.isArray(active?.atmospheric_readings) && active.atmospheric_readings.length ? active.atmospheric_readings[active.atmospheric_readings.length - 1] : {};
  const activeJob = (JOBS_CACHE || []).find((job) => job.id === active?.job_id) || null;
  const activeDays = daysUntil(active?.permit_valid_until);
  hydrovacPermitDetail.innerHTML = `
    ${hydrovacWorkspaceHero({
      eyebrow: "Permit detail",
      title: active?.permit_number || "New confined-space permit",
      description: active
        ? (activeJob?.title ? `${activeJob.title} keeps this permit attached to a live field move.` : "Keep the entry paperwork, atmosphere, and closeout record together here.")
        : "Create the next confined-space permit here so the job carries real entry coverage before the field arrives.",
      badges: [
        { label: titleCaseWords(String(active?.status || "draft").replace(/_/g, " ")), tone: active ? hydrovacManifestToneClass(active.status) : "pill" },
        ...(active?.permit_valid_until ? [{ label: activeDays != null && activeDays < 0 ? "Expired" : activeDays != null && activeDays <= 2 ? "Expires soon" : "On schedule", tone: activeDays != null && activeDays < 0 ? "pill-bad" : activeDays != null && activeDays <= 2 ? "pill-warn" : "pill-on" }] : []),
      ],
      summary: [
        { label: "Job", value: activeJob?.title || "Not linked", note: active?.space_description || "Link the permit to the right entry job." },
        { label: "Readings", value: Array.isArray(active?.atmospheric_readings) ? active.atmospheric_readings.length : 0, note: "Atmosphere entries logged on this permit." },
      ],
      signals: [
        { label: "Supervisor", value: active?.entry_supervisor_name || "Not set", note: "Entry lead tied to this permit.", tone: active?.entry_supervisor_name ? "is-good" : "" },
        { label: "Rescue plan", value: active?.rescue_procedure ? "Attached" : "Missing", note: active?.rescue_procedure || "Document the rescue setup before opening the permit.", tone: active?.rescue_procedure ? "is-good" : "is-warn" },
      ],
    })}
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active?.permit_number || "New permit")}</strong>
        <span class="pill ${active ? hydrovacManifestToneClass(active.status) : "pill"}">${escapeHtml(titleCaseWords(String(active?.status || "draft").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-copy">${escapeHtml(active?.notes || "Keep the permit narrative obvious enough that dispatch and the field see the same entry story.")}</div>
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
      <div class="workspace-focus-card__buttons" style="margin-top:12px;">
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
  const nextDue = rows
    .filter((row) => row.next_service_due_date && String(row.status || "").toLowerCase() !== "decommissioned")
    .slice()
    .sort((a, b) => String(a.next_service_due_date || "").localeCompare(String(b.next_service_due_date || "")))[0] || null;
  if (assetStageStrip) {
    assetStageStrip.innerHTML = hydrovacWorkspaceHero({
      eyebrow: "Asset watch",
      title: "Infrastructure condition should stay attached to dispatch memory",
      description: "Keep due service, defects, and municipal asset context visible so repeat hydrovac work starts with the right picture.",
      badges: [
        { label: withDefects ? "Defects on board" : "Condition steady", tone: withDefects ? "pill-warn" : "pill-on" },
        { label: dueSoon ? "Service due soon" : "Service schedule steady", tone: dueSoon ? "pill-warn" : "pill-on" },
      ],
      summary: [
        { label: "Active assets", value: activeRows, note: "Serviceable structures still in rotation." },
        { label: "Due soon", value: dueSoon, note: "Assets due in the next two weeks." },
        { label: "Defects", value: withDefects, note: "Assets carrying condition issues." },
      ],
      signals: [
        { label: "Next due asset", value: nextDue?.asset_name || nextDue?.external_asset_id || "None", note: nextDue?.next_service_due_date || "No due date is leading the board.", tone: dueSoon ? "is-warn" : "is-good" },
        { label: "Defect watch", value: withDefects, note: "Assets that need office follow-through.", tone: withDefects ? "is-warn" : "is-good" },
      ],
    });
  }
  if (assetActionBar) {
    assetActionBar.innerHTML = hydrovacWorkspaceFocusCard({
      eyebrow: "Office move",
      title: nextDue ? "Keep the next due asset tied to the service queue" : "Start the next tracked asset before service memory drifts",
      description: nextDue
        ? `${nextDue.asset_name || nextDue.external_asset_id || "An asset"} is the next due structure on the board, so keep it visible before the next cycle turns reactive.`
        : "When repeat service depends on the same structures, start the asset record here so history, defects, and due dates travel with the work.",
      statusLabel: withDefects ? "Defect watch" : (dueSoon ? "Due soon" : "Steady"),
      statusTone: withDefects ? "pill-warn" : (dueSoon ? "pill-warn" : "pill-on"),
      items: [
        { label: "Next due", value: nextDue?.next_service_due_date || "Not set", note: nextDue?.asset_name || "No asset is currently leading the board." },
        { label: "Defects", value: withDefects, note: "Assets with condition issues that still need a plan." },
        { label: "Active spread", value: activeRows, note: "Tracked structures still in service." },
      ],
      buttons: [
        { label: "New asset", attr: "data-asset-action", value: "new", variant: "primary" },
        { label: "Open customers", attr: "data-asset-action", value: "customers" },
        { label: "Open calendar", attr: "data-asset-action", value: "calendar" },
      ],
    });
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
  hydrovacAssetList.innerHTML = rows.length ? `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Asset board</div>
          <strong>Keep due service, defects, and repeat-site memory in one place</strong>
        </div>
        <div class="detail-copy">${escapeHtml(withDefects ? "Defect follow-through should stay visible before the next repeat visit turns into a callback." : "Use this board to keep repeat-site history obvious before the next truck rolls.")}</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Service due</div>
              <strong>${escapeHtml(dueSoon ? "Some structures are close to their next cycle" : "Service cadence is under control")}</strong>
            </div>
            <span class="pill ${dueSoon ? "pill-warn" : "pill-on"}">${escapeHtml(dueSoon ? `${dueSoon} due soon` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(nextDue?.asset_name || nextDue?.external_asset_id || "No next-due asset is set.")}</strong>
              <small>${escapeHtml(nextDue ? `Next due ${nextDue.next_service_due_date || "not set"}. Keep it linked to the next repeat-service decision.` : "As soon as the next asset due date exists, it will surface here.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Defect watch</div>
              <strong>${escapeHtml(withDefects ? "Condition notes need a plan" : "No defect pressure right now")}</strong>
            </div>
            <span class="pill ${withDefects ? "pill-warn" : "pill-on"}">${escapeHtml(withDefects ? `${withDefects} flagged` : "Clear")}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(withDefects ? "Defective structures should stay visible across visits." : "Defect pressure is not leading the board.")}</strong>
              <small>${escapeHtml(withDefects ? "Keep the repair or condition note tied to the asset so the next crew does not rediscover it from scratch." : "When defects are logged, they will surface here for the office.")}</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Site memory</div>
              <strong>${escapeHtml(rows.length ? "Repeat structures are ready to guide the next visit" : "No tracked sites yet")}</strong>
            </div>
            <span class="pill ${rows.length ? "pill" : "pill-on"}">${escapeHtml(`${rows.length}`)}</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>${escapeHtml(rows[0]?.asset_name || "Start the first tracked asset")}</strong>
              <small>${escapeHtml(rows.length ? "Use asset history to keep cleanout cadence, condition notes, and customer context attached to the same structure." : "Create the first asset so repeat hydrovac work has real site memory.")}</small>
            </div>
          </div>
        </div>
      </div>
    </div>
    ${rows.map((row) => `
    <button type="button" class="list-item ${row.id === ACTIVE_ASSET_ID ? "is-active" : ""}" data-asset-id="${escapeAttr(row.id)}">
      <div class="li-main">
        <div class="li-title">${escapeHtml(row.asset_name || row.external_asset_id || titleCaseWords(String(row.asset_type || "asset").replace(/_/g, " ")))}</div>
        <div class="li-sub muted">${escapeHtml(row.address || row.location_description || "Address not set")}</div>
      </div>
      <div class="li-meta">
        <span class="pill ${row.has_defects ? "pill-warn" : "pill-on"}">${row.has_defects ? "Defects" : escapeHtml(titleCaseWords(String(row.status || "active")))}</span>
        <span class="pill">${escapeHtml(row.next_service_due_date || "No due date")}</span>
      </div>
    </button>
  `).join("")}` : `
    <div class="workspace-board">
      <div class="workspace-board__head">
        <div>
          <div class="kicker">Asset board</div>
          <strong>Track the structures that turn one-off work into repeat-service memory</strong>
        </div>
        <div class="detail-copy">Create the first basin, manhole, tank, or wet well here so due dates, condition notes, and repeat history stay attached to the right site.</div>
      </div>
      <div class="workspace-board__grid">
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">Ready state</div>
              <strong>No infrastructure assets saved yet</strong>
            </div>
            <span class="pill pill-on">Clear</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>Repeat-site records will land here</strong>
              <small>As soon as the first tracked asset exists, this board will start surfacing due service, defect pressure, and site memory for the next visit.</small>
            </div>
          </div>
        </div>
        <div class="workspace-board-card">
          <div class="workspace-board-card__head">
            <div>
              <div class="kicker">First move</div>
              <strong>Capture the structure the crew sees most</strong>
            </div>
            <span class="pill pill-warn">Needs setup</span>
          </div>
          <div class="workspace-board-card__list">
            <div class="workspace-board-card__item">
              <strong>Give dispatch real site memory</strong>
              <small>Start with the asset that drives the most repeat visits so customer context, defects, and service cadence stop living in old notes.</small>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  hydrovacAssetList.querySelectorAll("[data-asset-id]").forEach((button) => {
    button.addEventListener("click", () => {
      ACTIVE_ASSET_ID = button.getAttribute("data-asset-id") || null;
      renderHydrovacAssetsWorkspace();
    });
  });
  const active = currentHydrovacAsset();
  const activeCustomer = (CUSTOMERS_CACHE || []).find((customer) => customer.id === active?.customer_id) || null;
  hydrovacAssetDetail.innerHTML = `
    ${hydrovacWorkspaceHero({
      eyebrow: "Asset detail",
      title: active?.asset_name || active?.external_asset_id || "New tracked asset",
      description: active
        ? `${activeCustomer?.name || "Customer not linked"} keeps this structure tied to repeat service memory.`
        : "Create the next tracked structure here so service history and defect notes travel with the work.",
      badges: [
        { label: active?.has_defects ? "Defects flagged" : titleCaseWords(String(active?.status || "active").replace(/_/g, " ")), tone: active?.has_defects ? "pill-warn" : "pill-on" },
      ],
      summary: [
        { label: "Next due", value: active?.next_service_due_date || "Not set", note: "When the next cleanout or inspection is due." },
        { label: "Service count", value: active?.service_count_total || 0, note: "Total visits recorded against this structure." },
      ],
      signals: [
        { label: "Condition", value: active?.last_condition_rating || "Not set", note: active?.condition_notes || "Add a clear condition note so the next visit starts smarter.", tone: active?.has_defects ? "is-warn" : "is-good" },
        { label: "Address", value: active?.address || "Missing", note: active?.location_description || "Capture the exact site memory here.", tone: active?.address ? "is-good" : "is-warn" },
      ],
    })}
    <div class="detail-card">
      <div class="detail-card__header">
        <strong>${escapeHtml(active?.asset_name || "New asset")}</strong>
        <span class="pill ${active?.has_defects ? "pill-warn" : "pill-on"}">${escapeHtml(titleCaseWords(String(active?.status || "active").replace(/_/g, " ")))}</span>
      </div>
      <div class="detail-copy">${escapeHtml(active?.notes || "Keep the service pattern, condition, and site memory attached to the same asset record.")}</div>
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
      <div class="workspace-focus-card__buttons" style="margin-top:12px;">
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
