"use strict";

const path = require("path");

describe("netlify/functions/lib/build-launch-checklist", () => {
  const modulePath = path.resolve(
    process.cwd(),
    "netlify/functions/lib/build-launch-checklist.js"
  );

  function settledCount(count) {
    return {
      status: "fulfilled",
      value: { count },
    };
  }

  test("prioritizes first real business wins before website polish", () => {
    const { buildLaunchChecklist } = require(modulePath);

    const result = buildLaunchChecklist({
      tenant: { business_name: "Benkari Vacs", name: "" },
      customersResult: settledCount(1),
      bidsResult: settledCount(0),
      ordersResult: settledCount(1),
      paymentsResult: settledCount(1),
      productsResult: settledCount(3),
      configResult: {
        status: "fulfilled",
        value: {
          data: {
            config_value: JSON.stringify({
              tagline: "Hydrovac work without the guesswork",
              site_publish_status: "draft",
            }),
          },
        },
      },
    });

    expect(result.steps.map((step) => step.id)).toEqual([
      "workspace_ready",
      "first_offer",
      "first_customer",
      "first_workflow",
      "first_payment",
      "website_shape",
      "website_publish",
    ]);
    expect(result.steps.find((step) => step.id === "first_payment")?.complete).toBe(true);
    expect(result.steps.find((step) => step.id === "website_publish")?.complete).toBe(false);
    expect(result.launch_ready).toBe(false);
  });

  test("treats missing or failing queries as incomplete instead of crashing", () => {
    const { buildLaunchChecklist } = require(modulePath);

    const result = buildLaunchChecklist({
      tenant: {},
      customersResult: { status: "rejected", reason: new Error("missing table") },
      bidsResult: { status: "rejected", reason: new Error("missing table") },
      ordersResult: settledCount(0),
      paymentsResult: settledCount(0),
      productsResult: settledCount(0),
      configResult: {
        status: "fulfilled",
        value: {
          data: {
            config_value: "{bad json",
          },
        },
      },
    });

    expect(result.completed).toBe(1);
    expect(result.total).toBe(7);
    expect(result.percent).toBe(14);
    expect(result.steps.find((step) => step.id === "first_customer")?.complete).toBe(false);
  });

  test("uses business_name when legacy tenant name is empty", () => {
    const { buildLaunchChecklist } = require(modulePath);

    const result = buildLaunchChecklist({
      tenant: { business_name: "Riverfront Milling", name: "" },
      customersResult: settledCount(0),
      bidsResult: settledCount(0),
      ordersResult: settledCount(0),
      paymentsResult: settledCount(0),
      productsResult: settledCount(0),
      configResult: { status: "fulfilled", value: { data: { config_value: "{}" } } },
    });

    expect(result.steps.find((step) => step.id === "workspace_ready")?.detail).toContain("Riverfront Milling");
  });
});
