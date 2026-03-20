"use strict";

const path = require("path");
const { TENANTS, buildEvent, createAdminClient } = require("../../../setup/test-helpers");
const {
  assertServiceWorkflowTablesReady,
  serviceWorkflowStamp,
} = require("../../../setup/service-workflow-helpers");

describe("service-intake integration", () => {
  const handler = require(path.resolve(
    process.cwd(),
    "netlify/functions/service-intake.js"
  )).handler;

  const created = {
    leads: new Set(),
    customers: new Set(),
  };

  function remember(table, id) {
    if (id && created[table]) created[table].add(id);
  }

  async function cleanupCreatedRecords() {
    const admin = createAdminClient();
    const deleteIfNeeded = async (table, ids) => {
      const values = [...ids].filter(Boolean);
      if (!values.length) return;
      const { error } = await admin.from(table).delete().in("id", values);
      if (error) throw error;
      ids.clear();
    };

    await deleteIfNeeded("leads", created.leads);
    await deleteIfNeeded("customers", created.customers);
  }

  beforeAll(async () => {
    await assertServiceWorkflowTablesReady();
  });

  afterEach(async () => {
    await cleanupCreatedRecords();
  });

  test("valid input creates a lead linked to a customer and tenant", async () => {
    const admin = createAdminClient();
    const tenant = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
    expect(tenant.error).toBeNull();

    const stamp = serviceWorkflowStamp("intake");
    const email = `${stamp}@example.com`;
    const response = await handler(
      buildEvent({
        method: "POST",
        body: {
          tenant_slug: TENANTS.tenantA.slug,
          customer_name: `PL Test Intake ${stamp}`,
          email,
          phone: "555-444-3333",
          summary: `Service request ${stamp}`,
          requested_service_type: "Pressure washing",
          service_address: "404 Clean Street, Detroit, MI",
        },
      })
    );

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    remember("leads", body.lead_id);
    remember("customers", body.customer_id);

    const lead = await admin.from("leads").select("*").eq("id", body.lead_id).single();
    expect(lead.error).toBeNull();
    expect(lead.data.tenant_id).toBe(tenant.data.id);
    expect(lead.data.customer_id).toBe(body.customer_id);
    expect(lead.data.contact_email).toBe(email);
    expect(lead.data.summary).toContain(stamp);

    const customer = await admin.from("customers").select("*").eq("id", body.customer_id).single();
    expect(customer.error).toBeNull();
    expect(customer.data.tenant_id).toBe(tenant.data.id);
    expect(customer.data.email).toBe(email);
  });

  test("invalid input fails cleanly without creating records", async () => {
    const stamp = serviceWorkflowStamp("intake-invalid");
    const email = `${stamp}@example.com`;
    const response = await handler(
      buildEvent({
        method: "POST",
        body: {
          tenant_slug: TENANTS.tenantA.slug,
          customer_name: `PL Test Intake ${stamp}`,
          email,
        },
      })
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("summary is required");

    const admin = createAdminClient();
    const leads = await admin.from("leads").select("id").eq("contact_email", email);
    expect(leads.error).toBeNull();
    expect(leads.data).toEqual([]);
  });

  test("tenant context is enforced so unresolved tenants do not create orphaned leads", async () => {
    const stamp = serviceWorkflowStamp("intake-missing-tenant");
    const email = `${stamp}@example.com`;
    const response = await handler(
      buildEvent({
        method: "POST",
        body: {
          tenant_slug: `missing-${stamp}`,
          customer_name: `PL Test Intake ${stamp}`,
          email,
          summary: `Should fail ${stamp}`,
        },
      })
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain("tenant could not be resolved");

    const admin = createAdminClient();
    const leads = await admin.from("leads").select("id").eq("contact_email", email);
    expect(leads.error).toBeNull();
    expect(leads.data).toEqual([]);

    const customers = await admin.from("customers").select("id").eq("email", email);
    expect(customers.error).toBeNull();
    expect(customers.data).toEqual([]);
  });
});
