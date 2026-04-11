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

  test('returns training and maintenance breakdowns for pricing and CPA follow-through', async () => {
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
          data: [
            {
              id: 'entry_1',
              member_id: 'member_1',
              operator_id: 'user_1',
              duration_minutes: 120,
              billable: false,
              cost_cents: 6400,
              work_type: 'driver_training',
              training_type: 'driver_safety',
              cost_bucket: 'pricing_overhead',
              started_at: '2026-04-01T14:00:00.000Z',
            },
            {
              id: 'entry_2',
              member_id: 'member_1',
              operator_id: 'user_1',
              duration_minutes: 90,
              billable: false,
              cost_cents: 4800,
              work_type: 'maintenance',
              maintenance_type: 'capital_improvement',
              asset_category: 'vehicle',
              asset_label: 'Truck 12',
              cost_bucket: 'asset_basis_candidate',
              started_at: '2026-04-02T14:00:00.000Z',
            },
          ],
          error: null,
        },
        jobs: { data: [], error: null },
        member_compensation_assignments: { data: [], error: null },
        member_compensation_overrides: { data: [], error: null },
        labor_contract_classifications: { data: [], error: null },
        labor_contract_rate_periods: { data: [], error: null },
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
    expect(body.members[0].training_minutes).toBe(120);
    expect(body.members[0].maintenance_minutes).toBe(90);
    expect(body.members[0].pricing_overhead_cost_cents).toBe(6400);
    expect(body.members[0].asset_basis_candidate_cost_cents).toBe(4800);
    expect(body.members[0].entries[0].work_type_label).toBe('Driver training');
    expect(body.totals.training_minutes).toBe(120);
    expect(body.totals.maintenance_minutes).toBe(90);
    expect(body.totals.pricing_overhead_cost_cents).toBe(6400);
    expect(body.totals.asset_basis_candidate_cost_cents).toBe(4800);
  });
});
