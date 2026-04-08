'use strict';

const { getAdminClient } = require('./utils/auth');
const {
  isGoogleCalendarConfigured,
  verifyGoogleCalendarState,
  exchangeGoogleCalendarCode,
  upsertGoogleCalendarConnection,
} = require('./utils/google-calendar');

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body,
  };
}

function operatorRedirectUrl(status) {
  const origin = String(process.env.SITE_URL || process.env.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  return `${origin}/operator/?calendar_sync=${encodeURIComponent(status)}#bookings`;
}

function callbackHtml(title, message, status) {
  const redirectUrl = operatorRedirectUrl(status);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="2;url=${redirectUrl}" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #17181f; color: #f4efe8; display: grid; place-items: center; min-height: 100vh; margin: 0; }
      .card { width: min(480px, 92vw); padding: 28px; border-radius: 18px; background: #222430; box-shadow: 0 24px 80px rgba(0,0,0,.28); }
      a { color: #ff8a4c; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1 style="margin:0 0 12px;font-size:1.2rem;">${title}</h1>
      <p style="margin:0 0 12px;line-height:1.5;">${message}</p>
      <p style="margin:0;font-size:.92rem;"><a href="${redirectUrl}">Return to the Calendar tab</a></p>
    </div>
  </body>
</html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return htmlResponse(200, '');
  if (event.httpMethod !== 'GET') {
    return htmlResponse(405, callbackHtml('Method not allowed', 'This callback only accepts Google redirect requests.', 'error'));
  }

  if (!isGoogleCalendarConfigured()) {
    return htmlResponse(503, callbackHtml('Google Calendar not configured', 'Set the Google Calendar environment variables before connecting an account.', 'error'));
  }

  const params = event.queryStringParameters || {};
  if (params.error) {
    return htmlResponse(400, callbackHtml('Google Calendar connection canceled', 'The Google connection was canceled before ProofLink could finish setup.', 'canceled'));
  }
  if (!params.code || !params.state) {
    return htmlResponse(400, callbackHtml('Missing Google callback details', 'Google did not return the code and state ProofLink needs to finish connecting your calendar.', 'error'));
  }

  try {
    const state = verifyGoogleCalendarState(params.state);
    const tokens = await exchangeGoogleCalendarCode(params.code);
    const supabase = getAdminClient();
    const providerEmail = String(tokens.id_token || '').trim() ? 'Connected Google account' : '';

    await upsertGoogleCalendarConnection(supabase, {
      tenant_id: state.tenant_id,
      operator_id: state.operator_id,
      provider_user_id: state.user_id,
      provider_user_email: providerEmail,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      access_token_expires_at: tokens.expires_in ? new Date(Date.now() + (Number(tokens.expires_in) * 1000)).toISOString() : null,
      selected_calendar_ids: [],
      export_calendar_id: '',
      export_bookings: false,
      sync_mode: 'read_only',
      last_sync_error: null,
      last_synced_at: null,
    });

    return htmlResponse(200, callbackHtml('Google Calendar connected', 'ProofLink connected the Google account. Return to the Calendar tab to choose which calendars to consolidate and where bookings should export.', 'connected'));
  } catch (error) {
    return htmlResponse(500, callbackHtml('Google Calendar connection failed', error.message || 'ProofLink could not finish the Google Calendar connection.', 'error'));
  }
};
