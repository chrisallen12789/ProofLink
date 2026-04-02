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

function createSupabaseMock({ bid, tenant, customer, lead = null }) {
  const proposalDocumentsTable = {
    select: vi.fn(() => proposalDocumentsTable),
    eq: vi.fn(() => proposalDocumentsTable),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  };

  const tenantBrandingProfilesTable = {
    select: vi.fn(() => tenantBrandingProfilesTable),
    eq: vi.fn(() => tenantBrandingProfilesTable),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  };

  const bidsTable = {
    select: vi.fn(() => bidsTable),
    eq: vi.fn(() => bidsTable),
    maybeSingle: vi.fn(async () => ({ data: bid, error: null })),
    update: vi.fn(() => {
      const chain = {
        eq: vi.fn(() => chain),
        not: vi.fn(() => chain),
        select: vi.fn(async () => ({ data: [{ id: bid?.id || "bid_pltest" }], error: null })),
      };
      return chain;
    }),
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

  const leadsTable = {
    select: vi.fn(() => leadsTable),
    eq: vi.fn(() => leadsTable),
    maybeSingle: vi.fn(async () => ({ data: lead, error: null })),
  };

  return {
    from: vi.fn((table) => {
      if (table === "proposal_documents") return proposalDocumentsTable;
      if (table === "tenant_branding_profiles") return tenantBrandingProfilesTable;
      if (table === "bids") return bidsTable;
      if (table === "tenants") return tenantsTable;
      if (table === "customers") return customersTable;
      if (table === "leads") return leadsTable;
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
        line_items: [
          {
            id: "line_1",
            name: "Daylight utility crossing",
            description: "Safely expose the crossing with hydrovac excavation.",
            quantity: 1,
            unit: "job",
            unit_price_cents: 125000,
          },
        ],
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
        email: "chris@example.com",
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
      expect(body.quote.recipient_email_hint).toBe("ch***@example.com");
      expect(body.business_logo_url).toBe("https://example.com/logo.png");
      expect(body.notes).toBe("Please review before Friday.");
      expect(body.terms).toContain("Pricing is based on the visible conditions");
      expect(body.quote.line_items).toEqual([
        expect.objectContaining({
          name: "Daylight utility crossing",
          description: "Safely expose the crossing with hydrovac excavation.",
          qty: 1,
          unit_price: 1250,
          line_total: 1250,
        }),
      ]);
    } finally {
      restore();
    }
  });

  test("POST accept blocks public approval when no recipient email can be verified", async () => {
    const supabase = createSupabaseMock({
      bid: {
        id: "bid_pltest_2",
        tenant_id: "tenant_pltest_2",
        title: "Drain cleaning",
        status: "pending",
        customer_id: null,
        lead_id: null,
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

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toContain("direct confirmation");
    } finally {
      restore();
    }
  });

  test("POST accept requires the recipient email when the quote has a customer email on file", async () => {
    const supabase = createSupabaseMock({
      bid: {
        id: "bid_pltest_3",
        tenant_id: "tenant_pltest_3",
        title: "Seasonal maintenance",
        status: "pending",
        customer_id: "cust_pltest_3",
        valid_until: "2026-04-10",
      },
      tenant: {
        email: "office@example.com",
        notification_email: null,
      },
      customer: {
        name: "Chris Customer",
        email: "customer@example.com",
      },
    });

    const { handler, restore } = loadHandlerWithAuthMock({
      getAdminClient: () => supabase,
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ action: "accept", token: "bid_pltest_3", customer_email: "wrong@example.com" }),
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toContain("same email address");
    } finally {
      restore();
    }
  });

  test("POST accept can verify against the linked lead email when no customer record exists", async () => {
    const supabase = createSupabaseMock({
      bid: {
        id: "bid_pltest_4",
        tenant_id: "tenant_pltest_4",
        title: "Seasonal maintenance",
        status: "pending",
        customer_id: null,
        lead_id: "lead_pltest_4",
        valid_until: "2026-04-10",
      },
      tenant: {
        email: "office@example.com",
        notification_email: null,
      },
      customer: null,
      lead: {
        contact_name: "Chris Customer",
        contact_email: "customer@example.com",
      },
    });

    const { handler, restore } = loadHandlerWithAuthMock({
      getAdminClient: () => supabase,
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ action: "accept", token: "bid_pltest_4", customer_email: "customer@example.com" }),
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    } finally {
      restore();
    }
  });
});
