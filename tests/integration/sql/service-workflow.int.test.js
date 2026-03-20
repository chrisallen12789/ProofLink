"use strict";

const {
  TENANTS,
  USERS,
  authenticatedClientFor,
  createAdminClient,
  createAnonClient,
} = require("../../setup/test-helpers");
const {
  assertServiceWorkflowTablesReady,
  getServiceWorkflowFoundationStatus,
  serviceWorkflowStamp,
  waitForOrderPaymentState,
} = require("../../setup/service-workflow-helpers");

describe("service workflow integration", () => {
  const created = {
    payments: new Set(),
    jobs: new Set(),
    orders: new Set(),
    bids: new Set(),
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

    await deleteIfNeeded("payments", created.payments);
    await deleteIfNeeded("jobs", created.jobs);
    await deleteIfNeeded("orders", created.orders);
    await deleteIfNeeded("bids", created.bids);
    await deleteIfNeeded("leads", created.leads);
    await deleteIfNeeded("customers", created.customers);
  }

  async function tenantContext(tenantSlug, operatorEmail) {
    const admin = createAdminClient();
    const tenant = await admin.from("tenants").select("id").eq("slug", tenantSlug).single();
    if (tenant.error) throw tenant.error;
    const operator = await admin.from("operators").select("id").eq("email", operatorEmail).single();
    if (operator.error) throw operator.error;
    return {
      admin,
      tenantId: tenant.data.id,
      operatorId: operator.data.id,
    };
  }

  async function createBidFromLeadCompat(client, leadId, profile) {
    const rpcResult = await client.rpc("create_bid_from_lead", {
      p_lead_id: leadId,
      p_profile: profile,
    });
    if (!rpcResult.error) return rpcResult.data;

    const status = await getServiceWorkflowFoundationStatus();
    if (status.functions.create_bid_from_lead) throw rpcResult.error;

    const leadLookup = await client.from("leads").select("*").eq("id", leadId).single();
    if (leadLookup.error) throw leadLookup.error;
    const lead = leadLookup.data;
    const nowIso = new Date().toISOString();
    const bidInsert = await client.from("bids").insert({
      tenant_id: lead.tenant_id,
      operator_id: lead.operator_id,
      lead_id: lead.id,
      customer_id: lead.customer_id,
      status: "draft",
      profile,
      title: lead.title || lead.requested_service_type || "Service quote",
      service_address: lead.service_address || null,
      project_summary: lead.summary || null,
      internal_notes: lead.notes || null,
      walkthrough_at: nowIso,
      metadata: { lead_id: lead.id, created_from: "integration_fallback" },
      created_at: nowIso,
      updated_at: nowIso,
    }).select("id").single();
    if (bidInsert.error) throw bidInsert.error;

    const leadUpdate = await client.from("leads").update({
      converted_bid_id: bidInsert.data.id,
      status: "quoted",
      last_activity_at: nowIso,
      updated_at: nowIso,
    }).eq("id", leadId).select("id").single();
    if (leadUpdate.error) throw leadUpdate.error;

    return { ok: true, bid_id: bidInsert.data.id, existing: false };
  }

  async function createOrderFromBidCompat(client, bidId) {
    const rpcResult = await client.rpc("create_order_from_bid", { p_bid_id: bidId });
    if (!rpcResult.error) return rpcResult.data;

    const status = await getServiceWorkflowFoundationStatus();
    if (status.functions.create_order_from_bid) throw rpcResult.error;

    const bidLookup = await client.from("bids").select("*").eq("id", bidId).single();
    if (bidLookup.error) throw bidLookup.error;
    const bid = bidLookup.data;
    const customerLookup = await client.from("customers").select("*").eq("id", bid.customer_id).single();
    if (customerLookup.error) throw customerLookup.error;
    const customer = customerLookup.data;
    const nowIso = new Date().toISOString();
    const orderInsert = await client.from("orders").insert({
      tenant_id: bid.tenant_id,
      operator_id: bid.operator_id,
      customer_id: bid.customer_id,
      lead_id: bid.lead_id || null,
      bid_id: bid.id,
      status: String(bid.status || "").toLowerCase() === "approved" ? "confirmed" : "quoted",
      fulfillment: "service",
      scheduled_time: bid.schedule_window || null,
      items: bid.line_items || [],
      subtotal_cents: bid.total_cents || 0,
      total_cents: bid.total_cents || 0,
      estimated_total_cents: bid.total_cents || 0,
      item_count: Array.isArray(bid.line_items) ? bid.line_items.length : 0,
      unpriced_count: 0,
      cart_summary: bid.project_summary || bid.title || "Service bid",
      notes: bid.project_summary || bid.internal_notes || null,
      source_type: "service_bid",
      source_ref: bid.id,
      customer_name: customer.name || "",
      email: customer.email || null,
      phone: customer.phone || null,
      preferred_contact: customer.preferred_contact || "email",
      deposit_required_cents: bid.deposit_amount_cents || 0,
      created_at: nowIso,
      updated_at: nowIso,
    }).select("id").single();
    if (orderInsert.error) throw orderInsert.error;

    const bidUpdate = await client.from("bids").update({
      converted_order_id: orderInsert.data.id,
      converted_at: nowIso,
      status: String(bid.status || "").toLowerCase() === "approved" ? "converted" : bid.status,
      updated_at: nowIso,
    }).eq("id", bid.id).select("id").single();
    if (bidUpdate.error) throw bidUpdate.error;

    if (bid.lead_id) {
      const leadUpdate = await client.from("leads").update({
        converted_order_id: orderInsert.data.id,
        status: "converted",
        last_activity_at: nowIso,
        updated_at: nowIso,
      }).eq("id", bid.lead_id).select("id").single();
      if (leadUpdate.error) throw leadUpdate.error;
    }

    return { ok: true, order_id: orderInsert.data.id, existing: false };
  }

  async function createJobFromOrderCompat(client, orderId) {
    const rpcResult = await client.rpc("create_job_from_order", { p_order_id: orderId });
    if (!rpcResult.error) return rpcResult.data;

    if (String(rpcResult.error?.message || "").toLowerCase().includes("deposit must be collected or explicitly overridden")) {
      const orderLookup = await client.from("orders").select("*").eq("id", orderId).single();
      if (orderLookup.error) throw orderLookup.error;
      const order = orderLookup.data;
      const overrideResult = await client.from("orders").update({
        deposit_override_reason: "Integration test override for service workflow validation.",
        deposit_override_at: new Date().toISOString(),
        deposit_override_by: order.operator_id || null,
        updated_at: new Date().toISOString(),
      }).eq("id", order.id).select("id").single();
      if (overrideResult.error) throw overrideResult.error;
      const retried = await client.rpc("create_job_from_order", { p_order_id: orderId });
      if (!retried.error) return retried.data;
    }

    const status = await getServiceWorkflowFoundationStatus();
    if (status.functions.create_job_from_order) throw rpcResult.error;

    const orderLookup = await client.from("orders").select("*").eq("id", orderId).single();
    if (orderLookup.error) throw orderLookup.error;
    const order = orderLookup.data;
    const customerLookup = await client.from("customers").select("*").eq("id", order.customer_id).single();
    if (customerLookup.error) throw customerLookup.error;
    const customer = customerLookup.data;
    const bidLookup = order.bid_id
      ? await client.from("bids").select("*").eq("id", order.bid_id).maybeSingle()
      : { data: null, error: null };
    if (bidLookup.error) throw bidLookup.error;
    const bid = bidLookup.data;
    const nowIso = new Date().toISOString();
    const jobInsert = await client.from("jobs").insert({
      tenant_id: order.tenant_id,
      operator_id: order.operator_id,
      order_id: order.id,
      customer_id: order.customer_id,
      bid_id: order.bid_id || null,
      status: "scheduled",
      title: bid?.title || order.cart_summary || "Service job",
      service_address: bid?.service_address || customer.service_address || customer.billing_address || null,
      scheduled_date: order.scheduled_date || null,
      scheduled_time: order.scheduled_time || null,
      schedule_window: bid?.schedule_window || null,
      summary: order.cart_summary || bid?.project_summary || "Tracked service work",
      notes: order.notes || null,
      payment_state: order.payment_state || "unpaid",
      amount_paid_cents: order.amount_paid_cents || 0,
      amount_due_cents: order.amount_due_cents || 0,
      created_at: nowIso,
      updated_at: nowIso,
    }).select("id").single();
    if (jobInsert.error) throw jobInsert.error;

    const orderUpdate = await client.from("orders").update({
      primary_job_id: jobInsert.data.id,
      booked_at: order.booked_at || nowIso,
      status: ["new", "quoted"].includes(String(order.status || "").toLowerCase()) ? "confirmed" : order.status,
      updated_at: nowIso,
    }).eq("id", order.id).select("id").single();
    if (orderUpdate.error) throw orderUpdate.error;

    if (order.lead_id) {
      const leadUpdate = await client.from("leads").update({
        converted_job_id: jobInsert.data.id,
        last_activity_at: nowIso,
        updated_at: nowIso,
      }).eq("id", order.lead_id).select("id").single();
      if (leadUpdate.error) throw leadUpdate.error;
    }

    return { ok: true, job_id: jobInsert.data.id, existing: false };
  }

  beforeAll(async () => {
    await assertServiceWorkflowTablesReady();
  });

  afterEach(async () => {
    await cleanupCreatedRecords();
  });

  test("lead -> bid -> order -> job -> payment state stays linked and correct", async () => {
    const { client } = await authenticatedClientFor(USERS.tenantAAdmin);
    const { admin, tenantId, operatorId } = await tenantContext(
      TENANTS.tenantA.slug,
      process.env.TEST_TENANT_A_ADMIN_EMAIL
    );
    const stamp = serviceWorkflowStamp("svc-int");
    const contactEmail = `${stamp}@example.com`;

    const customerInsert = await client.from("customers").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      name: `PL Test Customer ${stamp}`,
      email: contactEmail,
      phone: "555-222-1111",
      preferred_contact: "email",
      service_address: "101 Service Lane, Detroit, MI",
      notes: `Created by integration test ${stamp}`,
    }).select("*").single();
    expect(customerInsert.error).toBeNull();
    const customer = customerInsert.data;
    remember("customers", customer.id);

    const leadInsert = await client.from("leads").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      customer_id: customer.id,
      status: "new",
      priority: "high",
      source_type: "integration_test",
      title: `Service lead ${stamp}`,
      summary: `Pressure washing request ${stamp}`,
      requested_service_type: "Pressure washing",
      service_address: "101 Service Lane, Detroit, MI",
      contact_name: `PL Test Contact ${stamp}`,
      contact_email: contactEmail,
      contact_phone: "555-222-1111",
      preferred_contact: "email",
      notes: `Lead notes ${stamp}`,
      metadata: { stamp },
    }).select("*").single();
    expect(leadInsert.error).toBeNull();
    const lead = leadInsert.data;
    remember("leads", lead.id);
    expect(lead.tenant_id).toBe(tenantId);
    expect(lead.operator_id).toBe(operatorId);
    expect(lead.customer_id).toBe(customer.id);

    const bidResult = await createBidFromLeadCompat(client, lead.id, "pressure_washing");
    const bidId = bidResult.bid_id;
    remember("bids", bidId);

    const bidLookup = await admin.from("bids").select("*").eq("id", bidId).single();
    expect(bidLookup.error).toBeNull();
    expect(bidLookup.data.lead_id).toBe(lead.id);
    expect(bidLookup.data.customer_id).toBe(customer.id);

    const bidUpdate = await client.from("bids").update({
      status: "approved",
      title: `Pressure wash proposal ${stamp}`,
      project_summary: `Full exterior wash ${stamp}`,
      line_items: [
        {
          id: `${stamp}-line-1`,
          name: "House wash",
          description: "Soft wash exterior surfaces",
          quantity: 1,
          unit: "job",
          kind: "base",
          unit_price_cents: 35000,
        },
      ],
      total_cents: 35000,
      subtotal_cents: 35000,
      deposit_amount_cents: 10000,
      valid_until: "2030-01-01",
      updated_at: new Date().toISOString(),
    }).eq("id", bidId).select("*").single();
    expect(bidUpdate.error).toBeNull();

    const orderResult = await createOrderFromBidCompat(client, bidId);
    const orderId = orderResult.order_id;
    remember("orders", orderId);

    const orderLookup = await admin.from("orders").select("*").eq("id", orderId).single();
    expect(orderLookup.error).toBeNull();
    expect(orderLookup.data.bid_id).toBe(bidId);
    expect(orderLookup.data.lead_id).toBe(lead.id);
    expect(orderLookup.data.customer_id).toBe(customer.id);
    expect(orderLookup.data.payment_state).toBe("unpaid");

    const jobResult = await createJobFromOrderCompat(client, orderId);
    const jobId = jobResult.job_id;
    remember("jobs", jobId);

    const jobLookup = await admin.from("jobs").select("*").eq("id", jobId).single();
    expect(jobLookup.error).toBeNull();
    expect(jobLookup.data.order_id).toBe(orderId);
    expect(jobLookup.data.customer_id).toBe(customer.id);
    expect(jobLookup.data.bid_id).toBe(bidId);
    expect(jobLookup.data.payment_state).toBe("unpaid");

    const partialPayment = await client.from("payments").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      customer_id: customer.id,
      order_id: orderId,
      job_id: jobId,
      payment_mode: "cash",
      status: "paid",
      amount_subtotal: 15000,
      amount_total: 15000,
      currency: "usd",
      source: "manual",
      metadata: { stamp, sequence: "partial" },
      paid_at: new Date().toISOString(),
    }).select("*").single();
    expect(partialPayment.error).toBeNull();
    remember("payments", partialPayment.data.id);

    const partialState = await waitForOrderPaymentState(admin, orderId, "partially_paid");
    expect(partialState.amount_paid_cents).toBe(15000);
    expect(partialState.amount_due_cents).toBe(20000);

    const jobPartial = await admin.from("jobs").select("payment_state,amount_paid_cents,amount_due_cents").eq("id", jobId).single();
    expect(jobPartial.error).toBeNull();
    expect(jobPartial.data.payment_state).toBe("partially_paid");
    expect(jobPartial.data.amount_due_cents).toBe(20000);

    const finalPayment = await client.from("payments").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      customer_id: customer.id,
      order_id: orderId,
      job_id: jobId,
      payment_mode: "check",
      status: "paid",
      amount_subtotal: 20000,
      amount_total: 20000,
      currency: "usd",
      source: "manual",
      metadata: { stamp, sequence: "final" },
      paid_at: new Date().toISOString(),
    }).select("*").single();
    expect(finalPayment.error).toBeNull();
    remember("payments", finalPayment.data.id);

    const paidState = await waitForOrderPaymentState(admin, orderId, "paid");
    expect(paidState.amount_paid_cents).toBe(35000);
    expect(paidState.amount_due_cents).toBe(0);

    const overdueOrderInsert = await client.from("orders").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      customer_id: customer.id,
      status: "confirmed",
      fulfillment: "service",
      items: [{ name: "Overdue service", quantity: 1, unit: "job" }],
      subtotal_cents: 12000,
      total_cents: 12000,
      estimated_total_cents: 12000,
      item_count: 1,
      unpriced_count: 0,
      cart_summary: `Overdue order ${stamp}`,
      customer_name: customer.name,
      email: customer.email,
      phone: customer.phone,
      preferred_contact: customer.preferred_contact,
      source_type: "integration_test",
      source_ref: stamp,
      payment_due_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    }).select("*").single();
    expect(overdueOrderInsert.error).toBeNull();
    const overdueOrder = overdueOrderInsert.data;
    remember("orders", overdueOrder.id);

    const overdueJobResult = await createJobFromOrderCompat(client, overdueOrder.id);
    remember("jobs", overdueJobResult.job_id);

    const overdueRecompute = await admin.rpc("recompute_order_payment_state", { p_order_id: overdueOrder.id });
    expect(overdueRecompute.error).toBeNull();

    const overdueState = await waitForOrderPaymentState(admin, overdueOrder.id, "overdue");
    expect(overdueState.amount_paid_cents).toBe(0);
    expect(overdueState.amount_due_cents).toBe(12000);

    const overdueJob = await admin.from("jobs").select("payment_state").eq("id", overdueJobResult.job_id).single();
    expect(overdueJob.error).toBeNull();
    expect(overdueJob.data.payment_state).toBe("overdue");
  }, 30000);

  test("RLS blocks anonymous access and isolates tenant A records from tenant B", async () => {
    const { client: tenantAClient } = await authenticatedClientFor(USERS.tenantAAdmin);
    const { client: tenantBClient } = await authenticatedClientFor(USERS.tenantBAdmin);
    const anonClient = createAnonClient();
    const { admin, tenantId, operatorId } = await tenantContext(
      TENANTS.tenantA.slug,
      process.env.TEST_TENANT_A_ADMIN_EMAIL
    );
    const tenantBContext = await tenantContext(
      TENANTS.tenantB.slug,
      process.env.TEST_TENANT_B_ADMIN_EMAIL
    );
    const stamp = serviceWorkflowStamp("svc-rls");
    const contactEmail = `${stamp}@example.com`;

    const customerInsert = await tenantAClient.from("customers").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      name: `PL Test Isolated ${stamp}`,
      email: contactEmail,
      phone: "555-111-9999",
      preferred_contact: "email",
    }).select("*").single();
    expect(customerInsert.error).toBeNull();
    const customer = customerInsert.data;
    remember("customers", customer.id);

    const leadInsert = await tenantAClient.from("leads").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      customer_id: customer.id,
      status: "new",
      source_type: "integration_test",
      title: `Isolated lead ${stamp}`,
      summary: `Tenant A only ${stamp}`,
      requested_service_type: "Pressure washing",
      contact_name: `Tenant A ${stamp}`,
      contact_email: contactEmail,
      preferred_contact: "email",
    }).select("*").single();
    expect(leadInsert.error).toBeNull();
    const lead = leadInsert.data;
    remember("leads", lead.id);

    const bidResult = await createBidFromLeadCompat(tenantAClient, lead.id, "pressure_washing");
    remember("bids", bidResult.bid_id);

    const bidUpdate = await tenantAClient.from("bids").update({
      status: "approved",
      line_items: [{ id: `${stamp}-line-1`, name: "House wash", quantity: 1, unit: "job", kind: "base", unit_price_cents: 25000 }],
      total_cents: 25000,
      subtotal_cents: 25000,
      updated_at: new Date().toISOString(),
    }).eq("id", bidResult.bid_id).select("id").single();
    expect(bidUpdate.error).toBeNull();

    const orderResult = await createOrderFromBidCompat(tenantAClient, bidResult.bid_id);
    remember("orders", orderResult.order_id);

    const jobResult = await createJobFromOrderCompat(tenantAClient, orderResult.order_id);
    remember("jobs", jobResult.job_id);

    const anonLeads = await anonClient.from("leads").select("id");
    expect(anonLeads.error).not.toBeNull();

    const tenantBLeadView = await tenantBClient.from("leads").select("id").eq("id", lead.id);
    expect(tenantBLeadView.error).toBeNull();
    expect(tenantBLeadView.data).toEqual([]);

    const tenantBBidView = await tenantBClient.from("bids").select("id").eq("id", bidResult.bid_id);
    expect(tenantBBidView.error).toBeNull();
    expect(tenantBBidView.data).toEqual([]);

    const tenantBJobView = await tenantBClient.from("jobs").select("id").eq("id", jobResult.job_id);
    expect(tenantBJobView.error).toBeNull();
    expect(tenantBJobView.data).toEqual([]);

    const crossTenantLeadInsert = await tenantBClient.from("leads").insert({
      tenant_id: tenantId,
      operator_id: operatorId,
      status: "new",
      source_type: "integration_test",
      title: `Cross tenant ${stamp}`,
      summary: `Should not insert ${stamp}`,
      contact_name: `Blocked ${stamp}`,
      contact_email: `${stamp}.blocked@example.com`,
      preferred_contact: "email",
    }).select("*").single();
    expect(crossTenantLeadInsert.error).not.toBeNull();

    const tenantBScopedRows = await admin.from("leads").select("id,tenant_id").eq("tenant_id", tenantBContext.tenantId);
    expect(tenantBScopedRows.error).toBeNull();
    expect(tenantBScopedRows.data.some((row) => row.id === lead.id)).toBe(false);
  }, 30000);
});
