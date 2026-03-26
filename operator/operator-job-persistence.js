// Job persistence extracted from operator.js
// so job save behavior and post-save refresh stay together.
async function saveJobRecord(fields = {}) {
  const nowIso = new Date().toISOString();
  const linkedOrder = CRM_ORDERS_CACHE.find((row) => row.id === (fields.order_id || jobOrderId?.value || ""));
  if (linkedOrder) assertOrderAllowsJobCreation(linkedOrder);
  const payload = withTenantScope({
    operator_id: opId(),
    order_id: fields.order_id || jobOrderId?.value || null,
    customer_id: fields.customer_id || jobCustomerId?.value || linkedOrder?.customer_id || null,
    status: fields.status || jobStatus?.value || "scheduled",
    title: fields.title || jobTitle?.value?.trim() || linkedOrder?.cart_summary || "",
    service_address: fields.service_address || jobServiceAddress?.value?.trim() || "",
    scheduled_date: fields.scheduled_date || jobScheduledDate?.value || null,
    scheduled_time: fields.scheduled_time || jobScheduledTime?.value?.trim() || null,
    schedule_window: fields.schedule_window || jobScheduleWindow?.value?.trim() || null,
    summary: fields.summary || jobSummary?.value?.trim() || "",
    notes: fields.notes || jobNotes?.value?.trim() || "",
    assigned_operator_id: fields.assigned_operator_id || jobAssignedTo?.value || null,
    service_type: jobMainServiceType?.value === "hydrovac" ? (jobServiceType?.value || "hydrovac") : (jobMainServiceType?.value || null),
    equipment_id: jobEquipmentId?.value || null,
    billable_hours: jobBillableHours?.value ? parseFloat(jobBillableHours.value) : null,
    minimum_hours: jobMinimumHours?.value ? parseFloat(jobMinimumHours.value) : 2,
    travel_hours: jobTravelHours?.value ? parseFloat(jobTravelHours.value) : 0,
    hourly_truck_rate_cents: jobTruckRate?.value ? Math.round(parseFloat(jobTruckRate.value) * 100) : 0,
    hourly_operator_rate_cents: jobOperatorRate?.value ? Math.round(parseFloat(jobOperatorRate.value) * 100) : 0,
    after_hours_multiplier: jobAfterHoursMultiplier?.value ? parseFloat(jobAfterHoursMultiplier.value) : 1.0,
    mobilization_fee_cents: jobMobilizationFee?.value ? Math.round(parseFloat(jobMobilizationFee.value) * 100) : 0,
    disposal_volume_m3: jobDisposalVolume?.value ? parseFloat(jobDisposalVolume.value) : null,
    disposal_cost_cents: jobDisposalCost?.value ? Math.round(parseFloat(jobDisposalCost.value) * 100) : 0,
    disposal_site: jobDisposalSite?.value || null,
    disposal_manifest_number: jobDisposalManifest?.value || null,
    updated_at: nowIso,
  });
  if (Object.prototype.hasOwnProperty.call(fields, "actual_start_at")) payload.actual_start_at = fields.actual_start_at;
  if (Object.prototype.hasOwnProperty.call(fields, "actual_end_at")) payload.actual_end_at = fields.actual_end_at;
  if (Object.prototype.hasOwnProperty.call(fields, "check_in_lat")) payload.check_in_lat = fields.check_in_lat;
  if (Object.prototype.hasOwnProperty.call(fields, "check_in_lng")) payload.check_in_lng = fields.check_in_lng;
  if (!payload.order_id) throw new Error("Link the job to an order before saving it.");
  const id = fields.id || jobId?.value || "";
  const query = id
    ? sb.from("jobs").update(payload).eq("id", id).eq(OPERATOR_COLUMN, opId()).eq(TENANT_COLUMN, TENANT_ID)
    : sb.from("jobs").insert({ ...payload, created_at: nowIso });
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  ACTIVE_JOB_ID = data.id;
  await Promise.all([fetchJobs(), fetchCrmOrders()]);
  renderJobs(jobSearch?.value || "");
  renderOrders();
  renderDashboard();
  renderGuidance();
  if (String(data.status || "").toLowerCase() === "dispatched" && data.assigned_operator_id) {
    showToast("Job dispatched - crew member will be notified");
  }
  if (String(data.status || "").toLowerCase() === "completed" && data.assigned_operator_id) {
    maybeLogJobHours(data);
  }
  return data;
}

const JOB_PERSISTENCE_HELPERS = {
  saveJobRecord,
};

window.PROOFLINK_OPERATOR_JOB_PERSISTENCE = {
  ...(window.PROOFLINK_OPERATOR_JOB_PERSISTENCE || {}),
  ...JOB_PERSISTENCE_HELPERS,
};

Object.assign(window, JOB_PERSISTENCE_HELPERS);
