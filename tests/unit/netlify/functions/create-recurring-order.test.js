"use strict";

const path = require("path");

describe("netlify/functions/create-recurring-order", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/create-recurring-order.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  function loadHandlerWithContext(supabase) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        requireOperatorContext: vi.fn(async () => ({
          supabase,
          operatorId: "operator_1",
          tenantId: "tenant_1",
        })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    return require(handlerPath).handler;
  }

  test("creates a service plan from an existing order through the compatibility endpoint", async () => {
    const orderQuery = {
      select: vi.fn(() => orderQuery),
      eq: vi.fn(() => orderQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "order_1",
          customer_id: "customer_1",
          customer_name: "Harbor Suites",
          cart_summary: "HVAC visit",
          description: "Inspect rooftop unit",
          total_cents: 12500,
          line_items: [{ name: "Tune-up" }],
          service_address: "101 Main St",
          schedule_window: "Morning",
        },
        error: null,
      })),
    };
    const existingPlanQuery = {
      select: vi.fn(() => existingPlanQuery),
      eq: vi.fn(() => existingPlanQuery),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const insertChain = {
      select: vi.fn(() => insertChain),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "plan_1",
          source_order_id: "order_1",
          cadence: "monthly",
          next_run_on: "2026-04-01",
          status: "active",
          title: "HVAC visit",
          customer_id: "customer_1",
        },
        error: null,
      })),
    };
    const insert = vi.fn(() => insertChain);
    const supabase = {
      from: vi.fn((table) => {
        if (table === "orders") return orderQuery;
        if (table === "service_plans") {
          return {
            select: existingPlanQuery.select,
            eq: existingPlanQuery.eq,
            maybeSingle: existingPlanQuery.maybeSingle,
            insert,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const handler = loadHandlerWithContext(supabase);
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ order_id: "order_1", frequency: "monthly", next_date: "2026-04-01" }),
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: "tenant_1",
      operator_id: "operator_1",
      customer_id: "customer_1",
      source_order_id: "order_1",
      cadence: "monthly",
      next_run_on: "2026-04-01",
    }));
    expect(body.service_plan).toEqual(expect.objectContaining({ id: "plan_1", source_order_id: "order_1" }));
  });

  test("fails cleanly when the order is not linked to a customer", async () => {
    const orderQuery = {
      select: vi.fn(() => orderQuery),
      eq: vi.fn(() => orderQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "order_1",
          customer_id: null,
          customer_name: "Walk-in request",
        },
        error: null,
      })),
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table === "orders") return orderQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const handler = loadHandlerWithContext(supabase);
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({ order_id: "order_1", frequency: "weekly", next_date: "2026-04-01" }),
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.error).toContain("linked customer");
  });
});
