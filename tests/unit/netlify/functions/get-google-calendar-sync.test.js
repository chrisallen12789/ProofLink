'use strict';

const path = require('path');

describe('netlify/functions/get-google-calendar-sync', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/get-google-calendar-sync.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');
  const googlePath = path.resolve(process.cwd(), 'netlify/functions/utils/google-calendar.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[googlePath];
  });

  function installMocks({ connection = null, calendars = [], configured = true } = {}) {
    const supabase = {};
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
        isGoogleCalendarConfigured: vi.fn(() => configured),
        getOperatorCalendarConnection: vi.fn(async () => connection),
        listGoogleCalendars: vi.fn(async () => calendars),
        sanitizeGoogleCalendarConnection: vi.fn((row, availableCalendars) => ({
          connected: !!row,
          calendars: availableCalendars,
          provider_user_email: row?.provider_user_email || '',
        })),
      },
    };
  }

  test('returns disconnected state when no Google connection exists', async () => {
    installMocks({ connection: null });
    const handler = require(handlerPath).handler;

    const response = await handler({ httpMethod: 'GET', headers: { Authorization: 'Bearer test' } });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.connection.connected).toBe(false);
  });

  test('returns calendars for a connected operator account', async () => {
    installMocks({
      connection: { id: 'conn_1', provider_user_email: 'ops@example.com' },
      calendars: [{ id: 'primary', summary: 'Primary calendar' }],
    });
    const handler = require(handlerPath).handler;

    const response = await handler({ httpMethod: 'GET', headers: { Authorization: 'Bearer test' } });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.connection.connected).toBe(true);
    expect(body.connection.calendars).toEqual([{ id: 'primary', summary: 'Primary calendar' }]);
  });
});
