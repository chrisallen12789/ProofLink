'use strict';

const path = require('path');

function result(data, error = null) {
  return Promise.resolve({ data, error });
}

describe('netlify/functions/manage-labor-contracts', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/manage-labor-contracts.js');
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

  test('lists contracts with nested classifications and rate periods', async () => {
    const adminSb = {
      from: vi.fn((table) => {
        if (table === 'labor_contracts') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => result([{
                  id: 'contract_1',
                  tenant_id: 'tenant_1',
                  contract_name: 'Local 98 2025',
                }])),
              })),
            })),
          };
        }
        if (table === 'labor_contract_classifications') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => result([{
                  id: 'class_1',
                  tenant_id: 'tenant_1',
                  contract_id: 'contract_1',
                  classification_name: 'Metal Trades',
                }])),
              })),
            })),
          };
        }
        if (table === 'labor_contract_rate_periods') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => result([{
                  id: 'period_1',
                  tenant_id: 'tenant_1',
                  classification_id: 'class_1',
                  base_hourly_rate_cents: 4100,
                }])),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    installMocks(adminSb);
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: {},
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.contracts).toHaveLength(1);
    expect(body.contracts[0].classifications[0].rate_periods[0].base_hourly_rate_cents).toBe(4100);
  });

  test('creates a labor contract for the tenant', async () => {
    const adminSb = {
      from: vi.fn(() => ({
        insert: vi.fn((payload) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(() => result({ id: 'contract_1', ...payload })),
          })),
        })),
      })),
    };

    installMocks(adminSb);
    const handler = require(handlerPath).handler;

    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        entity: 'contract',
        contract_name: 'Local 98 2025',
        union_name: 'UA Local 98',
        union_local_number: '98',
        effective_start_date: '2025-06-02',
      }),
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.record.tenant_id).toBe('tenant_1');
    expect(body.record.contract_name).toBe('Local 98 2025');
  });
});
