'use strict';

const path = require('path');

const handlerPath = path.resolve(process.cwd(), 'netlify/functions/stripe-order-checkout.js');
const paymentsPath = path.resolve(process.cwd(), 'netlify/functions/_prooflink_payments.js');
const rateLimitPath = path.resolve(process.cwd(), 'netlify/functions/utils/rate-limit.js');

function loadHandlerWithMocks({ paymentsExports, rateLimitExports }) {
  const originals = new Map([
    [paymentsPath, require.cache[paymentsPath]],
    [rateLimitPath, require.cache[rateLimitPath]],
    [handlerPath, require.cache[handlerPath]],
  ]);

  require.cache[paymentsPath] = {
    id: paymentsPath,
    filename: paymentsPath,
    loaded: true,
    exports: paymentsExports,
  };
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: rateLimitExports,
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

describe('netlify/functions/stripe-order-checkout', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('returns a manual-payments response for operator checkout attempts', async () => {
    const { handler, restore } = loadHandlerWithMocks({
      paymentsExports: {
        clean: (value) => String(value || '').trim(),
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        manualPaymentsOnlyMessage: () => 'Manual payments only',
        readJson: vi.fn(() => ({
          tenantId: 'tenant_123',
          orderId: 'order_123',
        })),
        requireOperatorContext: vi.fn(async () => ({
          operatorId: 'operator_123',
        })),
      },
      rateLimitExports: {
        checkRateLimit: vi.fn(() => ({ allowed: true })),
        rateLimitResponse: vi.fn(() => ({ statusCode: 429, body: JSON.stringify({ error: 'rate limited' }) })),
        getClientIP: vi.fn(() => '127.0.0.1'),
      },
    });

    try {
      const response = await handler({
        httpMethod: 'POST',
        headers: {
          authorization: 'Bearer token',
        },
        body: JSON.stringify({
          tenantId: 'tenant_123',
          orderId: 'order_123',
        }),
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toEqual({
        ok: false,
        error: 'Manual payments only',
        code: 'manual_payments_only',
        next_step: 'Send an invoice or collect payment offline.',
      });
    } finally {
      restore();
    }
  });
});
