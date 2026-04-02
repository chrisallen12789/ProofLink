// netlify/functions/get-availability.js
// Public endpoint - no auth required.
// GET /?tenant_id=<uuid>&date=<YYYY-MM-DD>
// GET /?tenant_id=<uuid>&start_date=<YYYY-MM-DD>&end_date=<YYYY-MM-DD>
// Returns { available, reason, days, summary, window, ... }

'use strict';

const { getAdminClient, respond } = require('./utils/auth');
const { checkRateLimit, rateLimitResponse, getClientIP } = require('./utils/rate-limit');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 370;

function parseDateKey(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(date, count) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function countDaysInclusive(startDate, endDate) {
  return Math.floor((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
}

function normalizeBlackoutDates(rawValue) {
  if (!Array.isArray(rawValue)) return new Set();

  return new Set(
    rawValue
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') {
          return entry.date || entry.day || entry.value || '';
        }
        return '';
      })
      .filter((entry) => DATE_PATTERN.test(String(entry || '')))
  );
}

function resolveDateWindow(params) {
  const singleDate = String(params.date || '').trim();
  const startDate = String(params.start_date || '').trim();
  const endDate = String(params.end_date || '').trim();

  if (singleDate && (startDate || endDate)) {
    return {
      error: 'Use either date or start_date/end_date, not both',
      statusCode: 400,
    };
  }

  if (singleDate) {
    const parsed = parseDateKey(singleDate);
    if (!parsed) {
      return {
        error: 'date must be in YYYY-MM-DD format',
        statusCode: 400,
      };
    }
    return {
      startDate: parsed,
      endDate: parsed,
      singleDate: true,
    };
  }

  if (!startDate || !endDate) {
    return {
      error: 'date or start_date/end_date is required',
      statusCode: 400,
    };
  }

  const parsedStart = parseDateKey(startDate);
  const parsedEnd = parseDateKey(endDate);
  if (!parsedStart || !parsedEnd) {
    return {
      error: 'start_date and end_date must be in YYYY-MM-DD format',
      statusCode: 400,
    };
  }
  if (parsedEnd < parsedStart) {
    return {
      error: 'end_date must be on or after start_date',
      statusCode: 400,
    };
  }

  const totalDays = countDaysInclusive(parsedStart, parsedEnd);
  if (totalDays > MAX_RANGE_DAYS) {
    return {
      error: `Requested range exceeds ${MAX_RANGE_DAYS} days`,
      statusCode: 400,
    };
  }

  return {
    startDate: parsedStart,
    endDate: parsedEnd,
    singleDate: false,
  };
}

function buildDailyAvailability(startDate, endDate, blocks, blackoutDates) {
  const blockByDate = new Map();

  (blocks || []).forEach((block) => {
    const blockStart = parseDateKey(String(block.starts_at || '').slice(0, 10));
    const blockEnd = parseDateKey(String(block.ends_at || '').slice(0, 10));
    if (!blockStart || !blockEnd) return;

    let current = blockStart < startDate ? new Date(startDate.getTime()) : blockStart;
    const finalDay = blockEnd > endDate ? endDate : blockEnd;

    while (current <= finalDay) {
      const dateKey = toDateKey(current);
      if (!blockByDate.has(dateKey)) blockByDate.set(dateKey, block);
      current = addDays(current, 1);
    }
  });

  const days = [];
  let current = new Date(startDate.getTime());
  while (current <= endDate) {
    const dateKey = toDateKey(current);
    const block = blockByDate.get(dateKey) || null;
    const isBlackout = blackoutDates.has(dateKey);
    const reason = block
      ? (block.title ? `Not available: ${block.title}` : 'This date is not available for booking.')
      : (isBlackout ? 'This date is not available for booking.' : null);

    days.push({
      date: dateKey,
      available: !block && !isBlackout,
      reason,
      block_title: block?.title || null,
      is_blackout: isBlackout,
    });

    current = addDays(current, 1);
  }

  return days;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  const ip = getClientIP(event);
  const rl = checkRateLimit({ key: `get-availability:${ip}`, maxRequests: 60, windowMs: 15 * 60 * 1000 });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const params = event.queryStringParameters || {};
  const tenantId = params.tenant_id;
  if (!tenantId) return respond(400, { error: 'tenant_id is required' });

  const dateWindow = resolveDateWindow(params);
  if (dateWindow.error) {
    return respond(dateWindow.statusCode, { error: dateWindow.error });
  }

  const adminSb = getAdminClient();
  const startDateKey = toDateKey(dateWindow.startDate);
  const endDateKey = toDateKey(dateWindow.endDate);
  const dayStart = `${startDateKey}T00:00:00.000Z`;
  const dayEnd = `${endDateKey}T23:59:59.999Z`;

  const [availabilityResult, blocksResult] = await Promise.all([
    adminSb
      .from('availability')
      .select('timezone, lead_time_hours, max_orders_per_day, blackout_dates, notes')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    adminSb
      .from('availability_blocks')
      .select('id, title, starts_at, ends_at')
      .eq('tenant_id', tenantId)
      .eq('block_bookings', true)
      .lte('starts_at', dayEnd)
      .gte('ends_at', dayStart),
  ]);

  if (availabilityResult?.error) return respond(500, { error: availabilityResult.error.message });
  if (blocksResult?.error) return respond(500, { error: blocksResult.error.message });

  const availabilityRow = availabilityResult?.data || null;
  const blackoutDates = normalizeBlackoutDates(availabilityRow?.blackout_dates);
  const days = buildDailyAvailability(
    dateWindow.startDate,
    dateWindow.endDate,
    blocksResult?.data || [],
    blackoutDates
  );
  const firstAvailableDate = days.find((day) => day.available)?.date || null;
  const blockedDays = days.filter((day) => !day.available).length;
  const availableDays = days.length - blockedDays;
  const primaryDay = days[0] || { available: true, reason: null, date: startDateKey };

  return respond(200, {
    date: dateWindow.singleDate ? primaryDay.date : null,
    available: primaryDay.available,
    reason: primaryDay.reason,
    timezone: availabilityRow?.timezone || null,
    lead_time_hours: availabilityRow?.lead_time_hours ?? null,
    max_orders_per_day: availabilityRow?.max_orders_per_day ?? null,
    notes: availabilityRow?.notes || null,
    window: {
      start_date: startDateKey,
      end_date: endDateKey,
    },
    summary: {
      total_days: days.length,
      available_days: availableDays,
      blocked_days: blockedDays,
      first_available_date: firstAvailableDate,
    },
    days,
  });
};
