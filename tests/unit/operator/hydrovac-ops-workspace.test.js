"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeField() {
  return {
    value: "",
    innerHTML: "",
    addEventListener: vi.fn(),
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
});
