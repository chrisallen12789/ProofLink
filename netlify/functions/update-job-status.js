"use strict";

const { respond } = require("./utils/auth");
const { clean, parseJsonBody, requireHydrovacOperatorContext } = require("./utils/hydrovac");
const { collectHydrovacLifecycleIssues, logComplianceAlerts, resolveComplianceAlerts } = require("./lib/hydrovac-compliance");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(200, {});
  if (event.httpMethod !== "POST" && event.httpMethod !== "PATCH") {
    return respond(405, { error: "Method not allowed" });
  }

  let ctx;
  try {
    ctx = await requireHydrovacOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  let body;
  try {
    body = parseJsonBody(event);
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const jobId = clean(body.job_id);
  const nextStatus = clean(body.status);
  if (!jobId) return respond(400, { error: "job_id is required" });
  if (!nextStatus) return respond(400, { error: "status is required" });

  const { tenantId, adminSb, hydrovacSettings } = ctx;
  const { data: job, error: jobError } = await adminSb
    .from("jobs")
    .select("id, tenant_id, status, job_type, service_type, requires_confined_space_permit, total_loads_hauled, total_disposal_cost_cents, disposal_cost_cents, disposal_site, disposal_manifest_number, actual_start_at, actual_end_at")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) return respond(500, { error: jobError.message });
  if (!job) return respond(404, { error: "Job not found" });

  const issues = await collectHydrovacLifecycleIssues({
    adminSb,
    tenantId,
    hydrovacSettings,
    job,
    targetStatus: nextStatus,
  });
  if (issues.length) {
    await logComplianceAlerts(adminSb, tenantId, issues, {
      referenceType: "job",
      referenceId: job.id,
      actorLabel: ctx.email || "operator",
    });
    return respond(409, { error: issues[0].message, issues });
  }

  const nowIso = new Date().toISOString();
  const patch = {
    status    : nextStatus,
    updated_at: nowIso,
  };
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.blocker_note !== undefined) patch.blocker_note = body.blocker_note;
  if (body.check_in_lat !== undefined) patch.check_in_lat = body.check_in_lat;
  if (body.check_in_lng !== undefined) patch.check_in_lng = body.check_in_lng;
  if (body.actual_start_at !== undefined) patch.actual_start_at = body.actual_start_at;
  if (body.actual_end_at !== undefined) patch.actual_end_at = body.actual_end_at;

  if (nextStatus === "in_progress" && !patch.actual_start_at && !job.actual_start_at) {
    patch.actual_start_at = nowIso;
  }
  if (nextStatus === "completed") {
    if (!patch.actual_start_at && !job.actual_start_at) patch.actual_start_at = nowIso;
    if (!patch.actual_end_at && !job.actual_end_at) patch.actual_end_at = nowIso;
  }

  const { data: updated, error: updateError } = await adminSb
    .from("jobs")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .select("*")
    .maybeSingle();

  if (updateError) return respond(500, { error: updateError.message });
  await resolveComplianceAlerts(adminSb, tenantId, {
    referenceType: "job",
    referenceId: jobId,
    alertTypes: [
      "locate_ticket_missing",
      "confined_space_permit_missing",
      "manifest_missing",
      "manifest_unconfirmed",
      "manifest_facility_missing",
      "manifest_ticket_missing",
      "manifest_quantity_missing",
    ],
  });
  return respond(200, { ok: true, job: updated });
};
