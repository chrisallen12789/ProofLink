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
    manifestStageStrip: makeField(),
    complianceStageStrip: makeField(),
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

    expect(context.complianceStageStrip.innerHTML).toContain("Audit trail");
    expect(context.hydrovacComplianceSummary.innerHTML).toContain("Logged alerts");
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
    expect(context.hydrovacComplianceUrgent.innerHTML).toContain("Downtown dig needs the truck cleared");
    expect(context.hydrovacComplianceCoverage.innerHTML).toContain("Tomorrow's carryover warnings");
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

    expect(context.manifestStageStrip.innerHTML).toContain("Still in truck");
    expect(hydrovacManifestsList.innerHTML).toContain("MAN-100");
    expect(hydrovacManifestsList.innerHTML).toContain("Still in truck");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("BOL-88");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Prepare customer records");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Copy audit summary");
    expect(hydrovacManifestDetailWrap.innerHTML).toContain("Minimum dump threshold not met");
  });
});
