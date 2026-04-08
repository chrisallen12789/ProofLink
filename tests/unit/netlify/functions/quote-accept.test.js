"use strict";

const path = require("path");

describe("netlify/functions/quote-accept", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/quote-accept.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");
  const runtimeConfigPath = path.resolve(process.cwd(), "netlify/functions/utils/runtime-config.js");
  const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[emailPath];
    delete require.cache[runtimeConfigPath];
    delete require.cache[rateLimitPath];
  });

  function loadHandler(supabase) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[emailPath] = {
      id: emailPath,
      filename: emailPath,
      loaded: true,
      exports: {
        sendEmail: vi.fn(async () => ({ ok: true })),
        templates: {
          quoteAccepted: (payload) => payload,
        },
      },
    };
    require.cache[runtimeConfigPath] = {
      id: runtimeConfigPath,
      filename: runtimeConfigPath,
      loaded: true,
      exports: {
        getConfiguredSiteUrl: () => "https://prooflink.co",
      },
    };
    require.cache[rateLimitPath] = {
      id: rateLimitPath,
      filename: rateLimitPath,
      loaded: true,
      exports: {
        checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
        rateLimitResponse: (retryAfterMs) => ({
          statusCode: 429,
          body: JSON.stringify({ error: "Rate limit exceeded", retryAfterMs }),
        }),
        getClientIP: () => "127.0.0.1",
      },
    };

    return require(handlerPath).handler;
  }

  test("creates schema-compatible order data from an accepted quote", async () => {
    let insertedOrderPayload = null;

    const quotesTable = {
      select: vi.fn(() => quotesTable),
      eq: vi.fn(() => quotesTable),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "quote_1",
          tenant_id: "tenant_1",
          operator_id: "operator_1",
          customer_name: "Harbor Suites",
          customer_email: "ops@harbor.test",
          title: "Rooftop HVAC proposal",
          description: "Inspect and repair rooftop unit",
          amount_cents: 24500,
          valid_until: null,
          notes: "Bring lift access forms",
          status: "pending",
        },
        error: null,
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({ data: [{ id: "quote_1" }], error: null })),
          })),
        })),
      })),
    };

    const ordersInsertChain = {
      select: vi.fn(() => ordersInsertChain),
      maybeSingle: vi.fn(async () => ({ data: { id: "order_1" }, error: null })),
    };

    const ordersTable = {
      insert: vi.fn((payload) => {
        insertedOrderPayload = payload;
        return ordersInsertChain;
      }),
    };

    const tenantsTable = {
      select: vi.fn(() => tenantsTable),
      eq: vi.fn(() => tenantsTable),
      maybeSingle: vi.fn(async () => ({ data: { name: "ProofLink HVAC" }, error: null })),
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table === "quotes") return quotesTable;
        if (table === "orders") return ordersTable;
        if (table === "tenants") return tenantsTable;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const handler = loadHandler(supabase);
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        quote_id: "quote_1",
        customer_email: "ops@harbor.test",
        signature: "Signed by customer",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(200);
    expect(insertedOrderPayload).toEqual(expect.objectContaining({
      tenant_id: "tenant_1",
      operator_id: "operator_1",
      customer_name: "Harbor Suites",
      email: "ops@harbor.test",
      cart_summary: "Rooftop HVAC proposal",
      subtotal_cents: 24500,
      total_cents: 24500,
      estimated_total_cents: 24500,
      item_count: 1,
      unpriced_count: 0,
      source_type: "quote",
    }));
    expect(insertedOrderPayload).not.toHaveProperty("total_amount");
    expect(insertedOrderPayload).not.toHaveProperty("customer_email");
    expect(Array.isArray(insertedOrderPayload.items)).toBe(true);
    expect(insertedOrderPayload.items[0]).toEqual(expect.objectContaining({
      name: "Rooftop HVAC proposal",
      quantity: 1,
      unit_price_cents: 24500,
      total_cents: 24500,
    }));
  });

  test("requires the original customer email before accepting a quote", async () => {
    const quotesTable = {
      select: vi.fn(() => quotesTable),
      eq: vi.fn(() => quotesTable),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "quote_1",
          tenant_id: "tenant_1",
          operator_id: "operator_1",
          customer_name: "Harbor Suites",
          customer_email: "ops@harbor.test",
          title: "Rooftop HVAC proposal",
          description: "Inspect and repair rooftop unit",
          amount_cents: 24500,
          valid_until: null,
          notes: "Bring lift access forms",
          status: "pending",
        },
        error: null,
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({ data: [{ id: "quote_1" }], error: null })),
          })),
        })),
      })),
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table === "quotes") return quotesTable;
        if (table === "orders") {
          return { insert: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: vi.fn() })) })) };
        }
        if (table === "tenants") return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn() })) })) };
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const handler = loadHandler(supabase);
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        quote_id: "quote_1",
        customer_email: "someone-else@example.com",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(403);
    expect(quotesTable.update).not.toHaveBeenCalled();
  });

  test("rolls the quote back to pending when order creation fails after acceptance", async () => {
    const quoteUpdateSelect = vi.fn(async () => ({ data: [{ id: "quote_1" }], error: null }));
    const rollbackSelect = vi.fn(async () => ({ data: [{ id: "quote_1" }], error: null }));
    const quoteUpdateEqStatus = vi.fn(() => ({ select: quoteUpdateSelect }));
    const quoteUpdateEqId = vi.fn(() => ({ eq: quoteUpdateEqStatus }));
    const rollbackEqStatus = vi.fn(async () => ({ error: null }));
    const rollbackEqId = vi.fn(() => ({ eq: rollbackEqStatus }));

    const quotesTable = {
      select: vi.fn(() => quotesTable),
      eq: vi.fn(() => quotesTable),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "quote_1",
          tenant_id: "tenant_1",
          operator_id: "operator_1",
          customer_name: "Harbor Suites",
          customer_email: "ops@harbor.test",
          title: "Rooftop HVAC proposal",
          description: "Inspect and repair rooftop unit",
          amount_cents: 24500,
          valid_until: null,
          notes: "Bring lift access forms",
          status: "pending",
        },
        error: null,
      })),
      update: vi
        .fn()
        .mockReturnValueOnce({ eq: quoteUpdateEqId })
        .mockReturnValueOnce({ eq: rollbackEqId }),
    };

    const ordersTable = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: { message: "insert failed" } })),
        })),
      })),
    };

    const tenantsTable = {
      select: vi.fn(() => tenantsTable),
      eq: vi.fn(() => tenantsTable),
      maybeSingle: vi.fn(async () => ({ data: { name: "ProofLink HVAC" }, error: null })),
    };

    const supabase = {
      from: vi.fn((table) => {
        if (table === "quotes") return quotesTable;
        if (table === "orders") return ordersTable;
        if (table === "tenants") return tenantsTable;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const handler = loadHandler(supabase);
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        quote_id: "quote_1",
        customer_email: "ops@harbor.test",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(500);
    expect(quotesTable.update).toHaveBeenCalledTimes(2);
    expect(quoteUpdateEqStatus).toHaveBeenCalledWith("status", "pending");
    expect(rollbackEqStatus).toHaveBeenCalledWith("status", "accepted");
  });
});
