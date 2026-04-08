'use strict';

const crypto = require('crypto');

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
const SYNC_LOCK_MS = 45 * 1000;

function configuredSiteUrl() {
  return String(process.env.SITE_URL || process.env.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
}

function googleCalendarRedirectUri() {
  return String(process.env.GOOGLE_CALENDAR_REDIRECT_URI || '').trim()
    || `${configuredSiteUrl()}/.netlify/functions/google-calendar-oauth-callback`;
}

function isGoogleCalendarConfigured() {
  return !!String(process.env.GOOGLE_CLIENT_ID || '').trim()
    && !!String(process.env.GOOGLE_CLIENT_SECRET || '').trim()
    && !!configuredSiteUrl();
}

function normalizeCalendarSelection(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

function normalizeSyncMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['read_only', 'read_write'].includes(normalized) ? normalized : 'read_only';
}

function stateSecret() {
  return String(process.env.INTERNAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signGoogleCalendarState(payload) {
  const secret = stateSecret();
  if (!secret) throw new Error('Missing INTERNAL_SECRET for Google Calendar state signing');
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyGoogleCalendarState(rawState) {
  const secret = stateSecret();
  if (!secret) throw new Error('Missing INTERNAL_SECRET for Google Calendar state verification');
  const [body, signature] = String(rawState || '').split('.');
  if (!body || !signature) throw new Error('Missing or invalid Google Calendar state');
  const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('Invalid Google Calendar state signature');
  }

  const payload = JSON.parse(base64UrlDecode(body));
  const issuedAt = Number(payload?.issued_at || 0);
  if (!issuedAt || (Date.now() - issuedAt) > 15 * 60 * 1000) {
    throw new Error('Google Calendar state expired');
  }
  return payload;
}

function buildGoogleCalendarAuthUrl({ tenantId, operatorId, userId }) {
  if (!isGoogleCalendarConfigured()) {
    throw new Error('Google Calendar is not configured');
  }

  const state = signGoogleCalendarState({
    tenant_id: tenantId,
    operator_id: operatorId,
    user_id: userId,
    issued_at: Date.now(),
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleCalendarRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_SCOPES,
    state,
  });

  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

async function googleTokenRequest(params) {
  const body = new URLSearchParams({
    client_id: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    client_secret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirect_uri: googleCalendarRedirectUri(),
    ...params,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error_description || payload?.error || 'Google token exchange failed';
    throw new Error(detail);
  }
  return payload;
}

async function exchangeGoogleCalendarCode(code) {
  return googleTokenRequest({
    code,
    grant_type: 'authorization_code',
  });
}

function tokenExpiryIso(expiresInSeconds) {
  const expiresIn = Number(expiresInSeconds || 0);
  return expiresIn
    ? new Date(Date.now() + (expiresIn * 1000)).toISOString()
    : null;
}

async function getOperatorCalendarConnection(supabase, tenantId, operatorId) {
  const { data, error } = await supabase
    .from('operator_calendar_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('operator_id', operatorId)
    .eq('provider', 'google_calendar')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function refreshGoogleCalendarAccessToken(supabase, connection) {
  if (!connection?.refresh_token) return connection;

  const tokens = await googleTokenRequest({
    refresh_token: connection.refresh_token,
    grant_type: 'refresh_token',
  });
  const patch = {
    access_token: tokens.access_token,
    access_token_expires_at: tokenExpiryIso(tokens.expires_in),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('operator_calendar_connections')
    .update(patch)
    .eq('id', connection.id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || { ...connection, ...patch };
}

async function ensureFreshGoogleCalendarConnection(supabase, connection) {
  if (!connection?.access_token) return connection;
  const expiry = connection.access_token_expires_at ? new Date(connection.access_token_expires_at) : null;
  const expiringSoon = expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() <= (Date.now() + 60 * 1000);
  if (!expiringSoon) return connection;
  return refreshGoogleCalendarAccessToken(supabase, connection);
}

async function googleCalendarApiRequest(supabase, connection, path, { method = 'GET', searchParams, body } = {}) {
  let liveConnection = await ensureFreshGoogleCalendarConnection(supabase, connection);
  const runRequest = async (activeConnection) => {
    const url = new URL(`${GOOGLE_CALENDAR_BASE}${path}`);
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
    }
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${activeConnection.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  let { response, payload } = await runRequest(liveConnection);
  if (response.status === 401 && liveConnection?.refresh_token) {
    liveConnection = await refreshGoogleCalendarAccessToken(supabase, liveConnection);
    ({ response, payload } = await runRequest(liveConnection));
  }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.error_description || 'Google Calendar request failed';
    throw new Error(detail);
  }
  return payload;
}

function mapGoogleCalendarRecord(calendar, selectedCalendarIds = [], exportCalendarId = '') {
  const id = String(calendar?.id || '').trim();
  return {
    id,
    summary: String(calendar?.summary || calendar?.summaryOverride || id || 'Calendar').trim(),
    description: String(calendar?.description || '').trim(),
    primary: !!calendar?.primary,
    access_role: String(calendar?.accessRole || '').trim(),
    time_zone: String(calendar?.timeZone || '').trim() || null,
    selected: selectedCalendarIds.includes(id),
    export_target: !!exportCalendarId && exportCalendarId === id,
  };
}

async function listGoogleCalendars(supabase, connection) {
  const payload = await googleCalendarApiRequest(supabase, connection, '/users/me/calendarList');
  return Array.isArray(payload?.items) ? payload.items : [];
}

function googleDateToIso(value, endValue = null) {
  const dateTime = String(value?.dateTime || '').trim();
  if (dateTime) return new Date(dateTime).toISOString();

  const date = String(value?.date || '').trim();
  if (!date) return null;
  if (endValue?.date) {
    return new Date(`${date}T00:00:00.000Z`).toISOString();
  }
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

function eventAllDay(value) {
  return !!String(value?.date || '').trim() && !String(value?.dateTime || '').trim();
}

function normalizeGoogleExternalEvent(calendar, event) {
  const startsAt = googleDateToIso(event?.start, event?.end);
  const endsAt = googleDateToIso(event?.end, event?.end);
  return {
    id: `${calendar.id}:${event.id}`,
    source: 'google_calendar',
    source_label: 'Google Calendar',
    calendar_id: calendar.id,
    calendar_name: calendar.summary,
    external_event_id: String(event?.id || '').trim(),
    summary: String(event?.summary || event?.description || 'Google Calendar event').trim(),
    starts_at: startsAt,
    ends_at: endsAt,
    status: String(event?.status || 'confirmed').trim(),
    html_link: String(event?.htmlLink || '').trim() || null,
    location: String(event?.location || '').trim() || null,
    notes: String(event?.description || '').trim() || null,
    all_day: eventAllDay(event?.start),
    updated_at: String(event?.updated || '').trim() || null,
  };
}

async function fetchGoogleCalendarEvents({ supabase, connection, startDate, endDate, calendars }) {
  const selectedCalendars = Array.isArray(calendars) ? calendars : [];
  const events = [];

  await Promise.all(selectedCalendars.map(async (calendar) => {
    const payload = await googleCalendarApiRequest(
      supabase,
      connection,
      `/calendars/${encodeURIComponent(calendar.id)}/events`,
      {
        searchParams: {
          singleEvents: 'true',
          orderBy: 'startTime',
          showDeleted: 'false',
          timeMin: `${startDate}T00:00:00.000Z`,
          timeMax: `${endDate}T23:59:59.999Z`,
        },
      }
    );
    (Array.isArray(payload?.items) ? payload.items : []).forEach((event) => {
      if (!event?.id) return;
      events.push(normalizeGoogleExternalEvent(calendar, event));
    });
  }));

  return events
    .filter((event, index, items) => items.findIndex((candidate) => candidate.id === event.id) === index)
    .sort((left, right) => {
      const leftTime = new Date(left.starts_at || 0).getTime();
      const rightTime = new Date(right.starts_at || 0).getTime();
      return leftTime - rightTime;
    });
}

function connectionSelectedCalendarIds(connection, calendars = []) {
  const configured = normalizeCalendarSelection(connection?.selected_calendar_ids);
  if (configured.length) return configured;
  const primary = calendars.find((calendar) => calendar.primary);
  return primary ? [primary.id] : [];
}

function bookingSyncFingerprint(booking) {
  const payload = JSON.stringify({
    title: booking?.title || '',
    starts_at: booking?.starts_at || '',
    ends_at: booking?.ends_at || '',
    status: booking?.status || '',
    location: booking?.location || booking?.service_address || '',
    notes: booking?.notes || '',
    assigned_operator_id: booking?.assigned_operator_id || '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function bookingGoogleEventBody(booking) {
  const descriptionLines = [
    `ProofLink booking: ${String(booking?.id || '').trim() || 'unlinked'}`,
    booking?.customer_name ? `Customer: ${booking.customer_name}` : '',
    booking?.customer_email ? `Email: ${booking.customer_email}` : '',
    booking?.notes ? `Notes: ${booking.notes}` : '',
  ].filter(Boolean);

  return {
    summary: String(booking?.title || 'ProofLink booking').trim(),
    description: descriptionLines.join('\n'),
    location: String(booking?.location || booking?.service_address || '').trim() || undefined,
    start: { dateTime: booking?.starts_at },
    end: { dateTime: booking?.ends_at },
  };
}

async function syncSingleBookingToGoogleCalendar({ supabase, connection, booking }) {
  const exportCalendarId = String(connection?.export_calendar_id || '').trim();
  if (!exportCalendarId || !booking?.id) {
    return { created: 0, updated: 0, deleted: 0, skipped: 1 };
  }

  const fingerprint = bookingSyncFingerprint(booking);
  const { data: existingLink, error: linkError } = await supabase
    .from('operator_calendar_event_links')
    .select('*')
    .eq('connection_id', connection.id)
    .eq('booking_id', booking.id)
    .eq('external_calendar_id', exportCalendarId)
    .maybeSingle();
  if (linkError) throw linkError;

  if (String(booking.status || '').trim().toLowerCase() === 'cancelled') {
    if (!existingLink?.external_event_id) return { created: 0, updated: 0, deleted: 0, skipped: 1 };
    await googleCalendarApiRequest(
      supabase,
      connection,
      `/calendars/${encodeURIComponent(exportCalendarId)}/events/${encodeURIComponent(existingLink.external_event_id)}`,
      { method: 'DELETE' }
    );
    await supabase
      .from('operator_calendar_event_links')
      .delete()
      .eq('id', existingLink.id);
    return { created: 0, updated: 0, deleted: 1, skipped: 0 };
  }

  if (existingLink?.last_local_fingerprint === fingerprint) {
    return { created: 0, updated: 0, deleted: 0, skipped: 1 };
  }

  const body = bookingGoogleEventBody(booking);
  if (existingLink?.external_event_id) {
    const payload = await googleCalendarApiRequest(
      supabase,
      connection,
      `/calendars/${encodeURIComponent(exportCalendarId)}/events/${encodeURIComponent(existingLink.external_event_id)}`,
      { method: 'PUT', body }
    );
    await supabase
      .from('operator_calendar_event_links')
      .update({
        last_local_fingerprint: fingerprint,
        last_remote_updated_at: payload?.updated || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingLink.id);
    return { created: 0, updated: 1, deleted: 0, skipped: 0 };
  }

  const payload = await googleCalendarApiRequest(
    supabase,
    connection,
    `/calendars/${encodeURIComponent(exportCalendarId)}/events`,
    { method: 'POST', body }
  );
  const insertPayload = {
    tenant_id: connection.tenant_id,
    operator_id: connection.operator_id,
    connection_id: connection.id,
    booking_id: booking.id,
    external_calendar_id: exportCalendarId,
    external_event_id: payload?.id,
    sync_direction: 'export',
    last_local_fingerprint: fingerprint,
    last_remote_updated_at: payload?.updated || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('operator_calendar_event_links')
    .insert(insertPayload);
  if (error) throw error;

  return { created: 1, updated: 0, deleted: 0, skipped: 0 };
}

async function syncBookingsToGoogleCalendar({ supabase, connection, bookings }) {
  const totals = { created: 0, updated: 0, deleted: 0, skipped: 0 };
  const rows = Array.isArray(bookings) ? bookings : [];
  for (const booking of rows) {
    const result = await syncSingleBookingToGoogleCalendar({ supabase, connection, booking });
    totals.created += result.created;
    totals.updated += result.updated;
    totals.deleted += result.deleted;
    totals.skipped += result.skipped;
  }
  return totals;
}

async function acquireGoogleCalendarSyncLock(supabase, connection) {
  if (!connection?.id) return false;
  const lockUntil = connection.sync_lock_until ? new Date(connection.sync_lock_until) : null;
  if (lockUntil && !Number.isNaN(lockUntil.getTime()) && lockUntil.getTime() > Date.now()) {
    return false;
  }
  const { error } = await supabase
    .from('operator_calendar_connections')
    .update({
      sync_lock_until: new Date(Date.now() + SYNC_LOCK_MS).toISOString(),
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id);
  if (error) throw error;
  return true;
}

async function releaseGoogleCalendarSyncLock(supabase, connectionId, patch = {}) {
  if (!connectionId) return;
  await supabase
    .from('operator_calendar_connections')
    .update({
      sync_lock_until: null,
      updated_at: new Date().toISOString(),
      ...patch,
    })
    .eq('id', connectionId);
}

function sanitizeGoogleCalendarConnection(connection, calendars = []) {
  if (!connection) {
    return {
      connected: false,
      provider: 'google_calendar',
      selected_calendar_ids: [],
      export_calendar_id: '',
      export_bookings: false,
      consolidate_calendars: true,
      sync_mode: 'read_only',
      calendars: [],
      provider_user_email: '',
      last_synced_at: null,
      last_sync_error: null,
      sync_locked: false,
    };
  }
  const selectedCalendarIds = connectionSelectedCalendarIds(connection, calendars);
  return {
    connected: true,
    provider: 'google_calendar',
    provider_user_email: String(connection.provider_user_email || '').trim(),
    selected_calendar_ids: selectedCalendarIds,
    export_calendar_id: String(connection.export_calendar_id || '').trim(),
    export_bookings: connection.export_bookings === true,
    consolidate_calendars: connection.consolidate_calendars !== false,
    sync_mode: normalizeSyncMode(connection.sync_mode),
    calendars: calendars.map((calendar) =>
      mapGoogleCalendarRecord(calendar, selectedCalendarIds, String(connection.export_calendar_id || '').trim())
    ),
    last_synced_at: connection.last_synced_at || null,
    last_sync_error: connection.last_sync_error || null,
    sync_locked: !!(connection.sync_lock_until && new Date(connection.sync_lock_until).getTime() > Date.now()),
  };
}

async function upsertGoogleCalendarConnection(supabase, payload) {
  const insertPayload = {
    provider: 'google_calendar',
    consolidate_calendars: true,
    sync_mode: 'read_only',
    export_bookings: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...payload,
  };

  const { data: existing, error: existingError } = await supabase
    .from('operator_calendar_connections')
    .select('id')
    .eq('tenant_id', payload.tenant_id)
    .eq('operator_id', payload.operator_id)
    .eq('provider', 'google_calendar')
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const updatePayload = {
      ...insertPayload,
      updated_at: new Date().toISOString(),
    };
    delete updatePayload.created_at;
    const { data, error } = await supabase
      .from('operator_calendar_connections')
      .update(updatePayload)
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('operator_calendar_connections')
    .insert(insertPayload)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = {
  GOOGLE_SCOPES,
  isGoogleCalendarConfigured,
  googleCalendarRedirectUri,
  buildGoogleCalendarAuthUrl,
  verifyGoogleCalendarState,
  exchangeGoogleCalendarCode,
  getOperatorCalendarConnection,
  listGoogleCalendars,
  sanitizeGoogleCalendarConnection,
  normalizeCalendarSelection,
  normalizeSyncMode,
  connectionSelectedCalendarIds,
  fetchGoogleCalendarEvents,
  syncBookingsToGoogleCalendar,
  upsertGoogleCalendarConnection,
  acquireGoogleCalendarSyncLock,
  releaseGoogleCalendarSyncLock,
  bookingSyncFingerprint,
};
