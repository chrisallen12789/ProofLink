"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadCustomerDetail(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-customer-detail.js"),
    "utf8"
  );

  const context = {
    window: {},
    console,
    LEADS_CACHE: [],
    BIDS_CACHE: [],
    JOBS_CACHE: [],
    switchTab: vi.fn(),
    showToast: vi.fn(),
    $: vi.fn(() => null),
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window;
}

describe("operator customer detail", () => {
  test("bidGrandTotalCents falls back to included line items when total is missing", () => {
    const api = loadCustomerDetail();

    expect(api.bidGrandTotalCents({
      line_items: [
        { kind: "base", quantity: 2, unit_price_cents: 15000 },
        { kind: "allowance", quantity: 1, unit_price_cents: 5000 },
        { kind: "option", quantity: 1, unit_price_cents: 9000 },
      ],
    })).toBe(35000);
  });

  test("bidGrandTotalCents prefers explicit totals when present", () => {
    const api = loadCustomerDetail();

    expect(api.bidGrandTotalCents({
      total_cents: 42000,
      line_items: [
        { kind: "base", quantity: 1, unit_price_cents: 1000 },
      ],
    })).toBe(42000);
  });

  test("customerMemoryChecklist reflects repeat-service memory for landscaping", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      address_line1: "123 Main St",
      city: "Tulsa",
      state: "OK",
      zip: "74103",
      access_notes: "Gate code 4421",
      service_plan_name: "Weekly mow",
    }, {
      business: {
        key: "landscaping",
      },
    });

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.label)).toEqual([
      "Property profile",
      "Access notes",
      "Repeat-service memory",
      "Seasonal opportunities",
    ]);
    expect(items.slice(0, 3).every((item) => item.ready)).toBe(true);
    expect(items[3].ready).toBe(false);
  });

  test("customerMemoryChecklist highlights cleaning visit cadence and checklist memory", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      address_line1: "455 Elm St",
      city: "Dallas",
      state: "TX",
      zip: "75001",
      entry_notes: "Use side entrance",
      checklist_notes: "Kitchen first, then upstairs bath",
      recurring_notes: "Every other Tuesday",
    }, {
      business: {
        key: "cleaning",
      },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Site profile",
      "Access instructions",
      "Scope memory",
      "Visit cadence",
    ]);
    expect(items.every((item) => item.ready)).toBe(true);
  });

  test("customerMemoryChecklist captures HVAC equipment and diagnostic memory", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      equipment_serial: "TRN-44921",
      access_notes: "Mechanical room behind unit 3",
      failure_symptoms: "Short cycling after 10 minutes",
      parts_follow_up: "Control board ordered",
    }, {
      business: {
        key: "hvac",
      },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Equipment history",
      "Site and access",
      "Diagnostic memory",
      "Follow-up context",
    ]);
    expect(items.every((item) => item.ready)).toBe(true);
  });

  test("customerMemoryChecklist keeps plumbing emergency and repair follow-through visible", () => {
    const api = loadCustomerDetail();

    const items = api.customerMemoryChecklist({
      fixture_notes: "Second-floor hall bath sink trap replaced in 2025",
      shutoff_notes: "Whole-home shutoff in garage closet",
      emergency_notes: "Ceiling leak over dining room",
      restoration_notes: "Drywall patch likely after repair",
    }, {
      business: {
        key: "plumbing",
      },
    });

    expect(items.map((item) => item.label)).toEqual([
      "Fixture history",
      "Site and shutoff",
      "Emergency context",
      "Repair follow-through",
    ]);
    expect(items.every((item) => item.ready)).toBe(true);
  });

  test("customerCollectionGuidance highlights the first payment step when money is still open", () => {
    const api = loadCustomerDetail({
      formatDateTime: (value) => `formatted:${value}`,
    });

    const guidance = api.customerCollectionGuidance(
      { email: "owner@example.com" },
      [{ id: "order_1" }],
      [],
      15000
    );

    expect(guidance.title).toBe("The first payment step is still open");
    expect(guidance.description).toContain("Send the invoice");
  });

  test("customerRelationshipGuidance keeps HVAC follow-through visible before the next visit slips", () => {
    const api = loadCustomerDetail({
      formatDateTime: (value) => `formatted:${value}`,
      formatUsd: (value) => `$${value}`,
    });

    const guidance = api.customerRelationshipGuidance({
      customer: {
        maintenance_notes: "Spring maintenance due in April",
        parts_follow_up: "Control board still waiting on approval",
      },
      openRequestsCount: 0,
      openProposalCount: 1,
      activeOrderCount: 0,
      activeJobCount: 0,
      balance: 12000,
      latestInteraction: { summary: "Customer asked for parts ETA" },
      latestPayment: { paid_at: "2026-03-20" },
      blueprint: {
        business: {
          key: "hvac",
        },
      },
    });

    expect(guidance.title).toBe("Move the live proposal to a decision");
    expect(guidance.items.map((item) => item.label)).toEqual([
      "Open requests",
      "Live proposals",
      "Active work",
      "Money follow-through",
      "System follow-through",
      "Renewal risk",
    ]);
    expect(guidance.items[1].tone).toBe("warn");
    expect(guidance.items[4].note).toContain("Spring maintenance due in April");
    expect(guidance.items[5].ready).toBe(true);
  });

  test("customerRelationshipGuidance flags dormant cleaning cadence before the account cools off", () => {
    const api = loadCustomerDetail({
      formatDateTime: (value) => `formatted:${value}`,
      formatUsd: (value) => `$${value}`,
    });

    const guidance = api.customerRelationshipGuidance({
      customer: {
        recurring_notes: "Every other Tuesday",
        checklist_notes: "Kitchen and upstairs bath",
      },
      openRequestsCount: 0,
      openProposalCount: 0,
      activeOrderCount: 0,
      activeJobCount: 0,
      balance: 0,
      latestInteraction: null,
      latestPayment: null,
      blueprint: {
        business: {
          key: "cleaning",
        },
      },
    });

    expect(guidance.title).toBe("Protect the next repeat visit");
    expect(guidance.items.at(-1).label).toBe("Renewal risk");
    expect(guidance.items.at(-1).ready).toBe(false);
    expect(guidance.items.at(-1).note).toContain("next visit");
  });

  test("customerRepeatCadenceInsight reports how far a repeat account is past its usual rhythm", () => {
    const api = loadCustomerDetail();

    const insight = api.customerRepeatCadenceInsight({
      recurring_notes: "Every other Tuesday",
      last_service_on: "2026-02-15T00:00:00.000Z",
    }, new Date("2026-03-28T00:00:00.000Z"));

    expect(insight.cadenceDays).toBe(14);
    expect(insight.overdueDays).toBe(27);
    expect(insight.message).toContain("27 days past that rhythm");
  });

  test("customerReactivationActions recommends scheduling the next visit for a dormant repeat account", () => {
    const api = loadCustomerDetail();

    const actions = api.customerReactivationActions({
      customer: {
        recurring_notes: "Every other Tuesday",
        checklist_notes: "Kitchen and upstairs bath",
      },
      openRequestsCount: 0,
      openProposalCount: 0,
      activeOrderCount: 0,
      activeJobCount: 0,
      blueprint: {
        business: {
          key: "cleaning",
        },
      },
    });

    expect(actions.map((action) => action.label)).toEqual([
      "Schedule next cleaning visit",
      "Create cleaning follow-up request",
    ]);
  });

  test("customerReactivationActions treats HVAC parts follow-up as a real repeat-service recovery signal", () => {
    const api = loadCustomerDetail();

    const actions = api.customerReactivationActions({
      customer: {
        parts_follow_up: "Bring capacitor approval paperwork",
        warranty_notes: "Warranty visit can be staged next week",
      },
      openRequestsCount: 0,
      openProposalCount: 0,
      activeOrderCount: 0,
      activeJobCount: 0,
      blueprint: {
        business: {
          key: "hvac",
        },
      },
    });

    expect(actions.map((action) => action.label)).toEqual([
      "Schedule next system visit",
      "Create maintenance follow-up request",
    ]);
  });

  test("customerRetentionWorkflowActions prefers generating booked work when an active recurring plan is due", () => {
    const api = loadCustomerDetail({
      SERVICE_PLANS_CACHE: [{
        id: "plan_1",
        customer_id: "customer_1",
        status: "active",
        next_run_on: "2026-03-20",
      }],
      CRM_ORDERS_CACHE: [],
    });

    const actions = api.customerRetentionWorkflowActions({
      customer: {
        id: "customer_1",
        recurring_notes: "Every other Tuesday",
      },
      blueprint: {
        business: {
          key: "cleaning",
        },
      },
    });

    expect(actions.map((action) => action.label)).toEqual([
      "Generate next booked work",
      "Draft cleaning follow-up request",
      "Open customer",
    ]);
  });

  test("customerRetentionWorkflowActions can switch into one-click request creation", () => {
    const api = loadCustomerDetail();

    const actions = api.customerRetentionWorkflowActions({
      customer: {
        id: "customer_1",
        recurring_notes: "Every other Tuesday",
      },
      blueprint: {
        business: {
          key: "cleaning",
        },
      },
      requestAction: "create-request",
      requestLabel: api.customerCreateRequestActionLabel({ business: { key: "cleaning" } }),
    });

    expect(actions.map((action) => `${action.action}:${action.label}`)).toEqual([
      "reactivate-repeat:Schedule next cleaning visit",
      "create-request:Create cleaning follow-up request",
      "open-reactivation-customer:Open customer",
    ]);
  });

  test("openCustomerPlanOrder runs the linked recurring plan when the next booked work is ready", async () => {
    const runServicePlanRecord = vi.fn(async () => ({
      existing: false,
      order: { id: "order_generated_1" },
    }));
    const switchTab = vi.fn();
    const showToast = vi.fn();
    const api = loadCustomerDetail({
      switchTab,
      showToast,
      SERVICE_PLANS_CACHE: [{
        id: "plan_1",
        customer_id: "customer_1",
        status: "active",
        next_run_on: "2026-03-20",
      }],
      CRM_ORDERS_CACHE: [],
      window: {
        PROOFLINK_OPERATOR_LEAD_PLAN_WORKSPACE: {
          runServicePlanRecord,
        },
      },
    });

    expect(api.openCustomerPlanOrder({
      id: "customer_1",
      name: "Quiet Cleaning",
      recurring_notes: "Every other Tuesday",
    })).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(runServicePlanRecord).toHaveBeenCalledWith(expect.objectContaining({ id: "plan_1" }));
    expect(showToast).toHaveBeenCalledWith("Generating the next booked work from the recurring plan...");
  });

  test("openCustomerRequestDraft prefills a smarter HVAC follow-up request", () => {
    const leadCustomerId = { value: "" };
    const leadContactName = { value: "" };
    const leadContactEmail = { value: "" };
    const leadContactPhone = { value: "" };
    const leadPreferredContact = { value: "" };
    const leadRequestedService = { value: "" };
    const leadTitle = { value: "" };
    const leadServiceAddress = { value: "" };
    const leadSummary = { value: "", focus: vi.fn() };
    const leadNotes = { value: "" };
    const api = loadCustomerDetail({
      clearLeadForm: vi.fn(),
      renderLeadCustomerOptions: vi.fn(),
      setInlineMessage: vi.fn(),
      leadMsg: {},
      leadCustomerId,
      leadContactName,
      leadContactEmail,
      leadContactPhone,
      leadPreferredContact,
      leadRequestedService,
      leadTitle,
      leadServiceAddress,
      leadSummary,
      leadNotes,
    });

    api.openCustomerRequestDraft({
      id: "customer_1",
      name: "Harbor Suites",
      email: "ops@example.com",
      phone: "555-111-2222",
      preferred_contact: "email",
      address_line1: "455 Elm St",
      city: "Dallas",
      state: "TX",
      zip: "75001",
      maintenance_notes: "Spring maintenance visit due next month",
      parts_follow_up: "Bring capacitor approval paperwork",
      equipment_notes: "Carrier rooftop unit RTU-2",
    }, {}, { business: { key: "hvac" } });

    expect(leadRequestedService.value).toBe("Maintenance follow-up");
    expect(leadTitle.value).toBe("Harbor Suites maintenance follow-up");
    expect(leadServiceAddress.value).toContain("455 Elm St");
    expect(leadSummary.value).toContain("Bring capacitor approval paperwork");
    expect(leadNotes.value).toContain("Carrier rooftop unit RTU-2");
  });

  test("createCustomerRequestRecord saves a real follow-up request when the lead workspace is ready", async () => {
    const saveLeadRecord = vi.fn(async () => ({ id: "lead_created_1" }));
    const switchTab = vi.fn();
    const showToast = vi.fn();
    const api = loadCustomerDetail({
      switchTab,
      showToast,
      window: {
        PROOFLINK_OPERATOR_LEAD_PLAN_WORKSPACE: {
          saveLeadRecord,
        },
      },
    });

    expect(api.createCustomerRequestRecord({
      id: "customer_1",
      name: "Harbor Suites",
      email: "ops@example.com",
      phone: "555-111-2222",
      preferred_contact: "email",
      maintenance_notes: "Spring maintenance visit due next month",
    }, {
      successMessage: "Created from closeout.",
      sourceRecordType: "job",
      sourceRecordId: "job_1",
    }, { business: { key: "hvac" } })).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(saveLeadRecord).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: "customer_1",
      contact_name: "Harbor Suites",
      requested_service_type: "Maintenance follow-up",
      metadata: expect.objectContaining({
        created_from: "customer_retention",
        source_record_type: "job",
        source_record_id: "job_1",
      }),
    }));
  });

  test("customerPostWorkGuidance keeps plumbing closeout and collection visible after the repair", () => {
    const api = loadCustomerDetail({
      formatDateTime: (value) => `formatted:${value}`,
      formatUsd: (value) => `$${value}`,
    });

    const guidance = api.customerPostWorkGuidance({
      customer: {
        restoration_notes: "Drywall patch visit still needs scheduling",
        issue_summary: "Leak was isolated under the upstairs vanity",
      },
      customerOrders: [{
        id: "order_1",
        status: "completed",
        updated_at: "2026-03-26T15:00:00Z",
      }],
      customerJobs: [{
        id: "job_1",
        status: "completed",
        completed_at: "2026-03-26T16:00:00Z",
      }],
      balance: 8400,
      blueprint: {
        business: {
          key: "plumbing",
        },
      },
    });

    expect(guidance.title).toBe("Turn finished work into the next easy step");
    expect(guidance.description).toContain("formatted:2026-03-26T16:00:00Z");
    expect(guidance.items.map((item) => item.label)).toEqual([
      "Repair closeout stays visible",
      "Issue history is reusable",
      "Final money step",
    ]);
    expect(guidance.items[0].note).toContain("Drywall patch visit still needs scheduling");
    expect(guidance.items[2].note).toContain("$8400");
  });




  test("customerMaintenanceQueueBuckets separates overdue and due-soon assets", () => {
    const api = loadCustomerDetail();
    const buckets = api.customerMaintenanceQueueBuckets([
      { id: "a1", asset_name: "Pit A", address: "Building A", next_service_due_date: "2026-03-01" },
      { id: "a2", asset_name: "Pit B", address: "Building B", next_service_due_date: "2026-04-10" },
      { id: "a3", asset_name: "Pit C", address: "Building C", next_service_due_date: "2026-06-15" },
    ], new Date("2026-03-31T00:00:00Z"));

    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.dueSoon).toHaveLength(1);
    expect(buckets.scheduledLater).toHaveLength(1);
  });

  test("addDaysToIsoDate computes next maintenance date from a closeout date", () => {
    const api = loadCustomerDetail();
    expect(api.addDaysToIsoDate("2026-03-31", 30)).toBe("2026-04-30");
  });

  test("customer workspace helper builds query string for API drilldown", () => {
    const api = loadCustomerDetail();
    const query = api.customerWorkspaceQueryString("cust_123");

    expect(query).toContain("customer_id=cust_123");
    expect(query).toContain("include_closed=true");
  });

  test("customer detail source uses shared memory checklist classes", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "operator/operator-customer-detail.js"),
      "utf8"
    );

    expect(source).toContain("memory-checklist");
    expect(source).toContain("memory-checklist__item");
    expect(source).toContain("memory-checklist__item--ready");
    expect(source).toContain("customerRelationshipGuidance");
    expect(source).toContain("customerPostWorkGuidance");
    expect(source).toContain("customerRepeatPlanState");
    expect(source).toContain("customerCreateRequestActionLabel");
    expect(source).toContain("/.netlify/functions/get-customer-workspace");
    expect(source).toContain("Customer operations hub");
    expect(source).toContain("Photos & docs");
    expect(source).toContain("Open full job workspace");
    expect(source).toContain("customer-job-detail-card");
    expect(source).toContain("btnApplyCustomerWorkspaceFilters");
    expect(source).toContain("Building filter");
    expect(source).toContain("Job type filter");
    expect(source).toContain("Save maintenance window");
    expect(source).toContain("Maintenance follow-up");
    expect(source).toContain("applyCustomerJobMaintenanceWindow");
    expect(source).toContain("customerMaintenanceQueueBuckets");
    expect(source).toContain("Maintenance queue");
    expect(source).toContain("due in 30 days");
    expect(source).toContain("createCustomerRequestRecord");
    expect(source).toContain("Generate next booked work");
    expect(source).toContain("create-request");
    expect(source).toContain("customer-next-step-card");
    expect(source).toContain("After the work wraps");
    expect(source).not.toContain('style="padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;');
    expect(source).not.toContain('background:${item.ready ? "rgba(46,125,50,.10)" : "rgba(255,255,255,.03)"}');
    expect(source).not.toContain('style="margin-top:10px;"');
    expect(source).not.toContain('style="margin-top:14px;"');
    expect(source).not.toContain('style="font-size:.8rem;"');
  });
});
