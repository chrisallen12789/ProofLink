"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/approve-onboarding-request.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");

function loadHandlerWithMocks({ supabase, emailSend = vi.fn(), approvedTemplate = vi.fn(() => ({})) }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
    [emailPath, require.cache[emailPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      requireOnboardingAdminContext: vi.fn(async () => ({ supabase })),
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: {
      sendEmail: emailSend,
      templates: { approved: approvedTemplate },
    },
  };
  delete require.cache[handlerPath];

  return {
    handler: require(handlerPath).handler,
    restore() {
      delete require.cache[handlerPath];
      for (const [modulePath, original] of originals.entries()) {
        if (original) require.cache[modulePath] = original;
        else delete require.cache[modulePath];
      }
    },
  };
}

describe("netlify/functions/approve-onboarding-request", () => {
  test("approves an eligible onboarding request and returns the updated record", async () => {
    const updatedRequest = {
      id: "req_1",
      status: "approved",
      business_name: "ProofLink Test",
      approved_at: "2026-04-07T12:00:00.000Z",
    };
    const updateChain = {
      eq: vi.fn(() => updateChain),
      select: vi.fn(() => updateChain),
      maybeSingle: vi.fn(async () => ({ data: updatedRequest, error: null })),
    };
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_onboarding_requests") throw new Error(`Unexpected table ${table}`);
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: "req_1",
                  status: "submitted",
                  business_name: "ProofLink Test",
                  owner_name: "Owner Example",
                  owner_email: "owner@example.com",
                },
                error: null,
              })),
            })),
          })),
          update: vi.fn(() => updateChain),
        };
      }),
    };
    const emailSend = vi.fn(async () => ({ id: "email_1" }));
    const approvedTemplate = vi.fn(() => ({ subject: "Approved" }));
    const { handler, restore } = loadHandlerWithMocks({ supabase, emailSend, approvedTemplate });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ id: "req_1" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.message).toBe('Request for "ProofLink Test" approved');
      expect(body.request).toEqual(updatedRequest);
      expect(approvedTemplate).toHaveBeenCalledWith(expect.objectContaining({
        owner_name: "Owner Example",
        business_name: "ProofLink Test",
        owner_email: "owner@example.com",
      }));
      expect(emailSend).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("rejects non-approvable statuses with a clean 400", async () => {
    const supabase = {
      from: vi.fn((table) => {
        if (table !== "tenant_onboarding_requests") throw new Error(`Unexpected table ${table}`);
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: "req_1",
                  status: "provisioning",
                  business_name: "ProofLink Test",
                  owner_name: "Owner Example",
                  owner_email: "owner@example.com",
                },
                error: null,
              })),
            })),
          })),
        };
      }),
    };
    const { handler, restore } = loadHandlerWithMocks({ supabase });

    try {
      const response = await handler({
        httpMethod: "POST",
        body: JSON.stringify({ id: "req_1" }),
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(400);
      expect(body.current_status).toBe("provisioning");
    } finally {
      restore();
    }
  });
});
