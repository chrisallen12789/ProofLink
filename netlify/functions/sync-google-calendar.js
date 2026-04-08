'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const {
  isGoogleCalendarConfigured,
  getOperatorCalendarConnection,
  listGoogleCalendars,
  connectionSelectedCalendarIds,
  fetchGoogleCalendarEvents,
  syncBookingsToGoogleCalendar,
  acquireGoogleCalendarSyncLock,
  releaseGoogleCalendarSyncLock,
  normalizeSyncMode,
} = require('./utils/google-calendar');

function normalizeDate(value, fallback) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  if (!isGoogleCalendarConfigured()) {
    return respond(503, { error: 'Google Calendar sync is not configured for this environment.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  try {
    const connection = await getOperatorCalendarConnection(ctx.supabase, ctx.tenantId, ctx.operatorId);
    if (!connection) return respond(404, { error: 'Google Calendar is not connected for this operator yet.' });

    const acquired = await acquireGoogleCalendarSyncLock(ctx.supabase, connection);
    if (!acquired) {
      return respond(409, { error: 'A Google Calendar sync is already running for this operator. Wait a moment and try again.' });
    }

    try {
      const today = new Date();
      const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const defaultEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
      const start = normalizeDate(body.start, defaultStart);
      const end = normalizeDate(body.end, defaultEnd);
      const calendars = await listGoogleCalendars(ctx.supabase, connection);
      const selectedIds = new Set(connectionSelectedCalendarIds(connection, calendars));
      const selectedCalendars = calendars
        .filter((calendar) => selectedIds.has(String(calendar?.id || '').trim()))
        .map((calendar) => ({ id: calendar.id, summary: calendar.summary || calendar.id, primary: !!calendar.primary }));

      const externalEvents = await fetchGoogleCalendarEvents({
        supabase: ctx.supabase,
        connection,
        startDate: start,
        endDate: end,
        calendars: selectedCalendars,
      });

      let exportSummary = { created: 0, updated: 0, deleted: 0, skipped: 0 };
      const mode = normalizeSyncMode(connection.sync_mode);
      const shouldExport = connection.export_bookings === true && mode === 'read_write';
      if (shouldExport) {
        let bookingsQuery = ctx.supabase
          .from('bookings')
          .select('*')
          .eq('tenant_id', ctx.tenantId);

        if (body.booking_id) {
          bookingsQuery = bookingsQuery.eq('id', body.booking_id).limit(1);
        } else {
          bookingsQuery = bookingsQuery
            .gte('starts_at', `${start}T00:00:00.000Z`)
            .lte('starts_at', `${end}T23:59:59.999Z`);
        }

        const { data: bookings, error: bookingsError } = await bookingsQuery;
        if (bookingsError) throw bookingsError;
        exportSummary = await syncBookingsToGoogleCalendar({
          supabase: ctx.supabase,
          connection,
          bookings: bookings || [],
        });
      }

      await releaseGoogleCalendarSyncLock(ctx.supabase, connection.id, {
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
      });

      return respond(200, {
        ok: true,
        external_events: externalEvents,
        export_summary: exportSummary,
        window: { start, end },
      });
    } catch (innerError) {
      await releaseGoogleCalendarSyncLock(ctx.supabase, connection.id, {
        last_sync_error: innerError.message || 'Google Calendar sync failed.',
      });
      throw innerError;
    }
  } catch (error) {
    return respond(500, { error: error.message || 'Could not sync Google Calendar.' });
  }
};
