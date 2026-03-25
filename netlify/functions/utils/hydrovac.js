'use strict';

const { requireOperatorContext, getAdminClient } = require('./auth');

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function parseJsonBody(event) {
  if (!event || !event.body) return {};
  if (typeof event.body === 'object') return event.body;
  return JSON.parse(event.body || '{}');
}

function safeJsonParse(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item !== undefined && item !== null && String(item).trim() !== '');
}

function asNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asMoneyCents(value, fallback = 0) {
  return Math.max(0, Math.round(asNumber(value, fallback)));
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function normalizeBusinessType(value) {
  const normalized = lower(value);
  if (!normalized) return '';
  if (normalized === 'vactor') return 'hydrovac';
  if (normalized === 'hydrovac_vactor') return 'hydrovac';
  return normalized;
}

function isHydrovacBusinessType(value) {
  const normalized = normalizeBusinessType(value);
  return normalized === 'hydrovac';
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date = new Date()) {
  const start = startOfUtcDay(date);
  return new Date(start.getTime() + (24 * 60 * 60 * 1000));
}

function hoursBetween(startIso, endIso) {
  const start = Date.parse(startIso || '');
  const end = Date.parse(endIso || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / (1000 * 60 * 60);
}

function toIsoOrNull(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function daysUntil(value) {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  const today = startOfUtcDay(new Date());
  const diff = startOfUtcDay(target).getTime() - today.getTime();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

async function requireHydrovacOperatorContext(event) {
  const ctx = await requireOperatorContext(event);
  const adminSb = getAdminClient();
  if (!ctx.tenantId) {
    const err = new Error('Operator is not linked to a tenant');
    err.statusCode = 403;
    throw err;
  }

  const [{ data: tenant, error: tenantError }, { data: cfgRow, error: cfgError }, { data: settingsRow, error: settingsError }] = await Promise.all([
    adminSb
      .from('tenants')
      .select('id, name, slug, business_type, prooflink_plan_key')
      .eq('id', ctx.tenantId)
      .maybeSingle(),
    adminSb
      .from('tenant_config')
      .select('config_value')
      .eq('tenant_id', ctx.tenantId)
      .eq('config_key', 'site_settings')
      .maybeSingle(),
    adminSb
      .from('tenant_hydrovac_settings')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
  ]);

  if (tenantError || !tenant) {
    const err = new Error('Tenant not found');
    err.statusCode = 404;
    throw err;
  }
  if (cfgError) {
    const err = new Error('Failed to load tenant configuration');
    err.statusCode = 500;
    throw err;
  }
  if (settingsError && settingsError.code !== 'PGRST116') {
    const err = new Error('Failed to load hydrovac settings');
    err.statusCode = 500;
    throw err;
  }

  const rawConfig = safeJsonParse(cfgRow?.config_value, {});
  const businessType = normalizeBusinessType(
    tenant.business_type ||
    rawConfig.workspace_business_type ||
    rawConfig.business_type ||
    ''
  );

  if (!isHydrovacBusinessType(businessType)) {
    const err = new Error('Hydrovac module not enabled for this tenant');
    err.statusCode = 404;
    throw err;
  }

  return {
    ...ctx,
    adminSb,
    tenant,
    businessType,
    hydrovacSettings: settingsRow || null,
    rawTenantConfig: rawConfig,
  };
}

module.exports = {
  asArray,
  asBoolean,
  asMoneyCents,
  asNumber,
  clean,
  daysUntil,
  endOfUtcDay,
  hoursBetween,
  isHydrovacBusinessType,
  lower,
  normalizeBusinessType,
  parseJsonBody,
  requireHydrovacOperatorContext,
  safeJsonParse,
  startOfUtcDay,
  toIsoOrNull,
};
