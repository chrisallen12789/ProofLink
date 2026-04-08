'use strict';

const path = require('path');

describe('netlify/functions/sync-google-calendar', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/sync-google-calendar.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');
  const googlePath = path.resolve(process.cwd(), 'netlify/functions/utils/google-calendar.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[googlePath];
  });

  function installMocks({ acquired = true } = {}) {
    const bookingsResult = [{ id: 'booking_1', title: 'Main visit', starts_at: '2026-04-08T13:00:00.000Z', ends_at: '2026-04-08T14:00:00.000Z' }];
    const bookingQuery = {
      eq() { return this; },
      gte() { return this; },
      lte() { return this; },
      limit() { return this; },
      then(resolve) {
        return Promise.resolve({ data: bookingsResult, error: null }).then(resolve);
      },
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'bookings') {
          return {
            select: vi.fn(() => bookingQuery),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireOperatorContext: vi.fn(async () => ({
          supabase,
          tenantId: 'tenant_1',
          operatorId: 'operator_1',
        })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };

    require.cache[googlePath] = {
      id: googlePath,
      filename: googlePath,
      loaded: true,
      exports: {
        isGoogleCalendarConfigured: vi.fn(() => true),
        getOperatorCalendarConnection: vi.fn(async () => ({
          id: 'conn_1',
          tenant_id: 'tenant_1',
          operator_id: 'operator_1',
          export_bookings: true,
          sync_mode: 'read_write',
          export_calendar_id: 'primary',
          selected_calendar_ids: ['primary'],
        })),
        listGoogleCalendars: vi.fn(async () => [{ id: 'primary', summary: 'Primary' }]),
        connectionSelectedCalendarIds: vi.fn(() => ['primary']),
        fetchGoogleCalendarEvents: vi.fn(async () => [{ id: 'primary:event_1', summary: 'Google event' }]),
        syncBookingsToGoogleCalendar: vi.fn(async () => ({ created: 1, updated: 0, deleted: 0, skipped: 0 })),
        acquireGoogleCalendarSyncLock: vi.fn(async () => acquired),
        releaseGoogleCalendarSyncLock: vi.fn(async () => {}),
        normalizeSyncMode: vi.fn((value) => value || 'read_only'),
      },
    };
  }

  test('returns 409 when a sync is already locked', async () => {
    installMocks({ acquired: false });
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'POST',
      headers: { Authorization: 'Bearer test' },
      body: JSON.stringify({ start: '2026-04-01', end: '2026-04-30' }),
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error).toContain('already running');
  });
});
