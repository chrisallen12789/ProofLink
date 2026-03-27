// netlify/functions/get-availability.js
// Public endpoint — no auth required.
// GET /?tenant_id=<uuid>&date=<YYYY-MM-DD>
// Returns { available: bool, reason: string|null }

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `get-availability:${ip}`, maxRequests: 60, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const params    = event.queryStringParameters || {};
  const tenantId  = params.tenant_id;
  const dateStr   = params.date; // expected: YYYY-MM-DD

  if (!tenantId) return respond(400, { error: 'tenant_id is required' });
  if (!dateStr)  return respond(400, { error: 'date is required' });

  // Basic date format validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return respond(400, { error: 'date must be in YYYY-MM-DD format' });
  }

  const adminSb = getAdminClient();

  // A block covers the date if starts_at <= date <= ends_at and block_bookings is true.
  // starts_at/ends_at are stored as ISO timestamps; comparing against the date string
  // works because 'YYYY-MM-DD' <= 'YYYY-MM-DDTHH:MM:SSZ' lexicographically for the
  // same calendar date, so we use the day boundaries explicitly.
  const dayStart = dateStr + 'T00:00:00.000Z';
  const dayEnd   = dateStr + 'T23:59:59.999Z';

  const { data, error } = await adminSb
    .from('availability_blocks')
    .select('id, title, starts_at, ends_at')
    .eq('tenant_id', tenantId)
    .eq('block_bookings', true)
    .lte('starts_at', dayEnd)   // block starts on or before end of selected day
    .gte('ends_at', dayStart)   // block ends on or after start of selected day
    .limit(1);

  if (error) return respond(500, { error: error.message });

  if (data && data.length > 0) {
    const block = data[0];
    const reason = block.title
      ? 'Not available: ' + block.title
      : 'This date is not available for booking.';
    return respond(200, { available: false, reason });
  }

  return respond(200, { available: true, reason: null });
};
