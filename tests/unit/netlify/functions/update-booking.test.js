'use strict';

const path = require('path');

describe('netlify/functions/update-booking', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/update-booking.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');
  const emailPath = path.resolve(process.cwd(), 'netlify/functions/utils/email.js');
  const runtimeConfigPath = path.resolve(process.cwd(), 'netlify/functions/utils/runtime-config.js');
  const googlePath = path.resolve(process.cwd(), 'netlify/functions/utils/google-calendar.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[emailPath];
    delete require.cache[runtimeConfigPath];
    delete require.cache[googlePath];
  });

  function installMocks() {
    let updatedPayload = null;
    const bookingRow = {
      id: 'booking_1',
      tenant_id: 'tenant_1',
      customer_name: 'Chris',
      customer_email: 'chris@example.com',
      title: 'Hydrovac visit',
      starts_at: '2026-04-08T13:00:00.000Z',
      ends_at: '2026-04-08T14:00:00.000Z',
      confirmation_sent_at: null,
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'bookings') {
          return {
            update: vi.fn((payload) => {
              updatedPayload = payload;
              return {
                eq() { return this; },
                select() { return this; },
                maybeSingle: async () => ({ data: { ...bookingRow, ...payload }, error: null }),
                then: () => Promise.resolve(),
                catch: () => Promise.resolve(),
              };
            }),
          };
        }
        if (table === 'tenants') {
          return {
            select: () => ({
              eq() { return this; },
              maybeSingle: async () => ({ data: { business_name: 'ProofLink Test' }, error: null }),
            }),
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
        requireOperatorContext: vi.fn(async () => ({ supabase, tenantId: 'tenant_1', operatorId: 'operator_1' })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[emailPath] = {
      id: emailPath,
      filename: emailPath,
      loaded: true,
      exports: {
        sendEmail: vi.fn(async () => ({ id: 'email_1' })),
        templates: {
          bookingCancelled: vi.fn((payload) => payload),
          bookingConfirmation: vi.fn((payload) => payload),
        },
      },
    };
    require.cache[runtimeConfigPath] = {
      id: runtimeConfigPath,
      filename: runtimeConfigPath,
      loaded: true,
      exports: {
        getConfiguredSiteUrl: vi.fn(() => 'https://prooflink.test'),
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
          export_bookings: true,
          sync_mode: 'read_write',
          export_calendar_id: 'primary',
        })),
        syncBookingsToGoogleCalendar: vi.fn(async () => ({ created: 0, updated: 1, deleted: 0, skipped: 0 })),
      },
    };

    return { getUpdatedPayload: () => updatedPayload };
  }

  test('accepts assignment fields and notes vehicle in booking updates', async () => {
    const { getUpdatedPayload } = installMocks();
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'POST',
      headers: { Authorization: 'Bearer test' },
      body: JSON.stringify({
        id: 'booking_1',
        assigned_operator_id: 'member_2',
        notes_vehicle: 'Truck 7, stage at gate B',
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(getUpdatedPayload()).toMatchObject({
      assigned_operator_id: 'member_2',
      notes_vehicle: 'Truck 7, stage at gate B',
    });
  });
});
