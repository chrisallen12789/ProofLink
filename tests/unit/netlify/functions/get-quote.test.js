"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/get-quote.js");
const authUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

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

function createSupabaseMock({ bid, tenant, customer }) {
  const bidsTable = {
    select: vi.fn(() => bidsTable),
    eq: vi.fn(() => bidsTable),
    maybeSingle: vi.fn(async () => ({ data: bid, error: null })),
    update: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  };

  const tenantsTable = {
    select: vi.fn(() => tenantsTable),
    eq: vi.fn(() => tenantsTable),
    maybeSingle: vi.fn(async () => ({ data: tenant, error: null })),
  };

  const customersTable = {
    select: vi.fn(() => customersTable),
    eq: vi.fn(() => customersTable),
    maybeSingle: vi.fn(async () => ({ data: customer, error: null })),
  };

  return {
    from: vi.fn((table) => {
      if (table === "bids") return bidsTable;
      if (table === "tenants") return tenantsTable;
      if (table === "customers") return customersTable;
      throw new Error(`Unexpected table: ${table}`);
    }),
    bidsTable,
  };
}

describe("netlify/functions/get-quote", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.RESEND_API_KEY;
  });

  test("GET returns nested and flat customer-safe quote fields", async () => {
    const supabase = createSupabaseMock({
      bid: {
        id: "bid_pltest_1",
        tenant_id: "tenant_pltest_1",
        title: "Hydrovac estimate",
        project_summary: "Excavate around utility lines.",
        scope_of_work: "Expose the line and daylight the crossing.",
        total_cents: 125000,
        valid_until: "2026-03-31",
        cover_note: "Please review before Friday.",
        status: "pending",
        customer_id: "cust_pltest_1",
        created_at: "2026-03-25T12:00:00.000Z",
      },
      tenant: {
        name: "Benkari Vacs",
        logo_url: "https://example.com/logo.png",
        primary_color: "#c84b2f",
        email: "office@benkari.test",
        notification_email: "dispatch@benkari.test",
        phone: "555-111-2222",
      },
      customer: {
        name: "Chris Customer",
      },
    });

    const { handler, restore } = loadHandlerWithAuthMock({
      getAdminClient: () => supabase,
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    });

    try {
      const res = await handler({
        httpMethod: "GET",
        queryStringParameters: { token: "bid_pltest_1" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.quote.title).toBe("Hydrovac estimate");
      expect(body.quote.total_amount).toBe(1250);
      expect(body.quote.business_email).toBe("dispatch@benkari.test");
      expect(body.quote.business_phone).toBe("555-111-2222");
      expect(body.business_logo_url).toBe("https://example.com/logo.png");
      expect(body.notes).toBe("Please review before Friday.");
      expect(body.terms).toBe("Expose the line and daylight the crossing.");
    } finally {
      restore();
    }
  });

  test("POST accept still works when the caller sends token instead of bid_id", async () => {
    const supabase = createSupabaseMock({
      bid: {
        id: "bid_pltest_2",
        tenant_id: "tenant_pltest_2",
        title: "Drain cleaning",
        status: "pending",
        customer_id: null,
      },
      tenant: {
        email: "office@example.com",
        notification_email: null,
      },
      customer: null,
    });

    const { handler, restore } = loadHandlerWithAuthMock({
      getAdminClient: () => supabase,
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ action: "accept", token: "bid_pltest_2" }),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
      expect(supabase.bidsTable.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "accepted" })
      );
    } finally {
      restore();
    }
  });
});
