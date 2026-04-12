'use strict';

const path = require('path');

describe('netlify/functions/manage-driver-qualifications', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/manage-driver-qualifications.js');
  const hydrovacPath = path.resolve(process.cwd(), 'netlify/functions/utils/hydrovac.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[hydrovacPath];
    delete require.cache[authPath];
  });

  function installMocks(adminSb) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[hydrovacPath] = {
      id: hydrovacPath,
      filename: hydrovacPath,
      loaded: true,
      exports: {
        asArray: (value) => Array.isArray(value) ? value : [],
        asBoolean: (value, fallback = false) => value == null ? fallback : Boolean(value),
        clean: (value) => String(value || '').trim(),
        daysUntil: () => null,
        parseJsonBody: (event) => JSON.parse(event.body || '{}'),
        requireHydrovacOperatorContext: vi.fn(async () => ({ tenantId: 'tenant_b', adminSb })),
      },
    };
  }

  test('compliance_summary hydrates operator member labels without relying on a relational select', async () => {
    const order = vi.fn(() => Promise.resolve({
      data: [{
        id: 'dq_1',
        tenant_id: 'tenant_b',
        member_id: 'member_1',
        cdl_state: 'MI',
      }],
      error: null,
    }));
    const qualificationsEq = vi.fn(() => ({ order }));
    const membersIn = vi.fn(async () => ({
      data: [{ id: 'member_1', name: 'PL Test Tenant B Crew', role: 'staff' }],
      error: null,
    }));
    const membersEq = vi.fn(() => ({ in: membersIn }));
    const adminSb = {
      from: vi.fn((table) => {
        if (table === 'driver_qualifications') {
          return { select: vi.fn(() => ({ eq: qualificationsEq })) };
        }
        if (table === 'operators') {
          return { select: vi.fn(() => ({ eq: membersEq })) };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    installMocks(adminSb);
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: { action: 'compliance_summary' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.drivers).toHaveLength(1);
    expect(body.drivers[0].operator_members).toEqual(
      expect.objectContaining({
        id: 'member_1',
        display_name: 'PL Test Tenant B Crew',
        role_title: 'staff',
      })
    );
    expect(adminSb.from).toHaveBeenCalledWith('driver_qualifications');
    expect(adminSb.from).toHaveBeenCalledWith('operators');
  });
});
