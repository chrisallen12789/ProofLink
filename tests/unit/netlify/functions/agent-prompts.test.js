"use strict";

const prompts = require("../../../../netlify/functions/agent/prompts");

describe("agent prompts", () => {
  test("buildBriefingPrompt keeps top customers and multi-site accounts visible", () => {
    const prompt = prompts.buildBriefingPrompt({
      today_bookings: [],
      upcoming_bookings: [],
      upcoming_jobs: [{ title: "North Campus PM", service_address: "100 Main St", status: "scheduled", scheduled_date: "2026-04-03", scheduled_time: "09:00" }],
      unpaid_orders: [],
      overdue_orders: [],
      total_unpaid_cents: 0,
      pending_quotes: [],
      expired_quotes: [],
      unread_messages: [],
      stale_customers: [{ company_name: "North Campus Facilities", updated_at: "2026-02-01T00:00:00.000Z" }],
      reminders_needed: [],
      top_customers: [{ company_name: "North Campus Facilities", lifetime_value_cents: 1250000, order_count: 14 }],
      multi_location_customers: [{ name: "North Campus Facilities", site_count: 3, primary_site: "Main quad" }],
    });

    expect(prompt).toContain("UPCOMING JOBS / ACTIVE EXECUTION THIS WEEK");
    expect(prompt).toContain("TOP CUSTOMERS TO PROTECT");
    expect(prompt).toContain("MULTI-SITE ACCOUNTS");
    expect(prompt).toContain("North Campus Facilities");
  });

  test("buildCopilotPrompt includes richer customer portfolio context", () => {
    const prompt = prompts.buildCopilotPrompt("Who needs attention?", {
      unpaid_orders: [],
      total_unpaid_cents: 0,
      today_bookings: [],
      upcoming_bookings: [],
      upcoming_jobs: [{ id: "job_1" }],
      pending_quotes: [],
      unread_messages: [],
      overdue_orders: [],
      stale_customers: [],
      recent_payments: [],
      top_customers: [{ id: "customer_1", company_name: "Metro Public Works" }],
      multi_location_customers: [{ customer_id: "customer_1", name: "Metro Public Works", site_count: 6 }],
    });

    expect(prompt).toContain("Upcoming jobs this week: 1");
    expect(prompt).toContain("Multi-site accounts: 1");
    expect(prompt).toContain("Metro Public Works");
  });

  test("buildCopilotPrompt switches into the collections specialist lane when requested", () => {
    const prompt = prompts.buildCopilotPrompt("Who is most overdue?", {
      unpaid_orders: [{ id: "order_1", customer_name: "Metro Public Works", total_cents: 42000 }],
      overdue_orders: [{ id: "order_1", customer_name: "Metro Public Works", total_cents: 42000 }],
      total_unpaid_cents: 42000,
      recent_payments: [{ id: "payment_1", amount_total: 12000 }],
      top_customers: [{ id: "customer_1", company_name: "Metro Public Works" }],
    }, { specialist: "collections" });

    expect(prompt).toContain("Specialist lane: Collections");
    expect(prompt).toContain("You are working in the collections specialist lane.");
    expect(prompt).toContain("Overdue orders");
    expect(prompt).toContain("Metro Public Works");
  });
});
