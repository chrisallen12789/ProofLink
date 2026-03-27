'use strict';

const { respond } = require('./utils/auth');
const {
  asArray,
  asBoolean,
  asMoneyCents,
  asNumber,
  clean,
  daysUntil,
  parseJsonBody,
  requireHydrovacOperatorContext,
} = require('./utils/hydrovac');

function facilityWarnings(record) {
  const warnings = [];
  const permitDays = daysUntil(record?.permit_expiry_date);
  if (permitDays != null) {
    if (permitDays < 0) warnings.push({ field: 'permit_expiry_date', days_remaining: permitDays, severity: 'expired' });
    else if (permitDays <= 7) warnings.push({ field: 'permit_expiry_date', days_remaining: permitDays, severity: 'critical' });
    else if (permitDays <= 30) warnings.push({ field: 'permit_expiry_date', days_remaining: permitDays, severity: 'warning' });
  }
  const hasRate = [
    record?.price_per_gallon_cents,
    record?.price_per_cubic_yard_cents,
    record?.price_per_ton_cents,
    record?.minimum_charge_cents,
  ].some((value) => Number(value || 0) > 0);
  if (!hasRate) warnings.push({ field: 'pricing', severity: 'info', message: 'No contracted disposal pricing saved.' });
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
    let query = adminSb
      .from('disposal_facilities')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('status', { ascending: true })
      .order('name', { ascending: true });

    if (clean(params.id)) query = query.eq('id', clean(params.id));
    if (clean(params.status)) query = query.eq('status', clean(params.status));
    if (clean(params.facility_type)) query = query.eq('facility_type', clean(params.facility_type));

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });

    if (clean(params.id)) {
      const facility = Array.isArray(data) ? data[0] : null;
      if (!facility) return respond(404, { error: 'Disposal facility not found' });
      return respond(200, { facility: { ...facility, warnings: facilityWarnings(facility) } });
    }

    return respond(200, {
      facilities: (data || []).map((row) => ({ ...row, warnings: facilityWarnings(row) })),
    });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const name = clean(body.name);
    if (!name) return respond(400, { error: 'name is required' });

    const record = {
      tenant_id: tenantId,
      name: name.slice(0, 160),
      facility_type: clean(body.facility_type || 'transfer_station') || 'transfer_station',
      status: clean(body.status || 'active') || 'active',
      address: clean(body.address) || null,
      city: clean(body.city) || null,
      state_province: clean(body.state_province) || null,
      zip_postal: clean(body.zip_postal) || null,
      lat: asNumber(body.lat, null),
      lng: asNumber(body.lng, null),
      hours_of_operation: clean(body.hours_of_operation) || null,
      permit_number: clean(body.permit_number) || null,
      permit_expiry_date: clean(body.permit_expiry_date) || null,
      epa_id: clean(body.epa_id) || null,
      accepts_non_hazardous: asBoolean(body.accepts_non_hazardous, true),
      accepts_hazardous: asBoolean(body.accepts_hazardous, false),
      accepted_waste_types: asArray(body.accepted_waste_types),
      price_per_gallon_cents: asMoneyCents(body.price_per_gallon_cents, 0) || null,
      price_per_cubic_yard_cents: asMoneyCents(body.price_per_cubic_yard_cents, 0) || null,
      price_per_ton_cents: asMoneyCents(body.price_per_ton_cents, 0) || null,
      minimum_charge_cents: asMoneyCents(body.minimum_charge_cents, 0) || null,
      fuel_surcharge_percent: body.fuel_surcharge_percent != null ? Number(body.fuel_surcharge_percent) : null,
      primary_contact_name: clean(body.primary_contact_name) || null,
      primary_contact_phone: clean(body.primary_contact_phone) || null,
      primary_contact_email: clean(body.primary_contact_email) || null,
      dispatch_phone: clean(body.dispatch_phone) || null,
      after_hours_phone: clean(body.after_hours_phone) || null,
      account_number: clean(body.account_number) || null,
      approved_profiles: Array.isArray(body.approved_profiles) ? body.approved_profiles : [],
      notes: clean(body.notes) || null,
    };

    const { data, error } = await adminSb
      .from('disposal_facilities')
      .insert(record)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    return respond(201, { ok: true, facility: { ...data, warnings: facilityWarnings(data) } });
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

    const allowed = [
      'name', 'facility_type', 'status', 'address', 'city', 'state_province', 'zip_postal',
      'lat', 'lng', 'hours_of_operation', 'permit_number', 'permit_expiry_date', 'epa_id',
      'accepts_non_hazardous', 'accepts_hazardous', 'accepted_waste_types',
      'price_per_gallon_cents', 'price_per_cubic_yard_cents', 'price_per_ton_cents',
      'minimum_charge_cents', 'fuel_surcharge_percent', 'primary_contact_name',
      'primary_contact_phone', 'primary_contact_email', 'dispatch_phone',
      'after_hours_phone', 'account_number', 'approved_profiles', 'notes',
    ];
    const patch = {};
    for (const field of allowed) {
      if (body[field] === undefined) continue;
      patch[field] = body[field];
    }
    if (patch.accepted_waste_types !== undefined) patch.accepted_waste_types = asArray(patch.accepted_waste_types);
    if (patch.accepts_non_hazardous !== undefined) patch.accepts_non_hazardous = asBoolean(patch.accepts_non_hazardous, true);
    if (patch.accepts_hazardous !== undefined) patch.accepts_hazardous = asBoolean(patch.accepts_hazardous, false);
    if (patch.price_per_gallon_cents !== undefined) patch.price_per_gallon_cents = asMoneyCents(patch.price_per_gallon_cents, 0) || null;
    if (patch.price_per_cubic_yard_cents !== undefined) patch.price_per_cubic_yard_cents = asMoneyCents(patch.price_per_cubic_yard_cents, 0) || null;
    if (patch.price_per_ton_cents !== undefined) patch.price_per_ton_cents = asMoneyCents(patch.price_per_ton_cents, 0) || null;
    if (patch.minimum_charge_cents !== undefined) patch.minimum_charge_cents = asMoneyCents(patch.minimum_charge_cents, 0) || null;
    if (patch.lat !== undefined) patch.lat = asNumber(patch.lat, null);
    if (patch.lng !== undefined) patch.lng = asNumber(patch.lng, null);
    if (patch.approved_profiles !== undefined && !Array.isArray(patch.approved_profiles)) patch.approved_profiles = [];

    patch.updated_at = new Date().toISOString();
    const { data, error } = await adminSb
      .from('disposal_facilities')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Disposal facility not found' });
    return respond(200, { ok: true, facility: { ...data, warnings: facilityWarnings(data) } });
  }

  if (event.httpMethod === 'DELETE') {
    const id = clean(params.id);
    if (!id) return respond(400, { error: 'id is required' });

    const { data, error } = await adminSb
      .from('disposal_facilities')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Disposal facility not found' });
    return respond(200, { ok: true, facility: { ...data, warnings: facilityWarnings(data) } });
  }

  return respond(405, { error: 'Method not allowed' });
};
