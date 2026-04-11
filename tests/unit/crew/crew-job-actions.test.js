"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadCrew(overrides = {}) {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "crew/crew.js"),
    "utf8"
  );

  const elements = new Map();
  const ensureElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        style: {},
        className: "",
        classList: {
          toggle: vi.fn(),
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn(() => false),
        },
        dataset: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        closest: vi.fn(() => null),
        focus: vi.fn(),
      });
    }
    return elements.get(id);
  };

  const document = {
    getElementById: vi.fn((id) => ensureElement(id)),
    addEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      style: {},
      addEventListener: vi.fn(),
      click: vi.fn(),
      remove: vi.fn(),
      setAttribute: vi.fn(),
    })),
    body: { appendChild: vi.fn() },
    head: { appendChild: vi.fn() },
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  };

  const context = {
    console,
    window: {},
    document,
    navigator: { onLine: true, geolocation: { getCurrentPosition: vi.fn() } },
    indexedDB: { open: vi.fn() },
    fetch: vi.fn(),
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    sessionStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, ensureElement };
}

describe("crew job actions", () => {
  test("renderJobActions surfaces compliance blockers ahead of field actions", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobActions");
    vm.runInContext("ACTIVE_JOB = { compliance_message: 'Locate ticket is required before work can start.' };", context);

    context.renderJobActions("scheduled");

    expect(ensureElement("jobActions").innerHTML).toContain("Locate ticket is required before work can start.");
    expect(ensureElement("jobActions").innerHTML).toContain("Clock In");
    expect(ensureElement("jobActions").innerHTML).toContain("Report Issue");
  });

  test("renderJobActions keeps field memory attached while work is active", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobActions");

    context.renderJobActions("scheduled", {
      service_address: "123 Main St",
      customers: {
        phone: "555-555-1212",
        email: "owner@example.com",
      },
      notes: "Gate code 2468. Watch the back hydrant.",
    });

    expect(ensureElement("jobActions").innerHTML).toContain(
      "Keep in mind before you move this job forward"
    );
    expect(ensureElement("jobActions").innerHTML).toContain("Service location: 123 Main St");
    expect(ensureElement("jobActions").innerHTML).toContain("Customer contact: 555-555-1212 | owner@example.com");
    expect(ensureElement("jobActions").innerHTML).toContain("Scope and notes: Gate code 2468. Watch the back hydrant.");
  });

  test("renderJobActions adds a hydrovac field command card when paperwork pressure exists", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobActions");

    context.renderJobActions("scheduled", {
      business_key: "hydrovac",
      service_address: "1200 Water Street, Detroit, MI",
      truck_live_load_count: 1,
      manifests: [{
        manifest_number: "PLHV-4401",
        metadata: {
          load_state: "live_in_truck",
          live_load_hold_reason: "Waiting for compatible municipal load",
          disposal_ready_by: "2026-04-03",
        },
      }],
      locate_tickets: [{
        ticket_number: "PL-811-4401",
        status: "active",
        valid_until: "2026-04-04T18:30:00.000Z",
      }],
      confined_space_permits: [{
        permit_number: "PLCS-4401",
        status: "open",
        permit_valid_until: "2026-04-03T17:15:00.000Z",
      }],
      requires_confined_space_permit: true,
    });

    expect(ensureElement("jobActions").innerHTML).toContain("Hydrovac command");
    expect(ensureElement("jobActions").innerHTML).toContain("Truck load plan");
    expect(ensureElement("jobActions").innerHTML).toContain("Locate coverage");
    expect(ensureElement("jobActions").innerHTML).toContain("Permit state");
  });

  test("renderJobActions uses clearer paused and completed field guidance", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobActions");

    context.renderJobActions("blocked", { blocker_note: "" });
    expect(ensureElement("jobActions").innerHTML).toContain(
      "Work is paused. Tell the office exactly what is stopping progress"
    );

    context.renderJobActions("completed", {});
    expect(ensureElement("jobActions").innerHTML).toContain("Job complete");
    expect(ensureElement("jobActions").innerHTML).toContain(
      "The office can now handle any remaining invoice or customer follow-through"
    );
  });

  test("fieldActionGuidance keeps the crew guidance plain and reassuring", () => {
    const { context } = loadCrew();

    expect(context.fieldActionGuidance("scheduled", {})).toContain("Clock in when you are on site.");
    expect(context.fieldActionGuidance("in_progress", {})).toContain("closeout is quick");
    expect(context.fieldActionGuidance("completed", {})).toContain("invoice or customer follow-through");
    expect(context.fieldActionGuidance("blocked", { blocker_note: "Customer gate is locked" })).toBe(
      "Blocked: Customer gate is locked"
    );
  });

  test("fieldActionGuidance turns trade context into clearer crew prompts", () => {
    const { context } = loadCrew();

    expect(context.fieldActionGuidance("scheduled", {
      business_key: "cleaning",
      customers: { access_notes: "Use the side door lockbox before 9 AM" },
    })).toContain("Use the side door lockbox before 9 AM");

    expect(context.fieldActionGuidance("in_progress", {
      business_key: "hvac",
      customers: { diagnostic_notes: "Unit freezes after 20 minutes" },
    })).toContain("diagnostic finding");
  });

  test("fieldActionGuidance keeps hydrovac live-load rules visible in the field", () => {
    const { context } = loadCrew();

    expect(context.fieldActionGuidance("scheduled", {
      business_key: "hydrovac",
      truck_live_load_count: 1,
      manifest_metadata: {
        bol_number: "BOL-22",
        live_load_hold_reason: "Minimum load not met yet",
      },
      manifests: [{ manifest_number: "MAN-9", metadata: { load_state: "live_in_truck" } }],
    })).toContain("keep that load isolated");

    expect(context.fieldActionGuidance("in_progress", {
      business_key: "hydrovac",
    })).toContain("BOL");
  });

  test("crewJobMemoryItems fills in missing basics with clear prompts", () => {
    const { context } = loadCrew();

    const items = context.crewJobMemoryItems({});

    expect(items).toContain("Service location is missing. Confirm the address with the office before you travel.");
    expect(items).toContain("Customer contact is missing. Ask the office for the best number before access becomes a problem.");
    expect(items).toContain("Scope and notes are still light. Add a field note if the work changes so the office can finish strong.");
  });

  test("crewJobMemoryItems adds trade-specific field memory where it matters", () => {
    const { context } = loadCrew();

    const items = context.crewJobMemoryItems({
      business_key: "plumbing",
      service_address: "44 Pipe St",
      customers: {
        phone: "555-333-1111",
        shutoff_notes: "Main shutoff is behind the laundry panel",
        issue_summary: "Kitchen sink backs up when disposal runs",
      },
      notes: "Bring disposal adapter",
    });

    expect(items).toContain("Shutoff and access: Main shutoff is behind the laundry panel");
    expect(items).toContain("Repair context: Kitchen sink backs up when disposal runs");
  });

  test("crewJobMemoryItems adds hydrovac load memory when a truck is still carrying material", () => {
    const { context } = loadCrew();

    const items = context.crewJobMemoryItems({
      business_key: "hydrovac",
      service_address: "77 Trench Rd",
      manifests: [{
        manifest_number: "MAN-44",
        metadata: {
          load_state: "live_in_truck",
          bol_number: "BOL-44",
          live_load_hold_reason: "Waiting for a full compatible load",
          disposal_ready_by: "2026-03-29",
        },
      }],
    });

    expect(items).toContain("Live load on truck: MAN-44");
    expect(items).toContain("Bill of lading: BOL-44");
    expect(items).toContain("Live-load plan: Waiting for a full compatible load");
    expect(items).toContain("Disposal timing: Clear this load by 2026-03-29 so tomorrow does not get blocked.");
  });

  test("renderJobCards surfaces hydrovac job signals on the home list", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobsList");

    context.renderJobCards([
      {
        id: "job_1",
        status: "scheduled",
        business_key: "hydrovac",
        scheduled_date: "2026-04-03",
        scheduled_time: "08:00:00",
        service_address: "1200 Water Street, Detroit, MI",
        customers: {
          name: "Riverfront Milling",
        },
        title: "North trench daylighting",
        manifests: [{
          manifest_number: "PLHV-4401",
          metadata: {
            load_state: "live_in_truck",
          },
        }],
        locate_tickets: [{
          ticket_number: "PL-811-4401",
          status: "active",
          valid_until: "2099-04-05T18:30:00.000Z",
        }],
        confined_space_permits: [{
          permit_number: "PLCS-4401",
          status: "open",
          permit_valid_until: "2099-04-05T17:15:00.000Z",
        }],
        requires_confined_space_permit: true,
      },
    ]);

    expect(ensureElement("jobsList").innerHTML).toContain("job-card--hydrovac");
    expect(ensureElement("jobsList").innerHTML).toContain("Live load PLHV-4401");
    expect(ensureElement("jobsList").innerHTML).toContain("1 locate active");
    expect(ensureElement("jobsList").innerHTML).toContain("1 permit open");
  });

  test("renderJobCards can explain when the home list is showing upcoming fallback work", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("jobsList");

    context.renderJobCards([
      {
        id: "job_future_1",
        status: "scheduled",
        scheduled_date: "2026-04-10",
        scheduled_time: "09:00:00",
        service_address: "44 Service Drive, Detroit, MI",
        customers: { name: "Riverfront Milling" },
        title: "South vault cleanout",
      },
    ], {
      emptyMessage: "No jobs scheduled for today. Showing your next assigned work.",
    });

    expect(ensureElement("jobsList").innerHTML).toContain("Showing your next assigned work");
    expect(ensureElement("jobsList").innerHTML).toContain("South vault cleanout");
  });

  test("renderCrewSitePacketCard keeps the office handoff visible in the field", () => {
    const { context } = loadCrew();

    const html = context.renderCrewSitePacketCard({
      business_key: "hydrovac",
      site_packet: {
        site_label: "North trench daylighting",
        site_address: "1200 Water Street, Detroit, MI",
        access_notes: "Stage at gate 3 and keep the truck clear of the boring crew.",
        site_notes: "Vault throat is permit-required and the north trench is marked.",
        contact_name: "Riley Stone",
        contact_phone: "555-440-1000",
        current_photo_count: 3,
        recent_work: [
          {
            title: "Basin throat exposure",
            status: "completed",
            scheduled_date: "2026-04-02",
            notes: "Truck left with one isolated load pending disposal.",
          },
        ],
      },
    });

    expect(html).toContain("Field packet");
    expect(html).toContain("North trench daylighting");
    expect(html).toContain("gate 3");
    expect(html).toContain("Riley Stone");
    expect(html).toContain("Recent site work");
    expect(html).toContain("Basin throat exposure");
  });

  test("crewJobMemoryItems prefers the site packet when the office already built a field handoff", () => {
    const { context } = loadCrew();

    const items = context.crewJobMemoryItems({
      business_key: "hydrovac",
      site_packet: {
        site_label: "South vault cleanout",
        site_address: "44 Service Drive, Detroit, MI",
        access_notes: "Meet the inspector at the retaining wall gate.",
        contact_phone: "555-440-2000",
        site_notes: "Confined-space entry starts after the air meter check.",
        recent_work: [
          {
            title: "North trench daylighting",
            status: "completed",
            scheduled_date: "2026-04-02",
          },
        ],
      },
    });

    expect(items).toContain("Site packet: South vault cleanout");
    expect(items).toContain("Service location: 44 Service Drive, Detroit, MI");
    expect(items).toContain("Customer contact: 555-440-2000");
    expect(items).toContain("Access and staging: Meet the inspector at the retaining wall gate.");
    expect(items).toContain("Recent site work: North trench daylighting | Completed | 2026-04-02");
  });

  test("renderHydrovacCompletionForm lays out the structured closeout cards", () => {
    const { context } = loadCrew();

    const html = context.renderHydrovacCompletionForm({
      business_key: "hydrovac",
      requires_confined_space_permit: true,
      completion_handoff: {
        load_status: "truck_clear",
        field_summary: "Crew daylighted the trench and cleared the truck.",
        office_follow_up: ["invoice", "customer_records"],
      },
      confined_space_permits: [{
        permit_number: "PLCS-4401",
        status: "open",
      }],
    });

    expect(html).toContain("Load and disposal");
    expect(html).toContain("Locate and permit");
    expect(html).toContain("Office handoff");
    expect(html).toContain("Choose load status");
    expect(html).toContain("Customer records");
    expect(html).toContain("Invoice");
  });

  test("validateHydrovacCompletionHandoff enforces live-load and permit requirements", () => {
    const { context } = loadCrew();

    const invalid = context.validateHydrovacCompletionHandoff({
      load_status: "live_load_remaining",
      field_summary: "Crew kept one compatible load on the truck.",
      permit_status: "",
    }, {
      business_key: "hydrovac",
      requires_confined_space_permit: true,
      confined_space_permits: [{ permit_number: "PLCS-4401", status: "open" }],
    });

    expect(invalid.ok).toBe(false);
    expect(invalid.error).toContain("live load");

    const valid = context.validateHydrovacCompletionHandoff({
      load_status: "live_load_remaining",
      live_load_hold_reason: "Waiting on compatible municipal load",
      disposal_ready_by: "2026-04-04",
      field_summary: "Crew daylighted the trench and staged the live load for tomorrow morning.",
      permit_status: "open_and_safe",
    }, {
      business_key: "hydrovac",
      requires_confined_space_permit: true,
      confined_space_permits: [{ permit_number: "PLCS-4401", status: "open" }],
    });

    expect(valid.ok).toBe(true);
  });

  test("showCompletionScreen swaps hydrovac jobs into the structured closeout flow", () => {
    const { context, ensureElement } = loadCrew();
    ensureElement("completionNote");
    ensureElement("completionJobTitle");
    ensureElement("completionPhotoWarn").querySelector = vi.fn(() => ({ textContent: "" }));
    ensureElement("completionHydrovacOverview");
    ensureElement("completionStandardFields");
    ensureElement("completionHydrovacFields");
    ensureElement("completionPreviewWrap");
    ensureElement("completionPreviewCard");
    ensureElement("completionSubmitNote");
    ensureElement("completionFlow");
    context.clearSignature = vi.fn();
    context.initSignatureCanvas = vi.fn();
    context.showScreen = vi.fn();
    vm.runInContext(`ACTIVE_JOB = ${JSON.stringify({
      id: "job_1",
      business_key: "hydrovac",
      title: "North trench daylighting",
      photos: [{ photo_type: "after" }],
      manifests: [{ manifest_number: "MAN-100", metadata: { load_state: "live_in_truck" } }],
      locate_tickets: [{ ticket_number: "PL-811-4401", status: "active", valid_until: "2026-04-04T18:30:00.000Z" }],
      confined_space_permits: [{ permit_number: "PLCS-4401", status: "open", permit_valid_until: "2026-04-05T17:15:00.000Z" }],
      requires_confined_space_permit: true,
      site_packet: { site_label: "North trench daylighting" },
    })};`, context);

    context.showCompletionScreen();

    expect(ensureElement("completionStandardFields").style.display).toBe("none");
    expect(ensureElement("completionHydrovacFields").innerHTML).toContain("Load and disposal");
    expect(ensureElement("completionHydrovacOverview").innerHTML).toContain("Hydrovac command");
    expect(ensureElement("completionSubmitNote").textContent).toContain("Structured closeout");
    expect(context.showScreen).toHaveBeenCalledWith("completion");
  });

  test("maybeOpenRequestedCrewJob announces when the office launched the crew into a job", async () => {
    const { context } = loadCrew({
      URL,
      window: {
        location: {
          search: "?job=job_1&source=operator",
          href: "https://prooflink.co/crew/?job=job_1&source=operator",
          pathname: "/crew/",
          origin: "https://prooflink.co",
        },
        history: { replaceState: vi.fn() },
      },
    });
    const openJob = vi.fn(() => Promise.resolve());
    const showToast = vi.fn();
    context.openJob = openJob;
    context.showToast = showToast;
    vm.runInContext("PENDING_LAUNCH_JOB_ID = 'job_1'; PENDING_LAUNCH_SOURCE = 'operator';", context);

    const opened = await context.maybeOpenRequestedCrewJob([
      { id: "job_1", title: "North trench daylighting" },
    ]);

    expect(opened).toBe(true);
    expect(openJob).toHaveBeenCalledWith(expect.objectContaining({ id: "job_1" }));
    expect(showToast).toHaveBeenCalledWith(
      "The office sent you into North trench daylighting. Review the details before you roll.",
      "info"
    );
  });

  test("maybeOpenRequestedCrewJob opens the requested job from the launch query", async () => {
    const replaceState = vi.fn();
    const { context } = loadCrew({
      URL,
      window: {
        location: {
          search: "?job=job_77",
          href: "https://prooflink.co/crew/?job=job_77",
          pathname: "/crew/",
          origin: "https://prooflink.co",
        },
        history: { replaceState },
      },
    });

    const openJobSpy = vi.fn(async () => {});
    context.openJob = openJobSpy;
    vm.runInContext("PENDING_LAUNCH_JOB_ID = 'job_77';", context);

    const opened = await context.maybeOpenRequestedCrewJob([
      { id: "job_77", title: "North trench daylighting" },
    ]);

    expect(opened).toBe(true);
    expect(openJobSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "job_77" }));
    expect(replaceState).toHaveBeenCalled();
  });
});
