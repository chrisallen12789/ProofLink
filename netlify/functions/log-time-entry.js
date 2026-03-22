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
    duration_minutes: durationInput,
    billable         = true,
    hourly_rate_cents = 0,
  } = body;

  if (!started_at) return respond(400, { error: 'started_at is required' });
  if (isNaN(Date.parse(started_at))) return respond(400, { error: 'started_at must be a valid ISO datetime' });

  let resolvedEndedAt      = ended_at || null;
  let resolvedDurationMins = durationInput != null ? parseInt(durationInput, 10) : null;

  // If ended_at provided, compute duration_minutes (overrides manual input)
  if (ended_at) {
    if (isNaN(Date.parse(ended_at))) return respond(400, { error: 'ended_at must be a valid ISO datetime' });
    const startMs = new Date(started_at).getTime();
    const endMs   = new Date(ended_at).getTime();
    if (endMs <= startMs) return respond(400, { error: 'ended_at must be after started_at' });
    resolvedDurationMins = Math.round((endMs - startMs) / 60000);
  }

  const record = {
    tenant_id        : tenantId,
    operator_id      : operatorId || null,
    customer_id      : customer_id || null,
    order_id         : order_id   || null,
    booking_id       : booking_id || null,
    description      : description ? String(description).trim() : null,
    started_at,
    ended_at         : resolvedEndedAt,
    duration_minutes : resolvedDurationMins,
    billable         : billable !== false,
    hourly_rate_cents: Math.max(0, parseInt(hourly_rate_cents, 10) || 0),
    invoiced         : false,
    created_at       : new Date().toISOString(),
  };

  const { data: entry, error } = await supabase
    .from('time_entries')
    .insert(record)
    .select()
    .single();

  if (error) {
    console.error('[log-time-entry]', error);
    return respond(500, { error: 'Failed to log time entry' });
  }

  return respond(201, { ok: true, entry });
};
