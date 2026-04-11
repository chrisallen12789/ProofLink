'use strict';

const path = require('path');

const handlerPath = path.resolve(process.cwd(), 'netlify/functions/stripe-billing-webhook.js');
const helperPath = path.resolve(process.cwd(), 'netlify/functions/_prooflink_payments.js');

function loadHandlerWithMocks(helperExports) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [helperPath, require.cache[helperPath]],
  ]);

  require.cache[helperPath] = {
    id: helperPath,
    filename: helperPath,
    loaded: true,
    exports: helperExports,
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

describe('netlify/functions/stripe-billing-webhook', () => {
  test('returns a retired response in manual-payments mode', async () => {
    const { handler, restore } = loadHandlerWithMocks({
      json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      manualPaymentsOnlyMessage: () => 'Manual payments only',
    });

    try {
      const response = await handler({
        httpMethod: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id: 'evt_123' }),
      });

      expect(response.statusCode).toBe(410);
      expect(JSON.parse(response.body)).toEqual({
        ok: false,
        error: 'Manual payments only',
        code: 'manual_payments_only',
        retired: true,
      });
    } finally {
      restore();
    }
  });

  test('falls back to the default manual-payments message when the helper export is missing', async () => {
    const { handler, restore } = loadHandlerWithMocks({
      json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    });

    try {
      const response = await handler({
        httpMethod: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id: 'evt_123' }),
      });

      expect(response.statusCode).toBe(410);
      expect(JSON.parse(response.body)).toEqual(
        expect.objectContaining({
          ok: false,
          code: 'manual_payments_only',
          retired: true,
          error: expect.stringContaining('manual-payments mode'),
        })
      );
    } finally {
      restore();
    }
  });
});
