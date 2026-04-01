"use strict";

const path = require("path");

describe("netlify/functions/submit-onboarding-request", () => {
  const handlerPath = path.resolve(
    process.cwd(),
    "netlify/functions/submit-onboarding-request.js"
  );
  const authModulePath = require.resolve(
    path.resolve(process.cwd(), "netlify/functions/utils/auth.js")
  );
  const emailModulePath = require.resolve(
    path.resolve(process.cwd(), "netlify/functions/utils/email.js")
  );
  const rateLimitModulePath = require.resolve(
    path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js")
  );
  const slugifyModulePath = require.resolve(
    path.resolve(process.cwd(), "netlify/functions/utils/slugify.js")
  );
  const insertMock = vi.fn();
  const insertSelectMock = vi.fn();
  const insertMaybeSingleMock = vi.fn();
  const fromMock = vi.fn();
  const getAdminClientMock = vi.fn();
  const sendEmailMock = vi.fn().mockResolvedValue({ id: "email_123" });
  const templatesMock = {
    submitted: vi.fn(() => ({ to: "one@example.com" })),
    operatorNewRequest: vi.fn(() => ({ to: "ops@example.com" })),
  };
  const checkRateLimitMock = vi.fn(() => ({ allowed: true }));
  const rateLimitResponseMock = vi.fn();
  const getClientIPMock = vi.fn(() => "127.0.0.1");
  const slugifyMock = vi.fn((value) => `slug-${value}`);

  function createSelectChain(result) {
    const chain = {};
    chain.ilike = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => result);
    return chain;
  }

  beforeEach(() => {
    vi.resetModules();
    insertMock.mockReset();
    insertSelectMock.mockReset();
    insertMaybeSingleMock.mockReset();
    fromMock.mockReset();
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({ id: "email_123" });
    templatesMock.submitted.mockClear();
    templatesMock.operatorNewRequest.mockClear();
    checkRateLimitMock.mockClear();
    getClientIPMock.mockClear();
    slugifyMock.mockClear();

    insertMaybeSingleMock.mockResolvedValue({
      data: { id: "req_123", business_name: "Test Biz", status: "submitted" },
      error: null,
    });

    insertSelectMock.mockReturnValue({ maybeSingle: insertMaybeSingleMock });
    insertMock.mockReturnValue({ select: insertSelectMock });

    fromMock.mockImplementation((tableName) => {
      if (tableName === "tenants") {
        return {
          select: vi.fn(() => createSelectChain({ data: null, error: null })),
        };
      }
      if (tableName === "tenant_onboarding_requests") {
        return {
          select: vi.fn(() => createSelectChain({ data: null, error: null })),
          insert: insertMock,
        };
      }
      throw new Error(`Unexpected table ${tableName}`);
    });
    getAdminClientMock.mockReset();
    getAdminClientMock.mockReturnValue({ from: fromMock });

    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete require.cache[handlerPath];
    delete require.cache[authModulePath];
    delete require.cache[emailModulePath];
    delete require.cache[rateLimitModulePath];
    delete require.cache[slugifyModulePath];

    const authModule = require(authModulePath);
    authModule.getAdminClient = getAdminClientMock;

    const emailModule = require(emailModulePath);
    emailModule.sendEmail = sendEmailMock;
    emailModule.templates = templatesMock;

    const rateLimitModule = require(rateLimitModulePath);
    rateLimitModule.checkRateLimit = checkRateLimitMock;
    rateLimitModule.rateLimitResponse = rateLimitResponseMock;
    rateLimitModule.getClientIP = getClientIPMock;

    const slugifyModule = require(slugifyModulePath);
    slugifyModule.slugify = slugifyMock;
  });

  async function loadHandler() {
    return require(handlerPath).handler;
  }

  test("returns 200 for OPTIONS", async () => {
    const handler = await loadHandler();
    const res = await handler({ httpMethod: "OPTIONS", headers: {} });
    expect(res.statusCode).toBe(200);
  });

  test("returns 405 for non-POST requests", async () => {
    const handler = await loadHandler();
    const res = await handler({ httpMethod: "GET", headers: {} });
    expect(res.statusCode).toBe(405);
  });

  test("returns 400 for invalid JSON", async () => {
    const handler = await loadHandler();
    const res = await handler({ httpMethod: "POST", headers: {}, body: "{" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Invalid JSON body" });
  });

  test("returns 400 and fields for missing required values", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ business_name: "Test Biz" }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "Missing required fields",
      fields: ["owner_name", "owner_email"],
    });
  });

  test("returns 400 for invalid email", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        business_name: "Test Biz",
        owner_name: "Owner",
        owner_email: "not-an-email",
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "owner_email is not a valid email address" });
  });

  test("returns 201 for a valid payload and lowercases email", async () => {
    process.env.OPERATOR_ALERT_EMAIL = "ops@example.com";
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        business_name: "Test Biz",
        owner_name: "Owner",
        owner_email: "OWNER@Example.com",
        requested_subdomain: "Test Handle",
        business_type: "bakery",
        selected_plan: "growth",
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(slugifyMock).toHaveBeenCalledWith("Test Handle");
    expect(fromMock).toHaveBeenCalledWith("tenant_onboarding_requests");
    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          owner_email: "owner@example.com",
          business_slug: "slug-Test Handle",
          selected_plan: "growth",
        }),
      ])
    );

    expect(JSON.parse(res.body)).toEqual({
      message: "Onboarding request submitted successfully",
      request_id: "req_123",
      business: "Test Biz",
      status: "submitted",
      selected_plan: "growth",
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  test("returns 400 for invalid selected_plan", async () => {
    const handler = await loadHandler();
    const res = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        business_name: "Test Biz",
        owner_name: "Owner",
        owner_email: "owner@example.com",
        selected_plan: "vip",
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Invalid selected_plan" });
  });
});
