"use strict";

const path = require("path");

describe("netlify/functions/onboarding compatibility wrapper", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/onboarding.js");
  const helperPath = require.resolve(
    path.resolve(process.cwd(), "netlify/functions/lib/public-onboarding.js")
  );
  const rateLimitModulePath = require.resolve(
    path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js")
  );

  const submitOnboardingRequestMock = vi.fn();
  const checkRateLimitMock = vi.fn(() => ({ allowed: true }));
  const rateLimitResponseMock = vi.fn();
  const getClientIPMock = vi.fn(() => "127.0.0.1");

  beforeEach(() => {
    vi.resetModules();
    submitOnboardingRequestMock.mockReset();
    submitOnboardingRequestMock.mockResolvedValue({
      ok: true,
      request_id: "req_legacy",
      business: "Legacy Biz",
      status: "submitted",
      selected_plan: "starter",
    });
    checkRateLimitMock.mockClear();
    getClientIPMock.mockClear();

    delete require.cache[handlerPath];
    delete require.cache[helperPath];
    delete require.cache[rateLimitModulePath];

    require.cache[helperPath] = {
      id: helperPath,
      filename: helperPath,
      loaded: true,
      exports: {
        submitOnboardingRequest: submitOnboardingRequestMock,
      },
    };

    const rateLimitModule = require(rateLimitModulePath);
    rateLimitModule.checkRateLimit = checkRateLimitMock;
    rateLimitModule.rateLimitResponse = rateLimitResponseMock;
    rateLimitModule.getClientIP = getClientIPMock;
  });

  test("maps legacy onboarding submissions into the shared onboarding flow", async () => {
    const handler = require(handlerPath).handler;
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: "Legacy Biz",
        ownerName: "Owner",
        email: "owner@example.com",
        businessCategory: "bakery",
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(submitOnboardingRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: "Legacy Biz",
        ownerName: "Owner",
        email: "owner@example.com",
      })
    );
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        ok: true,
        request_id: "req_legacy",
      })
    );
  });
});
