'use strict';

const { respond } = require('./utils/auth');
const { asBoolean, asNumber, clean, parseJsonBody, requireHydrovacOperatorContext, daysUntil } = require('./utils/hydrovac');
const { jobRequiresLocateTicket } = require('./lib/hydrovac-compliance');

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
      return respond(409, { error: 'Driver CDL is expired', missing: 'cdl_expiry' });
    }
    if (medExpired && !forceDispatch) {
      return respond(409, { error: 'Driver medical certificate is expired', missing: 'medical_certificate_expiry' });
    }
    if (cdlExpired) warnings.push({ type: 'cdl_expired_override', message: 'Driver CDL is expired but dispatch was forced.' });
    if (medExpired) warnings.push({ type: 'medical_expired_override', message: 'Driver medical certificate is expired but dispatch was forced.' });

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
      .select('id, title, scheduled_date, status')
      .eq('tenant_id', tenantId)
      .eq('assigned_truck_id', assignedTruckId)
      .eq('scheduled_date', dispatchDate)
      .in('status', ['dispatched', 'in_progress'])
      .neq('id', jobId)
      .limit(1);

    if (conflictError) return respond(500, { error: conflictError.message });
    if (Array.isArray(conflicting) && conflicting.length) {
      return respond(409, {
        error: 'Truck already assigned',
        conflicting_job_id: conflicting[0].id,
      });
    }
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

  const patch = {
    status: 'dispatched',
    assigned_truck_id: assignedTruckId,
    assigned_member_id: driverMemberId,
    assigned_operator_id: member.operator_id || null,
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

  try {
    await adminSb
      .from('equipment')
      .update({ status: 'on_job' })
      .eq('tenant_id', tenantId)
      .eq('id', assignedTruckId);
  } catch (equipmentError) {
    console.warn('[dispatch-job] equipment status update skipped:', equipmentError.message || equipmentError);
  }

  return respond(200, { ok: true, job: updated, warnings });
};
