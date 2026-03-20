"use strict";

const path = require("path");

describe("netlify/functions/service-intake", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/service-intake.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");

  let rpcMock;
  let adminClientMock;

  function loadHandler() {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[rateLimitPath];

    const auth = require(authPath);
    auth.getAdminClient = vi.fn(() => adminClientMock);
    auth.respond = (statusCode, body) => ({
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const rateLimit = require(rateLimitPath);
    rateLimit.getClientIP = vi.fn(() => "127.0.0.1");
    rateLimit.checkRateLimit = vi.fn(() => ({ allowed: true }));
    rateLimit.rateLimitResponse = vi.fn((retryAfterMs) => ({
      statusCode: 429,
      headers: { "Retry-After": String(retryAfterMs || 60) },
      body: JSON.stringify({ error: "Too many requests" }),
    }));

    return require(handlerPath).handler;
  }

  beforeEach(() => {
    rpcMock = vi.fn();
    adminClientMock = {
      rpc: rpcMock,
      from: vi.fn(() => {
        throw new Error("Unexpected fallback database access");
      }),
    };
  });

  test("valid input creates a lead via submit_service_lead", async () => {
    rpcMock.mockResolvedValue({
      data: {
        lead_id: "11111111-1111-1111-1111-111111111111",
        customer_id: "22222222-2222-2222-2222-222222222222",
        tenant_id: "33333333-3333-3333-3333-333333333333",
      },
      error: null,
    });

    const handler = loadHandler();
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        tenant_slug: "pltest-tenant-a-starter",
        customer_name: "PL Test Service Intake",
        email: "pltest.service.intake@example.com",
        summary: "Clean the siding and driveway",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith("submit_service_lead", {
      payload: expect.objectContaining({
        tenant_slug: "pltest-tenant-a-starter",
        customer_name: "PL Test Service Intake",
        email: "pltest.service.intake@example.com",
        summary: "Clean the siding and driveway",
        source_type: "website_service_intake",
      }),
    });

    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      lead_id: "11111111-1111-1111-1111-111111111111",
      customer_id: "22222222-2222-2222-2222-222222222222",
      tenant_id: "33333333-3333-3333-3333-333333333333",
    });
  });

  test("invalid input fails before touching the database", async () => {
    const handler = loadHandler();
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        tenant_slug: "pltest-tenant-a-starter",
        email: "pltest.service.intake@example.com",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("customer_name is required");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("tenant resolution failures return a clean 400", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: "submit_service_lead: tenant could not be resolved",
      },
    });

    const handler = loadHandler();
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        tenant_slug: "missing-tenant",
        customer_name: "PL Test Service Intake",
        email: "pltest.service.intake@example.com",
        summary: "Clean the siding and driveway",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("tenant could not be resolved");
  });

  test("missing service workflow schema returns 503 instead of a generic 500", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: 'Could not find the function public.submit_service_lead(payload) in the schema cache',
      },
    });
    adminClientMock.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST205",
          message: "Could not find the table 'public.tenants' in the schema cache",
        },
      }),
    }));

    const handler = loadHandler();
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        tenant_slug: "pltest-tenant-a-starter",
        customer_name: "PL Test Service Intake",
        email: "pltest.service.intake@example.com",
        summary: "Clean the siding and driveway",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).error).toContain("schema");
  });

  test("incomplete linkage fails closed so no orphaned success response is returned", async () => {
    rpcMock.mockResolvedValue({
      data: {
        lead_id: "11111111-1111-1111-1111-111111111111",
        customer_id: null,
        tenant_id: "33333333-3333-3333-3333-333333333333",
      },
      error: null,
    });

    const handler = loadHandler();
    const response = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        tenant_slug: "pltest-tenant-a-starter",
        customer_name: "PL Test Service Intake",
        email: "pltest.service.intake@example.com",
        summary: "Clean the siding and driveway",
      }),
      headers: {},
    });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body).error).toContain("complete lead/customer linkage");
  });
});
