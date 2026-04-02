"use strict";

const path = require("path");

describe("collections follow-up assistant", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/agent/agents/collections-follow-up-assistant.js");
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("separates overdue balances from undated open balances without overstating status", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getCollectionsFollowUpContext: vi.fn(async () => ({
          open_balances: [
            {
              order_id: "order_1",
              customer_id: "customer_1",
              order_title: "Campus plumbing",
              customer_name: "North College",
              amount_due_cents: 24000,
              payment_due_date: "2026-03-01",
              invoice_due_date: "",
              invoice_status: "sent",
            },
            {
              order_id: "order_2",
              customer_id: "customer_2",
              order_title: "Lobby cleanup",
              customer_name: "Brightline Suites",
              amount_due_cents: 12000,
              payment_due_date: "",
              invoice_due_date: "",
              invoice_status: "",
            },
          ],
          assumptions: [],
          data_used: [{ label: "Open balance orders", count: 2, detail: "orders" }],
        })),
      },
    };

    const { runCollectionsFollowUpAssistant } = require(modulePath);
    const result = await runCollectionsFollowUpAssistant({
      supabase: {},
      tenantId: "tenant_1",
      input: {},
    });

    expect(result.report.findings[0].detail).toContain("proved due date in the past");
    expect(result.report.findings[1].detail).toContain("do not prove");
    expect(result.report.missing_data.map((item) => item.id)).toContain("collections_missing_due_dates");
    expect(result.report.recommended_actions.map((item) => item.id)).toEqual(expect.arrayContaining([
      "collections_review_queue",
      "collections_attach_due_dates",
    ]));
    expect(result.context_summary.overdue_count).toBe(1);
    expect(result.context_summary.missing_due_dates).toBe(1);
  });
});
