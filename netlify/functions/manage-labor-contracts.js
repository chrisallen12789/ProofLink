'use strict';

const { requireTenantAdminContext, getAdminClient, respond } = require('./utils/auth');

const CONTRACT_FIELDS = [
  'contract_name',
  'union_name',
  'union_local_number',
  'effective_start_date',
  'effective_end_date',
  'status',
  'notes',
  'source_document_url',
];

const CLASSIFICATION_FIELDS = [
  'contract_id',
  'classification_code',
  'classification_name',
  'worker_label',
  'driver_label',
  'is_driver_class',
  'apprentice_level',
  'sort_order',
  'notes',
];

const RATE_PERIOD_FIELDS = [
  'contract_id',
  'classification_id',
  'effective_start_date',
  'effective_end_date',
  'base_hourly_rate_cents',
  'foreman_hourly_premium_cents',
  'general_foreman_hourly_premium_cents',
  'shift_differential_cents',
  'travel_hourly_rate_cents',
  'standby_hourly_rate_cents',
  'per_diem_cents',
  'hazard_hourly_premium_cents',
  'overtime_multiplier',
  'doubletime_multiplier',
  'holiday_multiplier',
  'fringe_package',
  'notes',
];

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

function pickFields(source, allowed) {
  return Object.fromEntries(
    Object.entries(source || {}).filter(([key, value]) => allowed.includes(key) && value !== undefined)
  );
}

function normalizeEntity(value) {
  return String(value || '').trim().toLowerCase();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try {
    ctx = await requireTenantAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const tenantId = ctx.tenantId;
  const adminSb = getAdminClient();
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const contractId = String(params.contract_id || '').trim();
    const includeRates = String(params.include_rates || 'true').trim().toLowerCase() !== 'false';

    const { data: contracts, error: contractsError } = await adminSb
      .from('labor_contracts')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('effective_start_date', { ascending: false });

    if (contractsError) return respond(500, { error: contractsError.message });

    const { data: classifications, error: classificationsError } = await adminSb
      .from('labor_contract_classifications')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true });

    if (classificationsError) return respond(500, { error: classificationsError.message });

    let ratePeriods = [];
    if (includeRates) {
      const { data, error } = await adminSb
        .from('labor_contract_rate_periods')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('effective_start_date', { ascending: false });
      if (error) return respond(500, { error: error.message });
      ratePeriods = data || [];
    }

    const filteredContracts = contractId
      ? (contracts || []).filter((row) => String(row.id) === contractId)
      : (contracts || []);

    return respond(200, {
      contracts: filteredContracts.map((contract) => ({
        ...contract,
        classifications: (classifications || [])
          .filter((row) => String(row.contract_id) === String(contract.id))
          .map((classification) => ({
            ...classification,
            rate_periods: includeRates
              ? ratePeriods.filter((row) => String(row.classification_id) === String(classification.id))
              : [],
          })),
      })),
    });
  }

  if (event.httpMethod === 'POST') {
    const body = parseBody(event);
    if (!body) return respond(400, { error: 'Invalid JSON' });

    const entity = normalizeEntity(body.entity);
    if (!['contract', 'classification', 'rate_period'].includes(entity)) {
      return respond(400, { error: 'entity must be contract, classification, or rate_period' });
    }

    let table = 'labor_contracts';
    let allowed = CONTRACT_FIELDS;
    if (entity === 'classification') {
      table = 'labor_contract_classifications';
      allowed = CLASSIFICATION_FIELDS;
    } else if (entity === 'rate_period') {
      table = 'labor_contract_rate_periods';
      allowed = RATE_PERIOD_FIELDS;
    }

    const insert = {
      tenant_id: tenantId,
      ...pickFields(body, allowed),
    };

    const { data, error } = await adminSb
      .from(table)
      .insert(insert)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    return respond(201, { entity, record: data });
  }

  if (event.httpMethod === 'PATCH') {
    const body = parseBody(event);
    if (!body) return respond(400, { error: 'Invalid JSON' });

    const entity = normalizeEntity(body.entity);
    const id = String(body.id || '').trim();
    if (!id) return respond(400, { error: 'id is required' });

    let table = 'labor_contracts';
    let allowed = CONTRACT_FIELDS;
    if (entity === 'classification') {
      table = 'labor_contract_classifications';
      allowed = CLASSIFICATION_FIELDS;
    } else if (entity === 'rate_period') {
      table = 'labor_contract_rate_periods';
      allowed = RATE_PERIOD_FIELDS;
    } else if (entity !== 'contract') {
      return respond(400, { error: 'entity must be contract, classification, or rate_period' });
    }

    const patch = pickFields(body, allowed);
    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await adminSb
      .from(table)
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Record not found' });
    return respond(200, { entity, record: data });
  }

  if (event.httpMethod === 'DELETE') {
    const entity = normalizeEntity(params.entity);
    const id = String(params.id || '').trim();
    if (!id) return respond(400, { error: 'id is required' });

    let table = 'labor_contracts';
    if (entity === 'classification') table = 'labor_contract_classifications';
    else if (entity === 'rate_period') table = 'labor_contract_rate_periods';
    else if (entity !== 'contract') return respond(400, { error: 'entity must be contract, classification, or rate_period' });

    const { error } = await adminSb
      .from(table)
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) return respond(500, { error: error.message });
    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
