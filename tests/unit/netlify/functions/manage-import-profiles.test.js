"use strict";

const path = require("path");

function createSupabase(initialConfig = null) {
  let storedConfig = initialConfig;
  const state = {
    upserts: [],
  };

  return {
    state,
    from(table) {
      expect(table).toBe("tenant_config");
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        async maybeSingle() {
          return {
            data: storedConfig ? { config_value: JSON.stringify(storedConfig) } : null,
            error: null,
          };
        },
        async upsert(payload) {
          state.upserts.push(payload);
          storedConfig = JSON.parse(payload.config_value);
          return { error: null };
        },
      };
      return query;
    },
  };
}

describe("manage-import-profiles", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/manage-import-profiles.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  test("lists saved profiles for the tenant", async () => {
    const supabase = createSupabase({
      profiles: [
        {
          key: "legacy-customers",
          label: "Legacy customers",
          import_kind: "customers",
          field_aliases: { name: ["account_label"] },
        },
      ],
    });

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        requireTenantAdminContext: vi.fn(async () => ({
          supabase,
          tenantId: "tenant_1",
          operatorId: "operator_1",
        })),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({ httpMethod: "GET", queryStringParameters: {} });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0].key).toBe("legacy-customers");
  });

  test("saves a sanitized import profile for the tenant", async () => {
    const supabase = createSupabase({ profiles: [] });

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        requireTenantAdminContext: vi.fn(async () => ({
          supabase,
          tenantId: "tenant_1",
          operatorId: "operator_1",
        })),
      },
    };

    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        action: "upsert",
        profile: {
          label: "Legacy CRM customers",
          import_kind: "customers",
          field_aliases: {
            name: ["Account Label"],
            email: ["Primary Email"],
            ignored_field: ["Should Not Persist"],
          },
          sample_headers: ["Account Label", "Primary Email", "Ignored Field"],
          confidence_score: 0.84,
          source_system: "quickbooks",
          source_preset: "quickbooks_customers",
          learning_notes: [
            "Keep the QuickBooks invoice number visible in the linked work reference.",
            "Review service addresses before importing open work.",
          ],
          correction_fields: ["service_address", "ignored_field"],
          walkthrough_summary: "Source system: quickbooks | 12 preview rows | 2 edited | 0 skipped | 0 still flagged",
        },
      }),
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.profile.key).toBe("legacy-crm-customers");
    expect(body.profile.learned_by).toBe("operator_1");
    expect(body.profile.field_aliases).toEqual({
      name: ["account_label"],
      email: ["primary_email"],
    });
    expect(body.profile.source_system).toBe("quickbooks");
    expect(body.profile.source_preset).toBe("quickbooks-customers");
    expect(body.profile.learning_notes).toHaveLength(2);
    expect(body.profile.correction_fields).toEqual(["service_address"]);
    expect(body.profile.walkthrough_summary).toContain("Source system: quickbooks");
    expect(supabase.state.upserts).toHaveLength(1);
  });
});
