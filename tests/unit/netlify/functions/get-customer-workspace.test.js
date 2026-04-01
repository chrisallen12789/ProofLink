'use strict';

const path = require('path');

function createQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    ilike: vi.fn(() => query),
    neq: vi.fn(() => query),
    in: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    order: vi.fn(async () => result),
  };
  return query;
}

describe('netlify/functions/get-customer-workspace', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/get-customer-workspace.js');
  const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');

  function loadHandler({ customer, assets, jobs, expenses, photos } = {}) {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];

    const auth = require(authPath);
    auth.respond = (statusCode, body) => ({
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const customersQuery = createQuery({ data: customer || { id: 'cust_1', name: 'Wayne State' }, error: null });
    const assetsQuery = createQuery({ data: assets || [], error: null });
    const jobsQuery = createQuery({ data: jobs || [], error: null });
    const expensesQuery = createQuery({ data: expenses || [], error: null });
    const photosQuery = createQuery({ data: photos || [], error: null });

    const supabase = {
      from: vi.fn((table) => {
        if (table === 'customers') return customersQuery;
        if (table === 'infrastructure_assets') return assetsQuery;
        if (table === 'jobs') return jobsQuery;
        if (table === 'expenses') return expensesQuery;
        if (table === 'job_photos') return photosQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    auth.requireOperatorContext = vi.fn(async () => ({
      supabase,
      tenantId: 'tenant_1',
    }));

    return {
      handler: require(handlerPath).handler,
      auth,
      queries: { customersQuery, assetsQuery, jobsQuery, expensesQuery, photosQuery },
    };
  }

  test('returns 400 when customer_id is missing', async () => {
    const { handler } = loadHandler();
    const response = await handler({ httpMethod: 'GET', queryStringParameters: {} });
    const payload = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(payload.error).toContain('customer_id');
  });

  test('returns customer workspace with jobs, expenses, photos and building summaries', async () => {
    const { handler } = loadHandler({
      assets: [
        { id: 'asset_1', customer_id: 'cust_1', asset_name: 'Pit A', address: 'Engineering Building', next_service_due_date: '2026-04-10' },
      ],
      jobs: [
        {
          id: 'job_1',
          customer_id: 'cust_1',
          asset_id: 'asset_1',
          title: 'Ejection pit cleanout',
          scheduled_date: '2026-03-15',
          completed_at: '2026-03-16',
          service_address: 'Engineering Building',
          status: 'completed',
        },
      ],
      expenses: [
        { id: 'exp_1', job_id: 'job_1', customer_id: 'cust_1', amount_cents: 15000, date: '2026-03-16' },
      ],
      photos: [
        { id: 'photo_1', job_id: 'job_1', url: 'https://example.com/photo.jpg', created_at: '2026-03-16T12:00:00Z' },
      ],
    });

    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: { customer_id: 'cust_1', building: 'Engineering' },
    });

    const payload = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(payload.customer.id).toBe('cust_1');
    expect(payload.jobs).toHaveLength(1);
    expect(payload.jobs[0].expense_total_cents).toBe(15000);
    expect(payload.jobs[0].photos).toHaveLength(1);
    expect(payload.summary.total_buildings).toBe(1);
    expect(payload.summary.total_expense_cents).toBe(15000);
    expect(payload.buildings[0].building_key).toContain('Engineering');
  });
});
