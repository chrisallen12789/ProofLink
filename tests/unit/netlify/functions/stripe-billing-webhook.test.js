'use strict';

const path = require('path');

describe('netlify/functions/stripe-billing-webhook', () => {
  const handlerPath = path.resolve(process.cwd(), 'netlify/functions/stripe-billing-webhook.js');
  const supabasePkgPath = require.resolve('@supabase/supabase-js');
  const stripePkgPath = require.resolve('stripe');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[supabasePkgPath];
    delete require.cache[stripePkgPath];
    process.env.STRIPE_SECRET_KEY = 'sk_test_billing';
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_CONNECT_SECRET = 'whsec_legacy_connect';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  test('accepts the legacy connect webhook secret env name', async () => {
    const constructEvent = vi.fn(() => ({
      id: 'evt_billing_legacy',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: {
            tenant_id: 'tenant-123',
            target_plan: 'growth',
          },
        },
      },
    }));

    const insert = vi.fn(async () => ({ error: null }));
    const updateEq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: updateEq }));
    const from = vi.fn((table) => {
      if (table === 'processed_webhook_events') {
        return { insert };
      }
      if (table === 'tenants') {
        return { update };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    require.cache[stripePkgPath] = {
      id: stripePkgPath,
      filename: stripePkgPath,
      loaded: true,
      exports: class FakeStripe {
        constructor(secretKey) {
          this.secretKey = secretKey;
          this.webhooks = { constructEvent };
        }
      },
    };

    require.cache[supabasePkgPath] = {
      id: supabasePkgPath,
      filename: supabasePkgPath,
      loaded: true,
      exports: {
        createClient: vi.fn(() => ({ from })),
      },
    };

    const response = await require(handlerPath).handler({
      httpMethod: 'POST',
      headers: { 'stripe-signature': 'sig_test_legacy' },
      body: JSON.stringify({ ping: true }),
      isBase64Encoded: false,
    });

    expect(response.statusCode).toBe(200);
    expect(constructEvent).toHaveBeenCalledWith(
      JSON.stringify({ ping: true }),
      'sig_test_legacy',
      'whsec_legacy_connect'
    );
    expect(insert).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateEq).toHaveBeenCalledWith('id', 'tenant-123');
  });
});
