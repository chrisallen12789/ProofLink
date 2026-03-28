"use strict";

const path = require("path");
const fs = require("fs");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/get-customer-portal.js");
const authUtilsPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");

function loadHandlerWithMocks({ authMockExports, rateLimitMockExports }) {
  const originalAuthModule = require.cache[authUtilsPath];
  const originalRateLimitModule = require.cache[rateLimitPath];
  const originalHandlerModule = require.cache[handlerPath];

  require.cache[authUtilsPath] = {
    id: authUtilsPath,
    filename: authUtilsPath,
    loaded: true,
    exports: authMockExports,
  };
  require.cache[rateLimitPath] = {
    id: rateLimitPath,
    filename: rateLimitPath,
    loaded: true,
    exports: rateLimitMockExports,
  };
  delete require.cache[handlerPath];

  const handler = require(handlerPath).handler;

  return {
    handler,
    restore() {
      delete require.cache[handlerPath];
      if (originalHandlerModule) require.cache[handlerPath] = originalHandlerModule;
      if (originalAuthModule) require.cache[authUtilsPath] = originalAuthModule;
      else delete require.cache[authUtilsPath];
      if (originalRateLimitModule) require.cache[rateLimitPath] = originalRateLimitModule;
      else delete require.cache[rateLimitPath];
    },
  };
}

function createQueryChain(result, terminal = "limit") {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    in: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  };
  if (terminal === "maybeSingle") {
    chain.limit = vi.fn(() => chain);
  } else {
    chain.maybeSingle = vi.fn(() => chain);
  }
  return chain;
}

function createSupabaseMock() {
  let ordersSelectCount = 0;
  const tenantsTable = createQueryChain({
    data: { id: "tenant_1", name: "Benkari Vacs" },
    error: null,
  }, "maybeSingle");
  const ordersTable = createQueryChain({
    data: [{ id: "order_1", title: "Hydrovac work", amount_due_cents: 25000, status: "confirmed" }],
    error: null,
  });
  const linkedOrdersTable = createQueryChain({
    data: [{ id: "order_linked_1", title: "Operator-created work", amount_due_cents: 12000, status: "confirmed", customer_id: "customer_1", created_at: "2026-03-24T10:00:00.000Z" }],
    error: null,
  });
  const bookingsTable = createQueryChain({
    data: [{ id: "booking_1", title: "Site visit", status: "scheduled" }],
    error: null,
  });
  const quotesTable = createQueryChain({
    data: [{
      id: "legacy_quote_1",
      title: "Legacy quote",
      description: "Legacy quote description",
      amount_cents: 12500,
      status: "pending",
      valid_until: "2026-04-15",
      created_at: "2026-03-20T10:00:00.000Z",
    }],
    error: null,
  });
  const customersTable = createQueryChain({
    data: [{ id: "customer_1" }],
    error: null,
  });
  const leadsTable = createQueryChain({
    data: [{
      id: "lead_1",
      customer_id: "customer_1",
      contact_name: "Jamie Customer",
    }],
    error: null,
  });
  const bidsTable = createQueryChain({
    data: [{
      id: "bid_1",
      title: "Pressure wash proposal",
      project_summary: "Clean siding and trim.",
      total_cents: 35000,
      status: "sent",
      valid_until: "2026-04-20",
      created_at: "2026-03-22T12:00:00.000Z",
      customer_id: "customer_1",
    }],
    error: null,
  });

  return {
    from: vi.fn((table) => {
      if (table === "tenants") return tenantsTable;
      if (table === "orders") {
        return {
          select: vi.fn(() => {
            ordersSelectCount += 1;
            return ordersSelectCount === 1 ? ordersTable : linkedOrdersTable;
          }),
        };
      }
      if (table === "bookings") return bookingsTable;
      if (table === "quotes") return quotesTable;
      if (table === "customers") return customersTable;
      if (table === "leads") return leadsTable;
      if (table === "bids") return bidsTable;
      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe("netlify/functions/get-customer-portal", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("returns bid-based estimates alongside legacy quotes with customer-safe review links", async () => {
    const supabase = createSupabaseMock();
    const { handler, restore } = loadHandlerWithMocks({
      authMockExports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
      rateLimitMockExports: {
        checkRateLimit: () => ({ allowed: true }),
        rateLimitResponse: () => ({ statusCode: 429, body: JSON.stringify({ error: "rate limited" }) }),
        getClientIP: () => "127.0.0.1",
      },
    });

    try {
      const res = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ email: "customer@example.com", tenant_id: "tenant_1" }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.business_name).toBe("Benkari Vacs");
      expect(body.orders).toHaveLength(2);
      expect(body.orders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "order_1", title: "Hydrovac work" }),
          expect.objectContaining({ id: "order_linked_1", title: "Operator-created work", customer_id: "customer_1" }),
        ])
      );
      expect(body.bookings).toHaveLength(1);
      expect(body.quotes).toEqual([
        expect.objectContaining({
          id: "bid_1",
          title: "Pressure wash proposal",
          description: "Clean siding and trim.",
          amount_cents: 35000,
          status: "pending",
          source_type: "bid",
          review_url: "/quote.html?token=bid_1",
        }),
        expect.objectContaining({
          id: "legacy_quote_1",
          title: "Legacy quote",
          status: "pending",
          source_type: "quote",
          review_url: null,
        }),
      ]);
    } finally {
      restore();
    }
  });

  test("uses the real orders schema instead of drifting back to missing columns", () => {
    const source = fs.readFileSync(handlerPath, "utf8");
    expect(source).toContain("function normalizePortalOrder(order)");
    expect(source).toContain("title: order.title || order.cart_summary || order.customer_name || 'Order'");
    expect(source).toContain(".ilike('email', normalizedEmail)");
    expect(source).not.toContain("customer_email.ilike");
    expect(source).toContain(".select('id, cart_summary, status");
  });
});
