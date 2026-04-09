'use strict';

const path = require('path');

function result(data, error = null) {
  return Promise.resolve({ data, error });
}

describe('netlify/functions/manage-operator-members', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/manage-operator-members.js');
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
        requireOperatorContext: vi.fn(async () => ({ tenantId: 'tenant_1' })),
        getAdminClient: () => adminSb,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
  }

  test('lists union and driver labeling fields for team members', async () => {
    const adminSb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => result([{
              id: 'member_1',
              worker_label: 'Metal Trades',
              driver_label: 'Hydrovac Driver',
              union_local_number: '98',
              union_classification_label: 'Metal Trades',
              is_union_member: true,
            }])),
          })),
        })),
      })),
    };

    installMocks(adminSb);
    const handler = require(handlerPath).handler;

    const response = await handler({ httpMethod: 'GET' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.members[0].driver_label).toBe('Hydrovac Driver');
    expect(body.members[0].union_local_number).toBe('98');
  });

  test('patch accepts compensation and union labeling fields', async () => {
    const adminSb = {
      from: vi.fn(() => ({
        update: vi.fn((payload) => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(() => result({ id: 'member_1', ...payload })),
              })),
            })),
          })),
        })),
      })),
    };

    installMocks(adminSb);
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'PATCH',
      body: JSON.stringify({
        id: 'member_1',
        worker_label: 'Metal Trades',
        driver_label: 'Hydrovac Driver',
        union_local_number: '98',
        union_classification_label: 'Metal Trades',
        is_union_member: true,
        compensation_type: 'hourly',
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.member.worker_label).toBe('Metal Trades');
    expect(body.member.driver_label).toBe('Hydrovac Driver');
    expect(body.member.compensation_type).toBe('hourly');
  });
});
