"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_OWNER_EMAIL = "clane@benkari.net";
const DEMO_EMAIL_PREFIX = "demo.benkari.";
const DEMO_TAG = "demo_seed_v1";
const SUMMARY_PATH = path.resolve(process.cwd(), ".tmp", "demo-customer-seed-summary.json");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  argv.forEach((arg) => {
    const text = String(arg || "").trim();
    if (!text.startsWith("--")) return;
    const [rawKey, ...rest] = text.slice(2).split("=");
    const key = String(rawKey || "").trim();
    if (!key) return;
    args[key] = rest.length ? rest.join("=").trim() : true;
  });
  return args;
}

function loadEnv() {
  const testEnv = path.resolve(process.cwd(), ".env.test");
  const defaultEnv = path.resolve(process.cwd(), ".env");

  if (fs.existsSync(testEnv)) dotenv.config({ path: testEnv, quiet: true });
  if (fs.existsSync(defaultEnv)) dotenv.config({ path: defaultEnv, override: false, quiet: true });
}

function assertEnv() {
  const url = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase service-role environment. Set TEST_SUPABASE_URL/SERVICE_ROLE_KEY or SUPABASE_URL/SERVICE_ROLE_KEY.");
  }
  return { url, key };
}

function createSupabase() {
  loadEnv();
  const { url, key } = assertEnv();
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function clean(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isoAtDayOffset(offsetDays, hour = 9, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
}

function dateAtDayOffset(offsetDays) {
  return isoAtDayOffset(offsetDays).slice(0, 10);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mergeMetadata(metadata = {}, extra = {}) {
  return {
    ...safeObject(metadata),
    ...safeObject(extra),
    seed_tag: DEMO_TAG,
  };
}

function hydrovacCloseout(overrides = {}) {
  return {
    version: 1,
    captured_at: isoAtDayOffset(0, 16, 15),
    load_status: "truck_clear",
    bol_number: "",
    live_load_hold_reason: "",
    disposal_ready_by: "",
    locates_verified_on_site: true,
    permit_status: "not_required",
    permit_note: "",
    field_summary: "Crew completed the work and turned over a clean site packet.",
    customer_note: "Customer walked the site and signed off on completion.",
    office_follow_up: [],
    ...overrides,
  };
}

function moneyLine(name, quantity, unit, unitPriceCents, description = "") {
  return {
    id: `line_${slugify(name)}_${quantity}_${unitPriceCents}`,
    kind: "base",
    name,
    unit,
    quantity,
    description,
    product_id: "",
    template_key: "",
    pricing_source: "job_specific",
    unit_price_cents: unitPriceCents,
  };
}

async function findRows(supabase, table, match = {}, selectColumns = "*") {
  let query = supabase.from(table).select(selectColumns);
  Object.entries(match).forEach(([field, value]) => {
    if (Array.isArray(value)) {
      query = query.in(field, value);
      return;
    }
    query = query.eq(field, value);
  });
  const { data, error } = await query.limit(100);
  if (error) throw error;
  return data || [];
}

async function findRow(supabase, table, match = {}, selectColumns = "*") {
  const rows = await findRows(supabase, table, match, selectColumns);
  return rows[0] || null;
}

async function ensureRow(supabase, { table, match, insertPayload, updatePayload = insertPayload, selectColumns = "*" }) {
  const existing = await findRow(supabase, table, match, "id");
  if (!existing) {
    const { data, error } = await supabase.from(table).insert(insertPayload).select(selectColumns).single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from(table)
    .update(updatePayload)
    .eq("id", existing.id)
    .select(selectColumns)
    .single();
  if (error) throw error;
  return data;
}

async function resolveTenantContext(supabase, ownerEmail) {
  const operator = await findRow(
    supabase,
    "operators",
    { email: ownerEmail },
    "id,email,name,role,tenant_id"
  );

  if (!operator?.tenant_id) {
    throw new Error(`No tenant owner/operator was found for ${ownerEmail}.`);
  }

  const tenant = await findRow(
    supabase,
    "tenants",
    { id: operator.tenant_id },
    "id,slug,name,owner_email,business_type,prooflink_plan_key,status,billing_status"
  );

  if (!tenant) {
    throw new Error(`Operator ${ownerEmail} is linked to tenant ${operator.tenant_id}, but the tenant row was not found.`);
  }

  return { operator, tenant };
}

async function ensureTenantConfig(supabase, tenant, operator) {
  const nowIso = new Date().toISOString();
  await ensureRow(supabase, {
    table: "tenant_config",
    match: { tenant_id: tenant.id, config_key: "site_settings" },
    insertPayload: {
      tenant_id: tenant.id,
      config_key: "site_settings",
      config_value: JSON.stringify({
        business_type: tenant.business_type || "hydrovac",
        workspace_business_type: tenant.business_type || "hydrovac",
        tagline: "Demo-ready hydrovac workspace for Benkari walkthroughs.",
        accent_color: "#c84b2f",
        seeded_by: DEMO_TAG,
        updated_by_operator_id: operator.id,
      }),
      created_at: nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      config_value: JSON.stringify({
        business_type: tenant.business_type || "hydrovac",
        workspace_business_type: tenant.business_type || "hydrovac",
        tagline: "Demo-ready hydrovac workspace for Benkari walkthroughs.",
        accent_color: "#c84b2f",
        seeded_by: DEMO_TAG,
        updated_by_operator_id: operator.id,
      }),
      updated_at: nowIso,
    },
  });
}

async function ensureTenantSettings(supabase, tenant) {
  const nowIso = new Date().toISOString();
  await ensureRow(supabase, {
    table: "tenant_settings",
    match: { tenant_id: tenant.id },
    insertPayload: {
      tenant_id: tenant.id,
      branding: {
        business_name: tenant.name,
        accent_color: "#c84b2f",
      },
      contact: {
        email: tenant.owner_email,
        city_state: "Detroit, MI",
      },
      business_hours: {
        monday: ["07:00", "17:00"],
        tuesday: ["07:00", "17:00"],
        wednesday: ["07:00", "17:00"],
        thursday: ["07:00", "17:00"],
        friday: ["07:00", "17:00"],
      },
      created_at: nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      branding: {
        business_name: tenant.name,
        accent_color: "#c84b2f",
      },
      contact: {
        email: tenant.owner_email,
        city_state: "Detroit, MI",
      },
      business_hours: {
        monday: ["07:00", "17:00"],
        tuesday: ["07:00", "17:00"],
        wednesday: ["07:00", "17:00"],
        thursday: ["07:00", "17:00"],
        friday: ["07:00", "17:00"],
      },
      updated_at: nowIso,
    },
  });
}

async function ensureAvailability(supabase, tenant, operator) {
  const nowIso = new Date().toISOString();
  await ensureRow(supabase, {
    table: "availability",
    match: { tenant_id: tenant.id, operator_id: operator.id },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      timezone: "America/Detroit",
      lead_time_hours: 24,
      max_orders_per_day: 4,
      blackout_dates: [],
      notes: "Demo schedule tuned for owner walkthroughs.",
      created_at: nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      timezone: "America/Detroit",
      lead_time_hours: 24,
      max_orders_per_day: 4,
      blackout_dates: [],
      notes: "Demo schedule tuned for owner walkthroughs.",
      updated_at: nowIso,
    },
  });
}

async function ensureHydrovacSettings(supabase, tenant) {
  const nowIso = new Date().toISOString();
  await ensureRow(supabase, {
    table: "tenant_hydrovac_settings",
    match: { tenant_id: tenant.id },
    insertPayload: {
      tenant_id: tenant.id,
      default_billing_method: "hourly_plus_disposal",
      default_hourly_rate_cents: 32500,
      default_mobilization_cents: 9500,
      default_disposal_markup_percent: 18,
      portal_to_portal_billing: true,
      yard_address: "6840 Lynch Road, Detroit, MI",
      require_locate_ticket_for_excavation: true,
      require_confined_space_permit: true,
      default_ticket_validity_days: 10,
      emergency_callout_rate_cents: 46500,
      emergency_hourly_multiplier: 1.5,
      dot_number: "BNK-4402",
      usdot_registered: true,
      manifest_prefix: "BNK",
      permit_prefix: "BNK-CS",
      auto_generate_manifest_numbers: true,
      notify_on_ticket_expiry: true,
      notify_on_permit_expiry: true,
      notify_on_compliance_warning: true,
      compliance_alert_email: tenant.owner_email,
      gps_sync_enabled: false,
      updated_at: nowIso,
    },
    updatePayload: {
      default_billing_method: "hourly_plus_disposal",
      default_hourly_rate_cents: 32500,
      default_mobilization_cents: 9500,
      default_disposal_markup_percent: 18,
      portal_to_portal_billing: true,
      yard_address: "6840 Lynch Road, Detroit, MI",
      require_locate_ticket_for_excavation: true,
      require_confined_space_permit: true,
      default_ticket_validity_days: 10,
      emergency_callout_rate_cents: 46500,
      emergency_hourly_multiplier: 1.5,
      dot_number: "BNK-4402",
      usdot_registered: true,
      manifest_prefix: "BNK",
      permit_prefix: "BNK-CS",
      auto_generate_manifest_numbers: true,
      notify_on_ticket_expiry: true,
      notify_on_permit_expiry: true,
      notify_on_compliance_warning: true,
      compliance_alert_email: tenant.owner_email,
      gps_sync_enabled: false,
      updated_at: nowIso,
    },
  });
}

async function ensureProduct(supabase, tenant, operator, product) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "products",
    match: { tenant_id: tenant.id, slug: product.slug },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      pricing_mode: product.pricing_mode || "quote",
      category: product.category || "Hydrovac",
      starting_price_cents: product.starting_price_cents || 0,
      sell_price_cents: product.sell_price_cents || 0,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      name: product.name,
      description: product.description,
      pricing_mode: product.pricing_mode || "quote",
      category: product.category || "Hydrovac",
      starting_price_cents: product.starting_price_cents || 0,
      sell_price_cents: product.sell_price_cents || 0,
      is_active: true,
      updated_at: nowIso,
    },
  });
}

async function ensureEquipment(supabase, tenant, operator, payload) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "equipment",
    match: { tenant_id: tenant.id, unit_number: payload.unit_number },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      ...payload,
      metadata: mergeMetadata(payload.metadata),
      created_at: payload.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      ...payload,
      metadata: mergeMetadata(payload.metadata),
      updated_at: nowIso,
    },
  });
}

async function ensureDisposalFacility(supabase, tenant, payload) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "disposal_facilities",
    match: { tenant_id: tenant.id, name: payload.name },
    insertPayload: {
      tenant_id: tenant.id,
      ...payload,
      created_at: payload.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      ...payload,
      updated_at: nowIso,
    },
  });
}

async function ensureDriverQualification(supabase, tenant, operator) {
  const nowIso = new Date().toISOString();
  await ensureRow(supabase, {
    table: "driver_qualifications",
    match: { tenant_id: tenant.id, member_id: operator.id },
    insertPayload: {
      tenant_id: tenant.id,
      member_id: operator.id,
      cdl_number: "MI-BNK-4402",
      cdl_state: "MI",
      cdl_class: "A",
      cdl_expiry_date: dateAtDayOffset(50),
      cdl_endorsements: ["tank", "air_brake"],
      medical_certificate_expiry: dateAtDayOffset(42),
      medical_examiner_name: "Benkari Occupational Health",
      hazmat_certified: false,
      confined_space_certified: true,
      confined_space_cert_expiry_date: dateAtDayOffset(62),
      h2s_alive_certified: true,
      h2s_cert_expiry_date: dateAtDayOffset(92),
      first_aid_certified: true,
      first_aid_cert_expiry_date: dateAtDayOffset(92),
      defensive_driving_completed: true,
      last_mvr_check_date: dateAtDayOffset(-14),
      mvr_status: "clear",
      hos_available_driving_minutes: 420,
      hos_cycle_used_minutes: 860,
      hos_last_synced_at: isoAtDayOffset(0, 6, 20),
      notes: "Demo driver qualification record for owner walkthroughs.",
      updated_at: nowIso,
    },
    updatePayload: {
      cdl_number: "MI-BNK-4402",
      cdl_state: "MI",
      cdl_class: "A",
      cdl_expiry_date: dateAtDayOffset(50),
      cdl_endorsements: ["tank", "air_brake"],
      medical_certificate_expiry: dateAtDayOffset(42),
      medical_examiner_name: "Benkari Occupational Health",
      hazmat_certified: false,
      confined_space_certified: true,
      confined_space_cert_expiry_date: dateAtDayOffset(62),
      h2s_alive_certified: true,
      h2s_cert_expiry_date: dateAtDayOffset(92),
      first_aid_certified: true,
      first_aid_cert_expiry_date: dateAtDayOffset(92),
      defensive_driving_completed: true,
      last_mvr_check_date: dateAtDayOffset(-14),
      mvr_status: "clear",
      hos_available_driving_minutes: 420,
      hos_cycle_used_minutes: 860,
      hos_last_synced_at: isoAtDayOffset(0, 6, 20),
      notes: "Demo driver qualification record for owner walkthroughs.",
      updated_at: nowIso,
    },
  });
}

async function ensureCustomer(supabase, tenant, operator, customer) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "customers",
    match: { tenant_id: tenant.id, email: customer.email },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      name: customer.name,
      company_name: customer.company_name || customer.name,
      email: customer.email,
      phone: customer.phone,
      preferred_contact: customer.preferred_contact || "phone",
      notes: customer.notes,
      service_address: customer.service_address,
      billing_address: customer.billing_address || customer.service_address,
      lead_source: customer.lead_source || "demo_seed",
      tags: customer.tags || ["demo", "owner-walkthrough"],
      lifetime_value_cents: customer.lifetime_value_cents || 0,
      order_count: customer.order_count || 0,
      last_contact_at: customer.last_contact_at || nowIso,
      created_at: customer.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      name: customer.name,
      company_name: customer.company_name || customer.name,
      phone: customer.phone,
      preferred_contact: customer.preferred_contact || "phone",
      notes: customer.notes,
      service_address: customer.service_address,
      billing_address: customer.billing_address || customer.service_address,
      lead_source: customer.lead_source || "demo_seed",
      tags: customer.tags || ["demo", "owner-walkthrough"],
      lifetime_value_cents: customer.lifetime_value_cents || 0,
      order_count: customer.order_count || 0,
      last_contact_at: customer.last_contact_at || nowIso,
      updated_at: nowIso,
    },
  });
}

async function ensureLead(supabase, tenant, operator, customerId, lead) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "leads",
    match: { tenant_id: tenant.id, source_ref: lead.source_ref },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_id: customerId,
      status: lead.status,
      source_type: lead.source_type || "manual",
      source_ref: lead.source_ref,
      title: lead.title,
      summary: lead.summary,
      requested_service_type: lead.requested_service_type,
      priority: lead.priority || "normal",
      service_address: lead.service_address,
      contact_name: lead.contact_name,
      contact_email: lead.contact_email,
      contact_phone: lead.contact_phone,
      preferred_contact: lead.preferred_contact || "phone",
      notes: lead.notes || null,
      metadata: mergeMetadata(lead.metadata),
      converted_bid_id: lead.converted_bid_id || null,
      converted_order_id: lead.converted_order_id || null,
      converted_job_id: lead.converted_job_id || null,
      last_activity_at: lead.last_activity_at || nowIso,
      created_at: lead.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      status: lead.status,
      title: lead.title,
      summary: lead.summary,
      requested_service_type: lead.requested_service_type,
      priority: lead.priority || "normal",
      service_address: lead.service_address,
      contact_name: lead.contact_name,
      contact_email: lead.contact_email,
      contact_phone: lead.contact_phone,
      preferred_contact: lead.preferred_contact || "phone",
      notes: lead.notes || null,
      metadata: mergeMetadata(lead.metadata),
      converted_bid_id: lead.converted_bid_id || null,
      converted_order_id: lead.converted_order_id || null,
      converted_job_id: lead.converted_job_id || null,
      last_activity_at: lead.last_activity_at || nowIso,
      updated_at: nowIso,
    },
  });
}

async function ensureBid(supabase, tenant, operator, customerId, leadId, bid) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "bids",
    match: { tenant_id: tenant.id, customer_id: customerId, title: bid.title },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      lead_id: leadId,
      customer_id: customerId,
      status: bid.status,
      profile: bid.profile || "contractor_remodeling",
      title: bid.title,
      walkthrough_at: bid.walkthrough_at || nowIso,
      valid_until: bid.valid_until,
      service_address: bid.service_address,
      site_contact: bid.site_contact,
      schedule_window: bid.schedule_window,
      project_summary: bid.project_summary,
      scope_of_work: bid.scope_of_work,
      proposed_solution: bid.proposed_solution,
      materials_plan: bid.materials_plan,
      unused_materials_plan: bid.unused_materials_plan,
      exclusions: bid.exclusions,
      warranty: bid.warranty,
      cover_note: bid.cover_note,
      internal_notes: bid.internal_notes,
      deposit_percent: bid.deposit_percent || 0,
      deposit_amount_cents: bid.deposit_amount_cents || 0,
      terms: bid.terms,
      line_items: bid.line_items || [],
      photos: bid.photos || [],
      subtotal_cents: bid.subtotal_cents || 0,
      optional_total_cents: bid.optional_total_cents || 0,
      total_cents: bid.total_cents || 0,
      metadata: mergeMetadata(bid.metadata),
      converted_order_id: bid.converted_order_id || null,
      sent_at: bid.sent_at || null,
      approved_at: bid.approved_at || null,
      converted_at: bid.converted_at || null,
      created_at: bid.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      lead_id: leadId,
      status: bid.status,
      profile: bid.profile || "contractor_remodeling",
      walkthrough_at: bid.walkthrough_at || nowIso,
      valid_until: bid.valid_until,
      service_address: bid.service_address,
      site_contact: bid.site_contact,
      schedule_window: bid.schedule_window,
      project_summary: bid.project_summary,
      scope_of_work: bid.scope_of_work,
      proposed_solution: bid.proposed_solution,
      materials_plan: bid.materials_plan,
      unused_materials_plan: bid.unused_materials_plan,
      exclusions: bid.exclusions,
      warranty: bid.warranty,
      cover_note: bid.cover_note,
      internal_notes: bid.internal_notes,
      deposit_percent: bid.deposit_percent || 0,
      deposit_amount_cents: bid.deposit_amount_cents || 0,
      terms: bid.terms,
      line_items: bid.line_items || [],
      photos: bid.photos || [],
      subtotal_cents: bid.subtotal_cents || 0,
      optional_total_cents: bid.optional_total_cents || 0,
      total_cents: bid.total_cents || 0,
      metadata: mergeMetadata(bid.metadata),
      converted_order_id: bid.converted_order_id || null,
      sent_at: bid.sent_at || null,
      approved_at: bid.approved_at || null,
      converted_at: bid.converted_at || null,
      updated_at: nowIso,
    },
  });
}

async function ensureQuote(supabase, tenant, operator, customer, quote) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "quotes",
    match: { tenant_id: tenant.id, customer_email: customer.email, title: quote.title },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_name: customer.name,
      customer_email: customer.email,
      title: quote.title,
      description: quote.description || null,
      notes: quote.notes || null,
      amount_cents: quote.amount_cents,
      status: quote.status || "pending",
      valid_until: quote.valid_until || null,
      accepted_at: quote.accepted_at || null,
      declined_at: quote.declined_at || null,
      created_at: quote.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      customer_name: customer.name,
      description: quote.description || null,
      notes: quote.notes || null,
      amount_cents: quote.amount_cents,
      status: quote.status || "pending",
      valid_until: quote.valid_until || null,
      accepted_at: quote.accepted_at || null,
      declined_at: quote.declined_at || null,
      updated_at: nowIso,
    },
  });
}

async function ensureOrder(supabase, tenant, operator, customer, bidId, leadId, order) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "orders",
    match: { tenant_id: tenant.id, source_ref: order.source_ref },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_id: customer.id,
      status: order.status,
      fulfillment: order.fulfillment || "service",
      scheduled_date: order.scheduled_date || null,
      scheduled_time: order.scheduled_time || null,
      items: order.items || [],
      subtotal_cents: order.subtotal_cents || 0,
      delivery_fee_cents: order.delivery_fee_cents || 0,
      total_cents: order.total_cents || 0,
      estimated_total_cents: order.estimated_total_cents || order.total_cents || 0,
      item_count: order.item_count || (order.items || []).length,
      unpriced_count: order.unpriced_count || 0,
      cart_summary: order.cart_summary,
      notes: order.notes || null,
      customer_name: customer.name,
      email: customer.email,
      phone: customer.phone,
      preferred_contact: customer.preferred_contact || "phone",
      source_type: order.source_type || "demo_seed",
      source_ref: order.source_ref,
      lead_id: leadId || null,
      bid_id: bidId || null,
      primary_job_id: order.primary_job_id || null,
      payment_state: order.payment_state || "unpaid",
      amount_paid_cents: order.amount_paid_cents || 0,
      amount_due_cents: order.amount_due_cents || order.total_cents || 0,
      payment_due_date: order.payment_due_date || null,
      deposit_required_cents: order.deposit_required_cents || 0,
      deposit_paid_cents: order.deposit_paid_cents || 0,
      booked_at: order.booked_at || null,
      completed_at: order.completed_at || null,
      service_plan_id: order.service_plan_id || null,
      service_address: order.service_address || customer.service_address,
      schedule_window: order.schedule_window || null,
      deposit_policy: order.deposit_policy || "optional",
      invoice_number: order.invoice_number || null,
      invoice_sent_at: order.invoice_sent_at || null,
      order_type: order.order_type || "standard",
      created_at: order.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      status: order.status,
      fulfillment: order.fulfillment || "service",
      scheduled_date: order.scheduled_date || null,
      scheduled_time: order.scheduled_time || null,
      items: order.items || [],
      subtotal_cents: order.subtotal_cents || 0,
      delivery_fee_cents: order.delivery_fee_cents || 0,
      total_cents: order.total_cents || 0,
      estimated_total_cents: order.estimated_total_cents || order.total_cents || 0,
      item_count: order.item_count || (order.items || []).length,
      unpriced_count: order.unpriced_count || 0,
      cart_summary: order.cart_summary,
      notes: order.notes || null,
      customer_name: customer.name,
      email: customer.email,
      phone: customer.phone,
      preferred_contact: customer.preferred_contact || "phone",
      lead_id: leadId || null,
      bid_id: bidId || null,
      primary_job_id: order.primary_job_id || null,
      payment_state: order.payment_state || "unpaid",
      amount_paid_cents: order.amount_paid_cents || 0,
      amount_due_cents: order.amount_due_cents || order.total_cents || 0,
      payment_due_date: order.payment_due_date || null,
      deposit_required_cents: order.deposit_required_cents || 0,
      deposit_paid_cents: order.deposit_paid_cents || 0,
      booked_at: order.booked_at || null,
      completed_at: order.completed_at || null,
      service_plan_id: order.service_plan_id || null,
      service_address: order.service_address || customer.service_address,
      schedule_window: order.schedule_window || null,
      deposit_policy: order.deposit_policy || "optional",
      invoice_number: order.invoice_number || null,
      invoice_sent_at: order.invoice_sent_at || null,
      order_type: order.order_type || "standard",
      updated_at: nowIso,
    },
  });
}

async function ensureBooking(supabase, tenant, operator, customer, order, booking) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "bookings",
    match: { tenant_id: tenant.id, order_id: order.id },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_name: customer.name,
      customer_email: customer.email,
      title: booking.title,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      notes: booking.notes || null,
      order_id: order.id,
      status: booking.status || "confirmed",
      created_at: booking.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      customer_name: customer.name,
      customer_email: customer.email,
      title: booking.title,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      notes: booking.notes || null,
      status: booking.status || "confirmed",
      updated_at: nowIso,
    },
  });
}

async function ensureJob(supabase, tenant, operator, customer, order, bidId, equipmentId, job) {
  const nowIso = new Date().toISOString();
  const customFields = mergeMetadata(job.custom_fields, { ...(job.metadata || {}) });
  return ensureRow(supabase, {
    table: "jobs",
    match: { tenant_id: tenant.id, work_order_number: job.work_order_number },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      order_id: order.id,
      customer_id: customer.id,
      bid_id: bidId || null,
      assigned_operator_id: operator.id,
      assigned_member_id: operator.id,
      assigned_truck_id: equipmentId || null,
      status: job.status,
      title: job.title,
      service_address: job.service_address || customer.service_address,
      scheduled_date: job.scheduled_date || null,
      scheduled_time: job.scheduled_time || null,
      schedule_window: job.schedule_window || null,
      summary: job.summary,
      notes: job.notes || null,
      proof: job.proof || [],
      payment_state: job.payment_state || order.payment_state || "unpaid",
      amount_paid_cents: job.amount_paid_cents || 0,
      amount_due_cents: job.amount_due_cents || order.total_cents || 0,
      started_at: job.started_at || null,
      completed_at: job.completed_at || null,
      work_order_number: job.work_order_number,
      service_type: job.service_type || null,
      job_type: job.job_type || null,
      billing_method: job.billing_method || "hourly_plus_disposal",
      hourly_truck_rate_cents: job.hourly_truck_rate_cents || 32500,
      hourly_operator_rate_cents: job.hourly_operator_rate_cents || 11500,
      mobilization_fee_cents: job.mobilization_fee_cents || 9500,
      mobilization_charge_cents: job.mobilization_charge_cents || 9500,
      disposal_cost_cents: job.disposal_cost_cents || 0,
      customer_po_number: job.customer_po_number || null,
      asset_id: job.asset_id || null,
      requires_confined_space_permit: job.requires_confined_space_permit === true,
      emergency_callout: job.emergency_callout === true,
      custom_fields: customFields,
      service_plan_id: job.service_plan_id || null,
      created_at: job.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      assigned_operator_id: operator.id,
      assigned_member_id: operator.id,
      assigned_truck_id: equipmentId || null,
      status: job.status,
      title: job.title,
      service_address: job.service_address || customer.service_address,
      scheduled_date: job.scheduled_date || null,
      scheduled_time: job.scheduled_time || null,
      schedule_window: job.schedule_window || null,
      summary: job.summary,
      notes: job.notes || null,
      proof: job.proof || [],
      payment_state: job.payment_state || order.payment_state || "unpaid",
      amount_paid_cents: job.amount_paid_cents || 0,
      amount_due_cents: job.amount_due_cents || order.total_cents || 0,
      started_at: job.started_at || null,
      completed_at: job.completed_at || null,
      service_type: job.service_type || null,
      job_type: job.job_type || null,
      billing_method: job.billing_method || "hourly_plus_disposal",
      hourly_truck_rate_cents: job.hourly_truck_rate_cents || 32500,
      hourly_operator_rate_cents: job.hourly_operator_rate_cents || 11500,
      mobilization_fee_cents: job.mobilization_fee_cents || 9500,
      mobilization_charge_cents: job.mobilization_charge_cents || 9500,
      disposal_cost_cents: job.disposal_cost_cents || 0,
      customer_po_number: job.customer_po_number || null,
      asset_id: job.asset_id || null,
      requires_confined_space_permit: job.requires_confined_space_permit === true,
      emergency_callout: job.emergency_callout === true,
      custom_fields: customFields,
      service_plan_id: job.service_plan_id || null,
      updated_at: nowIso,
    },
  });
}

async function ensureOrderPrimaryJob(supabase, orderId, jobId) {
  const { error } = await supabase
    .from("orders")
    .update({
      primary_job_id: jobId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) throw error;
}

async function ensureAsset(supabase, tenant, customerId, asset) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "infrastructure_assets",
    match: { tenant_id: tenant.id, external_asset_id: asset.external_asset_id },
    insertPayload: {
      tenant_id: tenant.id,
      customer_id: customerId,
      ...asset,
      metadata: mergeMetadata(asset.metadata),
      created_at: asset.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      ...asset,
      metadata: mergeMetadata(asset.metadata),
      updated_at: nowIso,
    },
  });
}

async function ensureLocate(supabase, tenant, operator, jobId, orderId, customerId, locate) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "utility_locate_tickets",
    match: { tenant_id: tenant.id, ticket_number: locate.ticket_number },
    insertPayload: {
      tenant_id: tenant.id,
      job_id: jobId,
      order_id: orderId,
      customer_id: customerId,
      created_by_member_id: operator.id,
      verified_by_member_id: locate.verified_on_site === true ? operator.id : null,
      ...locate,
      created_at: locate.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      job_id: jobId,
      order_id: orderId,
      customer_id: customerId,
      created_by_member_id: operator.id,
      verified_by_member_id: locate.verified_on_site === true ? operator.id : null,
      ...locate,
      updated_at: nowIso,
    },
  });
}

async function ensurePermit(supabase, tenant, jobId, orderId, permit) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "confined_space_permits",
    match: { tenant_id: tenant.id, permit_number: permit.permit_number },
    insertPayload: {
      tenant_id: tenant.id,
      job_id: jobId,
      order_id: orderId,
      ...permit,
      created_at: permit.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      job_id: jobId,
      order_id: orderId,
      ...permit,
      updated_at: nowIso,
    },
  });
}

async function ensureManifest(supabase, tenant, operator, jobId, orderId, customerId, truckId, manifest) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "waste_manifests",
    match: { tenant_id: tenant.id, manifest_number: manifest.manifest_number },
    insertPayload: {
      tenant_id: tenant.id,
      job_id: jobId,
      order_id: orderId,
      customer_id: customerId,
      truck_id: truckId,
      driver_member_id: operator.id,
      ...manifest,
      metadata: mergeMetadata(manifest.metadata),
      created_at: manifest.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      job_id: jobId,
      order_id: orderId,
      customer_id: customerId,
      truck_id: truckId,
      driver_member_id: operator.id,
      ...manifest,
      metadata: mergeMetadata(manifest.metadata),
      updated_at: nowIso,
    },
  });
}

async function syncHydrovacJobLinks(supabase, jobRow) {
  const manifests = await findRows(
    supabase,
    "waste_manifests",
    { tenant_id: jobRow.tenant_id, job_id: jobRow.id },
    "id, quantity_unit, quantity_estimated, quantity_actual, disposal_cost_cents, disposal_charge_cents, status"
  );
  const locates = await findRows(
    supabase,
    "utility_locate_tickets",
    { tenant_id: jobRow.tenant_id, job_id: jobRow.id },
    "id, status"
  );
  const permits = await findRows(
    supabase,
    "confined_space_permits",
    { tenant_id: jobRow.tenant_id, job_id: jobRow.id },
    "id"
  );

  const activeManifests = manifests.filter((manifest) => clean(manifest.status).toLowerCase() !== "void");
  const totalGallons = activeManifests.reduce((sum, manifest) => (
    manifest.quantity_unit === "gallons"
      ? sum + Number(manifest.quantity_actual ?? manifest.quantity_estimated ?? 0)
      : sum
  ), 0);
  const totalYards = activeManifests.reduce((sum, manifest) => (
    manifest.quantity_unit === "cubic_yards"
      ? sum + Number(manifest.quantity_actual ?? manifest.quantity_estimated ?? 0)
      : sum
  ), 0);
  const totalDisposalCost = activeManifests.reduce((sum, manifest) => sum + Number(manifest.disposal_cost_cents || 0), 0);
  const totalDisposalCharge = activeManifests.reduce((sum, manifest) => sum + Number(manifest.disposal_charge_cents || 0), 0);

  const { error } = await supabase
    .from("jobs")
    .update({
      manifest_ids: activeManifests.map((manifest) => manifest.id),
      locate_ticket_ids: locates
        .filter((ticket) => clean(ticket.status).toLowerCase() !== "cancelled")
        .map((ticket) => ticket.id),
      permit_ids: permits.map((permit) => permit.id),
      total_loads_hauled: activeManifests.length,
      total_gallons_hauled: Number(totalGallons.toFixed(2)),
      total_yards_hauled: Number(totalYards.toFixed(2)),
      total_disposal_cost_cents: totalDisposalCost,
      total_disposal_charge_cents: totalDisposalCharge,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobRow.id);
  if (error) throw error;
}

async function ensurePayment(supabase, tenant, operator, customerId, orderId, jobId, payment) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "payments",
    match: { tenant_id: tenant.id, reference_number: payment.reference_number },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_id: customerId,
      order_id: orderId,
      job_id: jobId,
      payment_mode: payment.payment_mode || "manual_other",
      status: payment.status || "paid",
      amount_subtotal: payment.amount_subtotal || payment.amount_total || 0,
      amount_total: payment.amount_total || 0,
      amount_platform_fee: payment.amount_platform_fee || 0,
      currency: "usd",
      livemode: false,
      metadata: mergeMetadata(payment.metadata),
      source: payment.source || "manual",
      reference_number: payment.reference_number,
      note: payment.note || null,
      paid_at: payment.paid_at || null,
      received_at: payment.received_at || payment.paid_at || null,
      refunded_at: payment.refunded_at || null,
      is_manual: payment.is_manual !== false,
      created_at: payment.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      customer_id: customerId,
      order_id: orderId,
      job_id: jobId,
      payment_mode: payment.payment_mode || "manual_other",
      status: payment.status || "paid",
      amount_subtotal: payment.amount_subtotal || payment.amount_total || 0,
      amount_total: payment.amount_total || 0,
      amount_platform_fee: payment.amount_platform_fee || 0,
      currency: "usd",
      livemode: false,
      metadata: mergeMetadata(payment.metadata),
      source: payment.source || "manual",
      note: payment.note || null,
      paid_at: payment.paid_at || null,
      received_at: payment.received_at || payment.paid_at || null,
      refunded_at: payment.refunded_at || null,
      is_manual: payment.is_manual !== false,
      updated_at: nowIso,
    },
  });
}

async function ensureInvoice(supabase, tenant, operator, customer, orderId, invoice) {
  const nowIso = new Date().toISOString();
  const noteKey = `seed:${invoice.seed_key}`;
  return ensureRow(supabase, {
    table: "invoices",
    match: { tenant_id: tenant.id, order_id: orderId, notes: noteKey },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      order_id: orderId,
      customer_id: customer.id,
      customer_name: customer.name,
      customer_email: customer.email,
      business_name: tenant.name,
      line_items: invoice.line_items || [],
      subtotal_cents: invoice.subtotal_cents || 0,
      tax_cents: invoice.tax_cents || 0,
      total_cents: invoice.total_cents || 0,
      notes: noteKey,
      due_date: invoice.due_date || null,
      status: invoice.status || "draft",
      sent_at: invoice.sent_at || null,
      paid_at: invoice.paid_at || null,
      created_at: invoice.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      customer_id: customer.id,
      customer_name: customer.name,
      customer_email: customer.email,
      business_name: tenant.name,
      line_items: invoice.line_items || [],
      subtotal_cents: invoice.subtotal_cents || 0,
      tax_cents: invoice.tax_cents || 0,
      total_cents: invoice.total_cents || 0,
      due_date: invoice.due_date || null,
      status: invoice.status || "draft",
      sent_at: invoice.sent_at || null,
      paid_at: invoice.paid_at || null,
      updated_at: nowIso,
    },
  });
}

async function ensureExpense(supabase, tenant, operator, customerId, orderId, jobId, expense) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "expenses",
    match: { tenant_id: tenant.id, order_id: orderId, description: expense.description },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_id: customerId,
      order_id: orderId,
      job_id: jobId,
      date: expense.date || expense.expense_date || dateAtDayOffset(0),
      expense_date: expense.expense_date || expense.date || dateAtDayOffset(0),
      category: expense.category || "Operations",
      vendor: expense.vendor || "",
      description: expense.description,
      notes: expense.notes || null,
      amount_cents: expense.amount_cents || 0,
      expense_type: expense.expense_type || "job_cost",
      billable: expense.billable === true,
      reimbursable: expense.reimbursable === true,
      used_materials: expense.used_materials || [],
      created_at: expense.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      customer_id: customerId,
      job_id: jobId,
      date: expense.date || expense.expense_date || dateAtDayOffset(0),
      expense_date: expense.expense_date || expense.date || dateAtDayOffset(0),
      category: expense.category || "Operations",
      vendor: expense.vendor || "",
      notes: expense.notes || null,
      amount_cents: expense.amount_cents || 0,
      expense_type: expense.expense_type || "job_cost",
      billable: expense.billable === true,
      reimbursable: expense.reimbursable === true,
      used_materials: expense.used_materials || [],
      updated_at: nowIso,
    },
  });
}

async function ensureInteraction(supabase, tenant, operator, customerId, orderId, interaction) {
  return ensureRow(supabase, {
    table: "customer_interactions",
    match: { tenant_id: tenant.id, customer_id: customerId, summary: interaction.summary },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_id: customerId,
      order_id: orderId || null,
      type: interaction.type || "note",
      summary: interaction.summary,
      metadata: mergeMetadata(interaction.metadata),
      created_at: interaction.created_at || new Date().toISOString(),
    },
    updatePayload: {
      order_id: orderId || null,
      type: interaction.type || "note",
      metadata: mergeMetadata(interaction.metadata),
    },
  });
}

async function ensureReview(supabase, tenant, orderId, customer, review) {
  const existing = await findRow(supabase, "reviews", { order_id: orderId }, "id");
  const payload = {
    tenant_id: tenant.id,
    order_id: orderId,
    customer_name: customer.name,
    customer_email: customer.email,
    rating: review.rating,
    review_text: review.review_text,
    comment: review.review_text,
    created_at: review.created_at || new Date().toISOString(),
  };

  if (!existing) {
    const { data, error } = await supabase.from("reviews").insert(payload).select("*").single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("reviews")
    .update({
      rating: review.rating,
      review_text: review.review_text,
      comment: review.review_text,
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function ensureServicePlan(supabase, tenant, operator, customerId, orderId, jobId, plan) {
  const nowIso = new Date().toISOString();
  return ensureRow(supabase, {
    table: "service_plans",
    match: { tenant_id: tenant.id, customer_id: customerId, title: plan.title },
    insertPayload: {
      tenant_id: tenant.id,
      operator_id: operator.id,
      customer_id: customerId,
      source_order_id: orderId || null,
      source_job_id: jobId || null,
      status: plan.status || "active",
      title: plan.title,
      cadence: plan.cadence || "monthly",
      custom_interval_days: plan.custom_interval_days || null,
      next_run_on: plan.next_run_on || null,
      last_run_on: plan.last_run_on || null,
      auto_create_job: plan.auto_create_job !== false,
      service_address: plan.service_address,
      schedule_window: plan.schedule_window || null,
      summary: plan.summary || null,
      notes: plan.notes || null,
      line_items: plan.line_items || [],
      amount_cents: plan.amount_cents || 0,
      deposit_required_cents: plan.deposit_required_cents || 0,
      metadata: mergeMetadata(plan.metadata),
      created_at: plan.created_at || nowIso,
      updated_at: nowIso,
    },
    updatePayload: {
      source_order_id: orderId || null,
      source_job_id: jobId || null,
      status: plan.status || "active",
      cadence: plan.cadence || "monthly",
      custom_interval_days: plan.custom_interval_days || null,
      next_run_on: plan.next_run_on || null,
      last_run_on: plan.last_run_on || null,
      auto_create_job: plan.auto_create_job !== false,
      service_address: plan.service_address,
      schedule_window: plan.schedule_window || null,
      summary: plan.summary || null,
      notes: plan.notes || null,
      line_items: plan.line_items || [],
      amount_cents: plan.amount_cents || 0,
      deposit_required_cents: plan.deposit_required_cents || 0,
      metadata: mergeMetadata(plan.metadata),
      updated_at: nowIso,
    },
  });
}

async function ensureComplianceAlert(supabase, tenant, alert) {
  return ensureRow(supabase, {
    table: "compliance_alerts",
    match: {
      tenant_id: tenant.id,
      alert_type: alert.alert_type,
      reference_type: alert.reference_type,
      reference_id: alert.reference_id,
      message: alert.message,
    },
    insertPayload: {
      tenant_id: tenant.id,
      alert_type: alert.alert_type,
      severity: alert.severity,
      reference_type: alert.reference_type,
      reference_id: alert.reference_id,
      message: alert.message,
      due_date: alert.due_date || null,
      days_remaining: alert.days_remaining ?? null,
      resolved: alert.resolved === true,
      created_at: alert.created_at || new Date().toISOString(),
    },
    updatePayload: {
      severity: alert.severity,
      due_date: alert.due_date || null,
      days_remaining: alert.days_remaining ?? null,
      resolved: alert.resolved === true,
    },
  });
}

function buildScenarios() {
  return [
    {
      key: "riverfront",
      customer: {
        name: "Demo Riverfront Milling",
        email: `${DEMO_EMAIL_PREFIX}riverfront@example.com`,
        phone: "313-555-4101",
        notes: "Demo customer showing a live hydrovac load, open permit pressure, and office follow-up.",
        service_address: "1200 Water Street, Detroit, MI 48207",
        tags: ["demo", "dispatch-risk", "hydrovac"],
        last_contact_at: isoAtDayOffset(0, 7, 45),
      },
      story: {
        lead_status: "converted",
        bid_status: "converted",
        order_status: "confirmed",
        job_status: "dispatched",
        order_payment_state: "partially_paid",
        manifest_status: "in_transit",
        manifest_invoiced: false,
      },
      requiresPermit: true,
      liveLoad: true,
      bucket: "needs_field_handoff",
      title: "North trench daylighting and catch basin recovery",
      summary: "Expose utilities, clear the basin throat, and hold the truck load for compatible disposal.",
      quote: {
        title: "Emergency daylighting add-on",
        description: "Standby quote for after-hours support if the fiber alignment slips overnight.",
        amount_cents: 82500,
        status: "pending",
        valid_until: dateAtDayOffset(7),
      },
    },
    {
      key: "midtown",
      customer: {
        name: "Demo Midtown Campus Utilities",
        email: `${DEMO_EMAIL_PREFIX}midtown@example.com`,
        phone: "313-555-4102",
        notes: "Demo customer showing customer-records follow-through after crew closeout.",
        service_address: "4400 Cass Avenue, Detroit, MI 48201",
        tags: ["demo", "records-lane", "hydrovac"],
        last_contact_at: isoAtDayOffset(-1, 14, 20),
      },
      story: {
        lead_status: "converted",
        bid_status: "converted",
        order_status: "completed",
        job_status: "completed",
        order_payment_state: "partially_paid",
        manifest_status: "confirmed",
        manifest_invoiced: false,
      },
      requiresPermit: true,
      liveLoad: false,
      bucket: "needs_customer_records",
      title: "Steam vault cleanup and exposure",
      summary: "Completed vault cleanup with good field closeout, but office records are still waiting.",
      quote: {
        title: "Campus sweep follow-up option",
        description: "Quoted follow-up cleaning for the west-side structures after the first sweep results.",
        amount_cents: 164500,
        status: "pending",
        valid_until: dateAtDayOffset(14),
      },
    },
    {
      key: "greatlakes",
      customer: {
        name: "Demo Great Lakes Fiber",
        email: `${DEMO_EMAIL_PREFIX}fiber@example.com`,
        phone: "313-555-4103",
        notes: "Demo customer showing an audit-packet hold even after customer records are prepared.",
        service_address: "8900 Lynch Road, Detroit, MI 48234",
        tags: ["demo", "audit-packet", "hydrovac"],
        last_contact_at: isoAtDayOffset(-2, 10, 10),
      },
      story: {
        lead_status: "converted",
        bid_status: "converted",
        order_status: "completed",
        job_status: "completed",
        order_payment_state: "unpaid",
        manifest_status: "confirmed",
        manifest_invoiced: false,
      },
      requiresPermit: false,
      liveLoad: false,
      bucket: "needs_audit_packet",
      title: "Fiber daylighting and bore path verification",
      summary: "Field and customer records are complete, but audit packaging still needs office attention.",
      quote: {
        title: "Weekend bore support quote",
        description: "Weekend standby quote for bore support if the utility owner compresses the schedule.",
        amount_cents: 118000,
        status: "accepted",
        valid_until: dateAtDayOffset(10),
        accepted_at: isoAtDayOffset(-1, 12, 0),
      },
    },
    {
      key: "harbor",
      customer: {
        name: "Demo Harbor Terminal",
        email: `${DEMO_EMAIL_PREFIX}harbor@example.com`,
        phone: "313-555-4104",
        notes: "Demo customer showing clean field closeout and a manifest that is ready to bill.",
        service_address: "700 Dockside Drive, Detroit, MI 48209",
        tags: ["demo", "ready-to-invoice", "hydrovac"],
        last_contact_at: isoAtDayOffset(-1, 8, 25),
      },
      story: {
        lead_status: "converted",
        bid_status: "converted",
        order_status: "completed",
        job_status: "completed",
        order_payment_state: "unpaid",
        manifest_status: "confirmed",
        manifest_invoiced: false,
      },
      requiresPermit: false,
      liveLoad: false,
      bucket: "ready_to_invoice",
      title: "Dock trench recovery and sump cleanup",
      summary: "All field closeout and audit prep are done, so the office can move straight into billing.",
      quote: {
        title: "Dock wall washout contingency",
        description: "Contingency quote for additional trench recovery if the retaining wall needs re-exposure.",
        amount_cents: 94500,
        status: "pending",
        valid_until: dateAtDayOffset(12),
      },
    },
    {
      key: "saintmark",
      customer: {
        name: "Demo Saint Mark Logistics",
        email: `${DEMO_EMAIL_PREFIX}saintmark@example.com`,
        phone: "313-555-4105",
        notes: "Demo customer showing the closed loop: completed work, paid invoice, review, and recurring follow-up.",
        service_address: "6136 Pennsylvania Street, Detroit, MI 48213",
        tags: ["demo", "closed-loop", "recurring"],
        last_contact_at: isoAtDayOffset(-4, 15, 40),
      },
      story: {
        lead_status: "converted",
        bid_status: "converted",
        order_status: "completed",
        job_status: "completed",
        order_payment_state: "paid",
        manifest_status: "confirmed",
        manifest_invoiced: true,
      },
      requiresPermit: false,
      liveLoad: false,
      bucket: "closed",
      title: "Catch basin rehabilitation and inspection cleanup",
      summary: "Completed, invoiced, paid, and rolled into a recurring maintenance plan.",
      quote: {
        title: "Summer inspection option",
        description: "Optional summer follow-up inspection and debris pull for the next campus cycle.",
        amount_cents: 77500,
        status: "pending",
        valid_until: dateAtDayOffset(21),
      },
    },
  ];
}

function scenarioDates(index) {
  return {
    leadCreatedAt: isoAtDayOffset(-15 + index, 8, 15),
    walkthroughAt: isoAtDayOffset(-10 + index, 10, 30),
    bookingStart: isoAtDayOffset(index - 2, 8 + index, 0),
    bookingEnd: isoAtDayOffset(index - 2, 10 + index, 30),
    scheduledDate: dateAtDayOffset(index - 2),
    paymentDueDate: dateAtDayOffset(index + 4),
    jobStartedAt: isoAtDayOffset(index - 2, 8, 25),
    jobCompletedAt: isoAtDayOffset(index - 2, 14, 45),
    locateValidFrom: isoAtDayOffset(index - 4, 6, 0),
    locateValidUntil: isoAtDayOffset(index + 2, 18, 30),
    permitValidUntil: isoAtDayOffset(index + 1, 17, 0),
    departedSiteAt: isoAtDayOffset(index - 2, 12, 20),
    disposalConfirmedAt: isoAtDayOffset(index - 2, 16, 50),
    recordsPreparedAt: isoAtDayOffset(index - 1, 9, 20),
    auditPacketPreparedAt: isoAtDayOffset(index, 11, 10),
    invoiceSentAt: isoAtDayOffset(index - 1, 17, 15),
    invoicePaidAt: isoAtDayOffset(index, 13, 40),
    recurringNextRunOn: dateAtDayOffset(21),
  };
}

async function seedScenario(supabase, context, shared, scenario, index) {
  const { tenant, operator } = context;
  const { trucks, facilities } = shared;
  const dates = scenarioDates(index);
  const sourcePrefix = `demo-benkari-${scenario.key}`;
  const customer = await ensureCustomer(supabase, tenant, operator, {
    ...scenario.customer,
    lifetime_value_cents: scenario.story.order_payment_state === "paid" ? 462500 : 0,
    order_count: 1,
    created_at: dates.leadCreatedAt,
  });

  const asset = await ensureAsset(supabase, tenant, customer.id, {
    asset_type: scenario.requiresPermit ? "vault" : "catch_basin",
    asset_name: `${scenario.customer.name} service asset`,
    external_asset_id: `BNK-ASSET-${String(index + 1).padStart(3, "0")}`,
    status: "active",
    address: scenario.customer.service_address,
    city: "Detroit",
    location_description: `${scenario.customer.name} primary work area`,
    service_frequency_days: scenario.key === "saintmark" ? 30 : 60,
    next_service_due_date: scenario.key === "saintmark" ? dates.recurringNextRunOn : dateAtDayOffset(index + 14),
    last_condition_rating: scenario.bucket === "closed" ? "fair" : "poor",
    last_condition_date: dateAtDayOffset(-3),
    condition_notes: scenario.summary,
    has_defects: scenario.bucket !== "closed",
    defect_codes: scenario.bucket !== "closed" ? ["sediment_buildup"] : [],
    notes: `${scenario.summary} [${DEMO_TAG}]`,
    service_count_total: 3 + index,
    service_count_ytd: 1 + index,
    last_service_date: dateAtDayOffset(-3),
    avg_debris_per_service_gallons: 900 + (index * 175),
  });

  const lineItems = [
    moneyLine("Hydrovac truck and operator", 4, "hour", 32500, "Field truck, operator, and standard jetting setup."),
    moneyLine("Disposal coordination", 1, "load", 48500, "Disposal routing, manifest handling, and dump window coordination."),
  ];
  const subtotalCents = lineItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price_cents || 0)), 0);
  const totalCents = subtotalCents + 9500;
  const orderAmountPaid = scenario.story.order_payment_state === "paid"
    ? totalCents
    : scenario.story.order_payment_state === "partially_paid"
      ? Math.round(totalCents * 0.35)
      : 0;
  const orderAmountDue = Math.max(0, totalCents - orderAmountPaid);

  const lead = await ensureLead(supabase, tenant, operator, customer.id, {
    source_ref: `${sourcePrefix}-lead`,
    status: scenario.story.lead_status,
    title: scenario.customer.name,
    summary: scenario.summary,
    requested_service_type: scenario.requiresPermit ? "Vault cleanout" : "Catch basin and daylighting",
    priority: scenario.bucket === "needs_field_handoff" ? "urgent" : "normal",
    service_address: scenario.customer.service_address,
    contact_name: scenario.customer.name.replace(/^Demo\s+/, ""),
    contact_email: customer.email,
    contact_phone: customer.phone,
    preferred_contact: "phone",
    notes: `${scenario.customer.notes} [${DEMO_TAG}]`,
    metadata: { source_ref: sourcePrefix, scenario: scenario.bucket },
    last_activity_at: dates.bookingStart,
    created_at: dates.leadCreatedAt,
  });

  const bid = await ensureBid(supabase, tenant, operator, customer.id, lead.id, {
    status: scenario.story.bid_status,
    title: scenario.customer.name,
    walkthrough_at: dates.walkthroughAt,
    valid_until: dateAtDayOffset(14),
    service_address: scenario.customer.service_address,
    site_contact: scenario.customer.name.replace(/^Demo\s+/, ""),
    schedule_window: "8 AM - 1 PM",
    project_summary: scenario.summary,
    scope_of_work: scenario.title,
    proposed_solution: scenario.summary,
    materials_plan: "Hydrovac truck, traffic setup, confined-space gear where required, and disposal paperwork.",
    unused_materials_plan: "Unused materials stay staged for the next approved move.",
    exclusions: "Permit fees outside the noted scope, after-hours standby, and customer-added scope changes are excluded.",
    warranty: "Workmanship follows Benkari standard hydrovac service coverage.",
    cover_note: `Demo proposal seeded for ${tenant.name} owner walkthroughs.`,
    internal_notes: `Scenario bucket: ${scenario.bucket}. ${DEMO_TAG}`,
    deposit_percent: 20,
    deposit_amount_cents: Math.round(totalCents * 0.2),
    terms: "Scope, timing, and price are demo-ready but structured like a real Benkari commercial proposal.",
    line_items: lineItems,
    subtotal_cents: subtotalCents,
    optional_total_cents: 0,
    total_cents: totalCents,
    metadata: { source_ref: sourcePrefix, scenario: scenario.bucket },
    sent_at: isoAtDayOffset(-7 + index, 16, 0),
    approved_at: isoAtDayOffset(-6 + index, 13, 25),
    converted_at: isoAtDayOffset(-5 + index, 11, 15),
    created_at: dates.walkthroughAt,
  });

  const order = await ensureOrder(supabase, tenant, operator, customer, bid.id, lead.id, {
    status: scenario.story.order_status,
    fulfillment: "onsite_service",
    scheduled_date: dates.scheduledDate,
    scheduled_time: "08:00",
    items: lineItems,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: 9500,
    total_cents: totalCents,
    estimated_total_cents: totalCents,
    item_count: lineItems.length,
    cart_summary: scenario.title,
    notes: `${scenario.summary} [${DEMO_TAG}]`,
    source_type: "service_bid",
    source_ref: `${sourcePrefix}-order`,
    payment_state: scenario.story.order_payment_state,
    amount_paid_cents: orderAmountPaid,
    amount_due_cents: orderAmountDue,
    payment_due_date: dates.paymentDueDate,
    booked_at: isoAtDayOffset(-4 + index, 15, 30),
    completed_at: scenario.story.order_status === "completed" ? dates.jobCompletedAt : null,
    service_address: scenario.customer.service_address,
    schedule_window: "8 AM - 1 PM",
    invoice_number: scenario.story.manifest_invoiced ? `BNK-INV-${4400 + index}` : null,
    invoice_sent_at: scenario.story.manifest_invoiced ? dates.invoiceSentAt : null,
  });

  const booking = await ensureBooking(supabase, tenant, operator, customer, order, {
    title: scenario.title,
    starts_at: dates.bookingStart,
    ends_at: dates.bookingEnd,
    notes: `${scenario.summary} [${DEMO_TAG}]`,
    status: "confirmed",
    created_at: isoAtDayOffset(-4 + index, 16, 0),
  });

  const closeoutByBucket = {
    needs_field_handoff: null,
    needs_customer_records: hydrovacCloseout({
      load_status: "truck_clear",
      bol_number: `BNK-BOL-${4400 + index}`,
      permit_status: scenario.requiresPermit ? "closed" : "not_required",
      field_summary: "Crew completed the cleanup, photographed the site, and dropped a clean handoff package.",
      customer_note: "Customer confirmed the work looked right and wants records emailed over.",
      office_follow_up: ["customer_records", "invoice"],
    }),
    needs_audit_packet: hydrovacCloseout({
      load_status: "truck_clear",
      bol_number: `BNK-BOL-${4400 + index}`,
      permit_status: "not_required",
      field_summary: "Utilities were exposed cleanly and the crew confirmed the bore path with the site lead.",
      customer_note: "Customer wants the audit packet paired with the final billing review.",
      office_follow_up: ["audit_packet", "invoice"],
    }),
    ready_to_invoice: hydrovacCloseout({
      load_status: "truck_clear",
      bol_number: `BNK-BOL-${4400 + index}`,
      permit_status: "not_required",
      field_summary: "Truck cleared, disposal confirmed, and all field photos are uploaded.",
      customer_note: "Customer is expecting the invoice this afternoon.",
      office_follow_up: ["invoice"],
    }),
    closed: hydrovacCloseout({
      load_status: "truck_clear",
      bol_number: `BNK-BOL-${4400 + index}`,
      permit_status: "not_required",
      field_summary: "Work completed, disposal confirmed, and the customer signed off before the crew rolled.",
      customer_note: "Customer approved the recurring follow-up cadence.",
      office_follow_up: ["site_return"],
    }),
  };

  const selectedTruck = scenario.bucket === "needs_field_handoff" ? trucks.primary.id : trucks.secondary.id;
  const job = await ensureJob(supabase, tenant, operator, customer, order, bid.id, selectedTruck, {
    status: scenario.story.job_status,
    title: scenario.title,
    service_address: scenario.customer.service_address,
    scheduled_date: dates.scheduledDate,
    scheduled_time: "08:00",
    schedule_window: "8 AM - 1 PM",
    summary: scenario.summary,
    notes: `${scenario.summary} [${DEMO_TAG}]`,
    payment_state: scenario.story.order_payment_state,
    amount_paid_cents: orderAmountPaid,
    amount_due_cents: orderAmountDue,
    started_at: ["dispatched", "in_progress", "completed"].includes(scenario.story.job_status) ? dates.jobStartedAt : null,
    completed_at: scenario.story.job_status === "completed" ? dates.jobCompletedAt : null,
    work_order_number: `BNK-WO-${4401 + index}`,
    service_type: scenario.requiresPermit ? "hydrovac_vault_cleanout" : "hydrovac_daylighting",
    job_type: scenario.requiresPermit ? "confined_space_cleanout" : "utility_daylighting",
    customer_po_number: `BNK-PO-${4401 + index}`,
    asset_id: asset.id,
    requires_confined_space_permit: scenario.requiresPermit,
    custom_fields: {
      site_story: scenario.bucket,
      booking_id: booking.id,
    },
    metadata: closeoutByBucket[scenario.bucket]
      ? {
          crew_closeout: closeoutByBucket[scenario.bucket],
        }
      : { seed_story: "field_handoff_missing" },
  });

  await ensureOrderPrimaryJob(supabase, order.id, job.id);

  if (scenario.requiresPermit) {
    await ensurePermit(supabase, tenant, job.id, order.id, {
      permit_number: `BNK-CS-${4401 + index}`,
      space_description: `${scenario.customer.name} confined-space entry`,
      space_classification: "permit_required",
      atmospheric_readings: [
        {
          tested_at: isoAtDayOffset(index - 2, 7, 40),
          oxygen_pct: 20.8,
          lel_pct: 0,
          h2s_ppm: 0,
          co_ppm: 2,
          tester_name: operator.name,
          monitor_serial: `MON-${4401 + index}`,
        },
      ],
      oxygen_acceptable: true,
      lel_acceptable: true,
      h2s_acceptable: true,
      co_acceptable: true,
      entry_supervisor_name: operator.name,
      attendant_name: "Demo Hole Watch",
      known_hazards: ["traffic", "engulfment"],
      rescue_procedure: "Tripod staged at the truck with retrieval line and spotter.",
      status: scenario.bucket === "needs_field_handoff" ? "open" : "closed",
      permit_issued_at: isoAtDayOffset(index - 2, 7, 45),
      permit_valid_until: dates.permitValidUntil,
      notes: `${scenario.summary} [${DEMO_TAG}]`,
    });
  }

  await ensureLocate(supabase, tenant, operator, job.id, order.id, customer.id, {
    ticket_number: `BNK-811-${4401 + index}`,
    ticket_type: "standard",
    one_call_center: "MISS DIG 811",
    state_province: "MI",
    county: "Wayne",
    work_site_address: scenario.customer.service_address,
    work_site_city: "Detroit",
    excavation_type: scenario.requiresPermit ? "Vault cleanout" : "Utility daylighting",
    depth_of_excavation_ft: scenario.requiresPermit ? 12 : 8,
    work_area_description: scenario.summary,
    status: scenario.bucket === "needs_field_handoff" ? "active" : "extended",
    requested_at: isoAtDayOffset(index - 4, 7, 25),
    valid_from: dates.locateValidFrom,
    valid_until: dates.locateValidUntil,
    all_clear: scenario.bucket !== "needs_field_handoff",
    utilities_notified: ["electric", "gas", "telecom"],
    conflict_utilities: scenario.bucket === "needs_field_handoff" ? ["fiber"] : [],
    locate_notes: `${scenario.summary} [${DEMO_TAG}]`,
    verified_on_site: scenario.bucket === "needs_field_handoff" ? false : true,
    verified_at: scenario.bucket === "needs_field_handoff" ? null : isoAtDayOffset(index - 2, 7, 20),
  });

  const manifestMetadata = {
    bol_number: `BNK-BOL-${4401 + index}`,
  };
  if (scenario.liveLoad) {
    manifestMetadata.load_still_in_truck = true;
    manifestMetadata.load_state = "live_in_truck";
    manifestMetadata.live_load_hold_reason = "Waiting on the next compatible municipal dump window.";
    manifestMetadata.disposal_ready_by = dateAtDayOffset(0);
  }
  if (scenario.bucket === "needs_audit_packet" || scenario.bucket === "ready_to_invoice" || scenario.bucket === "closed") {
    manifestMetadata.customer_records_prepared_at = dates.recordsPreparedAt;
  }
  if (scenario.bucket === "ready_to_invoice" || scenario.bucket === "closed") {
    manifestMetadata.audit_packet_prepared_at = dates.auditPacketPreparedAt;
  }
  if (scenario.bucket === "closed") {
    manifestMetadata.audit_archived_at = dates.invoicePaidAt;
  }

  const manifest = await ensureManifest(supabase, tenant, operator, job.id, order.id, customer.id, selectedTruck, {
    manifest_number: `BNK-${4401 + index}`,
    manifest_type: "non_hazardous",
    material_type: "slurry",
    material_description: scenario.title,
    quantity_unit: "gallons",
    quantity_estimated: 1450 + (index * 180),
    quantity_actual: 1480 + (index * 160),
    pickup_address: scenario.customer.service_address,
    generator_name: customer.name,
    departed_site_at: dates.departedSiteAt,
    arrived_facility_at: scenario.liveLoad ? null : dates.disposalConfirmedAt,
    portal_to_portal_minutes: scenario.liveLoad ? null : 74 + (index * 4),
    disposal_facility_id: facilities.primary.id,
    disposal_facility_name: facilities.primary.name,
    disposal_facility_permit: facilities.primary.permit_number,
    disposal_method: scenario.liveLoad ? null : "dewater_and_treat",
    disposal_confirmed_at: scenario.liveLoad ? null : dates.disposalConfirmedAt,
    disposal_ticket_number: scenario.liveLoad ? "" : `BNK-DT-${4401 + index}`,
    disposal_cost_cents: 52000 + (index * 3200),
    disposal_charge_cents: 61800 + (index * 3600),
    is_billable: true,
    invoiced: scenario.story.manifest_invoiced,
    status: scenario.story.manifest_status,
    notes: `${scenario.summary} [${DEMO_TAG}]`,
    metadata: manifestMetadata,
  });

  await syncHydrovacJobLinks(supabase, { id: job.id, tenant_id: tenant.id });

  await ensureInteraction(supabase, tenant, operator, customer.id, order.id, {
    type: "note",
    summary: `${scenario.customer.name} seeded for the owner walkthrough.`,
    metadata: { scenario: scenario.bucket, source_ref: sourcePrefix },
    created_at: dates.leadCreatedAt,
  });
  await ensureInteraction(supabase, tenant, operator, customer.id, order.id, {
    type: "call",
    summary: `${scenario.customer.name} follow-up timeline reviewed with office.`,
    metadata: { scenario: scenario.bucket, source_ref: sourcePrefix, next_action: scenario.bucket },
    created_at: isoAtDayOffset(index - 1, 15, 25),
  });

  await ensureExpense(supabase, tenant, operator, customer.id, order.id, job.id, {
    date: dates.scheduledDate,
    expense_date: dates.scheduledDate,
    category: "Disposal",
    vendor: facilities.primary.name,
    description: `${scenario.customer.name} disposal cost`,
    notes: `${scenario.summary} [${DEMO_TAG}]`,
    amount_cents: 52000 + (index * 3200),
    expense_type: "job_cost",
    billable: true,
  });

  await ensureExpense(supabase, tenant, operator, customer.id, order.id, job.id, {
    date: dates.scheduledDate,
    expense_date: dates.scheduledDate,
    category: "Labor",
    vendor: "Internal crew",
    description: `${scenario.customer.name} labor allocation`,
    notes: `${scenario.summary} [${DEMO_TAG}]`,
    amount_cents: 84000 + (index * 4500),
    expense_type: "labor",
    billable: false,
  });

  if (scenario.story.order_payment_state === "partially_paid") {
    await ensurePayment(supabase, tenant, operator, customer.id, order.id, job.id, {
      reference_number: `BNK-PAY-${4401 + index}-DEPOSIT`,
      payment_mode: "check",
      status: "paid",
      amount_subtotal: orderAmountPaid,
      amount_total: orderAmountPaid,
      note: "Demo deposit payment.",
      paid_at: isoAtDayOffset(index - 3, 13, 10),
      metadata: { scenario: scenario.bucket, source_ref: sourcePrefix },
    });
  } else if (scenario.story.order_payment_state === "paid") {
    await ensurePayment(supabase, tenant, operator, customer.id, order.id, job.id, {
      reference_number: `BNK-PAY-${4401 + index}-FINAL`,
      payment_mode: "ach",
      status: "paid",
      amount_subtotal: totalCents,
      amount_total: totalCents,
      note: "Demo final payment.",
      paid_at: dates.invoicePaidAt,
      metadata: { scenario: scenario.bucket, source_ref: sourcePrefix },
    });
  }

  if (["needs_audit_packet", "closed"].includes(scenario.bucket)) {
    await ensureInvoice(supabase, tenant, operator, customer, order.id, {
      seed_key: `${sourcePrefix}-invoice`,
      line_items: [
        {
          description: scenario.title,
          quantity: 1,
          unit: "job",
          unit_price_cents: subtotalCents,
          line_total_cents: subtotalCents,
        },
        {
          description: "Mobilization",
          quantity: 1,
          unit: "trip",
          unit_price_cents: 9500,
          line_total_cents: 9500,
        },
      ],
      subtotal_cents: totalCents,
      total_cents: totalCents,
      due_date: dates.paymentDueDate,
      status: scenario.bucket === "closed" ? "paid" : "sent",
      sent_at: dates.invoiceSentAt,
      paid_at: scenario.bucket === "closed" ? dates.invoicePaidAt : null,
      created_at: isoAtDayOffset(index - 1, 16, 45),
    });
  }

  if (scenario.bucket === "closed") {
    await ensureReview(supabase, tenant, order.id, customer, {
      rating: 5,
      review_text: "Crew arrived prepared, kept the site clean, and the office paperwork made the billing easy to follow.",
      created_at: isoAtDayOffset(index, 17, 20),
    });
    await ensureServicePlan(supabase, tenant, operator, customer.id, order.id, job.id, {
      title: "Monthly basin maintenance",
      status: "active",
      cadence: "monthly",
      next_run_on: dates.recurringNextRunOn,
      last_run_on: dates.scheduledDate,
      auto_create_job: true,
      service_address: scenario.customer.service_address,
      schedule_window: "7 AM - 11 AM",
      summary: "Recurring monthly inspection and pull for the campus basins.",
      notes: `Recurring plan seeded for ${scenario.customer.name}. [${DEMO_TAG}]`,
      line_items: lineItems,
      amount_cents: totalCents,
      deposit_required_cents: 0,
      metadata: { source_ref: sourcePrefix },
      created_at: isoAtDayOffset(index - 1, 10, 45),
    });
  }

  await ensureQuote(supabase, tenant, operator, customer, {
    ...scenario.quote,
    created_at: isoAtDayOffset(index - 3, 12, 15),
  });

  if (scenario.bucket === "needs_field_handoff") {
    await ensureComplianceAlert(supabase, tenant, {
      alert_type: "truck_carryover_watch",
      severity: "critical",
      reference_type: "job",
      reference_id: job.id,
      message: `${customer.name} still has a live load on ${trucks.primary.unit_number}.`,
      due_date: dateAtDayOffset(0),
      days_remaining: 0,
      resolved: false,
      created_at: isoAtDayOffset(0, 6, 50),
    });
  }

  if (scenario.bucket === "needs_audit_packet") {
    await ensureComplianceAlert(supabase, tenant, {
      alert_type: "audit_packet_open",
      severity: "warning",
      reference_type: "job",
      reference_id: job.id,
      message: `${customer.name} is waiting on the audit packet before finance closes the loop.`,
      due_date: dateAtDayOffset(1),
      days_remaining: 1,
      resolved: false,
      created_at: isoAtDayOffset(0, 7, 10),
    });
  }

  return {
    customer,
    lead,
    bid,
    order,
    booking,
    job,
    asset,
    manifest,
    bucket: scenario.bucket,
  };
}

function buildProducts() {
  return [
    {
      slug: "benkari-hydrovac-daylighting",
      name: "Hydrovac Daylighting Shift",
      description: "Daylighting, utility exposure, and trench support for commercial sites.",
      pricing_mode: "quote",
      category: "Hydrovac",
    },
    {
      slug: "benkari-catch-basin-recovery",
      name: "Catch Basin Recovery",
      description: "Catch basin cleanout, jetting, and flow restoration with disposal tracking.",
      pricing_mode: "quote",
      category: "Hydrovac",
    },
    {
      slug: "benkari-vault-cleanout",
      name: "Vault Cleanout",
      description: "Confined-space-ready vault and structure cleanout with permit workflow support.",
      pricing_mode: "quote",
      category: "Hydrovac",
    },
    {
      slug: "benkari-emergency-hydrovac",
      name: "Emergency Hydrovac Response",
      description: "After-hours hydrovac dispatch for urgent excavation, flooding, and blockage issues.",
      pricing_mode: "quote",
      category: "Hydrovac",
    },
  ];
}

async function seedDemoCustomers({ ownerEmail = DEFAULT_OWNER_EMAIL } = {}) {
  const supabase = createSupabase();
  const context = await resolveTenantContext(supabase, ownerEmail);
  if (clean(context.tenant.business_type).toLowerCase() !== "hydrovac") {
    throw new Error(`Tenant ${context.tenant.slug} is ${context.tenant.business_type || "unknown"}, but this seed script currently targets hydrovac workspaces only.`);
  }

  await ensureTenantConfig(supabase, context.tenant, context.operator);
  await ensureTenantSettings(supabase, context.tenant);
  await ensureAvailability(supabase, context.tenant, context.operator);
  await ensureHydrovacSettings(supabase, context.tenant);
  await ensureDriverQualification(supabase, context.tenant, context.operator);

  for (const product of buildProducts()) {
    await ensureProduct(supabase, context.tenant, context.operator, product);
  }

  const trucks = {
    primary: await ensureEquipment(supabase, context.tenant, context.operator, {
      name: "Benkari Demo Hydrovac 201",
      unit_number: "BNK-HV-201",
      equipment_type: "hydrovac",
      status: "active",
      hourly_rate_cents: 32500,
      daily_rate_cents: 268000,
      year: 2024,
      make: "Freightliner",
      model: "M2 Vactor",
      license_plate: "BNK201",
      state_registered: "MI",
      dot_number: "BNK-4402",
      dot_unit_number: "BNK-HV-201",
      is_cdl_required: true,
      debris_tank_capacity_gallons: 8000,
      debris_tank_capacity_yards: 10.5,
      water_tank_capacity_gallons: 1500,
      water_pump_gpm: 18,
      water_pressure_psi: 2500,
      vacuum_cfm: 5400,
      max_hose_length_ft: 300,
      boom_length_ft: 22,
      digging_depth_ft: 20,
      next_dot_inspection_due: dateAtDayOffset(18),
      next_annual_inspection_due: dateAtDayOffset(46),
      next_tank_inspection_due: dateAtDayOffset(32),
      insurance_expiry_date: dateAtDayOffset(86),
      registration_expiry_date: dateAtDayOffset(140),
      notes: "Primary demo truck used for dispatch-risk walkthroughs.",
    }),
    secondary: await ensureEquipment(supabase, context.tenant, context.operator, {
      name: "Benkari Demo Hydrovac 202",
      unit_number: "BNK-HV-202",
      equipment_type: "hydrovac",
      status: "active",
      hourly_rate_cents: 32500,
      daily_rate_cents: 268000,
      year: 2022,
      make: "Kenworth",
      model: "Vactor 2100i",
      license_plate: "BNK202",
      state_registered: "MI",
      dot_number: "BNK-4402",
      dot_unit_number: "BNK-HV-202",
      is_cdl_required: true,
      debris_tank_capacity_gallons: 7000,
      debris_tank_capacity_yards: 9.5,
      water_tank_capacity_gallons: 1400,
      water_pump_gpm: 16,
      water_pressure_psi: 2200,
      vacuum_cfm: 5000,
      max_hose_length_ft: 280,
      boom_length_ft: 20,
      digging_depth_ft: 18,
      next_dot_inspection_due: dateAtDayOffset(26),
      next_annual_inspection_due: dateAtDayOffset(58),
      next_tank_inspection_due: dateAtDayOffset(41),
      insurance_expiry_date: dateAtDayOffset(112),
      registration_expiry_date: dateAtDayOffset(160),
      notes: "Secondary demo truck used for invoice-ready and closed-loop examples.",
    }),
  };

  const facilities = {
    primary: await ensureDisposalFacility(supabase, context.tenant, {
      name: "Benkari Demo North Yard Biosolids",
      facility_type: "treatment_plant",
      status: "preferred",
      address: "88 Disposal Loop",
      city: "Detroit",
      state_province: "MI",
      permit_number: "BNK-FAC-100",
      permit_expiry_date: dateAtDayOffset(180),
      accepted_waste_types: ["slurry", "non_hazardous"],
      price_per_gallon_cents: 34,
      minimum_charge_cents: 24000,
      primary_contact_name: "North Yard Dispatch",
      primary_contact_phone: "313-555-4150",
      dispatch_phone: "313-555-4151",
      notes: "Primary demo disposal facility for owner walkthroughs.",
    }),
    overflow: await ensureDisposalFacility(supabase, context.tenant, {
      name: "Benkari Demo Overflow Transfer Station",
      facility_type: "transfer_station",
      status: "active",
      address: "1120 Yard Overflow Avenue",
      city: "Warren",
      state_province: "MI",
      permit_number: "BNK-FAC-200",
      permit_expiry_date: dateAtDayOffset(95),
      accepted_waste_types: ["slurry"],
      price_per_gallon_cents: 28,
      minimum_charge_cents: 16500,
      primary_contact_name: "Overflow Yard",
      primary_contact_phone: "313-555-4152",
      dispatch_phone: "313-555-4153",
      notes: "Overflow demo disposal facility so routing views are not single-site only.",
    }),
  };

  const seeded = [];
  const scenarios = buildScenarios();
  for (const [index, scenario] of scenarios.entries()) {
    seeded.push(await seedScenario(supabase, context, { trucks, facilities }, scenario, index));
  }

  const counts = {};
  for (const table of [
    "customers",
    "leads",
    "bids",
    "quotes",
    "orders",
    "jobs",
    "bookings",
    "payments",
    "invoices",
    "service_plans",
    "customer_interactions",
    "reviews",
    "equipment",
    "waste_manifests",
    "utility_locate_tickets",
    "confined_space_permits",
    "disposal_facilities",
    "infrastructure_assets",
    "compliance_alerts",
  ]) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenant.id);
    if (error) throw error;
    counts[table] = count;
  }

  const summary = {
    seeded_at: new Date().toISOString(),
    tenant: {
      id: context.tenant.id,
      slug: context.tenant.slug,
      name: context.tenant.name,
      owner_email: context.tenant.owner_email,
    },
    operator: {
      id: context.operator.id,
      email: context.operator.email,
      name: context.operator.name,
    },
    demo_customers: seeded.map((item) => ({
      customer_id: item.customer.id,
      customer_name: item.customer.name,
      customer_email: item.customer.email,
      bucket: item.bucket,
      lead_id: item.lead.id,
      bid_id: item.bid.id,
      order_id: item.order.id,
      booking_id: item.booking.id,
      job_id: item.job.id,
      manifest_id: item.manifest.id,
      work_order_number: item.job.work_order_number,
      manifest_number: item.manifest.manifest_number,
    })),
    tenant_counts: counts,
  };

  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const args = parseArgs();
  const ownerEmail = clean(args["owner-email"] || DEFAULT_OWNER_EMAIL).toLowerCase();
  const summary = await seedDemoCustomers({ ownerEmail });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("Failed to seed demo customers:", error);
  process.exitCode = 1;
});
