// netlify/functions/get-bookings.js
// Returns bookings for the authenticated operator's tenant.
// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD  (optional date window, defaults to start of current month → end of next month)

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const {
  isGoogleCalendarConfigured,
  getOperatorCalendarConnection,
  listGoogleCalendars,
  connectionSelectedCalendarIds,
  fetchGoogleCalendarEvents,
  sanitizeGoogleCalendarConnection,
} = require('./utils/google-calendar');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId, operatorId } = ctx;

  const params = event.queryStringParameters || {};
  const now    = new Date();
  const start  = params.start || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end    = params.end   || new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
  const includeCalendarSync = String(params.include_calendar_sync || '').trim() === '1';

  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('starts_at', start)
    .lte('starts_at', end)
    .order('starts_at', { ascending: true });

  if (error) {
    console.error('[get-bookings] fetch error:', error);
    return respond(500, { error: 'Failed to fetch bookings' });
  }

  let externalEvents = [];
  let calendarSync = null;
  if (includeCalendarSync && isGoogleCalendarConfigured()) {
    try {
      const connection = await getOperatorCalendarConnection(supabase, tenantId, operatorId);
      if (connection) {
        const calendars = await listGoogleCalendars(supabase, connection);
        const selectedIds = new Set(connectionSelectedCalendarIds(connection, calendars));
        const selectedCalendars = calendars
          .filter((calendar) => selectedIds.has(String(calendar?.id || '').trim()))
          .map((calendar) => ({ id: calendar.id, summary: calendar.summary || calendar.id, primary: !!calendar.primary }));
        externalEvents = await fetchGoogleCalendarEvents({
          supabase,
          connection,
          startDate: start,
          endDate: end,
          calendars: selectedCalendars,
        });
        calendarSync = sanitizeGoogleCalendarConnection(connection, calendars);
      } else {
        calendarSync = sanitizeGoogleCalendarConnection(null, []);
      }
    } catch (syncError) {
      calendarSync = {
        ...sanitizeGoogleCalendarConnection(null, []),
        connected: true,
        last_sync_error: syncError.message || 'Google Calendar feed could not be loaded.',
      };
    }
  }

  return respond(200, {
    bookings: data || [],
    external_events: externalEvents,
    calendar_sync: calendarSync,
  });
};
