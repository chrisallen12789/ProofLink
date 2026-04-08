"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/admin-set-tester-exempt.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

function loadHandlerWithMocks({ authExports }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: authExports,
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

function makeTenantLookup(tenant, error = null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: tenant, error })),
  };
  return chain;
}

describe("netlify/functions/admin-set-tester-exempt", () => {
  test("returns 400 for an invalid exemption month value", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table === "tenants") {
          return makeTenantLookup({
            id: "tenant_1",
            slug: "north-college",
            business_name: "North College",
          });
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ supabase })),
        requireTenantAdminContext: vi.fn(async () => ({ supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenantId: "tenant_1", exempt: true, months: "abc" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.error).toBe("months must be an integer between 1 and 24");
    } finally {
      restore();
    }
  });

  test("returns 409 when active tester slots are already full", async () => {
    const currentExempt = [
      { id: "tenant_a", slug: "a", business_name: "A", billing_exempt_until: "2099-01-01T00:00:00Z" },
      { id: "tenant_b", slug: "b", business_name: "B", billing_exempt_until: "2099-01-01T00:00:00Z" },
      { id: "tenant_c", slug: "c", business_name: "C", billing_exempt_until: "2099-01-01T00:00:00Z" },
    ];

    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenants") throw new Error(`Unexpected table ${table}`);

        const fetchChain = {
          select: vi.fn((fields) => {
            if (fields.includes("billing_exempt, billing_exempt_until")) {
              return fetchChain;
            }
            if (fields.includes("billing_exempt_until")) {
              return countChain;
            }
            throw new Error(`Unexpected select(${fields})`);
          }),
          eq: vi.fn(() => fetchChain),
          maybeSingle: vi.fn(async () => ({
            data: {
              id: "tenant_1",
              slug: "north-college",
              business_name: "North College",
            },
            error: null,
          })),
        };

        const countChain = {
          eq: vi.fn(() => countChain),
          neq: vi.fn(async () => ({ data: currentExempt, error: null })),
        };

        return fetchChain;
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      authExports: {
        requireAdminContext: vi.fn(async () => ({ supabase })),
        requireTenantAdminContext: vi.fn(async () => ({ supabase })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ tenantId: "tenant_1", exempt: true, months: 12 }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(409);
      expect(body.error).toContain("Tester slot limit reached");
      expect(body.activeTesters).toHaveLength(3);
    } finally {
      restore();
    }
  });
});
