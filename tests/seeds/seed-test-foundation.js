"use strict";

const { createClient } = require("@supabase/supabase-js");
const { assertRequiredEnv, loadTestEnv } = require("../setup/env.test");
const { TENANTS } = require("../fixtures/tenants");
const { USERS, resolveUserConfig } = require("../fixtures/users");
const { ONBOARDING_FIXTURES } = require("../fixtures/onboarding");

loadTestEnv();
assertRequiredEnv();

const PLTEST_SLUG_PREFIX = "pltest-";
const PLTEST_EMAIL_PREFIX = "pltest.";
const SEEDED_CUSTOMERS = [
  {
    email: "pltest.customer.a@example.com",
    name: "PL Test Customer A",
    phone: "313-555-0101",
    preferredContact: "email",
    notes: "Seeded customer record for authenticated operator workspace coverage.",
    lifetimeValueCents: 227500,
    orderCount: 1,
    lastContactAt: "2026-04-01T15:30:00.000Z",
  },
  {
    email: "pltest.customer.b@example.com",
    name: "PL Test Customer B",
    phone: "248-555-0147",
    preferredContact: "phone",
    notes: "Second seeded customer so navigation and search are not single-row only.",
    lifetimeValueCents: 0,
    orderCount: 0,
    lastContactAt: "2026-03-28T10:15:00.000Z",
  },
];
const HYDROVAC_CUSTOMERS = [
  {
    email: "pltest.hydrovac.dispatch@example.com",
    name: "PL Test Riverfront Milling",
    phone: "313-555-0198",
    preferredContact: "phone",
    notes: "Hydrovac fixture customer used for locate, permit, and live-load coverage.",
    lifetimeValueCents: 486000,
    orderCount: 3,
    lastContactAt: "2026-04-02T14:10:00.000Z",
  },
  {
    email: "pltest.hydrovac.municipal@example.com",
    name: "PL Test Municipal Utilities",
    phone: "313-555-0172",
    preferredContact: "email",
    notes: "Second hydrovac fixture customer so truck carryover and next-day dispatch risk are visible.",
    lifetimeValueCents: 192500,
    orderCount: 2,
    lastContactAt: "2026-04-01T09:25:00.000Z",
  },
];

const supabase = createClient(process.env.TEST_SUPABASE_URL, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertPrefixedValue(value, prefix, label) {
  if (!String(value || "").startsWith(prefix)) {
    throw new Error(`${label} must start with "${prefix}" for safe hosted test seeding.`);
  }
}

function assertSeedFixturesSafe() {
  Object.values(TENANTS).forEach((tenant) => {
    assertPrefixedValue(tenant.slug, PLTEST_SLUG_PREFIX, `Tenant slug ${tenant.slug}`);
    assertPrefixedValue(tenant.ownerEmail, PLTEST_EMAIL_PREFIX, `Tenant owner email ${tenant.ownerEmail}`);
  });

  Object.values(USERS).forEach((user) => {
    const resolved = resolveUserConfig(user);
    assertPrefixedValue(resolved.email, PLTEST_EMAIL_PREFIX, `Seed user email ${resolved.email}`);
  });

  SEEDED_CUSTOMERS.forEach((customer) => {
    assertPrefixedValue(customer.email, PLTEST_EMAIL_PREFIX, `Seed customer email ${customer.email}`);
  });
  HYDROVAC_CUSTOMERS.forEach((customer) => {
    assertPrefixedValue(customer.email, PLTEST_EMAIL_PREFIX, `Hydrovac seed customer email ${customer.email}`);
  });

  Object.values(ONBOARDING_FIXTURES).forEach((fixture) => {
    assertPrefixedValue(
      fixture.business_slug,
      PLTEST_SLUG_PREFIX,
      `Onboarding slug ${fixture.business_slug}`
    );
    assertPrefixedValue(
      fixture.owner_email,
      PLTEST_EMAIL_PREFIX,
      `Onboarding owner email ${fixture.owner_email}`
    );
  });
}

async function findAuthUserByEmail(email) {
  let page = 1;
  while (page < 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data.users || []).find(
      (user) => String(user.email || "").toLowerCase() === String(email).toLowerCase()
    );
    if (match) return match;
    if (!data.users || data.users.length < 200) return null;
    page += 1;
  }
  return null;
}

async function ensureAuthUser(userConfig) {
  const resolved = resolveUserConfig(userConfig);
  let authUser = await findAuthUserByEmail(resolved.email);

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: resolved.email,
      password: resolved.password,
      email_confirm: true,
      user_metadata: {
        source: "prooflink-test-foundation",
      },
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: resolved.password,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        source: "prooflink-test-foundation",
      },
    });
    if (error) throw error;
    authUser = data.user;
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: authUser.id,
    role: resolved.profileRole,
  });
  if (profileError) throw profileError;

  return authUser;
}

async function upsertTenant(tenant) {
  const payload = {
    name: tenant.name,
    slug: tenant.slug,
    owner_email: tenant.ownerEmail,
    business_type: tenant.businessType || null,
    prooflink_plan_key: tenant.prooflinkPlanKey,
    billing_status: tenant.billingStatus,
    status: tenant.status,
    product_count: tenant.productCount,
    max_products: tenant.maxProducts,
    customer_count: tenant.customerCount,
    max_customers: tenant.maxCustomers,
    operator_seat_count: tenant.operatorSeatCount,
    // Temporarily lift seat capacity during fixture upserts so stale hosted rows
    // do not block the seed pass before we restore the intended near-limit values.
    max_operator_seats: Math.max(Number(tenant.maxOperatorSeats || 0), 25),
    current_month_order_count: tenant.currentMonthOrderCount,
    max_orders_per_month: tenant.maxOrdersPerMonth,
    storage_used_mb: tenant.storageUsedMb,
    max_storage_mb: tenant.maxStorageMb,
    allow_online_checkout: false,
    allow_custom_domain: false,
    allow_advanced_analytics: false,
    allow_automation: false,
    active: true,
  };

  const result = await supabase
    .from("tenants")
    .upsert(payload, { onConflict: "slug" })
    .select("*")
    .single();

  if (result.error) throw result.error;
  return result.data;
}

async function restoreTenantTargetMetrics(tenant) {
  const { error } = await supabase
    .from("tenants")
    .update({
      product_count: tenant.productCount,
      max_products: tenant.maxProducts,
      customer_count: tenant.customerCount,
      max_customers: tenant.maxCustomers,
      operator_seat_count: tenant.operatorSeatCount,
      max_operator_seats: tenant.maxOperatorSeats,
      current_month_order_count: tenant.currentMonthOrderCount,
      max_orders_per_month: tenant.maxOrdersPerMonth,
      storage_used_mb: tenant.storageUsedMb,
      max_storage_mb: tenant.maxStorageMb,
    })
    .eq("slug", tenant.slug);
  if (error) throw error;
}

async function ensureOperator(userConfig, tenantRow, authUser) {
  const resolved = resolveUserConfig(userConfig);
  const membershipRole =
    resolved.membershipRole ||
    (resolved.operatorRole === "admin" ? "owner" : resolved.operatorRole);
  const operatorPayload = {
    email: resolved.email,
    name: resolved.name,
    role: resolved.operatorRole,
    tenant_id: tenantRow ? tenantRow.id : null,
  };

  const { data, error } = await supabase
    .from("operators")
    .upsert(operatorPayload, { onConflict: "email" })
    .select("*")
    .single();
  if (error) throw error;

  if (tenantRow) {
    const { error: memberError } = await supabase.from("operator_members").upsert(
      {
        operator_id: data.id,
        tenant_id: tenantRow.id,
        role: membershipRole,
        user_id: authUser.id,
        invited_by: null,
      },
      { onConflict: "operator_id,tenant_id" }
    );
    if (memberError) throw memberError;
  }

  return data;
}

async function ensureTenantConfig(tenantRow, tenant) {
  const { error } = await supabase.from("tenant_config").upsert(
    {
      tenant_id: tenantRow.id,
      config_key: "site_settings",
      config_value: JSON.stringify({
        tagline: `Seed config for ${tenantRow.slug}`,
        accent_color: "#c84b2f",
        ...(tenant?.businessType
          ? {
              business_type: tenant.businessType,
              workspace_business_type: tenant.businessType,
            }
          : {}),
      }),
    },
    { onConflict: "tenant_id,config_key" }
  );
  if (error) throw error;
}

async function ensureProduct(tenantRow, operatorRow, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const existing = await supabase
    .from("products")
    .select("id")
    .eq("tenant_id", tenantRow.id)
    .eq("slug", slug)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const payload = {
    tenant_id: tenantRow.id,
    operator_id: operatorRow.id,
    name,
    slug,
    pricing_mode: "quote",
    sell_price_cents: 0,
    starting_price_cents: 0,
    is_active: true,
  };

  if (!existing.data) {
    const { data, error } = await supabase.from("products").insert(payload).select("*").single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", existing.data.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function ensureCustomer(tenantRow, operatorRow, customer) {
  const existing = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantRow.id)
    .eq("email", customer.email)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const payload = {
    tenant_id: tenantRow.id,
    operator_id: operatorRow.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    preferred_contact: customer.preferredContact,
    notes: customer.notes,
    lifetime_value_cents: customer.lifetimeValueCents,
    order_count: customer.orderCount,
    last_contact_at: customer.lastContactAt,
    updated_at: new Date().toISOString(),
  };

  if (!existing.data) {
    const { data, error } = await supabase.from("customers").insert({
      ...payload,
      created_at: customer.lastContactAt,
    }).select("*").single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("customers")
    .update(payload)
    .eq("id", existing.data.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function findRows(table, match = {}, selectColumns = "*") {
  let query = supabase.from(table).select(selectColumns);
  Object.entries(match).forEach(([field, value]) => {
    if (Array.isArray(value)) {
      query = query.in(field, value);
      return;
    }
    query = query.eq(field, value);
  });
  const { data, error } = await query.limit(50);
  if (error) throw error;
  return data || [];
}

async function findRow(table, match = {}, selectColumns = "*") {
  const rows = await findRows(table, match, selectColumns);
  return rows[0] || null;
}

async function ensureSeedRow({ table, match, insertPayload, updatePayload = insertPayload, selectColumns = "*" }) {
  const existing = await findRow(table, match, "id");
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

function isoAtDayOffset(offsetDays, hour = 9, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
}

function dateAtDayOffset(offsetDays) {
  return isoAtDayOffset(offsetDays).slice(0, 10);
}

function buildHydrovacFixtureTimeline() {
  return {
    today: dateAtDayOffset(0),
    tomorrow: dateAtDayOffset(1),
    threeDaysOut: dateAtDayOffset(3),
    fiveDaysOut: dateAtDayOffset(5),
    fourteenDaysOut: dateAtDayOffset(14),
    thirtyDaysOut: dateAtDayOffset(30),
    fortyFiveDaysOut: dateAtDayOffset(45),
    yesterday: dateAtDayOffset(-1),
    eightDaysAgo: dateAtDayOffset(-8),
    requestedAt: isoAtDayOffset(-2, 7, 45),
    locateValidFrom: isoAtDayOffset(-1, 6, 0),
    locateValidUntil: isoAtDayOffset(1, 18, 30),
    locateExpiredAt: isoAtDayOffset(-1, 12, 0),
    permitValidUntil: isoAtDayOffset(0, 17, 15),
    expiredPermitValidUntil: isoAtDayOffset(-1, 16, 15),
    departedSiteAt: isoAtDayOffset(0, 11, 10),
    disposalConfirmedAt: isoAtDayOffset(-1, 16, 45),
    createdAt: isoAtDayOffset(-7, 10, 0),
    updatedAt: new Date().toISOString(),
  };
}

async function ensureHydrovacSettings(tenantRow, tenant, timeline) {
  if (tenant.businessType !== "hydrovac") return null;

  return ensureSeedRow({
    table: "tenant_hydrovac_settings",
    match: { tenant_id: tenantRow.id },
    insertPayload: {
      tenant_id: tenantRow.id,
      default_billing_method: "hourly_plus_disposal",
      default_hourly_rate_cents: 32000,
      default_mobilization_cents: 9500,
      default_disposal_markup_percent: 18,
      portal_to_portal_billing: true,
      yard_address: "4100 ProofLink Yard Road, Detroit, MI",
      require_locate_ticket_for_excavation: true,
      require_confined_space_permit: true,
      default_ticket_validity_days: 10,
      emergency_callout_rate_cents: 45000,
      emergency_hourly_multiplier: 1.5,
      dot_number: "PLTEST-4012",
      usdot_registered: true,
      manifest_prefix: "PLHV",
      permit_prefix: "PLCS",
      auto_generate_manifest_numbers: true,
      notify_on_ticket_expiry: true,
      notify_on_permit_expiry: true,
      notify_on_compliance_warning: true,
      compliance_alert_email: tenant.ownerEmail,
      gps_sync_enabled: false,
      updated_at: timeline.updatedAt,
    },
  });
}

async function syncHydrovacJobLinks(jobRow) {
  const manifests = await findRows(
    "waste_manifests",
    { tenant_id: jobRow.tenant_id, job_id: jobRow.id },
    "id, quantity_unit, quantity_estimated, quantity_actual, disposal_cost_cents, disposal_charge_cents, status"
  );
  const locates = await findRows(
    "utility_locate_tickets",
    { tenant_id: jobRow.tenant_id, job_id: jobRow.id },
    "id, status"
  );
  const permits = await findRows(
    "confined_space_permits",
    { tenant_id: jobRow.tenant_id, job_id: jobRow.id },
    "id"
  );

  const activeManifests = manifests.filter((manifest) => String(manifest.status || "").toLowerCase() !== "void");
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
        .filter((ticket) => String(ticket.status || "").toLowerCase() !== "cancelled")
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

async function ensureHydrovacFixture(tenantRow, operatorRow, timeline) {
  const hydrovacCustomers = {};
  for (const customer of HYDROVAC_CUSTOMERS) {
    hydrovacCustomers[customer.email] = await ensureCustomer(tenantRow, operatorRow, customer);
  }

  await ensureProduct(tenantRow, operatorRow, "pltest-b-hydrovac-daylighting");
  await ensureProduct(tenantRow, operatorRow, "pltest-b-hydrovac-vault-cleanout");

  const primaryCustomer = hydrovacCustomers["pltest.hydrovac.dispatch@example.com"];
  const municipalCustomer = hydrovacCustomers["pltest.hydrovac.municipal@example.com"];

  const truck = await ensureSeedRow({
    table: "equipment",
    match: { tenant_id: tenantRow.id, unit_number: "PL-HV-101" },
    insertPayload: {
      tenant_id: tenantRow.id,
      operator_id: operatorRow.id,
      name: "PL Test Hydrovac 101",
      unit_number: "PL-HV-101",
      equipment_type: "hydrovac",
      status: "active",
      hourly_rate_cents: 32000,
      daily_rate_cents: 265000,
      year: 2023,
      make: "Freightliner",
      model: "M2 Vactor",
      license_plate: "PLT-HV1",
      state_registered: "MI",
      dot_number: "4012",
      dot_unit_number: "PL-HV-101",
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
      next_dot_inspection_due: timeline.threeDaysOut,
      next_annual_inspection_due: timeline.fourteenDaysOut,
      next_tank_inspection_due: timeline.yesterday,
      insurance_expiry_date: timeline.thirtyDaysOut,
      registration_expiry_date: timeline.fortyFiveDaysOut,
      notes: "Seeded hydrovac truck for carryover, compliance, and manifest workflow coverage.",
      metadata: {
        seed_fixture: "hydrovac_command_center",
      },
      updated_at: timeline.updatedAt,
    },
  });

  const preferredFacility = await ensureSeedRow({
    table: "disposal_facilities",
    match: { tenant_id: tenantRow.id, name: "PL Test North Yard Biosolids" },
    insertPayload: {
      tenant_id: tenantRow.id,
      name: "PL Test North Yard Biosolids",
      facility_type: "treatment_plant",
      status: "preferred",
      address: "88 Disposal Loop",
      city: "Detroit",
      state_province: "MI",
      permit_number: "PL-FAC-100",
      permit_expiry_date: timeline.thirtyDaysOut,
      accepted_waste_types: ["slurry", "non_hazardous"],
      price_per_gallon_cents: 34,
      minimum_charge_cents: 24500,
      primary_contact_name: "North Yard Dispatch",
      primary_contact_phone: "313-555-0130",
      dispatch_phone: "313-555-0131",
      notes: "Preferred seed facility for day-to-day hydrovac routing.",
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "disposal_facilities",
    match: { tenant_id: tenantRow.id, name: "PL Test Overflow Transfer Station" },
    insertPayload: {
      tenant_id: tenantRow.id,
      name: "PL Test Overflow Transfer Station",
      facility_type: "transfer_station",
      status: "active",
      address: "1120 Yard Overflow Avenue",
      city: "Warren",
      state_province: "MI",
      permit_number: "PL-FAC-200",
      permit_expiry_date: timeline.fiveDaysOut,
      accepted_waste_types: ["slurry"],
      primary_contact_name: "Overflow Receiving",
      primary_contact_phone: "313-555-0150",
      dispatch_phone: "313-555-0151",
      notes: "Overflow option intentionally missing pricing so the board catches it.",
      updated_at: timeline.updatedAt,
    },
  });

  const asset = await ensureSeedRow({
    table: "infrastructure_assets",
    match: { tenant_id: tenantRow.id, external_asset_id: "PL-ASSET-047" },
    insertPayload: {
      tenant_id: tenantRow.id,
      customer_id: primaryCustomer.id,
      asset_type: "catch_basin",
      asset_name: "CB-047 Riverfront",
      external_asset_id: "PL-ASSET-047",
      status: "active",
      address: "1200 Water Street, Detroit, MI",
      city: "Detroit",
      location_description: "North trench catch basin beside gate 3",
      service_frequency_days: 30,
      next_service_due_date: timeline.fiveDaysOut,
      last_condition_rating: "poor",
      last_condition_date: timeline.yesterday,
      condition_notes: "Frame shift and heavy sediment along the north wall.",
      has_defects: true,
      defect_codes: ["frame_shift", "heavy_sediment"],
      notes: "Seed asset used in hydrovac asset command center coverage.",
      service_count_total: 7,
      service_count_ytd: 3,
      last_service_date: timeline.eightDaysAgo,
      avg_debris_per_service_gallons: 1625,
      metadata: {
        seed_fixture: "hydrovac_command_center",
      },
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "infrastructure_assets",
    match: { tenant_id: tenantRow.id, external_asset_id: "PL-ASSET-052" },
    insertPayload: {
      tenant_id: tenantRow.id,
      customer_id: municipalCustomer.id,
      asset_type: "vault",
      asset_name: "Storm Vault 52",
      external_asset_id: "PL-ASSET-052",
      status: "active",
      address: "44 Service Drive, Detroit, MI",
      city: "Detroit",
      location_description: "Municipal storm vault near the south retaining wall",
      service_frequency_days: 60,
      next_service_due_date: timeline.fourteenDaysOut,
      last_condition_rating: "fair",
      last_condition_date: timeline.eightDaysAgo,
      has_defects: false,
      notes: "Healthy comparison asset so the board does not flatten into a single-risk state.",
      service_count_total: 4,
      service_count_ytd: 2,
      last_service_date: timeline.eightDaysAgo,
      updated_at: timeline.updatedAt,
    },
  });

  const orderToday = await ensureSeedRow({
    table: "orders",
    match: { tenant_id: tenantRow.id, source_ref: "pltest-hydrovac-order-today" },
    insertPayload: {
      tenant_id: tenantRow.id,
      operator_id: operatorRow.id,
      customer_id: primaryCustomer.id,
      status: "confirmed",
      fulfillment: "onsite_service",
      scheduled_date: timeline.today,
      scheduled_time: "08:00",
      items: [
        {
          sku: "pltest-b-hydrovac-daylighting",
          name: "Hydrovac daylighting shift",
          quantity: 1,
          unit_price_cents: 395000,
          total_cents: 395000,
        },
      ],
      subtotal_cents: 395000,
      total_cents: 395000,
      estimated_total_cents: 425000,
      item_count: 1,
      unpriced_count: 0,
      cart_summary: "Hydrovac daylighting and catch basin cleanout",
      notes: "Use gate 3, protect utility markings, and keep disposal tied to PO-4421.",
      customer_name: primaryCustomer.name,
      email: primaryCustomer.email,
      phone: primaryCustomer.phone,
      preferred_contact: primaryCustomer.preferred_contact || primaryCustomer.preferredContact,
      source_type: "operator",
      source_ref: "pltest-hydrovac-order-today",
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  const orderTomorrow = await ensureSeedRow({
    table: "orders",
    match: { tenant_id: tenantRow.id, source_ref: "pltest-hydrovac-order-tomorrow" },
    insertPayload: {
      tenant_id: tenantRow.id,
      operator_id: operatorRow.id,
      customer_id: municipalCustomer.id,
      status: "confirmed",
      fulfillment: "onsite_service",
      scheduled_date: timeline.tomorrow,
      scheduled_time: "09:30",
      items: [
        {
          sku: "pltest-b-hydrovac-vault-cleanout",
          name: "Vault cleanout and exposure",
          quantity: 1,
          unit_price_cents: 445000,
          total_cents: 445000,
        },
      ],
      subtotal_cents: 445000,
      total_cents: 445000,
      estimated_total_cents: 480000,
      item_count: 1,
      unpriced_count: 0,
      cart_summary: "Storm vault cleanout with permit-required entry",
      notes: "Tomorrow dispatch should stay obvious if a live load is still on the truck.",
      customer_name: municipalCustomer.name,
      email: municipalCustomer.email,
      phone: municipalCustomer.phone,
      preferred_contact: municipalCustomer.preferred_contact || municipalCustomer.preferredContact,
      source_type: "operator",
      source_ref: "pltest-hydrovac-order-tomorrow",
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  const jobToday = await ensureSeedRow({
    table: "jobs",
    match: { tenant_id: tenantRow.id, work_order_number: "PL-WO-HV-4401" },
    insertPayload: {
      tenant_id: tenantRow.id,
      operator_id: operatorRow.id,
      order_id: orderToday.id,
      customer_id: primaryCustomer.id,
      status: "dispatched",
      title: "North trench daylighting and basin cleanout",
      service_address: "1200 Water Street, Detroit, MI",
      scheduled_date: timeline.today,
      scheduled_time: "08:00",
      schedule_window: "8 AM - 11 AM",
      summary: "Expose utilities and clean the basin before boring starts.",
      notes: "Permit-required entry at the basin throat. Keep the live-load packet on the truck if disposal is delayed.",
      proof: [],
      payment_state: "partially_paid",
      amount_paid_cents: 150000,
      amount_due_cents: 245000,
      service_type: "hydrovac_daylighting",
      job_type: "utility_daylighting",
      billing_method: "hourly_plus_disposal",
      hourly_truck_rate_cents: 32000,
      hourly_operator_rate_cents: 11500,
      mobilization_fee_cents: 9500,
      mobilization_charge_cents: 9500,
      disposal_cost_cents: 0,
      assigned_truck_id: truck.id,
      assigned_member_id: operatorRow.id,
      customer_po_number: "PO-4421",
      work_order_number: "PL-WO-HV-4401",
      asset_id: asset.id,
      requires_confined_space_permit: true,
      emergency_callout: false,
      custom_fields: {
        access_gate: "Gate 3",
        disposal_plan: "North Yard Biosolids",
      },
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  const jobTomorrow = await ensureSeedRow({
    table: "jobs",
    match: { tenant_id: tenantRow.id, work_order_number: "PL-WO-HV-4402" },
    insertPayload: {
      tenant_id: tenantRow.id,
      operator_id: operatorRow.id,
      order_id: orderTomorrow.id,
      customer_id: municipalCustomer.id,
      status: "scheduled",
      title: "South vault cleanout",
      service_address: "44 Service Drive, Detroit, MI",
      scheduled_date: timeline.tomorrow,
      scheduled_time: "09:30",
      schedule_window: "9:30 AM - 1 PM",
      summary: "Permit-required storm vault cleanout scheduled on the same truck tomorrow.",
      notes: "This job should surface as carryover risk if the truck still carries today's load.",
      proof: [],
      payment_state: "unpaid",
      amount_paid_cents: 0,
      amount_due_cents: 445000,
      service_type: "hydrovac_vault_cleanout",
      job_type: "confined_space_cleanout",
      billing_method: "hourly_plus_disposal",
      hourly_truck_rate_cents: 32000,
      hourly_operator_rate_cents: 11500,
      mobilization_fee_cents: 9500,
      mobilization_charge_cents: 9500,
      disposal_cost_cents: 0,
      assigned_truck_id: truck.id,
      assigned_member_id: operatorRow.id,
      customer_po_number: "PO-4478",
      work_order_number: "PL-WO-HV-4402",
      requires_confined_space_permit: true,
      emergency_callout: false,
      custom_fields: {
        access_gate: "South retaining wall",
      },
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "utility_locate_tickets",
    match: { tenant_id: tenantRow.id, ticket_number: "PL-811-4401" },
    insertPayload: {
      tenant_id: tenantRow.id,
      job_id: jobToday.id,
      order_id: orderToday.id,
      customer_id: primaryCustomer.id,
      ticket_number: "PL-811-4401",
      ticket_type: "standard",
      one_call_center: "MISS DIG 811",
      state_province: "MI",
      county: "Wayne",
      work_site_address: jobToday.service_address,
      work_site_city: "Detroit",
      excavation_type: "Utility daylighting",
      depth_of_excavation_ft: 8,
      work_area_description: "North trench between gate 3 and the basin throat",
      status: "active",
      requested_at: timeline.requestedAt,
      valid_from: timeline.locateValidFrom,
      valid_until: timeline.locateValidUntil,
      all_clear: false,
      utilities_notified: ["electric", "gas", "telecom"],
      conflict_utilities: ["fiber"],
      locate_notes: "Marked and verified on site. Coverage expires tomorrow evening.",
      verified_on_site: true,
      verified_at: isoAtDayOffset(0, 7, 20),
      created_by_member_id: operatorRow.id,
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "waste_manifests",
    match: { tenant_id: tenantRow.id, manifest_number: "PLHV-4401" },
    insertPayload: {
      tenant_id: tenantRow.id,
      job_id: jobToday.id,
      order_id: orderToday.id,
      customer_id: primaryCustomer.id,
      truck_id: truck.id,
      driver_member_id: operatorRow.id,
      manifest_number: "PLHV-4401",
      manifest_type: "non_hazardous",
      material_type: "slurry",
      material_description: "Wet utility exposure spoils",
      quantity_unit: "gallons",
      quantity_estimated: 1800,
      quantity_actual: 1825,
      pickup_address: jobToday.service_address,
      generator_name: primaryCustomer.name,
      departed_site_at: timeline.departedSiteAt,
      disposal_facility_id: preferredFacility.id,
      disposal_facility_name: preferredFacility.name,
      disposal_facility_permit: preferredFacility.permit_number,
      disposal_cost_cents: 62000,
      disposal_charge_cents: 73500,
      is_billable: true,
      invoiced: false,
      status: "in_transit",
      notes: "Truck is still carrying this load pending a full compatible dump run.",
      metadata: {
        bol_number: "BOL-4401",
        load_still_in_truck: true,
        load_state: "live_in_truck",
        live_load_hold_reason: "Waiting for the compatible municipal load before disposal.",
        disposal_ready_by: timeline.today,
        load_isolation_note: "Keep north trench slurry isolated until North Yard confirms receiving window.",
      },
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "waste_manifests",
    match: { tenant_id: tenantRow.id, manifest_number: "PLHV-4400" },
    insertPayload: {
      tenant_id: tenantRow.id,
      job_id: jobToday.id,
      order_id: orderToday.id,
      customer_id: primaryCustomer.id,
      truck_id: truck.id,
      driver_member_id: operatorRow.id,
      manifest_number: "PLHV-4400",
      manifest_type: "non_hazardous",
      material_type: "slurry",
      material_description: "Confirmed disposal run from the same day",
      quantity_unit: "gallons",
      quantity_estimated: 1450,
      quantity_actual: 1440,
      pickup_address: jobToday.service_address,
      generator_name: primaryCustomer.name,
      departed_site_at: timeline.requestedAt,
      arrived_facility_at: timeline.disposalConfirmedAt,
      portal_to_portal_minutes: 78,
      disposal_facility_id: preferredFacility.id,
      disposal_facility_name: preferredFacility.name,
      disposal_facility_permit: preferredFacility.permit_number,
      disposal_method: "dewater_and_treat",
      disposal_confirmed_at: timeline.disposalConfirmedAt,
      disposal_ticket_number: "DT-4400",
      disposal_cost_cents: 48800,
      disposal_charge_cents: 58200,
      is_billable: true,
      invoiced: false,
      status: "confirmed",
      notes: "Confirmed disposal charge still waiting to hit the invoice.",
      metadata: {
        bol_number: "BOL-4400",
      },
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "confined_space_permits",
    match: { tenant_id: tenantRow.id, permit_number: "PLCS-4401" },
    insertPayload: {
      tenant_id: tenantRow.id,
      job_id: jobToday.id,
      order_id: orderToday.id,
      permit_number: "PLCS-4401",
      space_description: "North trench catch basin throat",
      space_classification: "permit_required",
      atmospheric_readings: [
        {
          tested_at: isoAtDayOffset(0, 7, 35),
          oxygen_pct: 20.8,
          lel_pct: 0,
          h2s_ppm: 0,
          co_ppm: 3,
          tester_name: operatorRow.name,
          monitor_serial: "MON-4401",
        },
      ],
      oxygen_acceptable: true,
      lel_acceptable: true,
      h2s_acceptable: true,
      co_acceptable: true,
      entry_supervisor_name: operatorRow.name,
      attendant_name: "PL Test Hole Watch",
      known_hazards: ["engulfment", "traffic"],
      rescue_procedure: "Tripod staged at the truck with retrieval line and spotter.",
      status: "open",
      permit_issued_at: isoAtDayOffset(0, 7, 40),
      permit_valid_until: timeline.permitValidUntil,
      notes: "Open and current for today's entry work.",
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "confined_space_permits",
    match: { tenant_id: tenantRow.id, permit_number: "PLCS-4402" },
    insertPayload: {
      tenant_id: tenantRow.id,
      job_id: jobTomorrow.id,
      order_id: orderTomorrow.id,
      permit_number: "PLCS-4402",
      space_description: "South vault entry",
      space_classification: "permit_required",
      atmospheric_readings: [],
      oxygen_acceptable: false,
      lel_acceptable: false,
      h2s_acceptable: false,
      co_acceptable: false,
      entry_supervisor_name: operatorRow.name,
      attendant_name: "",
      known_hazards: ["engulfment", "low_oxygen"],
      rescue_procedure: "Still waiting on the full entry plan and atmosphere check.",
      status: "open",
      permit_valid_until: timeline.locateExpiredAt,
      notes: "Expired open permit seeded so the permit board has a real blocker to surface.",
      created_at: timeline.createdAt,
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "driver_qualifications",
    match: { tenant_id: tenantRow.id, member_id: operatorRow.id },
    insertPayload: {
      tenant_id: tenantRow.id,
      member_id: operatorRow.id,
      cdl_number: "MI-PL-4401",
      cdl_state: "MI",
      cdl_class: "A",
      cdl_expiry_date: timeline.fiveDaysOut,
      cdl_endorsements: ["tank", "air_brake"],
      medical_certificate_expiry: timeline.threeDaysOut,
      medical_examiner_name: "ProofLink Occupational",
      hazmat_certified: false,
      confined_space_certified: true,
      confined_space_cert_expiry_date: timeline.fourteenDaysOut,
      h2s_alive_certified: true,
      h2s_cert_expiry_date: timeline.thirtyDaysOut,
      first_aid_certified: true,
      first_aid_cert_expiry_date: timeline.thirtyDaysOut,
      defensive_driving_completed: true,
      last_mvr_check_date: timeline.eightDaysAgo,
      mvr_status: "clear",
      hos_available_driving_minutes: 360,
      hos_cycle_used_minutes: 980,
      hos_last_synced_at: isoAtDayOffset(0, 6, 30),
      notes: "Seeded driver qualification record so the compliance board has a live expiry watch.",
      updated_at: timeline.updatedAt,
    },
  });

  await ensureSeedRow({
    table: "compliance_alerts",
    match: {
      tenant_id: tenantRow.id,
      alert_type: "truck_carryover_watch",
      reference_type: "job",
      reference_id: jobTomorrow.id,
      message: "Truck PL-HV-101 is still carrying PLHV-4401 into tomorrow's route.",
    },
    insertPayload: {
      tenant_id: tenantRow.id,
      alert_type: "truck_carryover_watch",
      severity: "critical",
      reference_type: "job",
      reference_id: jobTomorrow.id,
      message: "Truck PL-HV-101 is still carrying PLHV-4401 into tomorrow's route.",
      due_date: timeline.today,
      days_remaining: 0,
      resolved: false,
      created_at: timeline.updatedAt,
    },
  });

  await syncHydrovacJobLinks({ id: jobToday.id, tenant_id: tenantRow.id });
  await syncHydrovacJobLinks({ id: jobTomorrow.id, tenant_id: tenantRow.id });
}

async function ensureOnboarding(fixture, approvedByOperatorId) {
  const payload = {
    status: fixture.status,
    business_name: fixture.business_name,
    business_slug: fixture.business_slug,
    owner_name: fixture.owner_name,
    owner_email: fixture.owner_email,
    business_type: fixture.business_type,
    city_state: fixture.city_state,
    seed_template_key: fixture.seed_template_key,
    approved_at: fixture.status === "approved" ? new Date().toISOString() : null,
    reviewed_by: fixture.status === "approved" ? approvedByOperatorId : null,
  };

  const existing = await supabase
    .from("tenant_onboarding_requests")
    .select("id, status")
    .eq("business_slug", fixture.business_slug)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (!existing.data) {
    const { error } = await supabase.from("tenant_onboarding_requests").insert(payload);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("tenant_onboarding_requests")
    .update(payload)
    .eq("id", existing.data.id);
  if (error) throw error;
}

async function main() {
  assertSeedFixturesSafe();
  const hydrovacTimeline = buildHydrovacFixtureTimeline();

  const tenantRows = {};
  for (const tenant of Object.values(TENANTS)) {
    tenantRows[tenant.slug] = await upsertTenant(tenant);
    await ensureTenantConfig(tenantRows[tenant.slug], tenant);
    await ensureHydrovacSettings(tenantRows[tenant.slug], tenant, hydrovacTimeline);
  }

  const authUsers = {};
  for (const user of Object.values(USERS)) {
    authUsers[user.key] = await ensureAuthUser(user);
  }

  const operators = {};
  for (const user of Object.values(USERS)) {
    const tenantRow = user.tenantKey ? tenantRows[TENANTS[user.tenantKey].slug] : null;
    operators[user.key] = await ensureOperator(user, tenantRow, authUsers[user.key]);
  }

  await ensureProduct(tenantRows[TENANTS.tenantA.slug], operators.tenantAAdmin, "pltest-a-product");
  await ensureProduct(tenantRows[TENANTS.tenantB.slug], operators.tenantBAdmin, "pltest-b-product");
  for (const customer of SEEDED_CUSTOMERS) {
    await ensureCustomer(tenantRows[TENANTS.tenantA.slug], operators.tenantAAdmin, customer);
  }
  await ensureHydrovacFixture(tenantRows[TENANTS.tenantB.slug], operators.tenantBAdmin, hydrovacTimeline);

  await ensureOnboarding(ONBOARDING_FIXTURES.approved, operators.platformAdmin.id);
  await ensureOnboarding(ONBOARDING_FIXTURES.submitted, operators.platformAdmin.id);

  // Hosted DB triggers recompute some counters from real rows during seed setup.
  // Restore the intended near-limit fixture values after all seed writes complete.
  for (const tenant of Object.values(TENANTS)) {
    await restoreTenantTargetMetrics(tenant);
  }

  console.log("Seeded ProofLink test foundation data.");
}

main().catch((error) => {
  console.error("Failed to seed ProofLink test foundation:", error);
  process.exitCode = 1;
});
