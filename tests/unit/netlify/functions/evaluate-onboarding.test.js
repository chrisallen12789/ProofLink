"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/evaluate-onboarding.js");
const supabasePkgPath = require.resolve("@supabase/supabase-js");

function createSupabaseMock() {
  const requestRow = {
    id: "req_pltest_approved",
    owner_email: "owner@pltest-example.com",
    business_name: "pltest-window-cleaning",
    business_slug: "pltest-window-cleaning",
    business_type: "services",
    business_description: "Window cleaning",
    description: "Window cleaning",
  };

  function query(table) {
    const state = {
      table,
      selectValue: null,
      eqFilters: [],
      neqFilters: [],
      notFilter: null,
    };

    const builder = {
      select(value) {
        state.selectValue = value;
        return builder;
      },
      eq(column, value) {
        state.eqFilters.push([column, value]);
        return builder;
      },
      neq(column, value) {
        state.neqFilters.push([column, value]);
        return builder;
      },
      not(column, operator, value) {
        state.notFilter = [column, operator, value];
        return builder;
      },
      maybeSingle: vi.fn(async () => {
        if (table === "tenants") return { data: null, error: null };
        if (table === "onboarding_requests") return { data: null, error: null };
        if (table === "pl_reserved_slugs") return { data: null, error: null };
        return { data: null, error: null };
      }),
      single: vi.fn(async () => {
        if (table === "onboarding_requests" || table === "tenant_onboarding_requests") return { data: requestRow, error: null };
        return { data: null, error: new Error(`Unexpected single() table: ${table}`) };
      }),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
      then(resolve, reject) {
        let result;
        if (table === "pl_banned_keywords" || table === "pl_protected_brands" || table === "pl_prohibited_categories") {
          result = { data: [], error: null };
        } else if (table === "profiles") {
          result = { data: null, error: null };
        } else {
          result = { data: [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };

    return builder;
  }

  return {
    from: vi.fn((table) => query(table)),
  };
}

function loadHandlerWithSupabaseMock(createClient) {
  const originalSupabaseModule = require.cache[supabasePkgPath];
  const originalHandlerModule = require.cache[handlerPath];

  require.cache[supabasePkgPath] = {
    id: supabasePkgPath,
    filename: supabasePkgPath,
    loaded: true,
    exports: { createClient },
  };
  delete require.cache[handlerPath];

  return {
    handler: require(handlerPath).handler,
    restore() {
      delete require.cache[handlerPath];
      if (originalHandlerModule) {
        require.cache[handlerPath] = originalHandlerModule;
      }
      if (originalSupabaseModule) {
        require.cache[supabasePkgPath] = originalSupabaseModule;
      } else {
        delete require.cache[supabasePkgPath];
      }
    },
  };
}

describe("netlify/functions/evaluate-onboarding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
    process.env.SUPABASE_URL = "https://pltest.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_pltest";
    process.env.INTERNAL_SECRET = "internal_pltest";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("approved evaluations fail closed when site URL configuration is missing", async () => {
    const supabase = createSupabaseMock();
    const { handler, restore } = loadHandlerWithSupabaseMock(() => supabase);

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: { "x-prooflink-internal": "internal_pltest" },
        body: JSON.stringify({ request_id: "req_pltest_approved" }),
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toBe("configuration_error");
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
