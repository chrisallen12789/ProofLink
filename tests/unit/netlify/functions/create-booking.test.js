"use strict";

const path = require("path");

describe("netlify/functions/create-booking", () => {
  const handlerPath = path.resolve(process.cwd(), "netlify/functions/create-booking.js");
  const authPath = path.resolve(process.cwd(), "netlify/functions/utils/auth.js");
  const emailPath = path.resolve(process.cwd(), "netlify/functions/utils/email.js");
  const rateLimitPath = path.resolve(process.cwd(), "netlify/functions/utils/rate-limit.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[handlerPath];
    delete require.cache[authPath];
    delete require.cache[emailPath];
    delete require.cache[rateLimitPath];
    process.env.PUBLIC_SITE_URL = "https://app.prooflink.test";
  });

  function installMocks({ supabase }) {
    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        getAdminClient: () => supabase,
        requireOperatorContext: vi.fn(async () => ({ supabase, tenantId: "tenant_1", operatorId: "operator_1" })),
        respond: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
      },
    };
    require.cache[emailPath] = {
      id: emailPath,
      filename: emailPath,
      loaded: true,
      exports: {
        sendEmail: vi.fn(async () => ({ id: "email_1" })),
        templates: {
          bookingConfirmation: vi.fn((payload) => payload),
          newBookingOperator: vi.fn((payload) => payload),
        },
      },
    };
    require.cache[rateLimitPath] = {
      id: rateLimitPath,
      filename: rateLimitPath,
      loaded: true,
      exports: {
        checkRateLimit: vi.fn(() => ({ allowed: true })),
        rateLimitResponse: vi.fn((retryAfterMs) => ({ statusCode: 429, body: JSON.stringify({ retryAfterMs }) })),
        getClientIP: vi.fn(() => "127.0.0.1"),
      },
    };
  }

  test("rejects booking requests for past times", async () => {
    const supabase = { from: vi.fn() };
    installMocks({ supabase });
    const handler = require(handlerPath).handler;

    const start = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
    const end = new Date(Date.now() - (60 * 60 * 1000)).toISOString();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: "tenant_1",
        customer_name: "Chris",
        customer_email: "chris@example.com",
        title: "Visit",
        starts_at: start,
        ends_at: end,
      }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Bookings must be requested for a future time.");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  test("persists scheduling context in the stored booking notes", async () => {
    let insertedPayload = null;
    const queryBuilder = (result) => ({
      eq() { return this; },
      limit() { return this; },
      maybeSingle: async () => result,
    });
    const supabase = {
      from: vi.fn((table) => {
        if (table === "bookings") {
          return {
            insert: vi.fn((payload) => {
              insertedPayload = payload;
              return {
                select: () => ({
                  maybeSingle: async () => ({
                    data: { id: "booking_1", ...payload },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === "tenants") {
          return { select: () => queryBuilder({ data: { name: "ProofLink Test" }, error: null }) };
        }
        if (table === "tenant_config") {
          return {
            select: () => ({
              eq() { return this; },
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (table === "availability") {
          return { select: () => queryBuilder({ data: { timezone: "America/New_York" }, error: null }) };
        }
        if (table === "operators") {
          return { select: () => queryBuilder({ data: { email: "ops@example.com", name: "Ops" }, error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    installMocks({ supabase });
    const handler = require(handlerPath).handler;

    const start = new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString();
    const end = new Date(Date.now() + (3 * 60 * 60 * 1000)).toISOString();
    const res = await handler({
      httpMethod: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: "tenant_1",
        customer_name: "Chris",
        customer_email: "chris@example.com",
        title: "Visit",
        starts_at: start,
        ends_at: end,
        notes: "Please ring the side door.",
        service_address: "100 Market Street, Buffalo, NY 14201",
        preferred_time: "Morning (8am-12pm)",
        referral_source: "Google Search",
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(insertedPayload.notes).toContain("Please ring the side door.");
    expect(insertedPayload.notes).toContain("Service address: 100 Market Street, Buffalo, NY 14201");
    expect(insertedPayload.notes).toContain("Preferred time: Morning (8am-12pm)");
    expect(insertedPayload.notes).toContain("Referral source: Google Search");
  });

  test("hydrates the booking from the selected customer site when operator context is present", async () => {
    let insertedPayload = null;
    const queryBuilder = (result) => ({
      eq() { return this; },
      limit() { return this; },
      maybeSingle: async () => result,
    });
    const supabase = {
      from: vi.fn((table) => {
        if (table === "customers") {
          return {
            select: () => ({
              eq() { return this; },
              maybeSingle: async () => ({
                data: {
                  id: "customer_1",
                  name: "Metro Public Works",
                  email: "dispatch@metro.test",
                  address_line1: "400 Civic Center Plaza",
                  city: "Tulsa",
                  state: "OK",
                  zip: "74103",
                },
                error: null,
              }),
            }),
          };
        }
        if (table === "customer_locations") {
          return {
            select: () => ({
              eq() { return this; },
              maybeSingle: async () => ({
                data: {
                  id: "site_1",
                  customer_id: "customer_1",
                  site_name: "North Campus",
                  contact_email: "onsite@metro.test",
                  address_line1: "1200 North Campus Dr",
                  city: "Tulsa",
                  state: "OK",
                  zip: "74103",
                  access_notes: "Use the west gate before 7 AM",
                },
                error: null,
              }),
            }),
          };
        }
        if (table === "bookings") {
          return {
            insert: vi.fn((payload) => {
              insertedPayload = payload;
              return {
                select: () => ({
                  maybeSingle: async () => ({
                    data: { id: "booking_2", ...payload },
                    error: null,
                  }),
                }),
              };
            }),
          };
        }
        if (table === "tenants") {
          return { select: () => queryBuilder({ data: { name: "ProofLink Test" }, error: null }) };
        }
        if (table === "tenant_config") {
          return {
            select: () => ({
              eq() { return this; },
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (table === "availability") {
          return { select: () => queryBuilder({ data: { timezone: "America/New_York" }, error: null }) };
        }
        if (table === "operators") {
          return { select: () => queryBuilder({ data: { email: "ops@example.com", name: "Ops" }, error: null }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    installMocks({ supabase });
    const handler = require(handlerPath).handler;

    const start = new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString();
    const end = new Date(Date.now() + (3 * 60 * 60 * 1000)).toISOString();
    const res = await handler({
      httpMethod: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify({
        customer_id: "customer_1",
        customer_location_id: "site_1",
        customer_name: "Metro Public Works",
        title: "Quarterly walkthrough",
        starts_at: start,
        ends_at: end,
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(insertedPayload.customer_location_id).toBe("site_1");
    expect(insertedPayload.location).toBe("North Campus");
    expect(insertedPayload.service_address).toBe("1200 North Campus Dr, Tulsa OK 74103");
    expect(insertedPayload.customer_email).toBe("onsite@metro.test");
    expect(insertedPayload.notes).toContain("Site: North Campus");
    expect(insertedPayload.notes).toContain("Site access: Use the west gate before 7 AM");
  });
});
