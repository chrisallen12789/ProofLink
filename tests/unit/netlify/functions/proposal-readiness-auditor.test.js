"use strict";

const path = require("path");

describe("proposal readiness auditor", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/agent/agents/proposal-readiness-auditor.js");
  const toolsPath = path.resolve(process.cwd(), "netlify/functions/agent/tools.js");

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[modulePath];
    delete require.cache[toolsPath];
  });

  test("blocks delivery when reusable defaults and delivery fields are missing", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getProposalReadinessContext: vi.fn(async () => ({
          bid: {
            id: "bid_1",
            title: "Harbor tunnel proposal",
          },
          customer: {
            id: "customer_1",
            name: "Harbor Works",
          },
          active_sender: {
            full_name: "",
            email: "",
            signature_image_url: "",
          },
          deposit_amount_cents: 25000,
          status: {
            company_name: true,
            logo: false,
            default_terms: false,
            default_exclusions: true,
            default_signer: false,
            default_signer_signature: false,
            bid_sender: false,
            delivery_note: true,
            valid_until: false,
            terms_applied: false,
            exclusions_applied: true,
            deposit_requested: true,
          },
          missing_data: [],
          assumptions: [],
          data_used: [{ label: "Bid", count: 1, detail: "bids" }],
        })),
      },
    };

    const { runProposalReadinessAuditor } = require(modulePath);
    const result = await runProposalReadinessAuditor({
      supabase: {},
      tenantId: "tenant_1",
      input: { bid_id: "bid_1" },
    });

    expect(result.report.summary_status).toBe("blocked");
    expect(result.report.blockers.map((item) => item.id)).toEqual(expect.arrayContaining([
      "proposal_readiness_missing_required_setup",
      "proposal_readiness_deposit_without_validity",
    ]));
    expect(result.report.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "proposal_readiness_snapshot",
      "proposal_readiness_sender_state",
      "proposal_readiness_terms_gap",
      "proposal_readiness_deposit_visible",
    ]));
    expect(result.context_summary.bid_id).toBe("bid_1");
    expect(result.context_summary.missing_required_checks).toBeGreaterThan(0);
  });

  test("stays ready when signer, defaults, and delivery fields are complete", async () => {
    require.cache[toolsPath] = {
      id: toolsPath,
      filename: toolsPath,
      loaded: true,
      exports: {
        getProposalReadinessContext: vi.fn(async () => ({
          bid: {
            id: "bid_2",
            title: "Campus pressure wash proposal",
          },
          customer: {
            id: "customer_2",
            name: "City Campus",
          },
          active_sender: {
            full_name: "Alex Lane",
            email: "alex@example.com",
            signature_image_url: "https://cdn.example/signature.png",
          },
          deposit_amount_cents: 0,
          status: {
            company_name: true,
            logo: true,
            default_terms: true,
            default_exclusions: true,
            default_signer: true,
            default_signer_signature: true,
            bid_sender: true,
            delivery_note: true,
            valid_until: true,
            terms_applied: true,
            exclusions_applied: true,
            deposit_requested: false,
          },
          missing_data: [],
          assumptions: [],
          data_used: [{ label: "Proposal defaults", count: 4, detail: "proposal settings" }],
        })),
      },
    };

    const { runProposalReadinessAuditor } = require(modulePath);
    const result = await runProposalReadinessAuditor({
      supabase: {},
      tenantId: "tenant_1",
      input: { bid_id: "bid_2" },
    });

    expect(result.report.summary_status).toBe("ready");
    expect(result.report.blockers).toHaveLength(0);
    expect(result.report.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "proposal_readiness_snapshot",
      "proposal_readiness_sender_state",
    ]));
    expect(result.context_summary.ready_checks).toBeGreaterThan(5);
  });
});
