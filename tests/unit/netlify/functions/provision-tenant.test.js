"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/provision-tenant.js");
const authUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const emailUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");
const slugifyPath = path.resolve(process.cwd(), "netlify/functions/utils/slugify.js");
const seedTemplatesPath = path.resolve(process.cwd(), "netlify/functions/lib/seed-templates.js");
const authLinksPath = path.resolve(process.cwd(), "netlify/functions/utils/auth-links.js");

function makeInsertSingle(data, error = null) {
  return {
    select() { return this; },
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
}

function loadHandlerWithMocks({ authExports, emailExports, slugifyExports, seedTemplateExports, authLinksExports }) {
  const originals = new Map([
    [authUtilsPath, require.cache[authUtilsPath]],
    [emailUtilsPath, require.cache[emailUtilsPath]],
    [slugifyPath, require.cache[slugifyPath]],
    [seedTemplatesPath, require.cache[seedTemplatesPath]],
    [authLinksPath, require.cache[authLinksPath]],
    [handlerPath, require.cache[handlerPath]],
  ]);

  require.cache[authUtilsPath] = {
    id: authUtilsPath,
    filename: authUtilsPath,
    loaded: true,
    exports: authExports,
  };
  require.cache[emailUtilsPath] = {
    id: emailUtilsPath,
    filename: emailUtilsPath,
    loaded: true,
    exports: emailExports,
  };
  require.cache[slugifyPath] = {
    id: slugifyPath,
    filename: slugifyPath,
    loaded: true,
    exports: slugifyExports,
  };
  require.cache[seedTemplatesPath] = {
    id: seedTemplatesPath,
    filename: seedTemplatesPath,
    loaded: true,
    exports: seedTemplateExports,
  };
  require.cache[authLinksPath] = {
    id: authLinksPath,
    filename: authLinksPath,
    loaded: true,
    exports: authLinksExports,
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

function createSupabaseMock({
  existingOperator = null,
  existingTenant = null,
  onboardingStatus = "approved",
  listUsersError = null,
  listUsers = [],
  authCreateError = null,
  tenantInsertError = null,
  tenantInsertData = { id: "tenant_pltest", slug: "prooflink-test", name: "ProofLink Test" },
  operatorInsertError = null,
  operatorInsertData = { id: "operator_pltest", tenant_id: "tenant_pltest", name: "Owner", role: "tenant_owner" },
  operatorMembersUpsertError = null,
  tenantRollbackError = null,
  provisionFailureInsertError = null,
} = {}) {
  const tenantsInsert = vi.fn(() => makeInsertSingle(tenantInsertData, tenantInsertError));
  const tenantsDelete = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: tenantRollbackError })),
  }));
  const operatorsSelect = vi.fn(() => ({
    ilike: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({ data: existingOperator, error: null })),
    })),
  }));
  const operatorsInsert = vi.fn(() => makeInsertSingle(operatorInsertData, operatorInsertError));
  const operatorsDelete = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));
  const operatorMembersUpsert = vi.fn(async () => ({ error: operatorMembersUpsertError }));
  const operatorMembersUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  }));
  const operatorMembersDelete = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));
  const onboardingSelect = vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "req_pltest",
          status: onboardingStatus,
          business_name: "ProofLink Test",
          business_slug: "prooflink-test",
          owner_email: "owner@example.com",
          owner_name: "Owner Example",
          selected_plan: "starter",
        },
        error: null,
      })),
    })),
  }));
  const onboardingUpdate = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));
  const provisionFailuresInsert = vi.fn(async () => ({ error: provisionFailureInsertError }));

  const supabase = {
    from: vi.fn((table) => {
      if (table === "tenant_onboarding_requests") {
        return {
          select: onboardingSelect,
          update: onboardingUpdate,
        };
      }
      if (table === "tenants") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: existingTenant, error: null })),
            })),
          })),
          insert: tenantsInsert,
          delete: tenantsDelete,
        };
      }
      if (table === "operators") {
        return {
          select: operatorsSelect,
          insert: operatorsInsert,
          delete: operatorsDelete,
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: existingOperator, error: null })),
              })),
            })),
          })),
        };
      }
      if (table === "operator_members") {
        return {
          upsert: operatorMembersUpsert,
          update: operatorMembersUpdate,
          delete: operatorMembersDelete,
        };
      }
      if (table === "provision_failures") {
        return {
          insert: provisionFailuresInsert,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    auth: {
      admin: {
        createUser: vi.fn(async () => ({ data: null, error: authCreateError })),
        listUsers: vi.fn(async () => ({ data: { users: listUsers }, error: listUsersError })),
        deleteUser: vi.fn(async () => ({ data: null, error: null })),
      },
    },
    _calls: {
      tenantsInsert,
      tenantsDelete,
      operatorsInsert,
      operatorsDelete,
      operatorMembersUpsert,
      operatorMembersDelete,
      provisionFailuresInsert,
      onboardingUpdate,
    },
  };

  return supabase;
}

describe("netlify/functions/provision-tenant", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
  });

  test("fails closed when site URL configuration is missing", async () => {
    const supabase = { from: vi.fn(), auth: { admin: {} } };
    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn() } },
      slugifyExports: { uniqueTenantSlug: vi.fn() },
      seedTemplateExports: { seedTemplateForTenant: vi.fn() },
      authLinksExports: { buildPasswordSetupUrl: vi.fn() },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest_missing_url" }),
      });

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toBe("configuration_error");
      expect(supabase.from).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("fails provisioning when auth user creation cannot be resolved", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      authCreateError: { message: "Auth create failed" },
      listUsers: [],
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain("Auth user creation failed");
      expect(supabase._calls.operatorMembersDelete).toHaveBeenCalled();
      expect(supabase._calls.tenantsDelete).toHaveBeenCalled();
      expect(supabase._calls.operatorsDelete).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("records rollback failures for admin follow-up when cleanup cannot finish cleanly", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      authCreateError: { message: "Auth create failed" },
      listUsers: [],
      tenantRollbackError: { message: "tenant delete blocked" },
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(500);
      expect(supabase._calls.provisionFailuresInsert).toHaveBeenCalledWith(expect.objectContaining({
        onboarding_request_id: "req_pltest",
        tenant_id: "tenant_pltest",
        owner_email: "owner@example.com",
        failure_stage: "rollback",
        rollback_issues: expect.arrayContaining(["Tenant rollback failed: tenant delete blocked"]),
      }));
    } finally {
      restore();
    }
  });

  test("reuses an existing operator record instead of overwriting by email", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      existingOperator: {
        id: "operator_existing",
        tenant_id: "tenant_original",
        name: "Existing Owner",
        role: "tenant_owner",
      },
      authCreateError: { message: "already registered" },
      listUsers: [{ id: "auth_existing", email: "owner@example.com" }],
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(201);
      expect(supabase._calls.tenantsInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          application_fee_bps: 750,
        }),
      ]);
      expect(JSON.parse(res.body).operator_id).toBe("operator_existing");
      expect(supabase._calls.operatorsInsert).not.toHaveBeenCalled();
      expect(supabase._calls.operatorMembersUpsert).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("returns idempotent success when tenant already exists for onboarding request", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      existingTenant: { id: "tenant_existing", slug: "prooflink-test", name: "ProofLink Test" },
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual(expect.objectContaining({
        message: "Tenant already provisioned (idempotent)",
        tenant_id: "tenant_existing",
        slug: "prooflink-test",
      }));
      expect(supabase._calls.tenantsInsert).not.toHaveBeenCalled();
      expect(supabase._calls.onboardingUpdate).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("rejects provisioning when onboarding request is not approved or failed", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({ onboardingStatus: "submitted" });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({
        error: "Request must be in approved or failed status to provision",
        current_status: "submitted",
      });
      expect(supabase._calls.tenantsInsert).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("fails provisioning cleanly when slug generation fails", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock();

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => { throw new Error("slug unavailable"); }) },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain("Slug generation failed");
      expect(supabase._calls.tenantsInsert).not.toHaveBeenCalled();
      expect(supabase._calls.onboardingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" })
      );
    } finally {
      restore();
    }
  });

  test("fails provisioning cleanly when tenant insert fails", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      tenantInsertError: { message: "duplicate key value violates unique constraint" },
      tenantInsertData: null,
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain("Tenant creation failed");
      expect(supabase._calls.onboardingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          provision_error: expect.stringContaining("Tenant creation failed"),
        })
      );
    } finally {
      restore();
    }
  });

  test("fails provisioning cleanly when operator insert fails", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      operatorInsertError: { message: "operator insert failed" },
      operatorInsertData: null,
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain("Operator creation failed");
      expect(supabase._calls.onboardingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          provision_error: expect.stringContaining("Operator creation failed"),
        })
      );
    } finally {
      restore();
    }
  });

  test("fails provisioning cleanly when operator member upsert fails", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      operatorMembersUpsertError: { message: "member upsert denied" },
      authCreateError: { message: "already registered" },
      listUsers: [{ id: "auth_existing", email: "owner@example.com" }],
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => {}) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain("Operator member creation failed");
      expect(supabase._calls.onboardingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          provision_error: expect.stringContaining("Operator member creation failed"),
        })
      );
    } finally {
      restore();
    }
  });

  test("fails provisioning cleanly when template seeding fails", async () => {
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
    const supabase = createSupabaseMock({
      authCreateError: { message: "already registered" },
      listUsers: [{ id: "auth_existing", email: "owner@example.com" }],
    });

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireOnboardingAdminContext: vi.fn(async () => ({ operatorId: "op_pltest_admin", supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      emailExports: { sendEmail: vi.fn(async () => ({ id: "email_pltest" })), templates: { provisioned: vi.fn(() => ({})) } },
      slugifyExports: { uniqueTenantSlug: vi.fn(async () => "prooflink-test") },
      seedTemplateExports: { seedTemplateForTenant: vi.fn(async () => { throw new Error("seed template missing"); }) },
      authLinksExports: { buildPasswordSetupUrl: vi.fn(async () => "https://app.prooflink.test/operator/") },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        headers: {},
        body: JSON.stringify({ id: "req_pltest" }),
      });

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain("Template seeding failed");
      expect(supabase._calls.onboardingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          provision_error: expect.stringContaining("Template seeding failed"),
        })
      );
    } finally {
      restore();
    }
  });
});
