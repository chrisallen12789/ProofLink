"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeField() {
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    hidden: false,
    files: [],
    parentElement: {
      querySelector: vi.fn(() => null),
      insertBefore: vi.fn(),
    },
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    focus: vi.fn(),
  };
}

function loadBidsWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-bids-workspace.js"),
    "utf8"
  );

  const context = {
    console,
    window: { localStorage: { setItem: vi.fn(), getItem: vi.fn(() => "[]") } },
    document: {
      createElement: vi.fn(() => ({
        id: "",
        className: "",
        style: {},
        hidden: false,
        textContent: "",
        setAttribute: vi.fn(),
      })),
      body: { appendChild: vi.fn() },
    },
    BIDS_CACHE: [],
    CUSTOMERS_CACHE: [],
    ACTIVE_BID_ID: "",
    BID_QUICK_CUSTOMER_OPEN: false,
    BID_WORKSPACE_BOOTSTRAPPING: false,
    bidMsg: {},
    bidSearch: makeField(),
    btnNewBid: makeField(),
    btnDuplicateBid: makeField(),
    btnApplyBidProfile: makeField(),
    btnToggleBidQuickCustomer: makeField(),
    btnCancelBidQuickCustomer: makeField(),
    btnSaveBidQuickCustomer: makeField(),
    btnConvertBidToOrder: makeField(),
    bidForm: makeField(),
    bidTitle: makeField(),
    bidCustomerId: makeField(),
    bidProfile: makeField(),
    bidStatus: makeField(),
    bidTemplateType: makeField(),
    bidPreparedByUser: makeField(),
    bidSenderUser: makeField(),
    bidWalkthroughAt: makeField(),
    bidValidUntil: makeField(),
    bidRecipientCompany: makeField(),
    bidAttentionLine: makeField(),
    bidRecipientAddress: makeField(),
    bidProjectName: makeField(),
    bidSubjectLine: makeField(),
    bidIntroText: makeField(),
    bidValuePropositionText: makeField(),
    bidServiceAddress: makeField(),
    bidSiteContact: makeField(),
    bidScheduleWindow: makeField(),
    bidProjectSummary: makeField(),
    bidScopeOfWork: makeField(),
    bidProposedSolution: makeField(),
    bidMaterialsPlan: makeField(),
    bidUnusedMaterialsPlan: makeField(),
    bidExclusions: makeField(),
    bidWarranty: makeField(),
    bidCoverNote: makeField(),
    bidInternalNotes: makeField(),
    bidDepositPercent: makeField(),
    bidDepositAmount: makeField(),
    bidTerms: makeField(),
    bidTermsTemplateId: makeField(),
    bidExclusionsTemplateId: makeField(),
    bidTermsOverride: makeField(),
    bidExclusionsOverride: makeField(),
    bidQuickCustomerCard: { classList: { toggle: vi.fn() } },
    bidQuickCustomerForm: { classList: { toggle: vi.fn() } },
    bidQuickCustomerHeading: { textContent: "" },
    bidQuickCustomerSummary: { textContent: "" },
    bidQuickCustomerName: makeField(),
    bidQuickCustomerEmail: makeField(),
    bidQuickCustomerPhone: makeField(),
    bidQuickCustomerPreferredContact: makeField(),
    bidQuickCustomerNote: makeField(),
    bidQuickCustomerMsg: {},
    bidLineItemId: makeField(),
    bidLineItemName: makeField(),
    bidLineItemKind: makeField(),
    bidLineItemDescription: makeField(),
    bidLineItemQuantity: makeField(),
    bidLineItemUnit: makeField(),
    bidLineItemUnitPrice: makeField(),
    bidLineItemMsg: {},
    bidProposalOptionForm: makeField(),
    bidProposalOptionId: makeField(),
    bidProposalOptionTitle: makeField(),
    bidProposalOptionType: makeField(),
    bidProposalOptionPriceLabel: makeField(),
    bidProposalOptionPrice: makeField(),
    bidProposalOptionPriceUnit: makeField(),
    bidProposalOptionFees: makeField(),
    bidProposalOptionScope: makeField(),
    bidProposalOptionNotes: makeField(),
    btnClearBidProposalOption: makeField(),
    bidProposalOptionMsg: {},
    bidProposalOptionsList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bidPhotoFile: makeField(),
    bidPhotoName: makeField(),
    bidPhotoCategory: makeField(),
    bidPhotoNote: makeField(),
    bidPhotoMsg: {},
    bidFormTitle: { textContent: "" },
    btnClearBidLineItem: makeField(),
    bidPhotoForm: makeField(),
    bidLineItemForm: makeField(),
    btnPrintBidProposal: makeField(),
    btnCopyBidEmail: makeField(),
    btnExportBidJson: makeField(),
    bidGuideFlow: { innerHTML: "" },
    proposalStageStrip: { innerHTML: "" },
    proposalActionBar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bidsList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bidProfileGuide: { innerHTML: "" },
    bidStatsWrap: { innerHTML: "" },
    bidDeliveryWrap: { innerHTML: "" },
    bidPhotoGuide: { innerHTML: "" },
    bidPhotosList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bidScopeStarters: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bidCatalogStarters: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bidLineItemsList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    bidProposalPreview: { innerHTML: "" },
    $: vi.fn(() => makeField()),
    debounce: (fn) => fn,
    currentBid: vi.fn(() => null),
    preferredBidProfile: vi.fn(() => "default"),
    bidStorageKey: vi.fn(() => "prooflink.bid"),
    setInlineMessage: vi.fn(),
    mergeBidDraftCollections: vi.fn((localRows) => localRows),
    fetchPersistedBids: vi.fn(() => Promise.resolve([])),
    draftFromBidRow: vi.fn((row) => row),
    bidRowFromDraft: vi.fn((draft) => draft),
    bidRecordId: vi.fn((row) => row.record_id || row.id),
    bidProfileConfig: vi.fn(() => ({ label: "Default proposal" })),
    findBidCustomer: vi.fn(() => null),
    sortedCustomers: vi.fn((rows) => rows),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    cloneJson: (value, fallback = null) => (value == null ? fallback : JSON.parse(JSON.stringify(value))),
    money: (value) => Number(value || 0).toFixed(2),
    toCents: (value) => Math.round(Number(value || 0) * 100),
    formatDateOnly: (value) => String(value),
    opId: vi.fn(() => "operator_1"),
    sb: {
      from: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: { id: "bid_1" }, error: null })),
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
          getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://cdn.example/proposal.jpg" } })),
        })),
      },
    },
    TENANT_ID: "tenant_1",
    TENANT_COLUMN: "tenant_id",
    OPERATOR_COLUMN: "operator_id",
    currentWorkspaceBlueprint: vi.fn(() => ({})),
    isServiceWorkspace: vi.fn(() => true),
    showConfirmModal: vi.fn(() => Promise.resolve(true)),
    saveCustomerRecord: vi.fn(() => Promise.resolve({ id: "customer_1", name: "Logan" })),
    renderOrders: vi.fn(),
    switchTab: vi.fn(),
    markWorkspaceClean: vi.fn(),
    loadPersistedBids: vi.fn(() => Promise.resolve()),
    renderBids: vi.fn(),
    renderBidWorkspace: vi.fn(),
    renderBidList: vi.fn(),
    convertBidToTrackedOrder: vi.fn(() => Promise.resolve({ existed: false })),
    getAccessToken: vi.fn(() => Promise.resolve("token")),
    fetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    uploadBidPhotoAsset: vi.fn(() => Promise.resolve({ url: "https://cdn.example/photo.jpg", storage_mode: "cloud" })),
    mergeBidLineItem: vi.fn((existing, next) => ({ ...existing, ...next })),
    createLocalId: vi.fn((prefix) => `${prefix}_1`),
    defaultBidTitleFromDraft: vi.fn(() => "Walkthrough proposal"),
    hydrateBidPhotoCategoryOptions: vi.fn(),
    calculateBidTotals: vi.fn(() => ({ total: 0 })),
    bidIncludedLineItemsForOrder: vi.fn(() => []),
    bidLineItemTotalCents: vi.fn((item) => Number(item?.quantity || 0) * Number(item?.unit_price_cents || 0)),
    formatBidStatus: vi.fn((value) => value),
    slugify: (value) => String(value || "").toLowerCase().replace(/\s+/g, "-"),
    fileToDataUrl: vi.fn(() => Promise.resolve("data:image/png;base64,abc")),
    URL: { createObjectURL: vi.fn(() => "blob:url"), revokeObjectURL: vi.fn() },
    Blob,
    ...overrides,
  };

  if (overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL) {
    context.window.PROOFLINK_OPERATOR_CUSTOMER_DETAIL = overrides.PROOFLINK_OPERATOR_CUSTOMER_DETAIL;
  }

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator bids workspace", () => {
  test("keeps proposal-to-booked-work language plain for service work", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-bids-workspace.js"),
      "utf8"
    );

    expect(source).toContain("Move into booked work");
    expect(source).toContain("Open booked work");
    expect(source).toContain("Keep the trade details attached to the proposal");
    expect(source).toContain("bidCustomerMemoryItems");
    expect(source).toContain("Keep the decision path obvious");
    expect(source).toContain("bidFollowThroughItems");
    expect(source).toContain("No proposal drafts yet.");
    expect(source).toContain("Proposal emailed to ${customer.email}.");
    expect(source).toContain("data-proposal-settings-focus");
    expect(source).toContain("Each item disappears here as soon as it is configured.");
    expect(source).not.toContain("quoted / booked");
    expect(source).not.toContain("Sending…");
    expect(source).not.toContain("✓ Proposal emailed");
  });

  test("sortedBids filters by customer and proposal label text", () => {
    const context = loadBidsWorkspace({
      BIDS_CACHE: [
        { id: "bid_1", title: "Front yard cleanup", customer_id: "customer_1", profile: "landscaping", updated_at: "2026-03-26T10:00:00Z" },
        { id: "bid_2", title: "Truck dispatch", customer_id: "customer_2", profile: "hydrovac", updated_at: "2026-03-25T10:00:00Z" },
      ],
      bidProfileConfig: vi.fn((value) => ({ label: value === "landscaping" ? "Landscape proposal" : "Hydrovac proposal" })),
      findBidCustomer: vi.fn((id) => (id === "customer_1" ? { name: "Logan's Lawn Care" } : { name: "Benkari" })),
    });

    const rows = context.window.sortedBids("logan");

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("bid_1");
  });

  test("initBidWorkspaceBindings only wires listeners once", () => {
    const context = loadBidsWorkspace();

    context.window.initBidWorkspaceBindings();
    context.window.initBidWorkspaceBindings();

    expect(context.bidSearch.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnNewBid.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.bidForm.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.bidPhotoForm.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnExportBidJson.addEventListener).toHaveBeenCalledTimes(1);
  });

  test("bidCustomerMemoryItems reuses business-specific customer memory when available", () => {
    const context = loadBidsWorkspace({
      findBidCustomer: vi.fn(() => ({ id: "customer_1", name: "Logan's Lawn Care" })),
      PROOFLINK_OPERATOR_CUSTOMER_DETAIL: {
        customerMemoryChecklist: vi.fn(() => ([
          { label: "Property profile", ready: true, note: "Front yard beds and stone border" },
          { label: "Access notes", ready: false, note: "Need the gate code before the crew arrives" },
        ])),
      },
    });

    const items = context.window.bidCustomerMemoryItems({ id: "bid_1", customer_id: "customer_1" });

    expect(items).toEqual([
      { label: "Property profile", ready: true, note: "Front yard beds and stone border" },
      { label: "Access notes", ready: false, note: "Need the gate code before the crew arrives" },
    ]);
  });

  test("bidFollowThroughItems turns HVAC proposal context into a send-and-follow-up checklist", () => {
    const context = loadBidsWorkspace({
      findBidCustomer: vi.fn(() => ({
        id: "customer_1",
        name: "Benkari Mechanical",
        diagnostic_notes: "Compressor tripping on hot afternoons",
        parts_follow_up: "Capacitor quote still waiting on approval",
      })),
      bidIncludedLineItemsForOrder: vi.fn(() => ([{ quantity: 1, unit_price_cents: 32000 }])),
    });

    const items = context.window.bidFollowThroughItems({
      id: "bid_1",
      customer_id: "customer_1",
      status: "sent",
      valid_until: "2026-04-05",
      project_summary: "Cooling is dropping off during peak heat",
      scope_of_work: "Replace failing capacitor and verify system draw",
      cover_note: "Here is the repair proposal from today's site visit.",
      photos: [{ id: "photo_1" }],
    }, {
      business: {
        key: "hvac",
      },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Client decision path",
      "Scope and pricing confidence",
      "Proof and professionalism",
      "System follow-through",
    ]);
    expect(items[0].tone).toBe("warn");
    expect(items[0].note).toContain("valid through");
    expect(items[3].note).toContain("Capacitor quote still waiting on approval");
  });
});
