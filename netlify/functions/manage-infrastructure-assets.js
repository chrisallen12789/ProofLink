'use strict';

const { respond } = require('./utils/auth');
const { asArray, asBoolean, clean, parseJsonBody, requireHydrovacOperatorContext } = require('./utils/hydrovac');

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
    const id = clean(params.id);
    if (id) {
      const { data: asset, error: assetError } = await adminSb
        .from('infrastructure_assets')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle();

      if (assetError) return respond(500, { error: assetError.message });
      if (!asset) return respond(404, { error: 'Asset not found' });

      const { data: jobs, error: jobsError } = await adminSb
        .from('jobs')
        .select('id, title, status, scheduled_date, completed_at, total_loads_hauled, total_gallons_hauled')
        .eq('tenant_id', tenantId)
        .eq('asset_id', id)
        .order('completed_at', { ascending: false })
        .limit(10);

      if (jobsError) return respond(500, { error: jobsError.message });
      return respond(200, { asset, recent_jobs: jobs || [] });
    }

    let query = adminSb
      .from('infrastructure_assets')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('next_service_due_date', { ascending: true, nullsFirst: false });

    if (clean(params.customer_id)) query = query.eq('customer_id', clean(params.customer_id));
    if (clean(params.asset_type)) query = query.eq('asset_type', clean(params.asset_type));
    if (params.needs_service === 'true') {
      const dueDate = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      query = query.lte('next_service_due_date', dueDate).neq('status', 'decommissioned');
    }

    const { data, error } = await query;
    if (error) return respond(500, { error: error.message });
    return respond(200, { assets: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const assetType = clean(body.asset_type);
    if (!assetType) return respond(400, { error: 'asset_type is required' });

    const record = {
      tenant_id: tenantId,
      customer_id: clean(body.customer_id) || null,
      asset_type: assetType,
      asset_name: clean(body.asset_name) || null,
      external_asset_id: clean(body.external_asset_id) || null,
      status: clean(body.status || 'active') || 'active',
      address: clean(body.address) || null,
      city: clean(body.city) || null,
      lat: body.lat != null ? Number(body.lat) : null,
      lng: body.lng != null ? Number(body.lng) : null,
      location_description: clean(body.location_description) || null,
      gis_feature_id: clean(body.gis_feature_id) || null,
      grid_reference: clean(body.grid_reference) || null,
      diameter_inches: body.diameter_inches != null ? Number(body.diameter_inches) : null,
      depth_ft: body.depth_ft != null ? Number(body.depth_ft) : null,
      capacity_gallons: body.capacity_gallons != null ? Number(body.capacity_gallons) : null,
      material: clean(body.material) || null,
      invert_elevation_ft: body.invert_elevation_ft != null ? Number(body.invert_elevation_ft) : null,
      rim_elevation_ft: body.rim_elevation_ft != null ? Number(body.rim_elevation_ft) : null,
      service_frequency_days: body.service_frequency_days != null ? Number(body.service_frequency_days) : null,
      next_service_due_date: clean(body.next_service_due_date) || null,
      service_contract_id: clean(body.service_contract_id) || null,
      last_condition_rating: clean(body.last_condition_rating) || null,
      last_condition_date: clean(body.last_condition_date) || null,
      condition_notes: clean(body.condition_notes) || null,
      has_defects: asBoolean(body.has_defects, false),
      defect_codes: asArray(body.defect_codes),
      notes: clean(body.notes) || null,
      photos: Array.isArray(body.photos) ? body.photos : [],
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    };

    const { data, error } = await adminSb
      .from('infrastructure_assets')
      .insert(record)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    return respond(201, { ok: true, asset: data });
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
      'status', 'asset_name', 'external_asset_id', 'address', 'city', 'lat', 'lng',
      'location_description', 'gis_feature_id', 'grid_reference', 'diameter_inches', 'depth_ft',
      'capacity_gallons', 'material', 'invert_elevation_ft', 'rim_elevation_ft',
      'service_frequency_days', 'next_service_due_date', 'service_contract_id',
      'last_condition_rating', 'last_condition_date', 'condition_notes', 'has_defects',
      'defect_codes', 'notes', 'photos', 'metadata', 'customer_id',
    ];
    for (const field of allowed) {
      if (body[field] !== undefined) patch[field] = body[field];
    }
    if (patch.defect_codes !== undefined) patch.defect_codes = asArray(patch.defect_codes);
    if (patch.has_defects !== undefined) patch.has_defects = asBoolean(patch.has_defects, false);

    const { data, error } = await adminSb
      .from('infrastructure_assets')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Asset not found' });
    return respond(200, { ok: true, asset: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = clean(params.id);
    if (!id) return respond(400, { error: 'id is required' });

    const { data, error } = await adminSb
      .from('infrastructure_assets')
      .update({ status: 'decommissioned' })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Asset not found' });
    return respond(200, { ok: true, asset: data });
  }

  return respond(405, { error: 'Method not allowed' });
};
