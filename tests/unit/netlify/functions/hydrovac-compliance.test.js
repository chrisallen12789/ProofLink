"use strict";

const path = require("path");

describe("netlify hydrovac compliance helpers", () => {
  const modulePath = path.resolve(
    process.cwd(),
    "netlify/functions/lib/hydrovac-compliance.js"
  );

  beforeEach(() => {
    vi.resetModules();
  });

  test("jobRequiresLocateTicket only blocks excavation-style hydrovac jobs", () => {
    const compliance = require(modulePath);

    expect(
      compliance.jobRequiresLocateTicket(
        { job_type: "hydrovac_excavation" },
        { require_locate_ticket_for_excavation: true }
      )
    ).toBe(true);
    expect(
      compliance.jobRequiresLocateTicket(
        { job_type: "catch_basin_cleaning" },
        { require_locate_ticket_for_excavation: true }
      )
    ).toBe(false);
  });

  test("jobRequiresConfinedSpacePermit respects job flags and hydrovac job types", () => {
    const compliance = require(modulePath);

    expect(
      compliance.jobRequiresConfinedSpacePermit(
        { requires_confined_space_permit: true, job_type: "hydrovac" },
        {}
      )
    ).toBe(true);
    expect(
      compliance.jobRequiresConfinedSpacePermit(
        { job_type: "wet_well_cleaning" },
        { require_confined_space_permit: true }
      )
    ).toBe(true);
    expect(
      compliance.jobRequiresConfinedSpacePermit(
        { job_type: "wet_well_cleaning" },
        { require_confined_space_permit: false }
      )
    ).toBe(false);
  });

  test("manifestConfirmationIssues calls out the missing closeout fields", () => {
    const compliance = require(modulePath);

    const issues = compliance.manifestConfirmationIssues({
      manifest_number: "HV-1",
      disposal_facility_name: "",
      disposal_ticket_number: "",
      quantity_actual: null,
      quantity_estimated: null,
    });

    expect(issues).toHaveLength(3);
    expect(issues[0]).toContain("disposal facility");
    expect(issues[1]).toContain("ticket number");
    expect(issues[2]).toContain("hauled quantity");
  });
});
