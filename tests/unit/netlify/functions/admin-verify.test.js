"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-verify.js");
const authUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

function createSupabaseMock({ user, operatorRow, upsertRow, updateSucceeds = true }) {
  const operatorTable = {
    select: vi.fn(() => operatorTable),
    eq: vi.fn(() => operatorTable),
    ilike: vi.fn(() => operatorTable),
    limit: vi.fn(() => operatorTable),
    maybeSingle: vi.fn(async () => ({ data: operatorRow, error: null })),
    upsert: vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: upsertRow, error: null }),
      }),
    })),
    update: vi.fn(() => ({
      eq: async () => ({ error: updateSucceeds ? null : new Error("update failed") }),
    })),
  };

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
    },
    from: vi.fn((table) => {
      if (table !== "operators") throw new Error(`Unexpected table: ${table}`);
      return operatorTable;
    }),
    operatorTable,
  };
}

function loadHandlerWithAuthMock(authMockExports) {
  const originalAuthModule = require.cache[authUtilsPath];
  const originalHandlerModule = require.cache[handlerPath];

  require.cache[authUtilsPath] = {
    id: authUtilsPath,
    filename: authUtilsPath,
    loaded: true,
    exports: authMockExports,
  };
  delete require.cache[handlerPath];

  const handler = require(handlerPath).handler;

  return {
    handler,
    restore() {
      delete require.cache[handlerPath];
      if (originalHandlerModule) {
        require.cache[handlerPath] = originalHandlerModule;
      }

      if (originalAuthModule) {
        require.cache[authUtilsPath] = originalAuthModule;
      } else {
        delete require.cache[authUtilsPath];
      }
    },
  };
}

describe("netlify/functions/admin-verify", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PLATFORM_ADMIN_UID;
    delete process.env.PLATFORM_ADMIN_BOOTSTRAP_ENABLED;
  });

  test("missing PLATFORM_ADMIN_UID does not grant admin access", async () => {
    const supabase = createSupabaseMock({
      user: { id: "uid_pltest_missing", email: "admin@example.com", user_metadata: {} },
      operatorRow: null,
      upsertRow: null,
    });

    const { handler, restore } = loadHandlerWithAuthMock({
      getAdminClient: () => supabase,
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    });

    try {
      const res = await handler({
        httpMethod: "GET",
        headers: { Authorization: "Bearer token_pltest" },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/platform admin role required/i);
      expect(supabase.operatorTable.upsert).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("valid configured admin bootstrap identity still works", async () => {
    process.env.PLATFORM_ADMIN_UID = "uid_pltest_bootstrap";
    process.env.PLATFORM_ADMIN_BOOTSTRAP_ENABLED = "true";

    const supabase = createSupabaseMock({
      user: {
        id: "uid_pltest_bootstrap",
        email: "bootstrap@example.com",
        user_metadata: { full_name: "Bootstrap Admin" },
      },
      operatorRow: null,
      upsertRow: {
        id: "op_pltest_bootstrap",
        email: "bootstrap@example.com",
        name: "Bootstrap Admin",
        role: "platform_admin",
      },
    });

    const { handler, restore } = loadHandlerWithAuthMock({
      getAdminClient: () => supabase,
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    });

    try {
      const res = await handler({
        httpMethod: "GET",
        headers: { Authorization: "Bearer token_pltest" },
      });

      const body = JSON.parse(res.body);
      expect(res.statusCode).toBe(200);
      expect(body.role).toBe("platform_admin");
      expect(body.email).toBe("bootstrap@example.com");
      expect(supabase.operatorTable.upsert).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
