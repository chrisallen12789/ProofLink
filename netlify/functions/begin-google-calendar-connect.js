'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { isGoogleCalendarConfigured, buildGoogleCalendarAuthUrl } = require('./utils/google-calendar');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
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
    const authUrl = buildGoogleCalendarAuthUrl({
      tenantId: ctx.tenantId,
      operatorId: ctx.operatorId,
      userId: ctx.user?.id || '',
    });
    return respond(200, { ok: true, auth_url: authUrl });
  } catch (error) {
    return respond(500, { error: error.message || 'Could not start Google Calendar connection.' });
  }
};
