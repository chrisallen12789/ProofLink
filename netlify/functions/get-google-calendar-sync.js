'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const {
  isGoogleCalendarConfigured,
  getOperatorCalendarConnection,
  listGoogleCalendars,
  sanitizeGoogleCalendarConnection,
} = require('./utils/google-calendar');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  if (!isGoogleCalendarConfigured()) {
    return respond(200, {
      configured: false,
      connection: sanitizeGoogleCalendarConnection(null, []),
    });
  }

  try {
    const connection = await getOperatorCalendarConnection(ctx.supabase, ctx.tenantId, ctx.operatorId);
    if (!connection) {
      return respond(200, {
        configured: true,
        connection: sanitizeGoogleCalendarConnection(null, []),
      });
    }

    const calendars = await listGoogleCalendars(ctx.supabase, connection);
    return respond(200, {
      configured: true,
      connection: sanitizeGoogleCalendarConnection(connection, calendars),
    });
  } catch (error) {
    return respond(500, { error: error.message || 'Could not load Google Calendar sync settings.' });
  }
};
