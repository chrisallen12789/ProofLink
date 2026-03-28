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

  test("delegates recurring generation to the service plan RPC and returns its counts", async () => {
    const rpc = vi.fn(async () => ({
      data: { processed: 3, created: 2, existing: 1, failed: 0 },
      error: null,
    }));
    const supabase = { rpc };

    const handler = loadHandlerWithSupabase(supabase);
    const response = await handler({ httpMethod: "POST" });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledWith("generate_due_service_plans", { p_tenant_id: null });
    expect(body).toMatchObject({ ok: true, processed: 3, created: 2, skipped: 1, failed: 0 });
  });

  test("returns a clean 500 when recurring plan generation fails", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "function public.generate_due_service_plans does not exist" },
    }));
    const supabase = { rpc };

    const handler = loadHandlerWithSupabase(supabase);
    const response = await handler({ httpMethod: "POST" });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(500);
    expect(body.error).toBe("Failed to process recurring service plans");
  });
});
