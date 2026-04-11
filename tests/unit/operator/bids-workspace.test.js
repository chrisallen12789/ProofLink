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

function makeContainer() {
  return {
    innerHTML: "",
    textContent: "",
    hidden: false,
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
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
    BID_SYNC_TIMER: null,
    BID_SYNC_IN_FLIGHT: false,
    BID_SYNC_PROMISE: null,
    BID_QUICK_CUSTOMER_OPEN: false,
    BID_WORKSPACE_BOOTSTRAPPING: false,
    CURRENT_OPERATOR: { operator_id: "operator_1" },
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
    bidGuideFlow: makeContainer(),
    proposalStageStrip: makeContainer(),
    proposalActionBar: makeContainer(),
    bidsList: makeContainer(),
    bidProfileGuide: makeContainer(),
    bidStatsWrap: makeContainer(),
    bidDeliveryWrap: makeContainer(),
    bidProposalReadinessWrap: makeContainer(),
    bidEstimateReviewWrap: makeContainer(),
    bidQuoteRescueWrap: makeContainer(),
    bidPhotoGuide: makeContainer(),
    bidPhotosList: makeContainer(),
    bidScopeStarters: makeContainer(),
    bidCatalogStarters: makeContainer(),
    bidLineItemsList: makeContainer(),
    bidProposalPreview: makeContainer(),
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
    requestOperatorFunction: vi.fn(),
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
    expect(source).toContain("bidSignalBand");
    expect(source).toContain("renderBidSignalBand");
    expect(source).toContain("No proposal drafts yet.");
    expect(source).toContain("Proposal emailed to ${customer.email}.");
    expect(source).toContain("data-proposal-settings-focus");
    expect(source).toContain("Each item disappears here as soon as it is configured.");
    expect(source).toContain("Run proposal readiness review");
    expect(source).toContain("proposal_readiness_auditor");
    expect(source).toContain("Run estimate review");
    expect(source).toContain("quote_rescue_manager");
    expect(source).toContain("estimating_assistant");
    expect(source).toContain("bid_id");
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

  test("bidFollowThroughItems keeps hydrovac handoff details visible before conversion", () => {
    const context = loadBidsWorkspace({
      currentWorkspaceBlueprint: vi.fn(() => ({
        business: {
          key: "hydrovac",
          label: "Hydrovac",
          recordFocus: [],
        },
      })),
      findBidCustomer: vi.fn(() => ({
        id: "customer_9",
        name: "Harbor Utilities",
        locate_notes: "811 ticket expires Thursday",
        disposal_notes: "Use South County liquid waste facility",
      })),
      bidIncludedLineItemsForOrder: vi.fn(() => ([{ quantity: 1, unit_price_cents: 780000 }])),
    });

    const items = context.window.bidFollowThroughItems({
      id: "bid_hv_1",
      customer_id: "customer_9",
      status: "ready_to_send",
      project_summary: "Hydrovac daylighting at valve cluster",
      scope_of_work: "Expose and verify utilities around the valve cluster",
      internal_notes: "Truck access through east service road",
      photos: [{ id: "photo_1" }],
      cover_note: "Attached is the field proposal from today's walkthrough.",
    }, {
      business: {
        key: "hydrovac",
      },
    });

    expect(items[3]).toEqual({
      label: "Dispatch and compliance handoff",
      ready: true,
      note: "811 ticket expires Thursday",
      tone: "",
    });
  });

  test("runBidEstimateReview sends bid_id to the structured estimate report", async () => {
    const requestOperatorFunction = vi.fn(async () => ({
      report: {
        summary: "Estimate review ready.",
        summary_status: "ready",
        findings: [],
        blockers: [],
        recommended_actions: [],
        data_used: [],
        generated_at: "2026-04-02T10:00:00.000Z",
      },
      context_summary: {
        bid_id: "bid_remote_1",
      },
      generated_at: "2026-04-02T10:00:00.000Z",
    }));
    const context = loadBidsWorkspace({
      requestOperatorFunction,
      currentBid: vi.fn(() => ({
        id: "bid_local_1",
        record_id: "bid_remote_1",
        title: "Harbor proposal",
      })),
    });

    await context.window.runBidEstimateReview(context.currentBid(), { rerender: false });

    expect(requestOperatorFunction).toHaveBeenCalledWith("ai-agent-report", expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        agent_key: "estimating_assistant",
        bid_id: "bid_remote_1",
      }),
    }));
  });

  test("runBidProposalReadinessReview sends bid_id to the structured readiness report", async () => {
    const requestOperatorFunction = vi.fn(async () => ({
      report: {
        summary: "Proposal readiness review ready.",
        summary_status: "review_needed",
        findings: [],
        blockers: [],
        recommended_actions: [],
        data_used: [],
        generated_at: "2026-04-02T10:00:00.000Z",
      },
      context_summary: {
        bid_id: "bid_remote_3",
        ready_checks: 5,
      },
      generated_at: "2026-04-02T10:00:00.000Z",
    }));
    const context = loadBidsWorkspace({
      requestOperatorFunction,
      currentBid: vi.fn(() => ({
        id: "bid_local_3",
        record_id: "bid_remote_3",
        title: "Harbor proposal",
      })),
    });

    await context.window.runBidProposalReadinessReview(context.currentBid(), { rerender: false });

    expect(requestOperatorFunction).toHaveBeenCalledWith("ai-agent-report", expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        agent_key: "proposal_readiness_auditor",
        bid_id: "bid_remote_3",
      }),
    }));
  });

  test("renderBidEstimateReviewCard surfaces estimate review errors", async () => {
    const requestOperatorFunction = vi.fn(async () => {
      throw new Error("Estimate service unavailable");
    });
    const draft = {
      id: "bid_local_2",
      record_id: "bid_remote_2",
      title: "Dock proposal",
    };
    const context = loadBidsWorkspace({
      requestOperatorFunction,
      currentBid: vi.fn(() => draft),
    });

    await context.window.runBidEstimateReview(draft, { rerender: false });
    context.window.renderBidEstimateReviewCard(draft);

    expect(context.bidEstimateReviewWrap.innerHTML).toContain("Estimate service unavailable");
  });

  test("runBidQuoteRescueReview refreshes the proposal rescue queue", async () => {
    const requestOperatorFunction = vi.fn(async () => ({
      report: {
        summary: "Queue reviewed.",
        summary_status: "review_needed",
        findings: [
          {
            title: "North Plant needs a follow-up",
            detail: "Still ready to follow up.",
            category: "ready_to_follow_up",
            record_refs: [{ record_type: "bid", record_id: "bid_1", label: "North Plant proposal" }],
          },
        ],
        blockers: [],
        recommended_actions: [],
        data_used: [],
        generated_at: "2026-04-02T10:00:00.000Z",
      },
      context_summary: {
        total_records: 1,
        ready_to_follow_up: 1,
        missing_estimate_facts: 0,
        stale_enough_to_rework: 0,
      },
      generated_at: "2026-04-02T10:00:00.000Z",
    }));
    const context = loadBidsWorkspace({
      requestOperatorFunction,
    });

    await context.window.runBidQuoteRescueReview({ rerender: false });
    context.window.renderBidQuoteRescueCard();

    expect(requestOperatorFunction).toHaveBeenCalledWith("ai-agent-report", expect.objectContaining({
      body: expect.objectContaining({
        agent_key: "quote_rescue_manager",
      }),
    }));
    expect(context.bidQuoteRescueWrap.innerHTML).toContain("1 ready");
  });

  test("flushBidDraftSync retries without unsupported bid columns and preserves the local draft field", async () => {
    const localDraft = {
      id: "bid_local_1",
      record_id: "",
      customer_id: "customer_1",
      customer_location_id: "location_1",
      status: "sent",
      title: "Walkthrough proposal",
      created_at: "2026-04-03T10:00:00.000Z",
      updated_at: "2026-04-03T10:00:00.000Z",
      metadata: {},
    };
    const insertPayloads = [];
    const builder = {
      insert: vi.fn((payload) => {
        insertPayloads.push(payload);
        return builder;
      }),
      update: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      single: vi.fn()
        .mockResolvedValueOnce({
          data: null,
          error: {
            code: "PGRST204",
            message: "Could not find the 'customer_location_id' column of 'bids' in the schema cache",
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: "bid_remote_1",
            customer_id: "customer_1",
            status: "sent",
            title: "Walkthrough proposal",
            updated_at: "2026-04-03T10:00:00.000Z",
            metadata: {
              local_draft_id: "bid_local_1",
            },
          },
          error: null,
        }),
    };
    const context = loadBidsWorkspace({
      BIDS_CACHE: [localDraft],
      currentBid: vi.fn(() => context.BIDS_CACHE[0] || null),
      bidRecordId: vi.fn((row) => row.record_id || ""),
      bidRowFromDraft: vi.fn((draft) => ({
        customer_id: draft.customer_id,
        customer_location_id: draft.customer_location_id,
        status: draft.status,
        title: draft.title,
        updated_at: draft.updated_at,
        metadata: draft.metadata || {},
      })),
      draftFromBidRow: vi.fn((row) => ({
        id: row.metadata?.local_draft_id || row.id,
        record_id: row.id,
        customer_id: row.customer_id || "",
        customer_location_id: row.customer_location_id || "",
        status: row.status || "draft",
        title: row.title || "",
        updated_at: row.updated_at || "",
        metadata: row.metadata || {},
      })),
      sb: {
        from: vi.fn(() => builder),
      },
    });

    const syncedDraft = await context.window.flushBidDraftSync({ throwOnError: true });

    expect(insertPayloads).toHaveLength(2);
    expect(insertPayloads[0]).toMatchObject({
      customer_id: "customer_1",
      customer_location_id: "location_1",
    });
    expect(insertPayloads[1]).toMatchObject({
      customer_id: "customer_1",
    });
    expect(insertPayloads[1].customer_location_id).toBeUndefined();
    expect(syncedDraft.record_id).toBe("bid_remote_1");
    expect(syncedDraft.customer_location_id).toBe("location_1");
    expect(context.BIDS_CACHE[0].customer_location_id).toBe("location_1");
  });

  test("flushBidDraftSync runs a fresh sync after waiting for an older in-flight sync", async () => {
    const localDraft = {
      id: "bid_local_pending",
      record_id: "bid_remote_pending",
      customer_id: "customer_1",
      status: "sent",
      title: "Freshly edited proposal",
      updated_at: "2026-04-03T10:05:00.000Z",
      metadata: {},
    };
    const builder = {
      insert: vi.fn(() => builder),
      update: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      single: vi.fn(async () => ({
        data: {
          id: "bid_remote_pending",
          customer_id: "customer_1",
          status: "sent",
          title: "Freshly edited proposal",
          updated_at: "2026-04-03T10:05:00.000Z",
          metadata: {
            local_draft_id: "bid_local_pending",
          },
        },
        error: null,
      })),
    };
    let releaseInFlight;
    const context = loadBidsWorkspace({
      BIDS_CACHE: [localDraft],
      currentBid: vi.fn(() => context.BIDS_CACHE[0] || null),
      bidRecordId: vi.fn((row) => row.record_id || ""),
      bidRowFromDraft: vi.fn((draft) => ({
        customer_id: draft.customer_id,
        status: draft.status,
        title: draft.title,
        updated_at: draft.updated_at,
        metadata: draft.metadata || {},
      })),
      draftFromBidRow: vi.fn((row) => ({
        id: row.metadata?.local_draft_id || row.id,
        record_id: row.id,
        customer_id: row.customer_id || "",
        status: row.status || "draft",
        title: row.title || "",
        updated_at: row.updated_at || "",
        metadata: row.metadata || {},
      })),
      sb: {
        from: vi.fn(() => builder),
      },
    });

    context.BID_SYNC_PROMISE = new Promise((resolve) => {
      releaseInFlight = resolve;
    });

    const syncPromise = context.window.flushBidDraftSync({ throwOnError: true });
    releaseInFlight();
    context.BID_SYNC_PROMISE = null;
    const syncedDraft = await syncPromise;

    expect(builder.update).toHaveBeenCalled();
    expect(syncedDraft.title).toBe("Freshly edited proposal");
    expect(context.BIDS_CACHE[0].record_id).toBe("bid_remote_pending");
  });

  test("loadPersistedBids keeps unsupported local bid columns when remote rows omit them", async () => {
    const localDraft = {
      id: "bid_local_2",
      record_id: "bid_remote_2",
      customer_id: "customer_1",
      customer_location_id: "location_2",
      status: "sent",
      title: "Existing proposal",
      updated_at: "2026-04-03T10:00:00.000Z",
      metadata: {},
    };
    const context = loadBidsWorkspace({
      BIDS_CACHE: [localDraft],
      mergeBidDraftCollections: vi.fn((localRows, remoteRows) => {
        const byId = new Map(localRows.map((row) => [row.id, row]));
        remoteRows.forEach((row) => {
          byId.set(row.id, row);
        });
        return [...byId.values()];
      }),
      fetchPersistedBids: vi.fn(async () => ([{
        id: "bid_remote_2",
        customer_id: "customer_1",
        status: "sent",
        title: "Existing proposal",
        updated_at: "2026-04-03T10:00:00.000Z",
        metadata: {
          local_draft_id: "bid_local_2",
        },
      }])),
      draftFromBidRow: vi.fn((row) => ({
        id: row.metadata?.local_draft_id || row.id,
        record_id: row.id,
        customer_id: row.customer_id || "",
        customer_location_id: row.customer_location_id || "",
        status: row.status || "draft",
        title: row.title || "",
        updated_at: row.updated_at || "",
        metadata: row.metadata || {},
      })),
    });

    context.window.PROOFLINK_BID_UNSUPPORTED_COLUMNS.add("customer_location_id");
    const rows = await context.window.loadPersistedBids();

    expect(rows[0].customer_location_id).toBe("location_2");
    expect(context.BIDS_CACHE[0].customer_location_id).toBe("location_2");
  });
});
