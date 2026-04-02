"use strict";

const path = require("path");

describe("netlify/functions/utils/auth", () => {
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const supabasePkgPath = require.resolve("@supabase/supabase-js");

  function buildSupabase({ user, memberships, operator }) {
    return {
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
      },
      from: vi.fn((table) => {
        if (table === "operator_members") {
          const chain = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            order: vi.fn(async () => ({ data: memberships, error: null })),
          };
          return chain;
        }

        if (table === "operators") {
          const chain = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            maybeSingle: vi.fn(async () => ({ data: operator, error: null })),
          };
          return chain;
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };
  }

  function loadAuthModule({ user, memberships, operator }) {
    vi.resetModules();
    delete require.cache[authPath];
    delete require.cache[supabasePkgPath];
    process.env.SUPABASE_URL = "https://supabase.example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    require.cache[supabasePkgPath] = {
      id: supabasePkgPath,
      filename: supabasePkgPath,
      loaded: true,
      exports: {
        createClient: vi.fn(() => buildSupabase({ user, memberships, operator })),
      },
    };

    return require(authPath);
  }

  test("requireAdminContext rejects tenant-scoped owners", async () => {
    const auth = loadAuthModule({
      user: { id: "user_owner", email: "owner@example.com" },
      memberships: [
        {
          operator_id: "op_owner",
          tenant_id: "tenant_a",
          role: "owner",
          operators: {
            id: "op_owner",
            email: "owner@example.com",
            role: "admin",
            tenant_id: "tenant_a",
          },
        },
      ],
      operator: {
        id: "op_owner",
        email: "owner@example.com",
        role: "admin",
        tenant_id: "tenant_a",
      },
    });

    await expect(
      auth.requireAdminContext({
        headers: { Authorization: "Bearer token_owner" },
      })
    ).rejects.toMatchObject({ statusCode: 403, message: "Forbidden: admin role required" });
  });

  test("requireTenantAdminContext allows tenant-scoped owners for their own tenant", async () => {
    const auth = loadAuthModule({
      user: { id: "user_owner", email: "owner@example.com" },
      memberships: [
        {
          operator_id: "op_owner",
          tenant_id: "tenant_a",
          role: "owner",
          operators: {
            id: "op_owner",
            email: "owner@example.com",
            role: "admin",
            tenant_id: "tenant_a",
          },
        },
      ],
      operator: {
        id: "op_owner",
        email: "owner@example.com",
        role: "admin",
        tenant_id: "tenant_a",
      },
    });

    const ctx = await auth.requireTenantAdminContext(
      {
        headers: { Authorization: "Bearer token_owner" },
      },
      "tenant_a"
    );

    expect(ctx.role).toBe("owner");
    expect(ctx.operatorRole).toBe("admin");
    expect(ctx.tenantId).toBe("tenant_a");
  });

  test("requireOnboardingAdminContext preserves onboarding-specific denial messaging", async () => {
    const auth = loadAuthModule({
      user: { id: "user_staff", email: "staff@example.com" },
      memberships: [
        {
          operator_id: "op_staff",
          tenant_id: "tenant_a",
          role: "staff",
          operators: {
            id: "op_staff",
            email: "staff@example.com",
            role: "member",
            tenant_id: "tenant_a",
          },
        },
      ],
      operator: {
        id: "op_staff",
        email: "staff@example.com",
        role: "member",
        tenant_id: "tenant_a",
      },
    });

    await expect(
      auth.requireOnboardingAdminContext({
        headers: { Authorization: "Bearer token_staff" },
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: "Forbidden: onboarding admin role required",
    });
  });

  test("requireOnboardingAdminContext selects an eligible tenant-admin membership", async () => {
    const auth = loadAuthModule({
      user: { id: "user_multi", email: "multi@example.com" },
      memberships: [
        {
          operator_id: "op_staff",
          tenant_id: "tenant_b",
          role: "staff",
          operators: {
            id: "op_staff",
            email: "multi@example.com",
            role: "admin",
            tenant_id: "tenant_b",
          },
        },
        {
          operator_id: "op_owner",
          tenant_id: "tenant_a",
          role: "owner",
          operators: {
            id: "op_owner",
            email: "multi@example.com",
            role: "admin",
            tenant_id: "tenant_a",
          },
        },
      ],
      operator: {
        id: "op_owner",
        email: "multi@example.com",
        role: "admin",
        tenant_id: "tenant_a",
      },
    });

    const ctx = await auth.requireOnboardingAdminContext({
      headers: { Authorization: "Bearer token_multi" },
    });

    expect(ctx.operatorId).toBe("op_owner");
    expect(ctx.tenantId).toBe("tenant_a");
    expect(ctx.role).toBe("owner");
  });

  test("requireAdminContext still allows platform admins when the requested tenant differs from memberships", async () => {
    const auth = loadAuthModule({
      user: { id: "user_platform", email: "platform@example.com" },
      memberships: [
        {
          operator_id: "op_platform",
          tenant_id: "tenant_home",
          role: "owner",
          operators: {
            id: "op_platform",
            email: "platform@example.com",
            role: "platform_admin",
            tenant_id: "tenant_home",
          },
        },
      ],
      operator: {
        id: "op_platform",
        email: "platform@example.com",
        role: "platform_admin",
        tenant_id: "tenant_home",
      },
    });

    const ctx = await auth.requireAdminContext(
      {
        headers: { Authorization: "Bearer token_platform" },
      },
      "tenant_other"
    );

    expect(ctx.role).toBe("platform_admin");
    expect(ctx.operatorId).toBe("op_platform");
  });
});
