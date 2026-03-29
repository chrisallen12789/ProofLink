"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/create-tenant-bundle.js");
const paymentsPath = path.resolve(process.cwd(), "netlify/functions/_prooflink_payments.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const provisionPath = path.resolve(process.cwd(), "netlify/functions/lib/provision-tenant-bundle.js");

function loadHandlerWithMocks({ paymentsExports, authExports, provisionExports }) {
  const originals = new Map([
    [paymentsPath, require.cache[paymentsPath]],
    [authPath, require.cache[authPath]],
    [provisionPath, require.cache[provisionPath]],
    [handlerPath, require.cache[handlerPath]],
  ]);

  require.cache[paymentsPath] = {
    id: paymentsPath,
    filename: paymentsPath,
    loaded: true,
    exports: paymentsExports,
  };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: authExports,
  };
  require.cache[provisionPath] = {
    id: provisionPath,
    filename: provisionPath,
    loaded: true,
    exports: provisionExports,
  };
  delete require.cache[handlerPath];

  return {
    handler: require(handlerPath).handler,
    restore() {
      delete require.cache[handlerPath];
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
    },
  };
}

describe("netlify/functions/create-tenant-bundle", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("falls back to direct provisioning when the RPC signature is missing", async () => {
    const provisionTenantBundle = vi.fn().mockResolvedValue({
      tenant_id: "tenant_pltest_123",
      tenant_slug: "fallback-slug",
      operator_id: "operator_pltest_123",
      operator_slug: "",
    });

    const { handler, restore } = loadHandlerWithMocks({
      paymentsExports: {
        clean: (value) => String(value || "").trim(),
        ensureTenantApplicationFeeBps: vi.fn(async (tenant) => tenant),
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        readJson: () => ({
          business_name: "Fallback Plumbing",
          owner_name: "Chris Proof",
          email: "owner@example.com",
          phone: "555-0100",
          business_category: "plumbing",
        }),
        requireOperatorContext: vi.fn(async () => ({ operatorId: "admin_op_1" })),
        supabaseAdmin: vi.fn(async () => {
          throw new Error('{"code":"PGRST202","message":"Could not find the function public.create_tenant_bundle"}');
        }),
      },
      authExports: {
        getAdminClient: vi.fn(() => ({ from: vi.fn() })),
      },
      provisionExports: {
        isMissingCreateTenantBundleRpcError: vi.fn(() => true),
        provisionTenantBundle,
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        headers: {},
        body: "{}",
      });

      expect(response.statusCode).toBe(200);
      expect(provisionTenantBundle).toHaveBeenCalledWith(expect.objectContaining({
        invitedByOperatorId: "admin_op_1",
        payload: expect.objectContaining({
          owner_email: "owner@example.com",
          business_type: "plumbing",
        }),
      }));
      expect(JSON.parse(response.body)).toEqual({
        ok: true,
        result: {
          tenant_id: "tenant_pltest_123",
          tenant_slug: "fallback-slug",
          operator_id: "operator_pltest_123",
          operator_slug: "",
        },
      });
    } finally {
      restore();
    }
  });
});
