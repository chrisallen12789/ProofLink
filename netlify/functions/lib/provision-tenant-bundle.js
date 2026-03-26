"use strict";

const { uniqueTenantSlug } = require("../utils/slugify");
const { normalizeBusinessTypeKey } = require("../utils/business-type");
const { seedTemplateForTenant } = require("./seed-templates");

function clean(value) {
  return String(value || "").trim();
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizePlan(value) {
  const normalized = clean(value || "starter").toLowerCase();
  return normalized || "starter";
}

function normalizeBusinessType(payload) {
  return normalizeBusinessTypeKey(
    payload.business_type || payload.businessCategory || payload.business_category
  ) || null;
}

function extractErrorCode(error) {
  const directCode = clean(error?.code).toUpperCase();
  if (directCode) return directCode;

  const message = clean(error?.message);
  if (!message) return "";

  try {
    const parsed = JSON.parse(message);
    return clean(parsed?.code).toUpperCase();
  } catch {
    const match = message.match(/"code"\s*:\s*"([^"]+)"/i);
    return clean(match && match[1]).toUpperCase();
  }
}

function isMissingCreateTenantBundleRpcError(error) {
  const code = extractErrorCode(error);
  const message = clean(error?.message).toLowerCase();

  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(code)
    || message.includes("public.create_tenant_bundle")
    || message.includes("searched for the function public.create_tenant_bundle");
}

async function seedTenantSettings(supabase, tenantId, payload) {
  const { error } = await supabase
    .from("tenant_settings")
    .upsert([{
      tenant_id: tenantId,
      branding: {
        business_name: clean(payload.business_name || payload.businessName),
        logo_url: clean(payload.logo_url || payload.logoUrl) || null,
        accent_color: clean(payload.brand_color || payload.brandColor) || "#c84b2f",
      },
      contact: {
        email: clean(payload.owner_email || payload.email).toLowerCase() || null,
        phone: clean(payload.phone) || null,
        city_state: clean(payload.city_state || payload.cityState || payload.service_area || payload.serviceArea) || null,
      },
      business_hours: {},
    }], { onConflict: "tenant_id" });

  if (error) {
    console.warn("[provision-tenant-bundle] tenant_settings upsert non-fatal:", error.message);
  }
}

async function provisionTenantBundle({ supabase, payload, invitedByOperatorId = null }) {
  const businessName = clean(payload.business_name || payload.businessName);
  const ownerName = clean(payload.owner_name || payload.ownerName);
  const ownerEmail = clean(payload.owner_email || payload.email).toLowerCase();
  const phone = clean(payload.phone) || null;
  const businessType = normalizeBusinessType(payload);
  const cityState = clean(payload.city_state || payload.cityState || payload.service_area || payload.serviceArea) || null;
  const selectedPlan = normalizePlan(payload.selected_plan || payload.selectedPlan);
  const desiredSlug = clean(
    payload.subdomain_preference
      || payload.subdomainPreference
      || payload.requested_subdomain
      || payload.requestedSubdomain
      || payload.business_slug
      || businessName
  );
  const ownerUserId = clean(payload.user_id || payload.userId) || null;
  const couponCode = clean(payload.coupon_code || payload.couponCode).toUpperCase();
  const couponApplied = couponCode === "BUILDWITHME" && selectedPlan === "growth";
  const exemptUntil = couponApplied
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const tenantSlug = await uniqueTenantSlug(desiredSlug || businessName, supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert([{
      name: businessName,
      slug: tenantSlug,
      owner_email: ownerEmail,
      owner_name: ownerName,
      business_type: businessType,
      city_state: cityState,
      logo_url: clean(payload.logo_url || payload.logoUrl) || null,
      setup_complete: false,
      active: true,
      prooflink_plan_key: selectedPlan,
      billing_status: "onboarding",
      connect_status: "connect_not_started",
      payments_enabled: false,
      online_payments_enabled: false,
      billing_exempt: couponApplied,
      billing_exempt_until: exemptUntil,
    }])
    .select("id,slug,name")
    .maybeSingle();

  if (tenantError) throw tenantError;
  if (!tenant) throw new Error("Tenant creation failed: no record returned after insert");

  const { data: operator, error: operatorError } = await supabase
    .from("operators")
    .upsert([{
      email: ownerEmail,
      name: ownerName,
      role: "tenant_owner",
      tenant_id: tenant.id,
    }], { onConflict: "email" })
    .select("id")
    .maybeSingle();

  if (operatorError) throw operatorError;
  if (!operator) throw new Error("Operator creation failed: no record returned after upsert");

  const { error: membershipError } = await supabase
    .from("operator_members")
    .upsert([{
      operator_id: operator.id,
      tenant_id: tenant.id,
      role: "owner",
      invited_by: clean(invitedByOperatorId) || null,
      ...(ownerUserId ? { user_id: ownerUserId } : {}),
    }], { onConflict: "operator_id,tenant_id" });

  if (membershipError) throw membershipError;

  await seedTemplateForTenant(
    supabase,
    tenant.id,
    operator.id,
    clean(payload.seed_template_key || payload.seedTemplateKey) || businessType || "default"
  );
  await seedTenantSettings(supabase, tenant.id, payload);

  const existingSiteSettings = await supabase
    .from("tenant_config")
    .select("config_value")
    .eq("tenant_id", tenant.id)
    .eq("config_key", "site_settings")
    .maybeSingle();

  if (existingSiteSettings.error) {
    console.warn("[provision-tenant-bundle] site_settings fetch non-fatal:", existingSiteSettings.error.message);
  }

  const siteSettingsUpsert = await supabase
    .from("tenant_config")
    .upsert([{
      tenant_id: tenant.id,
      config_key: "site_settings",
      config_value: JSON.stringify({
        ...parseConfig(existingSiteSettings.data?.config_value),
        workspace_business_type: businessType || "",
        business_type: businessType || "",
      }),
    }], { onConflict: "tenant_id,config_key" });

  if (siteSettingsUpsert.error) {
    console.warn("[provision-tenant-bundle] site_settings business type upsert non-fatal:", siteSettingsUpsert.error.message);
  }

  return {
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    operator_id: operator.id,
    operator_slug: "",
  };
}

module.exports = {
  extractErrorCode,
  isMissingCreateTenantBundleRpcError,
  provisionTenantBundle,
};
