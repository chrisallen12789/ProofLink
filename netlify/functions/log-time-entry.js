// netlify/functions/log-time-entry.js
// Logs a time entry for a customer, order, or booking.
// POST { customer_id?, order_id?, booking_id?, description, started_at,
//        ended_at?, duration_minutes?, billable?, hourly_rate_cents? }
// Requires operator auth.
// Returns { ok: true, entry: {...} }

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

const WORK_TYPES = new Set([
  'job_work',
  'driver_training',
  'trade_training',
  'maintenance',
  'yard_shop',
  'safety_meeting',
  'admin_support',
  'other_paid_time',
]);

const TRAINING_TYPES = new Set([
  'cdl',
  'driver_safety',
  'worksite_safety',
  'vactor_operator',
  'plumbing_trade',
  'hydrovac_field',
  'ride_along',
  'onboarding',
  'other',
]);

const MAINTENANCE_TYPES = new Set([
  'routine_service',
  'repair',
  'tire_brake',
  'fluid_filter',
  'inspection',
  'cleanup',
  'capital_improvement',
  'other',
]);

const ASSET_CATEGORIES = new Set([
  'vehicle',
  'vactor',
  'trailer',
  'tool',
  'facility',
  'other',
]);

const COST_BUCKETS = new Set([
  'direct_job',
  'pricing_overhead',
  'maintenance_overhead',
  'asset_basis_candidate',
  'general_overhead',
]);

function normalizeKey(value, allowed, fallback) {
  const raw = String(value || '').trim().toLowerCase();
  if (allowed.has(raw)) return raw;
  return fallback;
}

function defaultBillableForWorkType(workType) {
  return workType === 'job_work';
}

function defaultCostBucketForWorkType(workType, maintenanceType) {
  if (workType === 'job_work') return 'direct_job';
  if (workType === 'maintenance') {
    return maintenanceType === 'capital_improvement'
      ? 'asset_basis_candidate'
      : 'maintenance_overhead';
  }
  if (workType === 'driver_training' || workType === 'trade_training') return 'pricing_overhead';
  if (workType === 'yard_shop') return 'pricing_overhead';
  return 'general_overhead';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId, user } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const {
    member_id,
    customer_id,
    order_id,
    booking_id,
    description,
    started_at,
    ended_at,
    duration_minutes: _duration_minutes,
    billable,
    hourly_rate_cents = 0,
    work_type,
    training_type,
    maintenance_type,
    asset_category,
    asset_label,
    cost_bucket,
  } = body;

  if (!started_at) return respond(400, { error: 'started_at is required' });
  if (isNaN(Date.parse(started_at))) return respond(400, { error: 'started_at must be a valid ISO datetime' });

  // Require duration — either computed from ended_at or provided explicitly
  if (!body.ended_at && (body.duration_minutes == null || body.duration_minutes <= 0)) {
    return respond(400, { error: 'Either ended_at or duration_minutes (> 0) is required to calculate billable time.' });
  }

  let resolvedEndedAt      = ended_at || null;

  // If ended_at provided, compute duration_minutes (overrides manual input)
  if (ended_at) {
    if (isNaN(Date.parse(ended_at))) return respond(400, { error: 'ended_at must be a valid ISO datetime' });
    const startMs = new Date(started_at).getTime();
    const endMs   = new Date(ended_at).getTime();
    if (endMs <= startMs) return respond(400, { error: 'ended_at must be after started_at' });
  }

  const durationMinutes = body.ended_at
    ? Math.round((new Date(body.ended_at) - new Date(body.started_at)) / 60000)
    : Math.round(Number(body.duration_minutes));

  if (!durationMinutes || durationMinutes <= 0) {
    return respond(400, { error: 'duration_minutes must resolve to a value greater than zero.' });
  }

  const normalizedWorkType = normalizeKey(work_type, WORK_TYPES, 'job_work');
  const normalizedTrainingType = normalizedWorkType === 'driver_training' || normalizedWorkType === 'trade_training'
    ? normalizeKey(training_type, TRAINING_TYPES, 'other')
    : null;
  const normalizedMaintenanceType = normalizedWorkType === 'maintenance'
    ? normalizeKey(maintenance_type, MAINTENANCE_TYPES, 'routine_service')
    : null;
  const normalizedAssetCategory = normalizedWorkType === 'maintenance'
    ? normalizeKey(asset_category, ASSET_CATEGORIES, 'vehicle')
    : null;
  const normalizedCostBucket = normalizeKey(
    cost_bucket,
    COST_BUCKETS,
    defaultCostBucketForWorkType(normalizedWorkType, normalizedMaintenanceType)
  );
  const resolvedBillable = typeof billable === 'boolean'
    ? billable
    : defaultBillableForWorkType(normalizedWorkType);
  const resolvedHourlyRateCents = Math.max(0, parseInt(hourly_rate_cents, 10) || 0);
  const estimatedCostCents = Math.round((durationMinutes / 60) * resolvedHourlyRateCents);

  let resolvedMemberId = null;
  let resolvedOperatorUserId = user?.id || null;

  if (member_id) {
    const { data: member, error: memberError } = await supabase
      .from('operator_members')
      .select('id, user_id, tenant_id, is_active')
      .eq('tenant_id', tenantId)
      .eq('id', String(member_id).trim())
      .maybeSingle();

    if (memberError) {
      console.error('[log-time-entry] member lookup failed', memberError);
      return respond(500, { error: 'Failed to resolve team member' });
    }
    if (!member || member.is_active === false) {
      return respond(400, { error: 'Selected team member could not be used for this time entry.' });
    }
    resolvedMemberId = member.id;
    resolvedOperatorUserId = member.user_id || resolvedOperatorUserId;
  }

  const record = {
    tenant_id        : tenantId,
    operator_id      : resolvedOperatorUserId,
    member_id        : resolvedMemberId,
    customer_id      : customer_id || null,
    order_id         : order_id   || null,
    booking_id       : booking_id || null,
    description      : description ? String(description).trim() : null,
    started_at,
    ended_at         : resolvedEndedAt,
    duration_minutes : durationMinutes,
    billable         : resolvedBillable,
    hourly_rate_cents: resolvedHourlyRateCents,
    amount_cents     : resolvedBillable ? estimatedCostCents : 0,
    cost_cents       : estimatedCostCents,
    work_type        : normalizedWorkType,
    training_type    : normalizedTrainingType,
    maintenance_type : normalizedMaintenanceType,
    asset_category   : normalizedAssetCategory,
    asset_label      : asset_label ? String(asset_label).trim() : null,
    cost_bucket      : normalizedCostBucket,
    invoiced         : false,
    created_at       : new Date().toISOString(),
  };

  const { data: entry, error } = await supabase
    .from('time_entries')
    .insert(record)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[log-time-entry]', error);
    return respond(500, { error: 'Failed to log time entry' });
  }
  if (!entry) {
    return respond(500, { error: 'Failed to log time entry: no record returned' });
  }

  return respond(201, { ok: true, entry });
};
