// netlify/functions/update-booking.js
// Updates or cancels a booking.
// PATCH { id, ...fields }  — only operator can update their tenant's bookings

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

const ALLOWED_FIELDS = ['title', 'customer_name', 'customer_email', 'starts_at', 'ends_at', 'notes', 'status'];
const VALID_STATUSES = ['confirmed', 'cancelled', 'completed', 'no_show'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'PATCH' && event.httpMethod !== 'POST')
    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { id, ...rest } = body;
  if (!id) return respond(400, { error: 'Missing booking id' });

  if (rest.status && !VALID_STATUSES.includes(rest.status)) {
    return respond(400, { error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const patch = {};
  ALLOWED_FIELDS.forEach((f) => { if (rest[f] !== undefined) patch[f] = rest[f]; });
  if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single();

  if (error) {
    console.error('[update-booking]', error);
    return respond(500, { error: 'Failed to update booking' });
  }
  if (!data) return respond(404, { error: 'Booking not found' });

  return respond(200, { ok: true, booking: data });
};
