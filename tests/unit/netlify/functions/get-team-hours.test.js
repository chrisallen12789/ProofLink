'use strict';

const path = require('path');

function createChain(result) {
  return {
    select() { return this; },
    eq() { return this; },
    gte() { return this; },
    lte() { return this; },
    not() { return this; },
    order() { return Promise.resolve(result); },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

describe('netlify/functions/get-team-hours', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/get-team-hours.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  function installMocks({ tables }) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireOperatorContext: vi.fn(async () => ({
          tenantId: 'tenant_1',
          operatorId: 'operator_1',
          supabase: {
            from(table) {
              if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
              return createChain(tables[table]);
            },
          },
        })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
  }

  test('uses compensation tables to enforce the union floor in estimated pay', async () => {
    installMocks({
      tables: {
        operator_members: {
          data: [{
            id: 'member_1',
            user_id: 'user_1',
            name: 'Driver One',
            role: 'member',
            hourly_rate_cents: 3200,
            email: 'driver@example.com',
          }],
          error: null,
        },
        time_entries: {
          data: [{
            id: 'entry_1',
            operator_id: 'user_1',
            duration_minutes: 120,
            billable: true,
            started_at: '2026-04-01T14:00:00.000Z',
          }],
          error: null,
        },
        jobs: {
          data: [],
          error: null,
        },
        member_compensation_assignments: {
          data: [{
            id: 'assignment_1',
            tenant_id: 'tenant_1',
            member_id: 'member_1',
            compensation_type: 'hourly',
            base_hourly_rate_cents: 3200,
            union_classification_id: 'class_1',
            is_union_member: true,
            effective_start_date: '2026-01-01',
          }],
          error: null,
        },
        member_compensation_overrides: {
          data: [],
          error: null,
        },
        labor_contract_classifications: {
          data: [{
            id: 'class_1',
            tenant_id: 'tenant_1',
            union_local_name: 'UA Local 98',
            union_local_number: '98',
            classification_name: 'Metal Trades',
          }],
          error: null,
        },
        labor_contract_rate_periods: {
          data: [{
            id: 'period_1',
            tenant_id: 'tenant_1',
            classification_id: 'class_1',
            base_hourly_rate_cents: 4100,
            effective_start_date: '2026-01-01',
          }],
          error: null,
        },
      },
    });

    const handler = require(handlerPath).handler;
    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: {
        start: '2026-04-01',
        end: '2026-04-30',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.members[0].effective_rate_cents).toBe(4100);
    expect(body.members[0].estimated_pay_cents).toBe(8200);
    expect(body.members[0].compensation.trace.contract_floor_cents).toBe(4100);
    expect(body.members[0].compensation.source).toBe('contract_floor');
  });

  test('falls back cleanly when the compensation tables do not exist yet', async () => {
    installMocks({
      tables: {
        operator_members: {
          data: [{
            id: 'member_1',
            user_id: 'user_1',
            name: 'Driver One',
            role: 'member',
            hourly_rate_cents: 3200,
            email: 'driver@example.com',
          }],
          error: null,
        },
        time_entries: {
          data: [{
            id: 'entry_1',
            operator_id: 'user_1',
            duration_minutes: 60,
            billable: true,
            started_at: '2026-04-01T14:00:00.000Z',
          }],
          error: null,
        },
        jobs: { data: [], error: null },
        member_compensation_assignments: {
          data: null,
          error: { code: 'PGRST205', message: "Could not find the table 'public.member_compensation_assignments' in the schema cache" },
        },
        member_compensation_overrides: {
          data: null,
          error: { code: 'PGRST205', message: "Could not find the table 'public.member_compensation_overrides' in the schema cache" },
        },
        labor_contract_classifications: {
          data: null,
          error: { code: 'PGRST205', message: "Could not find the table 'public.labor_contract_classifications' in the schema cache" },
        },
        labor_contract_rate_periods: {
          data: null,
          error: { code: 'PGRST205', message: "Could not find the table 'public.labor_contract_rate_periods' in the schema cache" },
        },
      },
    });

    const handler = require(handlerPath).handler;
    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: {
        start: '2026-04-01',
        end: '2026-04-30',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.members[0].effective_rate_cents).toBe(3200);
    expect(body.members[0].estimated_pay_cents).toBe(3200);
    expect(body.members[0].compensation.source).toBe('member_fallback');
  });
});
