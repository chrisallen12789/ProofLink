'use strict';

const ImportTools = require('../../operator/components/import-tools.js');
const { requireTenantAdminContext, respond } = require('./utils/auth');

const CONFIG_KEY = 'import_profiles';
const MAX_PROFILES = 16;

function parseConfigValue(value) {
  if (!value) return { profiles: [] };
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { profiles: [] };
  }
}

function slugKey(value, fallback = 'import-profile') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Number(Math.max(0, Math.min(1, score)).toFixed(2));
}

function normalizeProfile(profile = {}, operatorId = '') {
  const importKind = ImportTools.normalizeImportKind(profile.import_kind || profile.importKind || '');
  const allowedFields = Object.keys(ImportTools.FIELD_ALIASES?.[importKind] || {});
  const incomingFieldAliases = profile.field_aliases || profile.fieldAliases || {};
  const fieldAliases = {};

  allowedFields.forEach((fieldKey) => {
    const aliases = Array.isArray(incomingFieldAliases[fieldKey]) ? incomingFieldAliases[fieldKey] : [];
    const normalizedAliases = Array.from(new Set(
      aliases
        .map((value) => ImportTools.normalizeHeader(value))
        .filter(Boolean)
    )).slice(0, 20);
    if (normalizedAliases.length) fieldAliases[fieldKey] = normalizedAliases;
  });

  const sampleHeaders = Array.from(new Set(
    (Array.isArray(profile.sample_headers || profile.sampleHeaders) ? (profile.sample_headers || profile.sampleHeaders) : [])
      .map((value) => ImportTools.normalizeHeader(value))
      .filter(Boolean)
  )).slice(0, 60);

  const label = String(profile.label || profile.name || `${importKind} import profile`).trim().slice(0, 80)
    || `${importKind} import profile`;
  const key = slugKey(profile.key || profile.profile_key || label, `${importKind}-import-profile`);

  return {
    key,
    label,
    import_kind: importKind,
    field_aliases: fieldAliases,
    sample_headers: sampleHeaders,
    source_hint: String(profile.source_hint || profile.sourceHint || '').trim().slice(0, 120),
    confidence_score: clampScore(profile.confidence_score || profile.confidenceScore || 0),
    learned_at: new Date(profile.learned_at || profile.learnedAt || Date.now()).toISOString(),
    learned_by: String(profile.learned_by || operatorId || '').trim(),
  };
}

async function loadProfiles(supabase, tenantId) {
  const { data, error } = await supabase
    .from('tenant_config')
    .select('config_value')
    .eq('tenant_id', tenantId)
    .eq('config_key', CONFIG_KEY)
    .maybeSingle();

  if (error) throw error;
  const parsed = parseConfigValue(data?.config_value);
  const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  return profiles;
}

async function saveProfiles(supabase, tenantId, profiles) {
  const payload = {
    tenant_id: tenantId,
    config_key: CONFIG_KEY,
    config_value: JSON.stringify({ profiles }),
  };

  const { error } = await supabase
    .from('tenant_config')
    .upsert(payload, { onConflict: 'tenant_id,config_key' });

  if (error) throw error;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let body = {};
  if (event.httpMethod === 'POST') {
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }
  }

  let ctx;
  try {
    ctx = await requireTenantAdminContext(
      event,
      body.tenant_id || body.tenantId || event.queryStringParameters?.tenant_id || ''
    );
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message || 'Unauthorized' });
  }

  const { supabase, tenantId, operatorId } = ctx;
  if (!tenantId) return respond(403, { error: 'Tenant context is required' });

  try {
    if (event.httpMethod === 'GET') {
      const profiles = await loadProfiles(supabase, tenantId);
      return respond(200, {
        ok: true,
        tenant_id: tenantId,
        profiles,
      });
    }

    if (event.httpMethod !== 'POST') {
      return respond(405, { error: 'Method not allowed' });
    }

    const action = String(body.action || 'upsert').trim().toLowerCase();
    const currentProfiles = await loadProfiles(supabase, tenantId);

    if (action === 'delete') {
      const key = slugKey(body.profile_key || body.profileKey || body.key || '');
      if (!key) return respond(400, { error: 'profile_key is required for delete' });
      const nextProfiles = currentProfiles.filter((profile) => profile?.key !== key);
      await saveProfiles(supabase, tenantId, nextProfiles);
      return respond(200, {
        ok: true,
        tenant_id: tenantId,
        deleted: key,
        profiles: nextProfiles,
      });
    }

    if (!body.profile || typeof body.profile !== 'object') {
      return respond(400, { error: 'profile object is required' });
    }

    const normalizedProfile = normalizeProfile(body.profile, operatorId);
    if (!Object.keys(normalizedProfile.field_aliases).length) {
      return respond(400, { error: 'profile.field_aliases must contain at least one mapped field' });
    }

    const nextProfiles = [
      normalizedProfile,
      ...currentProfiles.filter((profile) => profile?.key !== normalizedProfile.key),
    ].slice(0, MAX_PROFILES);

    await saveProfiles(supabase, tenantId, nextProfiles);
    return respond(200, {
      ok: true,
      tenant_id: tenantId,
      profile: normalizedProfile,
      profiles: nextProfiles,
    });
  } catch (error) {
    return respond(500, { error: error.message || 'Failed to manage import profiles' });
  }
};
