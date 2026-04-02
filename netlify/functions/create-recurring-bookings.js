// netlify/functions/create-recurring-bookings.js
// Generates recurring booking instances from a parent booking.
// POST { booking_id, count? }
// Requires operator auth. Reads the parent booking's recurrence_rule and
// generates up to `count` (default 12) future instances, skipping any dates
// that already have a child booking for this parent.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

const VALID_RULES = ['DAILY', 'WEEKLY', 'MONTHLY'];

/**
 * Advance a Date by one recurrence unit * interval.
 * Returns a new Date object.
 */
function advanceDate(date, rule, interval) {
  const d = new Date(date);
  switch (rule) {
    case 'DAILY':
      d.setUTCDate(d.getUTCDate() + interval);
      break;
    case 'WEEKLY':
      d.setUTCDate(d.getUTCDate() + 7 * interval);
      break;
    case 'MONTHLY':
      d.setUTCMonth(d.getUTCMonth() + interval);
      break;
  }
  return d;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { booking_id, count = 12 } = body;
  if (!booking_id) return respond(400, { error: 'booking_id is required' });

  const maxCount = Math.min(Math.max(1, parseInt(count, 10) || 12), 52);

  // Load the parent booking — must belong to this tenant
  const { data: parent, error: parentErr } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', booking_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (parentErr) {
    console.error('[create-recurring-bookings] parent fetch:', parentErr);
    return respond(500, { error: 'Failed to load booking' });
  }
  if (!parent) return respond(404, { error: 'Booking not found or access denied' });
  if (!parent.recurrence_rule) {
    return respond(400, { error: 'Booking does not have a recurrence_rule set' });
  }
  if (!VALID_RULES.includes(parent.recurrence_rule)) {
    return respond(400, { error: `recurrence_rule must be one of: ${VALID_RULES.join(', ')}` });
  }

  const rule     = parent.recurrence_rule;
  const interval = Math.max(1, parseInt(parent.recurrence_interval, 10) || 1);
  const endDate  = parent.recurrence_end_date ? new Date(parent.recurrence_end_date) : null;

  // Load existing child bookings so we can skip already-generated dates
  const { data: existingChildren, error: childErr } = await supabase
    .from('bookings')
    .select('starts_at')
    .eq('recurrence_parent_id', booking_id)
    .eq('tenant_id', tenantId);

  if (childErr) {
    console.error('[create-recurring-bookings] children fetch:', childErr);
    return respond(500, { error: 'Failed to load existing recurrence instances' });
  }

  // Build a set of existing starts_at strings (ISO, date-only prefix for loose matching)
  const existingStartsSet = new Set(
    (existingChildren || []).map((b) => new Date(b.starts_at).toISOString())
  );

  // Duration of the parent booking in milliseconds
  const parentStart = new Date(parent.starts_at);
  const parentEnd   = parent.ends_at ? new Date(parent.ends_at) : null;
  const durationMs  = parentEnd ? parentEnd.getTime() - parentStart.getTime() : 0;

  const toInsert = [];
  let cursor = new Date(parentStart);

  for (let i = 0; i < maxCount * 4 && toInsert.length < maxCount; i++) {
    // Advance to next occurrence
    cursor = advanceDate(cursor, rule, interval);

    // Stop if past end date
    if (endDate && cursor > endDate) break;

    const newStart = new Date(cursor);
    const newEnd   = durationMs > 0 ? new Date(cursor.getTime() + durationMs) : null;

    const startIso = newStart.toISOString();

    // Skip if already generated
    if (existingStartsSet.has(startIso)) continue;

    // Build child booking record (omit generated/computed fields)
    const child = {
      tenant_id            : parent.tenant_id,
      operator_id          : parent.operator_id || null,
      customer_id          : parent.customer_id || null,
      customer_location_id : parent.customer_location_id || null,
      customer_name        : parent.customer_name,
      customer_email       : parent.customer_email || null,
      title                : parent.title,
      starts_at            : startIso,
      ends_at              : newEnd ? newEnd.toISOString() : null,
      notes                : parent.notes || null,
      status               : 'confirmed',
      order_id             : parent.order_id || null,
      location             : parent.location || null,
      recurrence_rule      : parent.recurrence_rule,
      recurrence_interval  : interval,
      recurrence_end_date  : parent.recurrence_end_date || null,
      recurrence_parent_id : parent.id,
      recurrence_generated : true,
      package_order_id     : parent.package_order_id || null,
      assigned_operator_id : parent.assigned_operator_id || null,
      service_address      : parent.service_address || null,
      created_at           : new Date().toISOString(),
      updated_at           : new Date().toISOString(),
    };

    toInsert.push(child);
    existingStartsSet.add(startIso); // prevent duplicate within this batch
  }

  if (!toInsert.length) {
    return respond(200, { ok: true, created: 0, bookings: [], message: 'No new instances to generate' });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('bookings')
    .insert(toInsert)
    .select();

  if (insertErr) {
    console.error('[create-recurring-bookings] insert:', insertErr);
    return respond(500, { error: 'Failed to create recurring booking instances' });
  }

  return respond(201, { ok: true, created: inserted.length, bookings: inserted });
};
