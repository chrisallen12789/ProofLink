'use strict';

const { respond } = require('./utils/auth');
const { asArray, asBoolean, clean, daysUntil, parseJsonBody, requireHydrovacOperatorContext } = require('./utils/hydrovac');

function buildWarnings(record) {
  const warningFields = [
    'cdl_expiry_date',
    'medical_certificate_expiry',
    'hazmat_cert_expiry_date',
    'confined_space_cert_expiry_date',
    'h2s_cert_expiry_date',
  ];
  const warnings = [];
  for (const field of warningFields) {
    const remaining = daysUntil(record[field]);
    if (remaining == null) continue;
    if (remaining < 0) {
      warnings.push({ field, expiry_date: record[field], days_remaining: remaining, severity: 'expired' });
    } else if (remaining <= 7) {
      warnings.push({ field, expiry_date: record[field], days_remaining: remaining, severity: 'critical' });
    } else if (remaining <= 30) {
      warnings.push({ field, expiry_date: record[field], days_remaining: remaining, severity: 'warning' });
    }
  }
  return warnings;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try {
    ctx = await requireHydrovacOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId, adminSb } = ctx;
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (clean(params.action) === 'compliance_summary') {
      const { data, error } = await adminSb
        .from('driver_qualifications')
        .select('*, operator_members!member_id(id, display_name, role_title)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) return respond(500, { error: error.message });
      const rows = (data || []).map((row) => ({ ...row, warnings: buildWarnings(row) }));
      return respond(200, { drivers: rows });
    }

    const memberId = clean(params.member_id);
    if (!memberId) return respond(400, { error: 'member_id is required' });

    const { data, error } = await adminSb
      .from('driver_qualifications')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('member_id', memberId)
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Driver qualification record not found' });
    return respond(200, { qualification: data, warnings: buildWarnings(data) });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const memberId = clean(body.member_id);
    if (!memberId) return respond(400, { error: 'member_id is required' });

    const record = {
      tenant_id: tenantId,
      member_id: memberId,
      cdl_number: clean(body.cdl_number) || null,
      cdl_state: clean(body.cdl_state) || null,
      cdl_class: clean(body.cdl_class) || null,
      cdl_expiry_date: clean(body.cdl_expiry_date) || null,
      cdl_endorsements: asArray(body.cdl_endorsements),
      cdl_restrictions: asArray(body.cdl_restrictions),
      medical_certificate_expiry: clean(body.medical_certificate_expiry) || null,
      medical_examiner_name: clean(body.medical_examiner_name) || null,
      medical_national_registry_num: clean(body.medical_national_registry_num) || null,
      last_pre_employment_test_date: clean(body.last_pre_employment_test_date) || null,
      last_random_test_date: clean(body.last_random_test_date) || null,
      drug_test_consortium: clean(body.drug_test_consortium) || null,
      dot_drug_test_clearinghouse_enrolled: asBoolean(body.dot_drug_test_clearinghouse_enrolled, false),
      hazmat_certified: asBoolean(body.hazmat_certified, false),
      hazmat_cert_expiry_date: clean(body.hazmat_cert_expiry_date) || null,
      confined_space_certified: asBoolean(body.confined_space_certified, false),
      confined_space_cert_expiry_date: clean(body.confined_space_cert_expiry_date) || null,
      h2s_alive_certified: asBoolean(body.h2s_alive_certified, false),
      h2s_cert_expiry_date: clean(body.h2s_cert_expiry_date) || null,
      first_aid_certified: asBoolean(body.first_aid_certified, false),
      first_aid_cert_expiry_date: clean(body.first_aid_cert_expiry_date) || null,
      defensive_driving_completed: asBoolean(body.defensive_driving_completed, false),
      last_mvr_check_date: clean(body.last_mvr_check_date) || null,
      mvr_status: clean(body.mvr_status) || null,
      hos_available_driving_minutes: body.hos_available_driving_minutes != null ? Number(body.hos_available_driving_minutes) : null,
      hos_cycle_used_minutes: body.hos_cycle_used_minutes != null ? Number(body.hos_cycle_used_minutes) : null,
      hos_last_synced_at: clean(body.hos_last_synced_at) || null,
      notes: clean(body.notes) || null,
    };

    const { data, error } = await adminSb
      .from('driver_qualifications')
      .insert(record)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    return respond(201, { ok: true, qualification: data, warnings: buildWarnings(data) });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const id = clean(body.id);
    if (!id) return respond(400, { error: 'id is required' });

    const patch = {};
    const arrayFields = new Set(['cdl_endorsements', 'cdl_restrictions']);
    const boolFields = new Set([
      'dot_drug_test_clearinghouse_enrolled',
      'hazmat_certified',
      'confined_space_certified',
      'h2s_alive_certified',
      'first_aid_certified',
      'defensive_driving_completed',
    ]);
    const allowed = [
      'cdl_number', 'cdl_state', 'cdl_class', 'cdl_expiry_date', 'cdl_endorsements', 'cdl_restrictions',
      'medical_certificate_expiry', 'medical_examiner_name', 'medical_national_registry_num',
      'last_pre_employment_test_date', 'last_random_test_date', 'drug_test_consortium',
      'dot_drug_test_clearinghouse_enrolled', 'hazmat_certified', 'hazmat_cert_expiry_date',
      'confined_space_certified', 'confined_space_cert_expiry_date', 'h2s_alive_certified', 'h2s_cert_expiry_date',
      'first_aid_certified', 'first_aid_cert_expiry_date', 'defensive_driving_completed',
      'last_mvr_check_date', 'mvr_status', 'hos_available_driving_minutes', 'hos_cycle_used_minutes',
      'hos_last_synced_at', 'notes',
    ];
    for (const field of allowed) {
      if (body[field] === undefined) continue;
      if (arrayFields.has(field)) patch[field] = asArray(body[field]);
      else if (boolFields.has(field)) patch[field] = asBoolean(body[field], false);
      else patch[field] = body[field];
    }

    const { data, error } = await adminSb
      .from('driver_qualifications')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Driver qualification record not found' });
    return respond(200, { ok: true, qualification: data, warnings: buildWarnings(data) });
  }

  return respond(405, { error: 'Method not allowed' });
};
