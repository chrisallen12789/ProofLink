'use strict';

const path = require('path');

function createInsertChain(result) {
  return {
    insert(payload) {
      this.payload = payload;
      return this;
    },
    select() { return this; },
    maybeSingle() {
      return Promise.resolve(result(this.payload));
    },
  };
}

function createLookupChain(result) {
  return {
    select() { return this; },
    eq() { return this; },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
}

describe('netlify/functions/log-time-entry', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/log-time-entry.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  function installMocks({ insertResult, memberLookupResult }) {
    const payloads = [];
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireOperatorContext: vi.fn(async () => ({
          tenantId: 'tenant_1',
          operatorId: 'operator_1',
          user: { id: 'user_current', email: 'owner@example.com' },
          supabase: {
            from(table) {
              if (table === 'time_entries') {
                return createInsertChain((payload) => {
                  payloads.push(payload);
                  return insertResult || { data: { id: 'entry_1', ...payload }, error: null };
                });
              }
              if (table === 'operator_members') {
                return createLookupChain(memberLookupResult || {
                  data: {
                    id: 'member_1',
                    user_id: 'user_driver',
                    tenant_id: 'tenant_1',
                    is_active: true,
                  },
                  error: null,
                });
              }
              throw new Error(`Unexpected table ${table}`);
            },
          },
        })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    return { payloads };
  }

  test('logs driver training against the selected team member with pricing overhead defaults', async () => {
    const { payloads } = installMocks({});
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        member_id: 'member_1',
        description: 'Driver safety orientation',
        started_at: '2026-04-11T13:00:00.000Z',
        duration_minutes: 120,
        hourly_rate_cents: 4200,
        work_type: 'driver_training',
        training_type: 'driver_safety',
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(payloads[0].member_id).toBe('member_1');
    expect(payloads[0].operator_id).toBe('user_driver');
    expect(payloads[0].billable).toBe(false);
    expect(payloads[0].work_type).toBe('driver_training');
    expect(payloads[0].training_type).toBe('driver_safety');
    expect(payloads[0].cost_bucket).toBe('pricing_overhead');
    expect(payloads[0].cost_cents).toBe(8400);
    expect(payloads[0].amount_cents).toBe(0);
  });

  test('logs capital maintenance as an asset basis candidate', async () => {
    const { payloads } = installMocks({});
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        member_id: 'member_1',
        description: 'Pump upgrade on Truck 12',
        started_at: '2026-04-11T13:00:00.000Z',
        duration_minutes: 90,
        hourly_rate_cents: 5000,
        work_type: 'maintenance',
        maintenance_type: 'capital_improvement',
        asset_category: 'vehicle',
        asset_label: 'Truck 12',
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(payloads[0].maintenance_type).toBe('capital_improvement');
    expect(payloads[0].asset_category).toBe('vehicle');
    expect(payloads[0].asset_label).toBe('Truck 12');
    expect(payloads[0].cost_bucket).toBe('asset_basis_candidate');
    expect(payloads[0].cost_cents).toBe(7500);
  });
});
