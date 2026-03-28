"use strict";

const path = require("path");

describe("netlify/functions/process-recurring-orders", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/process-recurring-orders.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
  });

  function loadHandlerWithSupabase(supabase) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        getAdminClient: () => supabase,
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };

    return require(handlerPath).handler;
  }

  test("skips duplicate recurring orders already created today and advances the schedule", async () => {
    const recurringOrderUpdate = vi.fn(() => ({
      eq: vi.fn(async () => ({ data: null, error: null })),
    }));
    const orderInsert = vi.fn();
    const supabase = {
      from: vi.fn((table) => {
        if (table === "recurring_orders") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                lte: vi.fn(async () => ({
                  data: [{
                    id: "rec_1",
                    tenant_id: "tenant_1",
                    operator_id: "operator_1",
                    source_order_id: "order_src_1",
                    frequency: "weekly",
                    next_date: "2026-03-28",
                    active: true,
                    orders: {
                      id: "order_src_1",
                      title: "Quarterly service",
                      customer_name: "Harbor Suites",
                      customer_email: "ops@example.com",
                      total_amount: 12500,
                      description: "Repeat service",
                      line_items: [{ name: "Service visit" }],
                    },
                  }],
                  error: null,
                })),
              })),
            })),
            update: recurringOrderUpdate,
          };
        }
        if (table === "orders") {
          const duplicateOrderQuery = {
            eq: vi.fn(function eq() { return this; }),
            maybeSingle: vi.fn(async () => ({
              data: { id: "order_existing_today" },
              error: null,
            })),
          };
          return {
            select: vi.fn(() => duplicateOrderQuery),
            insert: orderInsert,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const handler = loadHandlerWithSupabase(supabase);
    const response = await handler({ httpMethod: "POST" });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ ok: true, processed: 1, skipped: 1, created: 0, failed: 0 });
    expect(orderInsert).not.toHaveBeenCalled();
    expect(recurringOrderUpdate).toHaveBeenCalled();
  });
});
