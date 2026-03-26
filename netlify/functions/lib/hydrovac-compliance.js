"use strict";

const { asNumber, lower } = require("../utils/hydrovac");

const LOCATE_REQUIRED_JOB_TYPES = new Set([
  "hydrovac_excavation",
  "potholing",
  "daylighting",
]);

const CONFINED_SPACE_JOB_TYPES = new Set([
  "confined_space",
  "tank_cleaning",
  "wet_well_cleaning",
  "lift_station_cleaning",
]);

function hydrovacJobType(job) {
  return lower(job?.job_type || job?.service_type || "");
}

function jobRequiresLocateTicket(job, hydrovacSettings) {
  if (hydrovacSettings?.require_locate_ticket_for_excavation === false) return false;
  return LOCATE_REQUIRED_JOB_TYPES.has(hydrovacJobType(job));
}

function jobRequiresConfinedSpacePermit(job, hydrovacSettings) {
  if (job?.requires_confined_space_permit === true) return true;
  if (hydrovacSettings?.require_confined_space_permit === false) return false;
  return CONFINED_SPACE_JOB_TYPES.has(hydrovacJobType(job));
}

function manifestNeedsCloseout(job) {
  return (
    asNumber(job?.total_loads_hauled, 0) > 0 ||
    asNumber(job?.total_disposal_cost_cents, 0) > 0 ||
    asNumber(job?.disposal_cost_cents, 0) > 0 ||
    !!String(job?.disposal_site || "").trim() ||
    !!String(job?.disposal_manifest_number || "").trim()
  );
}

async function activeLocateTicketExists(adminSb, tenantId, jobId) {
  const { data, error } = await adminSb
    .from("utility_locate_tickets")
    .select("id", { head: false })
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .in("status", ["active", "extended"])
    .gt("valid_until", new Date().toISOString())
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function activePermitExists(adminSb, tenantId, jobId) {
  const { data, error } = await adminSb
    .from("confined_space_permits")
    .select("id", { head: false })
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .eq("status", "open")
    .gt("permit_valid_until", new Date().toISOString())
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function collectManifestCloseoutIssues(adminSb, tenantId, job) {
  const { data, error } = await adminSb
    .from("waste_manifests")
    .select("id, manifest_number, status, disposal_facility_id, disposal_facility_name, disposal_ticket_number, quantity_actual, quantity_estimated")
    .eq("tenant_id", tenantId)
    .eq("job_id", job.id)
    .neq("status", "void");

  if (error) throw error;

  const manifests = Array.isArray(data) ? data : [];
  const issues = [];

  if (!manifests.length && manifestNeedsCloseout(job)) {
    issues.push({
      code: "manifest_missing",
      message: "Log the hauled load before closing out this hydrovac job.",
    });
    return issues;
  }

  for (const manifest of manifests) {
    const number = manifest.manifest_number || manifest.id;
    if (String(manifest.status || "").toLowerCase() !== "confirmed") {
      issues.push({
        code: "manifest_unconfirmed",
        message: `Confirm manifest ${number} before closing out the job.`,
      });
    }
    if (!String(manifest.disposal_facility_id || manifest.disposal_facility_name || "").trim()) {
      issues.push({
        code: "manifest_facility_missing",
        message: `Add the disposal facility for manifest ${number} before closing out the job.`,
      });
    }
    if (!String(manifest.disposal_ticket_number || "").trim()) {
      issues.push({
        code: "manifest_ticket_missing",
        message: `Add the disposal ticket number for manifest ${number} before closing out the job.`,
      });
    }
    if (manifest.quantity_actual == null && manifest.quantity_estimated == null) {
      issues.push({
        code: "manifest_quantity_missing",
        message: `Add the hauled quantity for manifest ${number} before closing out the job.`,
      });
    }
  }

  return issues;
}

async function collectHydrovacLifecycleIssues({ adminSb, tenantId, hydrovacSettings, job, targetStatus }) {
  const status = lower(targetStatus);
  const issues = [];

  if (status === "in_progress") {
    if (jobRequiresLocateTicket(job, hydrovacSettings)) {
      const hasLocate = await activeLocateTicketExists(adminSb, tenantId, job.id);
      if (!hasLocate) {
        issues.push({
          code: "locate_ticket_missing",
          message: "An active locate ticket is required before this hydrovac job can start.",
        });
      }
    }

    if (jobRequiresConfinedSpacePermit(job, hydrovacSettings)) {
      const hasPermit = await activePermitExists(adminSb, tenantId, job.id);
      if (!hasPermit) {
        issues.push({
          code: "confined_space_permit_missing",
          message: "An open confined-space permit is required before this hydrovac job can start.",
        });
      }
    }
  }

  if (status === "completed") {
    const manifestIssues = await collectManifestCloseoutIssues(adminSb, tenantId, job);
    issues.push(...manifestIssues);
  }

  return issues;
}

function manifestConfirmationIssues(manifest) {
  const issues = [];
  if (!String(manifest?.disposal_facility_id || manifest?.disposal_facility_name || "").trim()) {
    issues.push("Choose a disposal facility before confirming this load.");
  }
  if (!String(manifest?.disposal_ticket_number || "").trim()) {
    issues.push("Add the disposal ticket number before confirming this load.");
  }
  if (manifest?.quantity_actual == null && manifest?.quantity_estimated == null) {
    issues.push("Add the hauled quantity before confirming this load.");
  }
  return issues;
}

module.exports = {
  collectHydrovacLifecycleIssues,
  hydrovacJobType,
  jobRequiresConfinedSpacePermit,
  jobRequiresLocateTicket,
  manifestConfirmationIssues,
};
