"use strict";

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const { loadTestEnv } = require("../tests/setup/env.test");
const { createAdminClient, TENANTS, USERS } = require("../tests/setup/test-helpers");
const { resolveUserConfig } = require("../tests/fixtures/users");

loadTestEnv();

const OUTPUT_DIR = path.join(__dirname, "..", "landing-shots");

function nowIso() {
  return new Date().toISOString();
}

async function tenantContext(admin) {
  const tenant = await admin.from("tenants").select("id").eq("slug", TENANTS.tenantA.slug).single();
  if (tenant.error) throw tenant.error;
  const user = resolveUserConfig(USERS.tenantAAdmin);
  const operator = await admin.from("operators").select("id").eq("email", user.email).single();
  if (operator.error) throw operator.error;
  return { tenantId: tenant.data.id, operatorId: operator.data.id, user };
}

async function insertCustomer(admin, created, tenantId, operatorId, payload) {
  const insert = await admin.from("customers").insert({
    tenant_id: tenantId,
    operator_id: operatorId,
    preferred_contact: "email",
    order_count: 0,
    lifetime_value_cents: 0,
    ...payload,
  }).select("*").single();
  if (insert.error) throw insert.error;
  created.customers.push(insert.data.id);
  return insert.data;
}

async function insertLead(admin, created, tenantId, operatorId, payload) {
  const insert = await admin.from("leads").insert({
    tenant_id: tenantId,
    operator_id: operatorId,
    status: "new",
    priority: "normal",
    source_type: "landing_shot",
    preferred_contact: "email",
    metadata: {},
    ...payload,
  }).select("*").single();
  if (insert.error) throw insert.error;
  created.leads.push(insert.data.id);
  return insert.data;
}

async function insertOrder(admin, created, tenantId, operatorId, payload) {
  const insert = await admin.from("orders").insert({
    tenant_id: tenantId,
    operator_id: operatorId,
    fulfillment: "service",
    status: "confirmed",
    source_type: "landing_shot",
    source_ref: `landing-shot-${Date.now()}`,
    items: [],
    item_count: 1,
    unpriced_count: 0,
    amount_paid_cents: 0,
    amount_due_cents: 0,
    payment_state: "unpaid",
    ...payload,
  }).select("*").single();
  if (insert.error) throw insert.error;
  created.orders.push(insert.data.id);
  return insert.data;
}

async function insertJob(admin, created, tenantId, operatorId, payload) {
  const insert = await admin.from("jobs").insert({
    tenant_id: tenantId,
    operator_id: operatorId,
    status: "scheduled",
    payment_state: "unpaid",
    amount_paid_cents: 0,
    amount_due_cents: 0,
    ...payload,
  }).select("*").single();
  if (insert.error) throw insert.error;
  created.jobs.push(insert.data.id);
  return insert.data;
}

async function insertPayment(admin, created, tenantId, operatorId, payload) {
  const insert = await admin.from("payments").insert({
    tenant_id: tenantId,
    operator_id: operatorId,
    payment_mode: "cash",
    status: "paid",
    currency: "usd",
    source: "manual",
    metadata: {},
    is_manual: true,
    ...payload,
  }).select("*").single();
  if (insert.error) throw insert.error;
  created.payments.push(insert.data.id);
  return insert.data;
}

async function insertInteraction(admin, created, tenantId, operatorId, payload) {
  const insert = await admin.from("customer_interactions").insert({
    tenant_id: tenantId,
    operator_id: operatorId,
    type: "note",
    metadata: {},
    created_at: nowIso(),
    ...payload,
  }).select("id").single();
  if (insert.error) throw insert.error;
  created.interactions.push(insert.data.id);
  return insert.data.id;
}

async function cleanup(admin, created) {
  async function remove(table, ids) {
    if (!ids.length) return;
    const { error } = await admin.from(table).delete().in("id", ids);
    if (error) throw error;
  }

  await remove("customer_interactions", created.interactions);
  await remove("payments", created.payments);
  await remove("jobs", created.jobs);
  await remove("orders", created.orders);
  await remove("leads", created.leads);
  await remove("customers", created.customers);
}

async function login(page, siteUrl, user) {
  await page.addInitScript(() => {
    window.localStorage.setItem("pl_tour_v1", "1");
    window.localStorage.setItem("pl_theme_choice_v2", "dark");
  });
  await page.goto(`${siteUrl}/operator/`, { waitUntil: "networkidle" });
  await page.locator("#loginForm").waitFor();
  await page.locator("#loginEmail").fill(user.email);
  await page.locator("#loginPassword").fill(user.password);
  await page.locator("#loginForm button[type='submit']").click();
  await page.waitForFunction(() => window.PROOFLINK_BOOT_READY === true, null, { timeout: 20000 });
}

async function clickListItem(page, listSelector, text) {
  const locator = page.locator(`${listSelector} .list-item`, { hasText: text }).first();
  await locator.waitFor({ state: "visible", timeout: 20000 });
  await locator.click();
}

async function tryClickListItem(page, listSelector, text) {
  try {
    await clickListItem(page, listSelector, text);
  } catch (error) {
    console.warn(`Landing shot list click skipped for ${listSelector} / ${text}: ${error.message}`);
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const admin = createAdminClient();
  const created = {
    interactions: [],
    payments: [],
    jobs: [],
    orders: [],
    leads: [],
    customers: [],
  };
  const { tenantId, operatorId, user } = await tenantContext(admin);
  const stamp = `landing-${Date.now()}`;
  const siteUrl = process.env.TEST_SITE_URL || "http://127.0.0.1:8888";

  try {
    const riverfront = await insertCustomer(admin, created, tenantId, operatorId, {
      name: "Riverfront Apartments",
      email: `riverfront-${stamp}@example.com`,
      phone: "313-555-0111",
      service_address: "142 Riverfront Drive, Detroit, MI",
      notes: "Weekly property wash and stairwell cleanup.",
      lifetime_value_cents: 860000,
      order_count: 5,
      last_contact_at: nowIso(),
    });

    const mason = await insertCustomer(admin, created, tenantId, operatorId, {
      name: "Mason Family Home",
      email: `mason-${stamp}@example.com`,
      phone: "313-555-0222",
      service_address: "808 Wash Way, Detroit, MI",
      notes: "House wash plus patio brightening.",
      lifetime_value_cents: 420000,
      order_count: 3,
      last_contact_at: nowIso(),
    });

    const lakeside = await insertCustomer(admin, created, tenantId, operatorId, {
      name: "Lakeside Retail Plaza",
      email: `lakeside-${stamp}@example.com`,
      phone: "313-555-0333",
      service_address: "600 Lakeside Avenue, Detroit, MI",
      notes: "Multi-tenant storefront cleaning inquiry.",
      lifetime_value_cents: 0,
      order_count: 0,
      last_contact_at: nowIso(),
    });

    const lead = await insertLead(admin, created, tenantId, operatorId, {
      customer_id: lakeside.id,
      title: "Storefront concrete and gum removal",
      summary: "Retail plaza wants a phased concrete wash and gum cleanup proposal.",
      requested_service_type: "Pressure washing",
      service_address: lakeside.service_address,
      contact_name: "Dana Price",
      contact_email: lakeside.email,
      contact_phone: lakeside.phone,
    });

    const riverfrontOrder = await insertOrder(admin, created, tenantId, operatorId, {
      customer_id: riverfront.id,
      status: "confirmed",
      items: [{ name: "Apartment exterior wash", quantity: 1, unit: "job" }],
      subtotal_cents: 240000,
      total_cents: 240000,
      estimated_total_cents: 240000,
      amount_paid_cents: 60000,
      amount_due_cents: 180000,
      payment_state: "partially_paid",
      deposit_required_cents: 60000,
      deposit_paid_cents: 60000,
      payment_due_date: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10),
      cart_summary: "Apartment buildings, sidewalks, and stairwells",
      customer_name: riverfront.name,
      email: riverfront.email,
      phone: riverfront.phone,
      preferred_contact: riverfront.preferred_contact,
      service_address: riverfront.service_address,
    });

    const riverfrontJob = await insertJob(admin, created, tenantId, operatorId, {
      order_id: riverfrontOrder.id,
      customer_id: riverfront.id,
      title: "Riverfront property wash",
      service_address: riverfront.service_address,
      scheduled_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      scheduled_time: "09:00",
      schedule_window: "Morning window",
      summary: "Crew wash for buildings, rails, and common paths.",
      notes: "Protect tenant signage and keep the loading dock accessible.",
      payment_state: "partially_paid",
      amount_paid_cents: 60000,
      amount_due_cents: 180000,
    });

    const masonOrder = await insertOrder(admin, created, tenantId, operatorId, {
      customer_id: mason.id,
      status: "completed",
      items: [{ name: "House wash and patio brightening", quantity: 1, unit: "job" }],
      subtotal_cents: 185000,
      total_cents: 185000,
      estimated_total_cents: 185000,
      amount_paid_cents: 185000,
      amount_due_cents: 0,
      payment_state: "paid",
      payment_due_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      cart_summary: "House wash, gutters, and rear patio",
      customer_name: mason.name,
      email: mason.email,
      phone: mason.phone,
      preferred_contact: mason.preferred_contact,
      service_address: mason.service_address,
    });

    const masonJob = await insertJob(admin, created, tenantId, operatorId, {
      order_id: masonOrder.id,
      customer_id: mason.id,
      title: "Mason house wash",
      service_address: mason.service_address,
      scheduled_date: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
      scheduled_time: "10:30",
      schedule_window: "Late morning",
      summary: "Soft wash exterior with patio brightening add-on.",
      notes: "Customer wants a review request after final walkthrough.",
      status: "completed",
      payment_state: "paid",
      amount_paid_cents: 185000,
      amount_due_cents: 0,
    });

    const riverfrontDeposit = await insertPayment(admin, created, tenantId, operatorId, {
      customer_id: riverfront.id,
      order_id: riverfrontOrder.id,
      job_id: riverfrontJob.id,
      payment_mode: "ach",
      amount_subtotal: 60000,
      amount_total: 60000,
      note: "Deposit received to hold the crew window.",
      paid_at: nowIso(),
      received_at: nowIso(),
      reference_number: `DEP-${stamp}`,
    });

    const masonPayment = await insertPayment(admin, created, tenantId, operatorId, {
      customer_id: mason.id,
      order_id: masonOrder.id,
      job_id: masonJob.id,
      payment_mode: "check",
      amount_subtotal: 185000,
      amount_total: 185000,
      note: "Final payment collected on completion.",
      paid_at: nowIso(),
      received_at: nowIso(),
      reference_number: `FIN-${stamp}`,
    });

    await insertInteraction(admin, created, tenantId, operatorId, {
      customer_id: riverfront.id,
      type: "call",
      summary: "Confirmed water access and crew arrival window with the property manager.",
      metadata: { order_id: riverfrontOrder.id, payment_id: riverfrontDeposit.id },
    });

    await insertInteraction(admin, created, tenantId, operatorId, {
      customer_id: mason.id,
      type: "email",
      summary: "Sent completion recap and review request after the final walkthrough.",
      metadata: { order_id: masonOrder.id, payment_id: masonPayment.id },
    });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1640, height: 1280 } });

    try {
      await login(page, siteUrl, user);

      await page.goto(`${siteUrl}/operator/#dashboard`, { waitUntil: "networkidle" });
      await page.locator("#dashboardWrap").waitFor({ state: "visible" });
      await page.locator("#dashboardWrap").screenshot({
        path: path.join(OUTPUT_DIR, "operator-today.png"),
      });

      await page.goto(`${siteUrl}/operator/#orders`, { waitUntil: "networkidle" });
      await clickListItem(page, "#ordersList", riverfront.name);
      await page.locator('[data-panel="orders"]').screenshot({
        path: path.join(OUTPUT_DIR, "operator-orders.png"),
      });

      await page.goto(`${siteUrl}/operator/#customers`, { waitUntil: "networkidle" });
      await clickListItem(page, "#customersList", mason.name);
      await page.locator('[data-panel="customers"]').screenshot({
        path: path.join(OUTPUT_DIR, "operator-customers.png"),
      });

      await page.goto(`${siteUrl}/operator/#payments`, { waitUntil: "networkidle" });
      await tryClickListItem(page, "#paymentsList", riverfront.name);
      await page.locator('[data-panel="payments"]').screenshot({
        path: path.join(OUTPUT_DIR, "operator-payments.png"),
      });

      await page.goto(`${siteUrl}/operator/#jobs`, { waitUntil: "networkidle" });
      await tryClickListItem(page, "#jobsList", riverfront.name);
      await page.locator('[data-panel="jobs"]').screenshot({
        path: path.join(OUTPUT_DIR, "operator-jobs.png"),
      });
    } finally {
      await browser.close();
    }

    console.log(`Landing screenshots captured in ${OUTPUT_DIR}`);
    console.log(`Lead captured for tracking: ${lead.id}`);
  } finally {
    await cleanup(admin, created);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
