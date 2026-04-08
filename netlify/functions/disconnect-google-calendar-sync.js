'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { isGoogleCalendarConfigured, getOperatorCalendarConnection } = require('./utils/google-calendar');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
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

  try {
    const connection = await getOperatorCalendarConnection(ctx.supabase, ctx.tenantId, ctx.operatorId);
    if (!connection) return respond(200, { ok: true });

    await ctx.supabase
      .from('operator_calendar_event_links')
      .delete()
      .eq('connection_id', connection.id);

    const { error } = await ctx.supabase
      .from('operator_calendar_connections')
      .delete()
      .eq('id', connection.id);
    if (error) throw error;

    return respond(200, { ok: true });
  } catch (error) {
    return respond(500, { error: error.message || 'Could not disconnect Google Calendar sync.' });
  }
};
