"use strict";

const path = require("path");

describe("netlify/functions/lib/plan-enforcement", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/lib/plan-enforcement.js");
  const planEnforcement = require(modulePath);

  test("getPlanKey returns tenant plan or starter fallback", () => {
    expect(planEnforcement.getPlanKey({ prooflink_plan_key: "growth" })).toBe("growth");
    expect(planEnforcement.getPlanKey({})).toBe("starter");
    expect(planEnforcement.getPlanKey(null)).toBe("starter");
  });

  test("limitFor returns expected starter limits", () => {
    const tenant = { prooflink_plan_key: "starter" };
    expect(planEnforcement.limitFor("products", tenant)).toBe(10);
    expect(planEnforcement.limitFor("customers", tenant)).toBe(50);
    expect(planEnforcement.limitFor("orders", tenant)).toBe(100);
    expect(planEnforcement.limitFor("operators", tenant)).toBe(1);
  });

  test("limitFor returns Infinity for growth and enterprise resources", () => {
    expect(planEnforcement.limitFor("products", { prooflink_plan_key: "growth" })).toBe(Infinity);
    expect(planEnforcement.limitFor("operators", { prooflink_plan_key: "enterprise" })).toBe(
      Infinity
    );
  });

  test("unknown plan falls back to starter", () => {
    expect(planEnforcement.limitFor("products", { prooflink_plan_key: "unknown" })).toBe(10);
  });

  test("enforceLimit returns true below limit and false at limit", () => {
    const tenant = { prooflink_plan_key: "starter" };
    expect(planEnforcement.enforceLimit("products", 9, tenant)).toBe(true);
    expect(planEnforcement.enforceLimit("products", 10, tenant)).toBe(false);
  });

  test("enforcementResponse returns a stable limit payload", () => {
    expect(
      planEnforcement.enforcementResponse("customers", 50, { prooflink_plan_key: "starter" })
    ).toEqual({
      ok: false,
      code: "plan_limit_reached",
      resourceKey: "customers",
      tenantPlan: "starter",
      currentCount: 50,
      limit: 50,
    });
  });
});
