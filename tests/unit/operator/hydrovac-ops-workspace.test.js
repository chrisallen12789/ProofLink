"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeField() {
  return {
    value: "",
    innerHTML: "",
    addEventListener: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    requestSubmit: vi.fn(),
    focus: vi.fn(),
  };
}

function loadHydrovacOpsWorkspace(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "operator/operator-hydrovac-ops-workspace.js"),
    "utf8"
  );

  const context = {
    console,
    window: {},
    HYDROVAC_FACILITIES_CACHE: [],
    HYDROVAC_MANIFESTS_CACHE: [],
    HYDROVAC_LOCATE_TICKETS_CACHE: [],
    HYDROVAC_DRIVER_COMPLIANCE_CACHE: [],
    HYDROVAC_EQUIPMENT_COMPLIANCE_CACHE: [],
    HYDROVAC_ANALYTICS_CACHE: null,
    HYDROVAC_ALERTS_CACHE: [],
    HYDROVAC_PERMITS_CACHE: [],
    HYDROVAC_ASSETS_CACHE: [],
    ACTIVE_FACILITY_ID: "",
    ACTIVE_MANIFEST_ID: "",
    ACTIVE_LOCATE_ID: "",
    ACTIVE_DRIVER_QUAL_MEMBER_ID: "",
    ACTIVE_PERMIT_ID: "",
    ACTIVE_ASSET_ID: "",
    btnRefreshFacilities: makeField(),
    btnNewFacility: makeField(),
    btnSaveAndAddFacility: makeField(),
    btnClearFacility: makeField(),
    hydrovacFacilityForm: makeField(),
    btnRefreshManifests: makeField(),
    btnRefreshLocates: makeField(),
    btnNewLocate: makeField(),
    btnClearLocate: makeField(),
    btnVerifyLocate: makeField(),
    hydrovacLocateForm: makeField(),
    btnRefreshCompliance: makeField(),
    facilityStageStrip: makeField(),
    facilityActionBar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    manifestStageStrip: makeField(),
    complianceStageStrip: makeField(),
    hydrovacFacilitiesList: makeField(),
    manifestActionBar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    complianceActionBar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    hydrovacManifestsList: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    hydrovacManifestDetailWrap: { innerHTML: "", querySelector: vi.fn(() => null) },
    hydrovacComplianceSummary: makeField(),
    hydrovacComplianceUrgent: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    hydrovacComplianceCoverage: makeField(),
    hydrovacPermitList: makeField(),
    hydrovacPermitDetail: makeField(),
    permitStageStrip: makeField(),
    permitActionBar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    hydrovacAssetList: makeField(),
    hydrovacAssetDetail: makeField(),
    assetStageStrip: makeField(),
    assetActionBar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
    CUSTOMERS_CACHE: [],
    JOBS_CACHE: [],
    CRM_ORDERS_CACHE: [],
    isHydrovacJob: vi.fn(() => false),
    fetchHydrovacFacilities: vi.fn(() => Promise.resolve()),
    fetchHydrovacManifests: vi.fn(() => Promise.resolve()),
    fetchHydrovacLocateTickets: vi.fn(() => Promise.resolve()),
    fetchHydrovacComplianceData: vi.fn(() => Promise.resolve()),
    fetchJobs: vi.fn(() => Promise.resolve()),
    requestOperatorFunction: vi.fn(() => Promise.resolve({})),
    setInlineMessage: vi.fn(),
    TABS_LOADED: new Set(),
    renderHydrovacFacilities: vi.fn(),
    renderHydrovacManifests: vi.fn(),
    renderHydrovacLocateWorkspace: vi.fn(),
    renderHydrovacCompliance: vi.fn(),
    renderHydrovacPermitsWorkspace: vi.fn(),
    renderHydrovacAssetsWorkspace: vi.fn(),
    $: vi.fn(() => null),
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    titleCaseWords: (value) => String(value),
    hydrovacManifestToneClass: vi.fn(() => "pill"),
    hydrovacManifestQuantityLabel: vi.fn(() => "12 gal"),
    hydrovacMaterialLabel: vi.fn((value) => String(value || "")),
    daysUntil: vi.fn(() => null),
    formatUsd: (value) => `$${Number(value || 0).toFixed(2)}`,
    orderAmountDueCents: vi.fn(() => 0),
    linkedOrderForJob: vi.fn(() => null),
    switchTab: vi.fn(),
    hydrovacFacilityId: makeField(),
    hydrovacFacilityName: makeField(),
    hydrovacFacilityStatus: makeField(),
    hydrovacFacilityType: makeField(),
    hydrovacFacilityPermitExpiry: makeField(),
    hydrovacFacilityAddress: makeField(),
    hydrovacFacilityCityState: makeField(),
    hydrovacFacilityRateGallon: makeField(),
    hydrovacFacilityRateYard: makeField(),
    hydrovacFacilityMinimumCharge: makeField(),
    hydrovacFacilityContact: makeField(),
    hydrovacFacilityDispatchPhone: makeField(),
    hydrovacFacilityWasteTypes: makeField(),
    hydrovacFacilityNotes: makeField(),
    hydrovacFacilityFormTitle: { textContent: "" },
    hydrovacFacilityMsg: {},
    hydrovacLocateId: makeField(),
    hydrovacLocateJobId: makeField(),
    hydrovacLocateType: makeField(),
    hydrovacLocateNumber: makeField(),
    hydrovacLocateStatus: makeField(),
    hydrovacLocateCenter: makeField(),
    hydrovacLocateState: makeField(),
    hydrovacLocateAddress: makeField(),
    hydrovacLocateValidFrom: makeField(),
    hydrovacLocateValidUntil: makeField(),
    hydrovacLocateNotes: makeField(),
    hydrovacLocateMsg: {},
    FACILITY_SAVE_ADD_ANOTHER: false,
    document: { createElement: vi.fn(() => ({ className: "", innerHTML: "", appendChild: vi.fn() })) },
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

describe("operator hydrovac ops workspace", () => {
  test("parseHydrovacCityState splits city and state cleanly", () => {
    const context = loadHydrovacOpsWorkspace();

    expect(context.window.parseHydrovacCityState("Tulsa, OK")).toEqual({ city: "Tulsa", state_province: "OK" });
    expect(context.window.parseHydrovacCityState("Calgary")).toEqual({ city: "Calgary", state_province: null });
  });

  test("initHydrovacOpsWorkspaceBindings only wires controls once", () => {
    const context = loadHydrovacOpsWorkspace();

    context.window.initHydrovacOpsWorkspaceBindings();
    context.window.initHydrovacOpsWorkspaceBindings();

    expect(context.btnRefreshFacilities.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.hydrovacFacilityForm.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnNewLocate.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.hydrovacLocateForm.addEventListener).toHaveBeenCalledTimes(1);
    expect(context.btnRefreshCompliance.addEventListener).toHaveBeenCalledTimes(1);
  });

  test("renderHydrovacCompliance surfaces logged alerts in the summary", () => {
    const context = loadHydrovacOpsWorkspace({
      HYDROVAC_ALERTS_CACHE: [
        {
          id: "alert_1",
          alert_type: "locate_ticket_missing",
          severity: "critical",
          message: "Dispatch is blocked until an active locate ticket is attached.",
          reference_type: "job",
          resolved: false,
        },
      ],
    });
    context.renderHydrovacPermitsWorkspace = vi.fn();
    context.renderHydrovacAssetsWorkspace = vi.fn();

    context.window.renderHydrovacCompliance([], []);

    expect(context.complianceStageStrip.innerHTML).toContain("record-hero");
    expect(context.complianceStageStrip.innerHTML).toContain("Logged alerts");
    expect(context.hydrovacComplianceSummary.innerHTML).toContain("Audit trail");
    expect(context.hydrovacComplianceUrgent.innerHTML).toContain("locate ticket missing");
    expect(context.hydrovacComplianceCoverage.innerHTML).toContain("Open compliance alerts");
  });

  test("renderHydrovacCompliance surfaces tomorrow carryover truck warnings", () => {
    const tomorrowKey = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    const context = loadHydrovacOpsWorkspace({
      JOBS_CACHE: [
        {
          id: "job_tomorrow",
          title: "Downtown dig",
          scheduled_date: tomorrowKey,
          assigned_truck_id: "truck_1",
        },
      ],
      HYDROVAC_MANIFESTS_CACHE: [
        {
          id: "manifest_live",
          manifest_number: "MAN-42",
          job_id: "job_previous",
          truck_id: "truck_1",
          status: "in_transit",
          metadata: {
            load_still_in_truck: true,
          },
        },
      ],
    });

    context.window.renderHydrovacCompliance([], []);

    expect(context.complianceStageStrip.innerHTML).toContain("Carryover risk");
    expect(context.complianceStageStrip.innerHTML).toContain("Disposal due");
    expect(context.hydrovacComplianceUrgent.innerHTML).toContain("Downtown dig needs the truck cleared");
    expect(context.hydrovacComplianceCoverage.innerHTML).toContain("Tomorrow's carryover warnings");
    expect(context.hydrovacComplianceCoverage.innerHTML).toContain("Disposal workflow board");
  });

  test("renderHydrovacManifests shows live-load records and audit actions", () => {
    const hydrovacManifestsList = {
      innerHTML: "",
      querySelectorAll: vi.fn(() => []),
    };
    const hydrovacManifestDetailWrap = {
      innerHTML: "",
      querySelector: vi.fn(() => null),
    };
    const context = loadHydrovacOpsWorkspace({
      hydrovacManifestsList,
      hydrovacManifestDetailWrap,
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "Vault cleanout",
          customer_name: "Riverfront Milling",
        },
      ],
      CUSTOMERS_CACHE: [
        {
          id: "customer_1",
          name: "Riverfront Milling",
        },
      ],
      HYDROVAC_MANIFESTS_CACHE: [
        {
          id: "manifest_1",
          manifest_number: "MAN-100",
          job_id: "job_1",
          customer_id: "customer_1",
          truck_id: "truck_9",
          status: "in_transit",
          material_type: "slurry",
          disposal_facility_name: "North Yard",
          disposal_ticket_number: "",
          quantity_actual: 12,
          notes: "Keep load isolated until disposal run.",
          metadata: {
            bol_number: "BOL-88",
            load_still_in_truck: true,
            disposal_ready_by: "2026-03-29",
            live_load_hold_reason: "Minimum dump threshold not met",
          },
        },
      ],
    });

    context.window.renderHydrovacManifests();

    expect(context.manifestStageStrip.innerHTML).toContain("record-hero");
    expect(context.manifestActionBar.innerHTML).toContain("workspace-focus-card");
    expect(context.manifestStageStrip.innerHTML).toContain("Live loads");
    expect(context.manifestStageStrip.innerHTML).toContain("Packet gaps");
    expect(hydrovacManifestsList.innerHTML).toContain("Office board");
    expect(hydrovacManifestsList.innerHTML).toContain("MAN-100");
    expect(hydrovacManifestsList.innerHTML).toContain("Live in truck");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("BOL-88");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Prepare customer records email");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Prepare audit handoff");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Copy full audit packet");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Minimum dump threshold not met");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Customer records not prepared");
  });

  test("renderHydrovacManifests builds closeout buckets from crew handoff and manifest state", () => {
    const hydrovacManifestsList = {
      innerHTML: "",
      querySelectorAll: vi.fn(() => []),
    };
    const hydrovacManifestDetailWrap = {
      innerHTML: "",
      querySelector: vi.fn(() => null),
    };
    const context = loadHydrovacOpsWorkspace({
      hydrovacManifestsList,
      hydrovacManifestDetailWrap,
      JOBS_CACHE: [
        {
          id: "job_ready",
          title: "North trench daylighting",
          customer_name: "Riverfront Milling",
          metadata: {
            crew_closeout: {
              load_status: "truck_clear",
              bol_number: "BOL-4401",
              locates_verified_on_site: true,
              permit_status: "closed",
              field_summary: "Crew daylighted the trench and cleared the truck.",
              office_follow_up: ["invoice"],
            },
          },
        },
        {
          id: "job_missing",
          title: "South vault cleanout",
          customer_name: "Metro Utility",
          requires_confined_space_permit: true,
        },
      ],
      CUSTOMERS_CACHE: [
        { id: "customer_ready", name: "Riverfront Milling" },
        { id: "customer_missing", name: "Metro Utility" },
      ],
      HYDROVAC_MANIFESTS_CACHE: [
        {
          id: "manifest_ready",
          manifest_number: "MAN-4401",
          job_id: "job_ready",
          customer_id: "customer_ready",
          status: "confirmed",
          invoiced: false,
          customer_records_prepared_at: "2026-04-03T12:00:00.000Z",
          audit_packet_prepared_at: "2026-04-03T12:30:00.000Z",
          metadata: {
            bol_number: "BOL-4401",
          },
        },
        {
          id: "manifest_missing",
          manifest_number: "MAN-5501",
          job_id: "job_missing",
          customer_id: "customer_missing",
          status: "in_transit",
          invoiced: false,
          metadata: {
            load_still_in_truck: true,
          },
        },
      ],
      HYDROVAC_LOCATE_TICKETS_CACHE: [
        {
          id: "loc_1",
          job_id: "job_ready",
          status: "active",
          valid_until: "2026-04-05T12:00:00.000Z",
          verified_on_site: true,
        },
      ],
      HYDROVAC_PERMITS_CACHE: [
        {
          id: "permit_1",
          job_id: "job_ready",
          status: "closed",
        },
      ],
    });

    context.window.renderHydrovacManifests();

    expect(hydrovacManifestsList.innerHTML).toContain("Closeout lane");
    expect(hydrovacManifestsList.innerHTML).toContain("Needs field handoff");
    expect(hydrovacManifestsList.innerHTML).toContain("Ready to invoice");
    expect(hydrovacManifestsList.innerHTML).toContain("Crew closeout or disposal confirmation is still missing");
    expect(hydrovacManifestsList.innerHTML).toContain("Crew daylighted the trench and cleared the truck.");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Crew handoff");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Use the structured field handoff");
  });

  test("renderHydrovacManifests reads crew closeout from custom_fields when metadata is absent", () => {
    const hydrovacManifestsList = {
      innerHTML: "",
      querySelectorAll: vi.fn(() => []),
    };
    const hydrovacManifestDetailWrap = {
      innerHTML: "",
      querySelector: vi.fn(() => null),
    };
    const context = loadHydrovacOpsWorkspace({
      hydrovacManifestsList,
      hydrovacManifestDetailWrap,
      JOBS_CACHE: [
        {
          id: "job_custom_fields",
          title: "Dock trench recovery",
          customer_name: "Harbor Terminal",
          custom_fields: {
            crew_closeout: {
              load_status: "truck_clear",
              bol_number: "BOL-5501",
              locates_verified_on_site: true,
              permit_status: "not_required",
              field_summary: "Crew cleared the truck and turned over the field package.",
              office_follow_up: ["invoice"],
            },
          },
        },
      ],
      CUSTOMERS_CACHE: [
        { id: "customer_harbor", name: "Harbor Terminal" },
      ],
      HYDROVAC_MANIFESTS_CACHE: [
        {
          id: "manifest_custom_fields",
          manifest_number: "MAN-5501",
          job_id: "job_custom_fields",
          customer_id: "customer_harbor",
          status: "confirmed",
          invoiced: false,
          metadata: {
            bol_number: "BOL-5501",
            customer_records_prepared_at: "2026-04-03T12:00:00.000Z",
            audit_packet_prepared_at: "2026-04-03T12:30:00.000Z",
          },
        },
      ],
    });

    context.window.renderHydrovacManifests();

    expect(hydrovacManifestsList.innerHTML).toContain("Ready to invoice");
    expect(hydrovacManifestsList.innerHTML).toContain("Crew cleared the truck and turned over the field package.");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("BOL-5501");
  });

  test("renderHydrovacCompliance surfaces closeout release blockers", () => {
    const context = loadHydrovacOpsWorkspace({
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "South vault cleanout",
          requires_confined_space_permit: true,
          metadata: {
            crew_closeout: {
              load_status: "live_load_remaining",
              live_load_hold_reason: "Waiting on compatible municipal load",
              disposal_ready_by: "2026-03-29",
              locates_verified_on_site: false,
              permit_status: "needs_office_followup",
              field_summary: "Crew completed the dig but left one compatible load on the truck.",
            },
          },
        },
      ],
      HYDROVAC_MANIFESTS_CACHE: [
        {
          id: "manifest_1",
          manifest_number: "MAN-8801",
          job_id: "job_1",
          status: "in_transit",
          metadata: {
            load_still_in_truck: true,
            disposal_ready_by: "2026-03-29",
          },
        },
      ],
      HYDROVAC_LOCATE_TICKETS_CACHE: [
        {
          id: "loc_1",
          job_id: "job_1",
          status: "active",
          valid_until: "2026-04-05T12:00:00.000Z",
        },
      ],
      HYDROVAC_PERMITS_CACHE: [
        {
          id: "permit_1",
          job_id: "job_1",
          permit_number: "PLCS-8801",
          status: "open",
          permit_valid_until: "2026-04-05T12:00:00.000Z",
        },
      ],
    });

    context.window.renderHydrovacCompliance([], []);

    expect(context.complianceStageStrip.innerHTML).toContain("Release blockers");
    expect(context.hydrovacComplianceUrgent.innerHTML).toContain("MAN-8801: Live load overdue");
    expect(context.hydrovacComplianceUrgent.innerHTML).toContain("MAN-8801: Permit still open");
    expect(context.hydrovacComplianceCoverage.innerHTML).toContain("Closeout release blockers");
  });

  test("renderHydrovacFacilities keeps the zero state inside the command-center board", () => {
    const context = loadHydrovacOpsWorkspace({
      HYDROVAC_FACILITIES_CACHE: [],
    });

    context.window.renderHydrovacFacilities();

    expect(context.facilityStageStrip.innerHTML).toContain("record-hero");
    expect(context.facilityActionBar.innerHTML).toContain("workspace-focus-card");
    expect(context.hydrovacFacilitiesList.innerHTML).toContain("workspace-board");
    expect(context.hydrovacFacilitiesList.innerHTML).toContain("No facilities saved yet");
  });

  test("renderHydrovacPermitsWorkspace turns permit risk into a command center", () => {
    const context = loadHydrovacOpsWorkspace({
      JOBS_CACHE: [
        {
          id: "job_1",
          title: "South vault cleanout",
        },
      ],
      HYDROVAC_PERMITS_CACHE: [
        {
          id: "permit_1",
          job_id: "job_1",
          permit_number: "PLCS-4401",
          space_description: "South vault entry",
          status: "open",
          permit_valid_until: "2026-04-04T17:15:00.000Z",
          atmospheric_readings: [],
          rescue_procedure: "",
        },
      ],
    });

    context.window.renderHydrovacPermitsWorkspace();

    expect(context.permitStageStrip.innerHTML).toContain("record-hero");
    expect(context.permitActionBar.innerHTML).toContain("workspace-focus-card");
    expect(context.hydrovacPermitList.innerHTML).toContain("Entry board");
    expect(context.hydrovacPermitList.innerHTML).toContain("PLCS-4401");
    expect(context.hydrovacPermitDetail.innerHTML).toContain("South vault cleanout");
    expect(context.hydrovacPermitDetail.innerHTML).toContain("Rescue plan");
  });

  test("renderHydrovacPermitsWorkspace keeps the zero state inside the command-center board", () => {
    const context = loadHydrovacOpsWorkspace({
      HYDROVAC_PERMITS_CACHE: [],
    });

    context.window.renderHydrovacPermitsWorkspace();

    expect(context.permitStageStrip.innerHTML).toContain("record-hero");
    expect(context.permitActionBar.innerHTML).toContain("workspace-focus-card");
    expect(context.hydrovacPermitList.innerHTML).toContain("workspace-board");
    expect(context.hydrovacPermitList.innerHTML).toContain("No confined-space permits logged yet");
  });

  test("renderHydrovacAssetsWorkspace keeps service due and defect pressure obvious", () => {
    const context = loadHydrovacOpsWorkspace({
      CUSTOMERS_CACHE: [
        {
          id: "customer_1",
          name: "Riverfront Milling",
        },
      ],
      HYDROVAC_ASSETS_CACHE: [
        {
          id: "asset_1",
          customer_id: "customer_1",
          asset_type: "catch_basin",
          asset_name: "CB-047 Riverfront",
          external_asset_id: "PL-ASSET-047",
          status: "active",
          address: "1200 Water Street, Detroit, MI",
          next_service_due_date: "2026-04-08",
          has_defects: true,
          last_condition_rating: "poor",
          condition_notes: "Heavy sediment and shifted frame.",
          service_count_total: 7,
          last_service_date: "2026-03-26",
        },
      ],
    });

    context.window.renderHydrovacAssetsWorkspace();

    expect(context.assetStageStrip.innerHTML).toContain("record-hero");
    expect(context.assetActionBar.innerHTML).toContain("workspace-focus-card");
    expect(context.hydrovacAssetList.innerHTML).toContain("Asset board");
    expect(context.hydrovacAssetList.innerHTML).toContain("CB-047 Riverfront");
    expect(context.hydrovacAssetDetail.innerHTML).toContain("Riverfront Milling");
    expect(context.hydrovacAssetDetail.innerHTML).toContain("Defects flagged");
  });

  test("renderHydrovacAssetsWorkspace keeps the zero state inside the command-center board", () => {
    const context = loadHydrovacOpsWorkspace({
      HYDROVAC_ASSETS_CACHE: [],
    });

    context.window.renderHydrovacAssetsWorkspace();

    expect(context.assetStageStrip.innerHTML).toContain("record-hero");
    expect(context.assetActionBar.innerHTML).toContain("workspace-focus-card");
    expect(context.hydrovacAssetList.innerHTML).toContain("workspace-board");
    expect(context.hydrovacAssetList.innerHTML).toContain("No infrastructure assets saved yet");
  });
});
