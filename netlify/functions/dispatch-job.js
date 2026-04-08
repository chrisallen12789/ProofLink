'use strict';

const { respond } = require('./utils/auth');
const { asBoolean, asNumber, clean, parseJsonBody, requireHydrovacOperatorContext, daysUntil } = require('./utils/hydrovac');
const {
  jobRequiresLocateTicket,
  logComplianceAlerts,
  manifestBolNumber,
  manifestLiveHoldReason,
  manifestMarkedLive,
  resolveComplianceAlerts,
  truckLoadIssuesForRows,
} = require('./lib/hydrovac-compliance');

function manifestReadyBy(manifest) {
  const metadata = manifest?.metadata && typeof manifest.metadata === 'object' && !Array.isArray(manifest.metadata)
    ? manifest.metadata
    : {};
  return clean(metadata.disposal_ready_by);
}

function estimatedDispatchMinutes(job = {}) {
  const minimumHours = asNumber(job.minimum_hours, 0);
  const billableHours = asNumber(job.billable_hours, 0);
  const travelHours = asNumber(job.travel_hours, 0);
  const workingHours = billableHours > 0 ? billableHours : Math.max(minimumHours, 0);
  return Math.round((workingHours + Math.max(travelHours, 0)) * 60);
}

function compoundWindowMinutes(job = {}, conflictingJobs = []) {
  const jobs = [job, ...(Array.isArray(conflictingJobs) ? conflictingJobs : [])];
  const maxMinimumHours = jobs.reduce((max, row) => Math.max(max, asNumber(row?.minimum_hours, 0)), 0);
  return Math.round(Math.max(4, maxMinimumHours) * 60);
}

function truckDispatchPlanner(loads = [], job = {}, dispatchDate = '') {
  const liveLoads = (Array.isArray(loads) ? loads : []).filter((manifest) => manifestMarkedLive(manifest));
  const carryoverLoads = liveLoads.filter((manifest) => String(manifest?.job_id || '') !== String(job?.id || ''));
  const warnings = [];
  const blockingIssues = [];
  const riskIssues = truckLoadIssuesForRows(carryoverLoads, job);

  riskIssues.forEach((issue) => {
    if (issue.code === 'truck_cross_contamination_risk') {
      blockingIssues.push(issue);
      return;
    }
    warnings.push({
      type: issue.code,
      message: issue.message,
    });
  });

  carryoverLoads.forEach((manifest) => {
    const number = manifest?.manifest_number || manifest?.id || 'load';
    if (!manifestBolNumber(manifest)) {
      blockingIssues.push({
        code: 'manifest_bol_missing',
        message: `Dispatch is blocked until manifest ${number} has a bill of lading or reference number attached.`,
      });
    }
    if (!manifestLiveHoldReason(manifest)) {
      blockingIssues.push({
        code: 'manifest_live_hold_reason_missing',
        message: `Dispatch is blocked until manifest ${number} explains why the load is still live in the truck.`,
      });
    }
    const readyBy = manifestReadyBy(manifest);
    if (!readyBy || !dispatchDate) return;
    if (readyBy < dispatchDate) {
      warnings.push({
        type: 'truck_disposal_overdue',
        message: `Manifest ${number} should have been handled before ${dispatchDate}. Clear that load before it becomes tomorrow's bottleneck too.`,
      });
      return;
    }
    if (readyBy === dispatchDate) {
      warnings.push({
        type: 'truck_disposal_due_today',
        message: `Manifest ${number} is already marked ready for disposal today. Plan the dump run before this truck stalls later in the shift.`,
      });
    }
  });

  return { liveLoads, carryoverLoads, warnings, blockingIssues };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireHydrovacOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId, adminSb, hydrovacSettings } = ctx;

  let body;
  try {
    body = parseJsonBody(event);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const jobId = clean(body.job_id);
  const assignedTruckId = clean(body.assigned_truck_id);
  const driverMemberId = clean(body.driver_member_id);
  const scheduledDate = clean(body.scheduled_date);
  const scheduledTime = clean(body.scheduled_time);
  const forceDispatch = asBoolean(body.force_dispatch, false);
  const compoundRouteOverride = asBoolean(body.compound_route_override, false);

  if (!jobId) return respond(400, { error: 'job_id is required' });
  if (!assignedTruckId) return respond(400, { error: 'assigned_truck_id is required' });
  if (!driverMemberId) return respond(400, { error: 'driver_member_id is required' });

  const [jobResult, truckResult, memberResult] = await Promise.all([
    adminSb
      .from('jobs')
      .select('id, tenant_id, status, title, job_type, travel_hours, minimum_hours, scheduled_date, scheduled_time')
      .eq('tenant_id', tenantId)
      .eq('id', jobId)
      .maybeSingle(),
    adminSb
      .from('equipment')
      .select('id, tenant_id, name, unit_number, is_cdl_required, gvwr_lbs, next_dot_inspection_due, next_annual_inspection_due, next_tank_inspection_due, insurance_expiry_date, registration_expiry_date')
      .eq('tenant_id', tenantId)
      .eq('id', assignedTruckId)
      .eq('is_active', true)
      .maybeSingle(),
    adminSb
      .from('operator_members')
      .select('id, tenant_id, operator_id, role, display_name')
      .eq('tenant_id', tenantId)
      .eq('id', driverMemberId)
      .maybeSingle(),
  ]);

  if (jobResult.error) return respond(500, { error: jobResult.error.message });
  if (truckResult.error) return respond(500, { error: truckResult.error.message });
  if (memberResult.error) return respond(500, { error: memberResult.error.message });
  if (!jobResult.data) return respond(404, { error: 'Job not found' });
  if (!truckResult.data) return respond(404, { error: 'Assigned truck not found' });
  if (!memberResult.data) return respond(404, { error: 'Driver member not found' });

  const job = jobResult.data;
  const truck = truckResult.data;
  const member = memberResult.data;
  const warnings = [];
  const dispatchDate = scheduledDate || clean(job.scheduled_date);

  if (jobRequiresLocateTicket(job, hydrovacSettings)) {
    const { data: locateTickets, error: locateError } = await adminSb
      .from('utility_locate_tickets')
      .select('id, status, valid_until')
      .eq('tenant_id', tenantId)
      .eq('job_id', jobId)
      .in('status', ['active', 'extended'])
      .gt('valid_until', new Date().toISOString())
      .limit(1);

    if (locateError) return respond(500, { error: locateError.message });
    if (!Array.isArray(locateTickets) || !locateTickets.length) {
      await logComplianceAlerts(adminSb, tenantId, [{
        code: 'locate_ticket_missing',
        message: 'Dispatch is blocked until an active locate ticket is attached to this hydrovac job.',
      }], {
        referenceType: 'job',
        referenceId: jobId,
        actorLabel: ctx.email || 'operator',
      });
      return respond(409, { error: 'Utility locate ticket required', missing: 'locate_ticket' });
    }
  }

  const { data: qualifications, error: qualError } = await adminSb
    .from('driver_qualifications')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('member_id', driverMemberId)
    .maybeSingle();

  if (qualError) return respond(500, { error: qualError.message });

  if (truck.is_cdl_required) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const cdlExpired = qualifications?.cdl_expiry_date && qualifications.cdl_expiry_date < todayIso;
    const medExpired = qualifications?.medical_certificate_expiry && qualifications.medical_certificate_expiry < todayIso;

    if (cdlExpired && !forceDispatch) {
      await logComplianceAlerts(adminSb, tenantId, [{
        code: 'cdl_expiry',
        message: 'Dispatch is blocked because the assigned driver CDL is expired.',
      }], {
        referenceType: 'job',
        referenceId: jobId,
        actorLabel: ctx.email || 'operator',
      });
      return respond(409, { error: 'Driver CDL is expired', missing: 'cdl_expiry' });
    }
    if (medExpired && !forceDispatch) {
      await logComplianceAlerts(adminSb, tenantId, [{
        code: 'medical_certificate_expiry',
        message: 'Dispatch is blocked because the assigned driver medical certificate is expired.',
      }], {
        referenceType: 'job',
        referenceId: jobId,
        actorLabel: ctx.email || 'operator',
      });
      return respond(409, { error: 'Driver medical certificate is expired', missing: 'medical_certificate_expiry' });
    }
    if (cdlExpired) {
      warnings.push({ type: 'cdl_expired_override', message: 'Driver CDL is expired but dispatch was forced.' });
      await logComplianceAlerts(adminSb, tenantId, [{
        code: 'cdl_expired_override',
        message: 'Dispatch was forced with an expired CDL on the assigned driver.',
      }], {
        referenceType: 'job',
        referenceId: jobId,
        actorLabel: ctx.email || 'operator',
        reason: forceDispatch ? 'Force dispatch was used.' : '',
      });
    }
    if (medExpired) {
      warnings.push({ type: 'medical_expired_override', message: 'Driver medical certificate is expired but dispatch was forced.' });
      await logComplianceAlerts(adminSb, tenantId, [{
        code: 'medical_expired_override',
        message: 'Dispatch was forced with an expired medical certificate on the assigned driver.',
      }], {
        referenceType: 'job',
        referenceId: jobId,
        actorLabel: ctx.email || 'operator',
        reason: forceDispatch ? 'Force dispatch was used.' : '',
      });
    }

    const cdlDays = daysUntil(qualifications?.cdl_expiry_date);
    const medDays = daysUntil(qualifications?.medical_certificate_expiry);
    if (cdlDays != null && cdlDays >= 0 && cdlDays <= 30) warnings.push({ type: 'cdl_expiring', days_remaining: cdlDays, message: 'Driver CDL expires within 30 days.' });
    if (medDays != null && medDays >= 0 && medDays <= 30) warnings.push({ type: 'medical_expiring', days_remaining: medDays, message: 'Driver medical certificate expires within 30 days.' });
  }

  const estimatedMinutes = Math.round(((asNumber(job.minimum_hours, 0) + asNumber(job.travel_hours, 0)) * 60));
  if (qualifications?.hos_available_driving_minutes != null && estimatedMinutes > 0 && estimatedMinutes > asNumber(qualifications.hos_available_driving_minutes, 0)) {
    warnings.push({
      type: 'hos_warning',
      message: 'Estimated job and travel time may exceed available HOS.',
      available_minutes: asNumber(qualifications.hos_available_driving_minutes, 0),
      estimated_minutes: estimatedMinutes,
    });
  }

  if (dispatchDate) {
    const { data: conflicting, error: conflictError } = await adminSb
      .from('jobs')
      .select('id, title, scheduled_date, status, assigned_member_id, assigned_operator_id, minimum_hours, billable_hours, travel_hours')
      .eq('tenant_id', tenantId)
      .eq('assigned_truck_id', assignedTruckId)
      .eq('scheduled_date', dispatchDate)
      .in('status', ['dispatched', 'in_progress'])
      .neq('id', jobId)
      .limit(10);

    if (conflictError) return respond(500, { error: conflictError.message });
    if (Array.isArray(conflicting) && conflicting.length) {
      if (!compoundRouteOverride) {
        return respond(409, {
          error: 'Truck already assigned',
          conflicting_job_id: conflicting[0].id,
        });
      }

      const conflictingDriverMismatch = conflicting.find((row) => {
        const assignedMemberId = clean(row?.assigned_member_id);
        const assignedOperatorId = clean(row?.assigned_operator_id);
        return (
          (assignedMemberId && assignedMemberId !== driverMemberId)
          || (assignedOperatorId && assignedOperatorId !== clean(member.operator_id))
        );
      });
      if (conflictingDriverMismatch) {
        return respond(409, {
          error: 'Compound route override only works when the same crew member owns the truck route.',
          conflicting_job_id: conflictingDriverMismatch.id,
          code: 'compound_route_driver_mismatch',
        });
      }

      const totalEstimatedMinutes = estimatedDispatchMinutes(job)
        + conflicting.reduce((sum, row) => sum + estimatedDispatchMinutes(row), 0);
      const allowedWindowMinutes = compoundWindowMinutes(job, conflicting);
      if (totalEstimatedMinutes > allowedWindowMinutes) {
        return respond(409, {
          error: 'Compound route exceeds the minimum crew block.',
          code: 'compound_route_exceeds_minimum',
          conflicting_job_id: conflicting[0].id,
          total_estimated_minutes: totalEstimatedMinutes,
          allowed_window_minutes: allowedWindowMinutes,
        });
      }

      warnings.push({
        type: 'compound_route_override',
        message: `Truck route was compounded across ${conflicting.length + 1} jobs inside the ${Math.round(allowedWindowMinutes / 60)}-hour minimum block.`,
        total_estimated_minutes: totalEstimatedMinutes,
        allowed_window_minutes: allowedWindowMinutes,
      });
    }
  }

  const { data: truckLoads, error: truckLoadsError } = await adminSb
    .from('waste_manifests')
    .select('id, job_id, customer_id, truck_id, manifest_number, status, metadata')
    .eq('tenant_id', tenantId)
    .eq('truck_id', assignedTruckId)
    .neq('status', 'void')
    .in('status', ['in_transit', 'delivered']);

  if (truckLoadsError) return respond(500, { error: truckLoadsError.message });

  const truckPlanner = truckDispatchPlanner(Array.isArray(truckLoads) ? truckLoads : [], job, dispatchDate);
  if (truckPlanner.blockingIssues.length) {
    await logComplianceAlerts(adminSb, tenantId, truckPlanner.blockingIssues, {
      referenceType: 'job',
      referenceId: jobId,
      actorLabel: ctx.email || 'operator',
    });
    return respond(409, {
      error: truckPlanner.blockingIssues[0].message,
      code: truckPlanner.blockingIssues[0].code,
      warnings: truckPlanner.warnings,
    });
  }

  if (truckPlanner.warnings.length) {
    warnings.push(...truckPlanner.warnings);
  }

  for (const field of ['next_dot_inspection_due', 'next_annual_inspection_due', 'next_tank_inspection_due', 'insurance_expiry_date', 'registration_expiry_date']) {
    const remaining = daysUntil(truck[field]);
    if (remaining != null && remaining >= 0 && remaining <= 30) {
      warnings.push({
        type: 'truck_compliance_warning',
        field,
        days_remaining: remaining,
        message: `${field.replace(/_/g, ' ')} is due within 30 days.`,
      });
    }
  }

  const nowIso = new Date().toISOString();
  const patch = {
    status               : 'dispatched',
    assigned_truck_id    : assignedTruckId,
    assigned_member_id   : driverMemberId,
    assigned_operator_id : member.operator_id || null,
    updated_at           : nowIso,
  };
  if (dispatchDate) patch.scheduled_date = dispatchDate;
  if (scheduledTime) patch.scheduled_time = scheduledTime;

  const { data: updated, error: updateError } = await adminSb
    .from('jobs')
    .update(patch)
    .eq('tenant_id', tenantId)
    .eq('id', jobId)
    .select()
    .maybeSingle();

  if (updateError) return respond(500, { error: updateError.message });

  await resolveComplianceAlerts(adminSb, tenantId, {
    referenceType: 'job',
    referenceId: jobId,
    alertTypes: [
      'locate_ticket_missing',
      'cdl_expiry',
      'medical_certificate_expiry',
      'truck_cross_contamination_risk',
      'manifest_bol_missing',
      'manifest_live_hold_reason_missing',
    ],
  });

  try {
    await adminSb
      .from('equipment')
      .update({ status: 'on_job', updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .eq('id', assignedTruckId);
  } catch (equipmentError) {
    console.warn('[dispatch-job] equipment status update skipped:', equipmentError.message || equipmentError);
  }

  return respond(200, { ok: true, job: updated, warnings });
};
