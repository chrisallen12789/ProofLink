'use strict';

const path = require('path');

function createThenableQuery(result) {
  return {
    select() { return this; },
    eq() { return this; },
    lte() { return this; },
    gte() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

describe('netlify/functions/get-availability', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/get-availability.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');
  const rateLimitPath = path.resolve(process.cwd(), 'netlify/functions/utils/rate-limit.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[rateLimitPath];
  });

  function installMocks() {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        getAdminClient: () => ({
          from(table) {
            if (table === 'availability') {
              return createThenableQuery({
                data: {
                  timezone: 'America/Chicago',
                  lead_time_hours: 24,
                  max_orders_per_day: 6,
                  blackout_dates: ['2026-04-05'],
                  notes: 'Closed on major holidays.',
                },
                error: null,
              });
            }
            if (table === 'availability_blocks') {
              return createThenableQuery({
                data: [
                  {
                    id: 'block_1',
                    title: 'Team retreat',
                    starts_at: '2026-04-03T00:00:00.000Z',
                    ends_at: '2026-04-04T23:59:59.999Z',
                  },
                ],
                error: null,
              });
            }
            throw new Error(`Unexpected table: ${table}`);
          },
        }),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };

    require.cache[rateLimitPath] = {
      id: rateLimitPath,
      filename: rateLimitPath,
      loaded: true,
      exports: {
        checkRateLimit: vi.fn(() => ({ allowed: true })),
        rateLimitResponse: vi.fn((retryAfterMs) => ({ statusCode: 429, body: JSON.stringify({ retryAfterMs }) })),
        getClientIP: vi.fn(() => '127.0.0.1'),
      },
    };
  }

  test('returns a single-day unavailable response with range metadata', async () => {
    installMocks();
    const handler = require(handlerPath).handler;

    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: {
        tenant_id: 'tenant_1',
        date: '2026-04-03',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.available).toBe(false);
    expect(body.reason).toBe('Not available: Team retreat');
    expect(body.window).toEqual({
      start_date: '2026-04-03',
      end_date: '2026-04-03',
    });
    expect(body.days).toHaveLength(1);
    expect(body.timezone).toBe('America/Chicago');
  });

  test('returns daily availability for a requested range', async () => {
    installMocks();
    const handler = require(handlerPath).handler;

    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: {
        tenant_id: 'tenant_1',
        start_date: '2026-04-02',
        end_date: '2026-04-05',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary).toEqual({
      total_days: 4,
      available_days: 1,
      blocked_days: 3,
      first_available_date: '2026-04-02',
    });
    expect(body.days.map((day) => [day.date, day.available])).toEqual([
      ['2026-04-02', true],
      ['2026-04-03', false],
      ['2026-04-04', false],
      ['2026-04-05', false],
    ]);
    expect(body.days[3].is_blackout).toBe(true);
    expect(body.notes).toBe('Closed on major holidays.');
  });
});
