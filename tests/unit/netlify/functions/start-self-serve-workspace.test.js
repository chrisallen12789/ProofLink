"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/start-self-serve-workspace.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");
const runtimeConfigPath = path.resolve(process.cwd(), "netlify/functions/utils/runtime-config.js");
const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");
const paymentsPath = path.resolve(process.cwd(), "netlify/functions/_prooflink_payments.js");
const provisionPath = path.resolve(process.cwd(), "netlify/functions/lib/provision-tenant-bundle.js");

function loadHandlerWithMocks({
  authExports,
  emailExports,
  runtimeConfigExports,
  rateLimitExports,
  paymentsExports,
  provisionExports,
}) {
  const originals = new Map([
    [authPath, require.cache[authPath]],
    [emailPath, require.cache[emailPath]],
    [runtimeConfigPath, require.cache[runtimeConfigPath]],
    [rateLimitPath, require.cache[rateLimitPath]],
    [paymentsPath, require.cache[paymentsPath]],
    [provisionPath, require.cache[provisionPath]],
    [handlerPath, require.cache[handlerPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: authExports,
  };
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: emailExports,
  };
  require.cache[runtimeConfigPath] = {
    id: runtimeConfigPath,
    filename: runtimeConfigPath,
    loaded: true,
    exports: runtimeConfigExports,
  };
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: rateLimitExports,
  };
  require.cache[paymentsPath] = {
    id: paymentsPath,
    filename: paymentsPath,
    loaded: true,
    exports: paymentsExports,
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

function makeSupabaseTableChain(result = { data: null, error: null }) {
  const chain = {
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    single: vi.fn(async () => result),
  };
  return chain;
}

describe("netlify/functions/start-self-serve-workspace", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("falls back to direct provisioning when create_tenant_bundle is missing", async () => {
    const provisionTenantBundle = vi.fn().mockResolvedValue({
      tenant_id: "tenant_pltest_456",
      tenant_slug: "fallback-self-serve",
      operator_id: "operator_pltest_456",
    });

    const operatorMembersChain = makeSupabaseTableChain();
    const onboardingRequestsChain = makeSupabaseTableChain();
    const authAdmin = {
      listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      createUser: vi.fn(async () => ({ data: { user: { id: "auth_pltest_1" } }, error: null })),
      generateLink: vi.fn(async () => ({
        data: { properties: { action_link: "https://prooflink.test/magic" } },
        error: null,
      })),
    };
    const adminClient = {
      auth: { admin: authAdmin },
      from: vi.fn((table) => {
        if (table === "operator_members") return operatorMembersChain;
        if (table === "tenant_onboarding_requests") return onboardingRequestsChain;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        getAdminClient: vi.fn(() => adminClient),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: {
        sendEmail: vi.fn(() => Promise.resolve()),
        templates: {
          provisioned: vi.fn(() => ({ subject: "ready" })),
        },
      },
      runtimeConfigExports: {
        getConfiguredSiteUrl: vi.fn(() => "https://prooflink.test"),
      },
      rateLimitExports: {
        getClientIP: vi.fn(() => "127.0.0.1"),
        checkRateLimit: vi.fn(() => ({ allowed: true })),
        rateLimitResponse: vi.fn((retryAfterMs) => ({
          statusCode: 429,
          body: JSON.stringify({ error: `retry in ${retryAfterMs}` }),
        })),
      },
      paymentsExports: {
        supabaseAdmin: vi.fn(async () => {
          throw new Error('{"code":"PGRST202","message":"Could not find the function public.create_tenant_bundle"}');
        }),
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
        body: JSON.stringify({
          business_name: "Fallback Service Co",
          owner_name: "Chris Proof",
          owner_email: "owner@example.com",
          phone: "555-0101",
          business_type: "plumbing",
          city_state: "Detroit, MI",
          selected_plan: "starter",
        }),
      });

      expect(response.statusCode).toBe(201);
      expect(provisionTenantBundle).toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({
          business_name: "Fallback Service Co",
          owner_email: "owner@example.com",
          requested_subdomain: "fallback-service-co",
        }),
      }));
      expect(authAdmin.generateLink).toHaveBeenCalled();
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        mode: "self_serve",
        tenant_id: "tenant_pltest_456",
        tenant_slug: "fallback-self-serve",
        operator_id: "operator_pltest_456",
        login_url: "https://prooflink.test/magic",
      }));
    } finally {
      restore();
    }
  });
});
