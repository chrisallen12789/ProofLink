"use strict";

const path = require("path");

describe("netlify/functions/lib/hydrovac-compliance", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/lib/hydrovac-compliance.js");

  test("manifestCloseoutIssuesForRows allows a live load with a documented hold reason", () => {
    const compliance = require(modulePath);
    const issues = compliance.manifestCloseoutIssuesForRows([
      {
        id: "manifest_1",
        manifest_number: "HV-001",
        status: "in_transit",
        truck_id: "truck_1",
        quantity_estimated: 1200,
        metadata: {
          load_still_in_truck: true,
          load_state: "live_in_truck",
          live_load_hold_reason: "Waiting for a fuller non-hazardous load before disposal",
          bol_number: "BOL-1001",
        },
      },
    ], {
      id: "job_1",
      total_loads_hauled: 1,
    });

    expect(issues).toEqual([]);
  });

  test("manifestCloseoutIssuesForRows requires hold reason and bol tracking when a live load is left in the truck", () => {
    const compliance = require(modulePath);
    const issues = compliance.manifestCloseoutIssuesForRows([
      {
        id: "manifest_2",
        manifest_number: "HV-002",
        status: "in_transit",
        truck_id: "",
        metadata: {
          load_still_in_truck: true,
          load_state: "live_in_truck",
        },
      },
    ], {
      id: "job_2",
      total_loads_hauled: 1,
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      "manifest_live_hold_reason_missing",
      "manifest_live_hold_reason_missing",
    ]);
  });

  test("truckLoadIssuesForRows warns on cross-contamination risk before a new job starts", () => {
    const compliance = require(modulePath);
    const issues = compliance.truckLoadIssuesForRows([
      {
        id: "manifest_3",
        manifest_number: "HV-003",
        job_id: "job_old",
        customer_id: "customer_a",
        truck_id: "truck_1",
        status: "in_transit",
      },
    ], {
      id: "job_next",
      customer_id: "customer_b",
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: "truck_cross_contamination_risk",
      }),
    ]);
  });
});
