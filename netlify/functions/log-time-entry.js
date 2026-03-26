// netlify/functions/log-time-entry.js
// Logs a time entry for a customer, order, or booking.
// POST { customer_id?, order_id?, booking_id?, description, started_at,
//        ended_at?, duration_minutes?, billable?, hourly_rate_cents? }
// Requires operator auth.
// Returns { ok: true, entry: {...} }

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId, operatorId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const {
    customer_id,
    order_id,
    booking_id,
    description,
    started_at,
    ended_at,
    duration_minutes: _duration_minutes,
    billable         = true,
    hourly_rate_cents = 0,
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

  const record = {
    tenant_id        : tenantId,
    operator_id      : operatorId || null,
    customer_id      : customer_id || null,
    order_id         : order_id   || null,
    booking_id       : booking_id || null,
    description      : description ? String(description).trim() : null,
    started_at,
    ended_at         : resolvedEndedAt,
    duration_minutes : durationMinutes,
    billable         : billable !== false,
    hourly_rate_cents: Math.max(0, parseInt(hourly_rate_cents, 10) || 0),
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
