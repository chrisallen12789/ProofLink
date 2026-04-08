"use strict";

const path = require("path");

const handlerPath = path.resolve(process.cwd(), "netlify/functions/get-crew-jobs.js");
const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
const closeoutPath = path.resolve(process.cwd(), "netlify/functions/lib/hydrovac-closeout.js");

function loadHandlerWithMocks({ adminSb, ctx }) {
  vi.resetModules();

  const originals = new Map([
    [handlerPath, require.cache[handlerPath]],
    [authPath, require.cache[authPath]],
    [closeoutPath, require.cache[closeoutPath]],
  ]);

  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      requireOperatorContext: vi.fn(async () => ctx),
      getAdminClient: vi.fn(() => adminSb),
      respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    },
  };
  require.cache[closeoutPath] = {
    id: closeoutPath,
    filename: closeoutPath,
    loaded: true,
    exports: {
      extractHydrovacCompletionHandoff: vi.fn(() => null),
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

describe("netlify/functions/get-crew-jobs", () => {
  test("matches jobs assigned by operator_members.id and returns the crew member identity", async () => {
    let jobsOrClause = "";
    const jobsResult = Promise.resolve({ data: [], error: null });
    const jobsQuery = {
      select: vi.fn(() => jobsQuery),
      eq: vi.fn(() => jobsQuery),
      or: vi.fn((value) => {
        jobsOrClause = value;
        return jobsQuery;
      }),
      not: vi.fn(() => jobsQuery),
      order: vi.fn(() => jobsQuery),
      then: jobsResult.then.bind(jobsResult),
      catch: jobsResult.catch.bind(jobsResult),
      finally: jobsResult.finally.bind(jobsResult),
    };

    const memberQuery = {
      select: vi.fn(() => memberQuery),
      eq: vi.fn(() => memberQuery),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "member_123",
          operator_id: null,
          user_id: "user_123",
          role: "member",
          role_title: "Crew Member",
          name: "Skylar",
          operators: null,
        },
        error: null,
      })),
    };

    const adminSb = {
      from: vi.fn((table) => {
        if (table === "operator_members") return memberQuery;
        if (table === "jobs") return jobsQuery;
        if (table === "job_photos" || table === "waste_manifests" || table === "utility_locate_tickets" || table === "confined_space_permits") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({ data: [], error: null })),
              eq: vi.fn(() => ({ in: vi.fn(async () => ({ data: [], error: null })) })),
            })),
          };
        }
        if (table === "customer_locations") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const { handler, restore } = loadHandlerWithMocks({
      adminSb,
      ctx: {
        user: { id: "user_123", email: "skylar@example.com" },
        tenantId: "tenant_123",
      },
    });

    try {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: { date: "2026-04-08" },
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(jobsOrClause).toContain("assigned_member_id.eq.member_123");
      expect(jobsOrClause).toContain("assigned_operator_id.eq.user_123");
      expect(body.member).toEqual(
        expect.objectContaining({
          id: "member_123",
          operator_id: null,
          name: "Skylar",
          role: "member",
        })
      );
    } finally {
      restore();
    }
  });
});
