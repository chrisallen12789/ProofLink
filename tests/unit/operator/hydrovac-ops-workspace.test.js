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
    complianceStageStrip: makeField(),
    complianceActionBar: { innerHTML: "", querySelectorAll: vi.fn(() => []) },
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
    escapeHtml: (value) => String(value),
    escapeAttr: (value) => String(value),
    titleCaseWords: (value) => String(value),
    daysUntil: vi.fn(() => null),
    formatUsd: (value) => `$${Number(value || 0).toFixed(2)}`,
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
});
