'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const {
  isGoogleCalendarConfigured,
  getOperatorCalendarConnection,
  listGoogleCalendars,
  sanitizeGoogleCalendarConnection,
  normalizeCalendarSelection,
  normalizeSyncMode,
} = require('./utils/google-calendar');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PATCH') {
    return respond(405, { error: 'Method not allowed' });
  }

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

    const calendars = await listGoogleCalendars(ctx.supabase, connection);
    const availableIds = new Set(calendars.map((calendar) => String(calendar?.id || '').trim()).filter(Boolean));
    const selectedCalendarIds = normalizeCalendarSelection(body.selected_calendar_ids);
    if (selectedCalendarIds.some((id) => !availableIds.has(id))) {
      return respond(400, { error: 'One or more selected calendars are no longer available on this Google account.' });
    }

    const exportCalendarId = String(body.export_calendar_id || '').trim();
    if (exportCalendarId && !availableIds.has(exportCalendarId)) {
      return respond(400, { error: 'The export calendar is not available on this Google account.' });
    }

    const patch = {
      selected_calendar_ids: selectedCalendarIds,
      export_calendar_id: exportCalendarId,
      export_bookings: body.export_bookings === true,
      consolidate_calendars: body.consolidate_calendars !== false,
      sync_mode: normalizeSyncMode(body.sync_mode),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await ctx.supabase
      .from('operator_calendar_connections')
      .update(patch)
      .eq('id', connection.id)
      .select('*')
      .maybeSingle();
    if (error) throw error;

    return respond(200, {
      ok: true,
      connection: sanitizeGoogleCalendarConnection(data || { ...connection, ...patch }, calendars),
    });
  } catch (error) {
    return respond(500, { error: error.message || 'Could not save Google Calendar sync settings.' });
  }
};
