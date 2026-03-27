'use strict';

const { respond } = require('./utils/auth');
const { asArray, asBoolean, clean, parseJsonBody, requireHydrovacOperatorContext } = require('./utils/hydrovac');

function normalizeReadings(readings) {
  if (!Array.isArray(readings)) return [];
  return readings
    .map((entry) => ({
      tested_at: clean(entry?.tested_at) || null,
      oxygen_pct: entry?.oxygen_pct != null ? Number(entry.oxygen_pct) : null,
      lel_pct: entry?.lel_pct != null ? Number(entry.lel_pct) : null,
      h2s_ppm: entry?.h2s_ppm != null ? Number(entry.h2s_ppm) : null,
      co_ppm: entry?.co_ppm != null ? Number(entry.co_ppm) : null,
      tester_name: clean(entry?.tester_name) || null,
      monitor_serial: clean(entry?.monitor_serial) || null,
    }))
    .filter((entry) => entry.tested_at || entry.oxygen_pct != null || entry.lel_pct != null || entry.h2s_ppm != null || entry.co_ppm != null);
}

function atmosphereFailures(patch) {
  const failures = [];
  if (patch.oxygen_acceptable !== true) failures.push('oxygen');
  if (patch.lel_acceptable !== true) failures.push('lel');
  if (patch.h2s_acceptable !== true) failures.push('h2s');
  if (patch.co_acceptable !== true) failures.push('co');
  return failures;
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
    const jobId = clean(params.job_id);
    if (!jobId) {
      let query = adminSb
        .from('confined_space_permits')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (clean(params.status)) query = query.eq('status', clean(params.status));
      if (clean(params.order_id)) query = query.eq('order_id', clean(params.order_id));

      const { data, error } = await query.limit(Math.min(Number(params.limit || 100), 250));
      if (error) return respond(500, { error: error.message });
      return respond(200, { permits: data || [] });
    }

    const { data, error } = await adminSb
      .from('confined_space_permits')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (error) return respond(500, { error: error.message });
    return respond(200, { permits: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const jobId = clean(body.job_id);
    const description = clean(body.space_description);
    if (!jobId) return respond(400, { error: 'job_id is required' });
    if (!description) return respond(400, { error: 'space_description is required' });

    const { data, error } = await adminSb
      .from('confined_space_permits')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        order_id: clean(body.order_id) || null,
        permit_number: clean(body.permit_number) || null,
        space_description: description,
        space_classification: clean(body.space_classification || 'permit_required') || 'permit_required',
        atmospheric_readings: normalizeReadings(body.atmospheric_readings),
        entry_supervisor_name: clean(body.entry_supervisor_name) || null,
        attendant_name: clean(body.attendant_name) || null,
        known_hazards: asArray(body.known_hazards),
        hazard_controls: clean(body.hazard_controls) || null,
        rescue_procedure: clean(body.rescue_procedure) || null,
        permit_valid_until: clean(body.permit_valid_until) || null,
        notes: clean(body.notes) || null,
      })
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    return respond(201, { ok: true, permit: data });
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
    const allowed = [
      'status', 'atmospheric_readings', 'authorized_entrants',
      'oxygen_acceptable', 'lel_acceptable', 'h2s_acceptable', 'co_acceptable',
      'rescue_equipment_on_site', 'rescue_equipment_list', 'closure_notes',
      'permit_valid_until', 'entry_supervisor_name', 'attendant_name', 'known_hazards',
      'hazard_controls', 'rescue_procedure', 'notes', 'permit_pdf_url',
    ];
    for (const field of allowed) {
      if (body[field] === undefined) continue;
      patch[field] = body[field];
    }
    if (patch.atmospheric_readings !== undefined) patch.atmospheric_readings = normalizeReadings(patch.atmospheric_readings);
    if (patch.authorized_entrants !== undefined) patch.authorized_entrants = Array.isArray(patch.authorized_entrants) ? patch.authorized_entrants : [];
    if (patch.known_hazards !== undefined) patch.known_hazards = asArray(patch.known_hazards);
    if (patch.rescue_equipment_on_site !== undefined) patch.rescue_equipment_on_site = asBoolean(patch.rescue_equipment_on_site, false);

    if (patch.status === 'open') {
      if (!Array.isArray(patch.atmospheric_readings) || !patch.atmospheric_readings.length) {
        return respond(400, { error: 'At least one atmospheric reading is required before opening the permit' });
      }
      const failures = atmosphereFailures(patch);
      if (failures.length) {
        return respond(400, { error: `Atmosphere not acceptable for entry: ${failures.join(', ')}` });
      }
      patch.permit_issued_at = new Date().toISOString();
    }

    if (patch.status === 'closed') {
      patch.permit_closed_at = new Date().toISOString();
      patch.closed_by_member_id = clean(body.closed_by_member_id) || null;
    }

    patch.updated_at = new Date().toISOString();
    const { data, error } = await adminSb
      .from('confined_space_permits')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Confined space permit not found' });
    return respond(200, { ok: true, permit: data });
  }

  return respond(405, { error: 'Method not allowed' });
};
