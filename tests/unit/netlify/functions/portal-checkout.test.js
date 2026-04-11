'use strict';

const path = require('path');

const handlerPath = path.resolve(process.cwd(), 'netlify/functions/portal-checkout.js');
const authUtilsPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');
const rateLimitPath = path.resolve(process.cwd(), 'netlify/functions/utils/rate-limit.js');
const paymentsPath = path.resolve(process.cwd(), 'netlify/functions/_prooflink_payments.js');

function loadHandlerWithMocks({ authMockExports, rateLimitMockExports, paymentsMockExports }) {
  const originals = new Map([
    [authUtilsPath, require.cache[authUtilsPath]],
    [rateLimitPath, require.cache[rateLimitPath]],
    [paymentsPath, require.cache[paymentsPath]],
    [handlerPath, require.cache[handlerPath]],
  ]);

  require.cache[authUtilsPath] = {
    id: authUtilsPath,
    filename: authUtilsPath,
    loaded: true,
    exports: authMockExports,
  };
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: rateLimitMockExports,
  };
  require.cache[paymentsPath] = {
    id: paymentsPath,
    filename: paymentsPath,
    loaded: true,
    exports: paymentsMockExports,
  };
  delete require.cache[handlerPath];

  return {
    handler: require(handlerPath).handler,
    restore() {
      delete require.cache[handlerPath];
      for (const [modulePath, original] of originals.entries()) {
        if (original) require.cache[modulePath] = original;
        else delete require.cache[modulePath];
      }
    },
  };
}

function createQueryChain(result) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(async () => result),
  };
  return chain;
}

describe('netlify/functions/portal-checkout', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('returns manual payment help with the explicit amount due', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'orders') {
          return createQueryChain({
            data: [{
              id: 'order_123',
              tenant_id: 'tenant_123',
              email: 'customer@example.com',
              total_cents: 45000,
              amount_paid_cents: 5000,
              amount_due_cents: 12500,
              status: 'confirmed',
              cart_summary: 'Hydrovac daylighting',
            }],
            error: null,
          });
        }
        if (table === 'tenants') {
          return createQueryChain({
            data: [{
              id: 'tenant_123',
              business_name: 'ProofLink Hydro',
              owner_email: 'office@example.com',
            }],
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      authMockExports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      rateLimitMockExports: {
        checkRateLimit: () => ({ allowed: true }),
        rateLimitResponse: () => ({ statusCode: 429, body: JSON.stringify({ error: 'rate limited' }) }),
        getClientIP: () => '127.0.0.1',
      },
      paymentsMockExports: {
        manualPaymentsOnlyMessage: () => 'Manual payments only',
      },
    });

    try {
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: {
          order_id: 'order_123',
          email: 'customer@example.com',
        },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({
        ok: false,
        error: 'Manual payments only',
        contact_needed: true,
        code: 'manual_payments_only',
        payment_help: {
          business_name: 'ProofLink Hydro',
          contact_email: 'office@example.com',
          order_id: 'order_123',
          amount_due_cents: 12500,
        },
      });
    } finally {
      restore();
    }
  });

  test('falls back to a default manual mode message when the helper export is missing', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'orders') {
          return createQueryChain({
            data: [{
              id: 'order_123',
              tenant_id: 'tenant_123',
              email: 'customer@example.com',
              total_cents: 10000,
              amount_paid_cents: 0,
              amount_due_cents: 10000,
              status: 'confirmed',
              cart_summary: 'Drain cleaning',
            }],
            error: null,
          });
        }
        if (table === 'tenants') {
          return createQueryChain({
            data: [{
              id: 'tenant_123',
              business_name: 'ProofLink Hydro',
              owner_email: 'office@example.com',
            }],
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      authMockExports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      rateLimitMockExports: {
        checkRateLimit: () => ({ allowed: true }),
        rateLimitResponse: () => ({ statusCode: 429, body: JSON.stringify({ error: 'rate limited' }) }),
        getClientIP: () => '127.0.0.1',
      },
      paymentsMockExports: {},
    });

    try {
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: {
          order_id: 'order_123',
          email: 'customer@example.com',
        },
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual(
        expect.objectContaining({
          ok: false,
          code: 'manual_payments_only',
          contact_needed: true,
          error: expect.stringContaining('manual-payments mode'),
        })
      );
    } finally {
      restore();
    }
  });

  test('blocks terminal orders before payment help is shown', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === 'orders') {
          return createQueryChain({
            data: [{
              id: 'order_789',
              tenant_id: 'tenant_123',
              email: 'customer@example.com',
              total_cents: 10000,
              amount_paid_cents: 10000,
              amount_due_cents: 0,
              status: 'paid',
            }],
            error: null,
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      authMockExports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      rateLimitMockExports: {
        checkRateLimit: () => ({ allowed: true }),
        rateLimitResponse: () => ({ statusCode: 429, body: JSON.stringify({ error: 'rate limited' }) }),
        getClientIP: () => '127.0.0.1',
      },
      paymentsMockExports: {
        manualPaymentsOnlyMessage: () => 'Manual payments only',
      },
    });

    try {
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: {
          order_id: 'order_789',
          email: 'customer@example.com',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual(
        expect.objectContaining({
          ok: false,
          error: 'This order has already been paid in full.',
          status: 'paid',
        })
      );
    } finally {
      restore();
    }
  });
});
