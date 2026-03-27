'use strict';

const { respond } = require('./utils/auth');
const { clean, daysUntil, parseJsonBody, requireHydrovacOperatorContext } = require('./utils/hydrovac');

function complianceWarnings(unit) {
  const fields = [
    'next_dot_inspection_due',
    'next_annual_inspection_due',
    'next_tank_inspection_due',
    'insurance_expiry_date',
    'registration_expiry_date',
  ];
  const warnings = [];
  for (const field of fields) {
    const remaining = daysUntil(unit[field]);
    if (remaining == null) continue;
    if (remaining < 0) warnings.push({ field, due_date: unit[field], days_remaining: remaining, severity: 'expired' });
    else if (remaining <= 7) warnings.push({ field, due_date: unit[field], days_remaining: remaining, severity: 'critical' });
    else if (remaining <= 30) warnings.push({ field, due_date: unit[field], days_remaining: remaining, severity: 'warning' });
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

  const { tenantId, operatorId, adminSb } = ctx;
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (clean(params.action) === 'compliance_summary') {
      const { data, error } = await adminSb
        .from('equipment')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) return respond(500, { error: error.message });
      return respond(200, { equipment: (data || []).map((row) => ({ ...row, warnings: complianceWarnings(row) })) });
    }

    if (clean(params.action) === 'availability') {
      const date = clean(params.date);
      if (!date) return respond(400, { error: 'date is required' });

      const [{ data: units, error: unitsError }, { data: jobs, error: jobsError }] = await Promise.all([
        adminSb
          .from('equipment')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .order('name', { ascending: true }),
        adminSb
          .from('jobs')
          .select('id, assigned_truck_id')
          .eq('tenant_id', tenantId)
          .eq('scheduled_date', date)
          .in('status', ['scheduled', 'dispatched', 'in_progress']),
      ]);

      if (unitsError) return respond(500, { error: unitsError.message });
      if (jobsError) return respond(500, { error: jobsError.message });

      const busyTruckIds = new Set((jobs || []).map((row) => row.assigned_truck_id).filter(Boolean));
      return respond(200, {
        equipment: (units || []).filter((unit) => !busyTruckIds.has(unit.id)),
        date,
      });
    }

    let query = adminSb
      .from('equipment')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (clean(params.id)) query = query.eq('id', clean(params.id));
    if (clean(params.type)) query = query.eq('equipment_type', clean(params.type));
    if (clean(params.status)) query = query.eq('status', clean(params.status));

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    if (clean(params.id)) {
      const unit = Array.isArray(data) ? data[0] : null;
      if (!unit) return respond(404, { error: 'Equipment not found' });
      return respond(200, { equipment: unit, warnings: complianceWarnings(unit) });
    }
    return respond(200, { equipment: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const name = clean(body.name);
    const equipmentType = clean(body.equipment_type);
    if (!name) return respond(400, { error: 'name is required' });
    if (!equipmentType) return respond(400, { error: 'equipment_type is required' });

    const record = {
      tenant_id: tenantId,
      operator_id: operatorId,
      name: name.slice(0, 100),
      equipment_type: equipmentType,
      unit_number: clean(body.unit_number) || null,
      make: clean(body.make) || null,
      model: clean(body.model) || null,
      year: body.year != null ? Number(body.year) : (body.model_year != null ? Number(body.model_year) : null),
      model_year: body.model_year != null ? Number(body.model_year) : (body.year != null ? Number(body.year) : null),
      status: clean(body.status || 'available') || 'available',
      daily_rate_cents: body.daily_rate_cents != null ? Number(body.daily_rate_cents) : null,
      hourly_rate_cents: body.hourly_rate_cents != null ? Number(body.hourly_rate_cents) : 0,
      debris_tank_capacity_gallons: body.debris_tank_capacity_gallons != null ? Number(body.debris_tank_capacity_gallons) : null,
      debris_tank_capacity_yards: body.debris_tank_capacity_yards != null ? Number(body.debris_tank_capacity_yards) : null,
      water_tank_capacity_gallons: body.water_tank_capacity_gallons != null ? Number(body.water_tank_capacity_gallons) : null,
      water_pump_gpm: body.water_pump_gpm != null ? Number(body.water_pump_gpm) : null,
      water_pressure_psi: body.water_pressure_psi != null ? Number(body.water_pressure_psi) : null,
      vacuum_cfm: body.vacuum_cfm != null ? Number(body.vacuum_cfm) : null,
      vacuum_hose_diameter_inches: body.vacuum_hose_diameter_inches != null ? Number(body.vacuum_hose_diameter_inches) : null,
      max_hose_length_ft: body.max_hose_length_ft != null ? Number(body.max_hose_length_ft) : null,
      boom_length_ft: body.boom_length_ft != null ? Number(body.boom_length_ft) : null,
      digging_depth_ft: body.digging_depth_ft != null ? Number(body.digging_depth_ft) : null,
      gvwr_lbs: body.gvwr_lbs != null ? Number(body.gvwr_lbs) : null,
      is_cdl_required: body.is_cdl_required !== false,
      gps_device_id: clean(body.gps_device_id) || null,
      gps_provider: clean(body.gps_provider) || null,
      notes: clean(body.notes) || null,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    };

    const { data, error } = await adminSb
      .from('equipment')
      .insert(record)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    return respond(201, { item: data });
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
      'name', 'unit_number', 'make', 'model', 'year', 'model_year', 'equipment_type', 'status',
      'hourly_rate_cents', 'daily_rate_cents', 'notes', 'is_active', 'vin', 'license_plate',
      'state_registered', 'dot_number', 'dot_unit_number', 'gvwr_lbs', 'is_cdl_required',
      'debris_tank_capacity_gallons', 'debris_tank_capacity_yards', 'water_tank_capacity_gallons',
      'water_pump_gpm', 'water_pressure_psi', 'vacuum_cfm', 'vacuum_hose_diameter_inches',
      'max_hose_length_ft', 'boom_length_ft', 'digging_depth_ft', 'last_dot_inspection_date',
      'next_dot_inspection_due', 'last_annual_inspection_date', 'next_annual_inspection_due',
      'last_tank_inspection_date', 'next_tank_inspection_due', 'insurance_expiry_date',
      'registration_expiry_date', 'ifta_account_number', 'gps_device_id', 'gps_provider',
      'current_lat', 'current_lng', 'current_location_updated_at', 'odometer_miles', 'engine_hours',
      'last_service_at', 'next_service_due_at', 'next_service_due_miles', 'next_service_due_hours',
      'acquisition_date', 'acquisition_cost_cents', 'current_value_cents', 'metadata',
    ];
    const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });

    const { data, error } = await adminSb
      .from('equipment')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Equipment not found' });
    return respond(200, { item: data, warnings: complianceWarnings(data) });
  }

  if (event.httpMethod === 'DELETE') {
    const id = clean(params.id);
    if (!id) return respond(400, { error: 'id is required' });

    const { data, error } = await adminSb
      .from('equipment')
      .update({ is_active: false, status: 'out_of_service', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Equipment not found' });
    return respond(200, { item: data });
  }

  return respond(405, { error: 'Method not allowed' });
};
