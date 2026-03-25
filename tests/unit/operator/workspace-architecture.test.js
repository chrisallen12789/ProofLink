"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadWorkspaceArchitecture() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "prooflink-workspace-architecture.js"),
    "utf8"
  );
  const context = {
    window: {},
    console,
    Set,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.PROOFLINK_WORKSPACE_ARCHITECTURE;
}

describe("prooflink workspace architecture", () => {
  test("service-heavy business types resolve to dedicated bid profiles", () => {
    const architecture = loadWorkspaceArchitecture();

    expect(architecture.resolveBidProfileForBusinessType("landscaping")).toBe("landscaping_maintenance");
    expect(architecture.resolveBidProfileForBusinessType("lawn_care")).toBe("landscaping_maintenance");
    expect(architecture.resolveBidProfileForBusinessType("cleaning")).toBe("cleaning_services");
    expect(architecture.resolveBidProfileForBusinessType("photography")).toBe("photography_sessions");
    expect(architecture.resolveBidProfileForBusinessType("pet_services")).toBe("pet_care_services");
    expect(architecture.resolveBidProfileForBusinessType("events")).toBe("event_planning");
    expect(architecture.resolveBidProfileForBusinessType("handyman")).toBe("handyman_punchlist");
    expect(architecture.resolveBidProfileForBusinessType("bakery")).toBe("bakery_custom_orders");
  });

  test("blueprints keep richer profile mapping while preserving workflow visibility rules", () => {
    const architecture = loadWorkspaceArchitecture();

    const petBlueprint = architecture.resolveWorkspaceBlueprint("starter", "pet_services");
    const bakeryBlueprint = architecture.resolveWorkspaceBlueprint("starter", "bakery");
    const eventsBlueprint = architecture.resolveWorkspaceBlueprint("growth", "events");

    expect(petBlueprint.bidProfile).toBe("pet_care_services");
    expect(petBlueprint.hiddenByDefault).toContain("bids");

    expect(bakeryBlueprint.bidProfile).toBe("bakery_custom_orders");
    expect(bakeryBlueprint.hiddenByDefault).toContain("bids");

    expect(eventsBlueprint.bidProfile).toBe("event_planning");
    expect(eventsBlueprint.priorityViews).toContain("bids");
  });
});
