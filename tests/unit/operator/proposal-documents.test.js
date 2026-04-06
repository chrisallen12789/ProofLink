"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createEngineStub() {
  return {
    TEMPLATE_TYPES: {
      STANDARD_OPERATIONAL: "standard_operational",
      FORMAL_VENDOR: "formal_vendor",
    },
    normalizeOption(option, fallbackTitle) {
      return {
        optionType: option?.option_type || option?.optionType || "option",
        optionTitle: option?.option_title || option?.optionTitle || fallbackTitle || "Option",
        pricingLabel: option?.pricing_label || option?.pricingLabel || "Investment",
        priceAmountCents: Number(option?.price_amount_cents ?? option?.priceAmountCents ?? 0) || 0,
        priceUnit: option?.price_unit || option?.priceUnit || "",
        scopeContent: Array.isArray(option?.scope_content)
          ? option.scope_content
          : (option?.scope_content ? [{ text: String(option.scope_content) }] : []),
        feeRows: Array.isArray(option?.fee_rows) ? option.fee_rows : [],
        notes: option?.notes || "",
      };
    },
    buildBranding() {
      return {
        companyName: "ProofLink",
        hasLogo: false,
      };
    },
    buildProposalViewModel(payload = {}) {
      return {
        options: payload.options || [],
        branding: {},
        sender: {},
        serviceType: payload.serviceType || "",
      };
    },
  };
}

function loadProposalDocuments(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-proposal-documents.js"),
    "utf8"
  );

  const context = {
    console,
    window: {
      ProofLinkProposalDocuments: createEngineStub(),
    },
    TENANT_ID: "tenant_1",
    SETUP_STATE: {},
    createLocalId: vi.fn((prefix) => `${prefix || "id"}_1`),
    calculateBidTotals: vi.fn((draft) => ({
      total: (draft?.line_items || []).reduce((sum, item) => {
        return sum + (Number(item?.quantity || 0) * Number(item?.unit_price_cents || 0));
      }, 0),
    })),
    findBidCustomer: vi.fn(() => null),
    defaultBidTitleFromDraft: vi.fn(() => "Proposal"),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.PROOFLINK_OPERATOR_PROPOSAL_DOCUMENTS;
}

describe("operator proposal documents", () => {
  test("mergeDraftDefaults keeps auto-generated proposal options aligned with bid totals", () => {
    const api = loadProposalDocuments();
    const draft = {
      title: "Pressure wash proposal",
      project_summary: "Exterior wash proposal",
      scope_of_work: "Soft wash siding and exterior trim",
      line_items: [
        {
          id: "line_1",
          quantity: 1,
          unit_price_cents: 35000,
        },
      ],
      proposal_options: [
        {
          id: "proposal_option_1",
          option_type: "option",
          option_title: "Pressure wash proposal",
          pricing_label: "Investment",
          price_amount_cents: 0,
          scope_content: [],
          fee_rows: [],
          notes: "",
          metadata: {
            auto_generated_from_bid: true,
          },
        },
      ],
    };

    const merged = api.mergeDraftDefaults(draft);

    expect(merged.proposal_options).toHaveLength(1);
    expect(merged.proposal_options[0]).toMatchObject({
      id: "proposal_option_1",
      option_title: "Pressure wash proposal",
      price_amount_cents: 35000,
      metadata: {
        auto_generated_from_bid: true,
      },
    });
    expect(merged.proposal_options[0].scope_content).toEqual([
      { text: "Soft wash siding and exterior trim" },
    ]);
  });

  test("mergeDraftDefaults leaves customized proposal options untouched", () => {
    const api = loadProposalDocuments();
    const draft = {
      title: "Pressure wash proposal",
      project_summary: "Exterior wash proposal",
      scope_of_work: "Soft wash siding and exterior trim",
      line_items: [
        {
          id: "line_1",
          quantity: 1,
          unit_price_cents: 35000,
        },
      ],
      proposal_options: [
        {
          id: "proposal_option_custom",
          option_type: "option",
          option_title: "Premium package",
          pricing_label: "Client investment",
          price_amount_cents: 42500,
          scope_content: [{ text: "Custom scope" }],
          fee_rows: [],
          notes: "Custom notes",
          metadata: {},
        },
      ],
    };

    const merged = api.mergeDraftDefaults(draft);

    expect(merged.proposal_options[0]).toMatchObject({
      id: "proposal_option_custom",
      option_title: "Premium package",
      pricing_label: "Client investment",
      price_amount_cents: 42500,
      notes: "Custom notes",
    });
    expect(merged.proposal_options[0].scope_content).toEqual([{ text: "Custom scope" }]);
  });
});
