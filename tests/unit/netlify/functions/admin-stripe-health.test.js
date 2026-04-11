'use strict';

const path = require('path');

const handlerPath = path.resolve(process.cwd(), 'netlify/functions/admin-stripe-health.js');
const authPath = path.resolve(process.cwd(), 'netlify/functions/utils/auth.js');

function loadHandlerWithMocks({ supabase, authError = null }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      requireAdminContext: vi.fn(async () => {
        if (authError) throw authError;
        return { supabase };
      }),
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
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

describe('netlify/functions/admin-stripe-health', () => {
  test('returns a healthy manual-payments summary', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table !== 'tenants') throw new Error(`Unexpected table ${table}`);

        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn((column, value) => {
            if (column === 'payments_enabled' && value === true) {
              return Promise.resolve({ count: 4, error: null });
            }
            if (column === 'online_payments_enabled' && value === true) {
              return Promise.resolve({ count: 0, error: null });
            }
            throw new Error(`Unexpected eq(${column}, ${value})`);
          }),
        };

        return chain;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({ httpMethod: 'GET' });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.summary).toEqual(
        expect.objectContaining({
          ok: true,
          message: expect.stringContaining('manual-payments mode'),
        })
      );
      expect(body.stripe_key).toEqual(
        expect.objectContaining({
          ok: true,
          message: expect.stringContaining('intentionally disabled'),
        })
      );
      expect(body.connect).toEqual(
        expect.objectContaining({
          ok: true,
          count: 4,
          online_payments_enabled_count: 0,
          billing_customer_count: 0,
        })
      );
      expect(body.webhook).toEqual(
        expect.objectContaining({
          ok: true,
          platform_secret_present: false,
          billing_secret_present: false,
        })
      );
    } finally {
      restore();
    }
  });

  test('returns a degraded summary when tenant queries fail', async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table !== 'tenants') throw new Error(`Unexpected table ${table}`);

        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(async () => ({ count: 0, error: { message: 'query failed' } })),
        };

        return chain;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({ supabase });
    try {
      const response = await handler({ httpMethod: 'GET' });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.summary.ok).toBe(false);
      expect(body.connect.ok).toBe(true);
      expect(body.connect.count).toBe(0);
      expect(body.webhook.ok).toBe(true);
    } finally {
      restore();
    }
  });
});
