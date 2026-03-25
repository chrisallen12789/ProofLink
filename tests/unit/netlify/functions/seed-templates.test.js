"use strict";

const path = require("path");

describe("netlify/functions/lib/seed-templates", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/lib/seed-templates.js");

  test("resolves hydrovac tenants to the hydrovac starter template", () => {
    const { resolveTemplateKey } = require(modulePath);

    expect(resolveTemplateKey("hydrovac")).toBe("hydrovac");
  });

  test("includes the Benkari hydrovac rate-sheet starter products", () => {
    const { TEMPLATES } = require(modulePath);
    const hydrovac = TEMPLATES.hydrovac;

    expect(hydrovac).toBeTruthy();
    expect(Array.isArray(hydrovac.products)).toBe(true);
    expect(hydrovac.products.length).toBeGreaterThanOrEqual(12);
    expect(hydrovac.products.some((product) => product.name === "Hydrovac 4-hour minimum (truck + laborer)")).toBe(true);
    expect(hydrovac.products.some((product) => product.name === "Liquid waste disposal")).toBe(true);
  });

  test("caps seeded products to the tenant plan limit", async () => {
    const { seedTemplateForTenant } = require(modulePath);
    const state = { insertedRows: null, siteConfig: null };
    const fakeSupabase = {
      from(table) {
        if (table === "tenant_config") {
          return {
            upsert(payload) {
              state.siteConfig = payload;
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "products") {
          return {
            select() {
              return {
                eq() {
                  return {
                    limit() {
                      return Promise.resolve({ data: [], error: null });
                    },
                  };
                },
              };
            },
            insert(rows) {
              state.insertedRows = rows;
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "tenants") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({ data: { max_products: 10 }, error: null });
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await seedTemplateForTenant(fakeSupabase, "tenant-1", "operator-1", "hydrovac");

    expect(state.siteConfig).toBeTruthy();
    expect(Array.isArray(state.insertedRows)).toBe(true);
    expect(state.insertedRows).toHaveLength(10);
    expect(result).toMatchObject({ seeded: 10, templateKey: "hydrovac", truncated: true });
  });
});
