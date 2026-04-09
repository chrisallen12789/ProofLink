'use strict';

const { requireTenantAdminContext, getAdminClient, respond } = require('./utils/auth');

const ASSIGNMENT_FIELDS = [
  'member_id',
  'compensation_profile_id',
  'compensation_type',
  'employment_type',
  'worker_label',
  'driver_label',
  'base_hourly_rate_cents',
  'annual_salary_cents',
  'daily_rate_cents',
  'job_rate_cents',
  'commission_percent',
  'union_classification_id',
  'is_union_member',
  'pay_source_label',
  'effective_start_date',
  'effective_end_date',
  'metadata',
];

const OVERRIDE_FIELDS = [
  'member_id',
  'override_scope',
  'override_reason',
  'compensation_type',
  'worker_label',
  'driver_label',
  'hourly_rate_cents',
  'daily_rate_cents',
  'job_rate_cents',
  'commission_percent',
  'shift_differential_cents',
  'hazard_hourly_premium_cents',
  'travel_hourly_rate_cents',
  'per_diem_cents',
  'standby_hourly_rate_cents',
  'is_union_member',
  'effective_start_date',
  'effective_end_date',
  'metadata',
];

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return null;
  }
}

function normalizeEntity(value) {
  return String(value || '').trim().toLowerCase();
}

function pickFields(source, allowed) {
  return Object.fromEntries(
    Object.entries(source || {}).filter(([key, value]) => allowed.includes(key) && value !== undefined)
  );
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
    const memberId = String(params.member_id || '').trim();

    const assignmentsQuery = adminSb
      .from('member_compensation_assignments')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('effective_start_date', { ascending: false });

    const overridesQuery = adminSb
      .from('member_compensation_overrides')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('effective_start_date', { ascending: false });

    const [{ data: assignments, error: assignmentsError }, { data: overrides, error: overridesError }] = await Promise.all([
      (memberId ? assignmentsQuery.eq('member_id', memberId) : assignmentsQuery),
      (memberId ? overridesQuery.eq('member_id', memberId) : overridesQuery),
    ]);

    if (assignmentsError) return respond(500, { error: assignmentsError.message });
    if (overridesError) return respond(500, { error: overridesError.message });

    return respond(200, {
      assignments: assignments || [],
      overrides: overrides || [],
    });
  }

  if (event.httpMethod === 'POST') {
    const body = parseBody(event);
    if (!body) return respond(400, { error: 'Invalid JSON' });

    const entity = normalizeEntity(body.entity);
    const table = entity === 'override' ? 'member_compensation_overrides' : entity === 'assignment' ? 'member_compensation_assignments' : '';
    const allowed = entity === 'override' ? OVERRIDE_FIELDS : entity === 'assignment' ? ASSIGNMENT_FIELDS : null;
    if (!table) return respond(400, { error: 'entity must be assignment or override' });

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

    const table = entity === 'override' ? 'member_compensation_overrides' : entity === 'assignment' ? 'member_compensation_assignments' : '';
    const allowed = entity === 'override' ? OVERRIDE_FIELDS : entity === 'assignment' ? ASSIGNMENT_FIELDS : null;
    if (!table) return respond(400, { error: 'entity must be assignment or override' });

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

    const table = entity === 'override' ? 'member_compensation_overrides' : entity === 'assignment' ? 'member_compensation_assignments' : '';
    if (!table) return respond(400, { error: 'entity must be assignment or override' });

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
