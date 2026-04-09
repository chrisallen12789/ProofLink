'use strict';

const path = require('path');

function result(data, error = null) {
  return Promise.resolve({ data, error });
}

describe('netlify/functions/manage-member-compensation', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/manage-member-compensation.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  function installMocks(adminSb) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireTenantAdminContext: vi.fn(async () => ({ tenantId: 'tenant_1' })),
        getAdminClient: () => adminSb,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
  }

  test('lists assignments and overrides for a member', async () => {
    const adminSb = {
      from: vi.fn((table) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              eq: vi.fn(() => result(table === 'member_compensation_assignments'
                ? [{ id: 'assignment_1', member_id: 'member_1', base_hourly_rate_cents: 4100 }]
                : [{ id: 'override_1', member_id: 'member_1', hourly_rate_cents: 4700 }]))
            })),
            then: undefined,
          })),
        })),
      })),
    };

    installMocks(adminSb);
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: { member_id: 'member_1' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.assignments[0].base_hourly_rate_cents).toBe(4100);
    expect(body.overrides[0].hourly_rate_cents).toBe(4700);
  });

  test('creates a member compensation assignment', async () => {
    const adminSb = {
      from: vi.fn(() => ({
        insert: vi.fn((payload) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(() => result({ id: 'assignment_1', ...payload })),
          })),
        })),
      })),
    };

    installMocks(adminSb);
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        entity: 'assignment',
        member_id: 'member_1',
        compensation_type: 'hourly',
        worker_label: 'Metal Trades',
        driver_label: 'Hydrovac Driver',
        base_hourly_rate_cents: 4100,
        is_union_member: true,
        effective_start_date: '2025-06-02',
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.record.tenant_id).toBe('tenant_1');
    expect(body.record.worker_label).toBe('Metal Trades');
  });
});
