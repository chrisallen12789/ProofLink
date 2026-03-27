'use strict';

const { respond } = require('./utils/auth');
const {
  asMoneyCents,
  asNumber,
  clean,
  parseJsonBody,
  requireHydrovacOperatorContext,
  startOfUtcDay,
  endOfUtcDay,
  toIsoOrNull,
} = require('./utils/hydrovac');
const { manifestConfirmationIssues, logComplianceAlerts, resolveComplianceAlerts } = require('./lib/hydrovac-compliance');

async function nextManifestNumber(adminSb, tenantId, prefix) {
  const today = new Date();
  const start = startOfUtcDay(today).toISOString();
  const end = endOfUtcDay(today).toISOString();
  const yyyymmdd = start.slice(0, 10).replace(/-/g, '');

  const { count, error } = await adminSb
    .from('waste_manifests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', start)
    .lt('created_at', end);

  if (error) throw error;
  return `${clean(prefix || 'HV') || 'HV'}-${yyyymmdd}-${String((count || 0) + 1).padStart(4, '0')}`;
}

async function getFacilitySnapshot(adminSb, tenantId, facilityId) {
  if (!facilityId) return null;
  const { data, error } = await adminSb
    .from('disposal_facilities')
    .select('id, name, permit_number')
    .eq('tenant_id', tenantId)
    .eq('id', facilityId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function syncJobManifestTotals(adminSb, tenantId, jobId) {
  if (!jobId) return;
  const { data, error } = await adminSb
    .from('waste_manifests')
    .select('id, quantity_unit, quantity_estimated, quantity_actual, disposal_cost_cents, disposal_charge_cents, status')
    .eq('tenant_id', tenantId)
    .eq('job_id', jobId)
    .neq('status', 'void');

  if (error) throw error;

  const manifests = Array.isArray(data) ? data : [];
  let totalLoads = 0;
  let totalGallons = 0;
  let totalYards = 0;
  let totalCost = 0;
  let totalCharge = 0;

  for (const row of manifests) {
    totalLoads += 1;
    const qty = asNumber(row.quantity_actual, asNumber(row.quantity_estimated, 0));
    if (row.quantity_unit === 'gallons') totalGallons += qty;
    if (row.quantity_unit === 'cubic_yards') totalYards += qty;
    totalCost += asMoneyCents(row.disposal_cost_cents, 0);
    totalCharge += asMoneyCents(row.disposal_charge_cents, 0);
  }

  const { error: updateError } = await adminSb
    .from('jobs')
    .update({
      total_loads_hauled: totalLoads,
      total_gallons_hauled: Number(totalGallons.toFixed(2)),
      total_yards_hauled: Number(totalYards.toFixed(2)),
      total_disposal_cost_cents: totalCost,
      total_disposal_charge_cents: totalCharge,
      manifest_ids: manifests.map((row) => row.id),
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', jobId);

  if (updateError) throw updateError;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try {
    ctx = await requireHydrovacOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId, adminSb, hydrovacSettings } = ctx;
  const params = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (params.action === 'unbilled') {
      const days = Math.min(365, Math.max(1, parseInt(params.days, 10) || 30));
      const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
      const { data, error } = await adminSb
        .from('waste_manifests')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_billable', true)
        .eq('invoiced', false)
        .eq('status', 'confirmed')
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      if (error) return respond(500, { error: error.message });
      return respond(200, { manifests: data || [] });
    }

    if (params.action === 'all' || (!clean(params.job_id) && !clean(params.status))) {
      let query = adminSb
        .from('waste_manifests')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (clean(params.status)) query = query.eq('status', clean(params.status));
      if (clean(params.facility_id)) query = query.eq('disposal_facility_id', clean(params.facility_id));
      if (clean(params.customer_id)) query = query.eq('customer_id', clean(params.customer_id));
      const limit = Math.min(250, Math.max(1, parseInt(params.limit, 10) || 100));
      query = query.limit(limit);

      const { data, error } = await query;
      if (error) return respond(500, { error: error.message });
      return respond(200, { manifests: data || [] });
    }

    const jobId = clean(params.job_id);
    if (!jobId) return respond(400, { error: 'job_id is required' });

    let query = adminSb
      .from('waste_manifests')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (clean(params.status)) query = query.eq('status', clean(params.status));

    const { data, error } = await query;

    if (error) return respond(500, { error: error.message });
    return respond(200, { manifests: data || [] });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = parseJsonBody(event);
    } catch {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const jobId = clean(body.job_id);
    const manifestType = clean(body.manifest_type || 'non_hazardous') || 'non_hazardous';
    const materialType = clean(body.material_type);
    const quantityUnit = clean(body.quantity_unit || 'gallons') || 'gallons';
    const pickupAddress = clean(body.pickup_address);

    if (!jobId) return respond(400, { error: 'job_id is required' });
    if (!materialType) return respond(400, { error: 'material_type is required' });
    if (!pickupAddress) return respond(400, { error: 'pickup_address is required' });

    if ((manifestType === 'hazardous' || manifestType === 'rcra') && (!clean(body.generator_epa_id) || !clean(body.un_number))) {
      return respond(400, { error: 'Hazardous and RCRA manifests require generator_epa_id and un_number' });
    }

    const { data: job, error: jobError } = await adminSb
      .from('jobs')
      .select('id, tenant_id, order_id, customer_id, assigned_truck_id, assigned_member_id')
      .eq('tenant_id', tenantId)
      .eq('id', jobId)
      .maybeSingle();

    if (jobError) return respond(500, { error: jobError.message });
    if (!job) return respond(404, { error: 'Job not found' });

    let disposalCharge = asMoneyCents(body.disposal_charge_cents, 0);
    const disposalCost = asMoneyCents(body.disposal_cost_cents, 0);
    if (!disposalCharge && disposalCost > 0) {
      const markup = Number(hydrovacSettings?.default_disposal_markup_percent || 15);
      disposalCharge = Math.round(disposalCost * (1 + (markup / 100)));
    }

    let facility = null;
    try {
      facility = await getFacilitySnapshot(adminSb, tenantId, clean(body.disposal_facility_id));
    } catch (facilityError) {
      return respond(500, { error: facilityError.message });
    }

    let manifestNumber = clean(body.manifest_number);
    if (!manifestNumber) {
      try {
        manifestNumber = await nextManifestNumber(adminSb, tenantId, hydrovacSettings?.manifest_prefix || 'HV');
      } catch (numberError) {
        return respond(500, { error: numberError.message });
      }
    }

    const record = {
      tenant_id: tenantId,
      job_id: job.id,
      order_id: clean(body.order_id) || job.order_id || null,
      customer_id: clean(body.customer_id) || job.customer_id || null,
      truck_id: clean(body.truck_id) || job.assigned_truck_id || null,
      driver_member_id: clean(body.driver_member_id) || job.assigned_member_id || null,
      manifest_number: manifestNumber,
      external_manifest_number: clean(body.external_manifest_number) || null,
      manifest_type: manifestType,
      material_type: materialType,
      material_description: clean(body.material_description) || null,
      waste_profile_number: clean(body.waste_profile_number) || null,
      un_number: clean(body.un_number) || null,
      hazard_class: clean(body.hazard_class) || null,
      quantity_unit: quantityUnit,
      quantity_estimated: asNumber(body.quantity_estimated, null),
      quantity_actual: asNumber(body.quantity_actual, null),
      tare_weight_lbs: asNumber(body.tare_weight_lbs, null),
      gross_weight_lbs: asNumber(body.gross_weight_lbs, null),
      pickup_address: pickupAddress,
      pickup_lat: asNumber(body.pickup_lat, null),
      pickup_lng: asNumber(body.pickup_lng, null),
      generator_name: clean(body.generator_name) || null,
      generator_epa_id: clean(body.generator_epa_id) || null,
      departed_site_at: toIsoOrNull(body.departed_site_at),
      arrived_facility_at: toIsoOrNull(body.arrived_facility_at),
      portal_to_portal_minutes: null,
      disposal_facility_id: facility?.id || clean(body.disposal_facility_id) || null,
      disposal_facility_name: clean(body.disposal_facility_name) || facility?.name || null,
      disposal_facility_permit: clean(body.disposal_facility_permit) || facility?.permit_number || null,
      disposal_method: clean(body.disposal_method) || null,
      disposal_confirmed_at: toIsoOrNull(body.disposal_confirmed_at),
      disposal_ticket_number: clean(body.disposal_ticket_number) || null,
      disposal_cost_cents: disposalCost,
      disposal_charge_cents: disposalCharge,
      is_billable: body.is_billable !== false,
      invoiced: body.invoiced === true,
      invoice_id: clean(body.invoice_id) || null,
      driver_signature_url: clean(body.driver_signature_url) || null,
      facility_signature_url: clean(body.facility_signature_url) || null,
      manifest_pdf_url: clean(body.manifest_pdf_url) || null,
      state_copy_submitted: body.state_copy_submitted === true,
      state_submission_date: clean(body.state_submission_date) || null,
      status: clean(body.status || 'in_transit') || 'in_transit',
      notes: clean(body.notes) || null,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    };

    if (record.departed_site_at && record.arrived_facility_at) {
      const start = Date.parse(record.departed_site_at);
      const end = Date.parse(record.arrived_facility_at);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        record.portal_to_portal_minutes = Math.round((end - start) / 60000);
      }
    }

    const { data, error } = await adminSb
      .from('waste_manifests')
      .insert(record)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });

    try {
      await syncJobManifestTotals(adminSb, tenantId, job.id);
    } catch (syncError) {
      console.warn('[manage-waste-manifests] rollup sync failed:', syncError.message || syncError);
    }

    return respond(201, { ok: true, manifest: data });
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

    const { data: existing, error: existingError } = await adminSb
      .from('waste_manifests')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();

    if (existingError) return respond(500, { error: existingError.message });
    if (!existing) return respond(404, { error: 'Manifest not found' });

    const patch = {};
    const fields = [
      'status', 'external_manifest_number', 'material_description', 'waste_profile_number',
      'un_number', 'hazard_class', 'quantity_estimated', 'quantity_actual', 'tare_weight_lbs',
      'gross_weight_lbs', 'pickup_address', 'pickup_lat', 'pickup_lng', 'generator_name',
      'generator_epa_id', 'disposal_method', 'disposal_ticket_number', 'disposal_cost_cents',
      'disposal_charge_cents', 'is_billable', 'invoiced', 'invoice_id', 'driver_signature_url',
      'facility_signature_url', 'manifest_pdf_url', 'state_copy_submitted', 'state_submission_date',
      'notes', 'metadata', 'arrived_facility_at', 'departed_site_at', 'disposal_confirmed_at',
    ];
    for (const field of fields) {
      if (body[field] !== undefined) patch[field] = body[field];
    }

    if (patch.arrived_facility_at !== undefined) patch.arrived_facility_at = toIsoOrNull(patch.arrived_facility_at);
    if (patch.departed_site_at !== undefined) patch.departed_site_at = toIsoOrNull(patch.departed_site_at);
    if (patch.disposal_confirmed_at !== undefined) patch.disposal_confirmed_at = toIsoOrNull(patch.disposal_confirmed_at);
    if (patch.disposal_cost_cents !== undefined) patch.disposal_cost_cents = asMoneyCents(patch.disposal_cost_cents, 0);
    if (patch.disposal_charge_cents !== undefined) patch.disposal_charge_cents = asMoneyCents(patch.disposal_charge_cents, 0);
    if (patch.quantity_estimated !== undefined) patch.quantity_estimated = asNumber(patch.quantity_estimated, null);
    if (patch.quantity_actual !== undefined) patch.quantity_actual = asNumber(patch.quantity_actual, null);
    if (patch.tare_weight_lbs !== undefined) patch.tare_weight_lbs = asNumber(patch.tare_weight_lbs, null);
    if (patch.gross_weight_lbs !== undefined) patch.gross_weight_lbs = asNumber(patch.gross_weight_lbs, null);
    const nextManifest = { ...existing, ...patch };
    if (patch.status === 'confirmed') {
      const issues = manifestConfirmationIssues(nextManifest);
      if (issues.length) {
        await logComplianceAlerts(adminSb, tenantId, issues.map((message) => ({
          code: message.includes('facility') ? 'manifest_facility_missing'
            : message.includes('ticket') ? 'manifest_ticket_missing'
            : 'manifest_quantity_missing',
          message,
        })), {
          referenceType: 'manifest',
          referenceId: existing.id,
          actorLabel: ctx.email || 'operator',
        });
        return respond(409, { error: issues[0], issues });
      }
      if (!patch.disposal_confirmed_at) patch.disposal_confirmed_at = new Date().toISOString();
    }

    const departed = patch.departed_site_at || existing.departed_site_at;
    const arrived = patch.arrived_facility_at || existing.arrived_facility_at;
    if (departed && arrived) {
      const start = Date.parse(departed);
      const end = Date.parse(arrived);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        patch.portal_to_portal_minutes = Math.round((end - start) / 60000);
      }
    }

    patch.updated_at = new Date().toISOString();
    const { data, error } = await adminSb
      .from('waste_manifests')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return respond(500, { error: error.message });

    if ((patch.status || existing.status) === 'confirmed') {
      await resolveComplianceAlerts(adminSb, tenantId, {
        referenceType: 'manifest',
        referenceId: id,
        alertTypes: [
          'manifest_facility_missing',
          'manifest_ticket_missing',
          'manifest_quantity_missing',
        ],
      });
    }

    if ((patch.status || existing.status) === 'confirmed' && data?.is_billable) {
      try {
        const hours = Number(data.portal_to_portal_minutes || 0) / 60;
        await adminSb.from('inventory_usage').insert({
          tenant_id: tenantId,
          order_id: data.order_id || null,
          customer_id: data.customer_id || null,
          quantity: Math.max(1, Number(hours.toFixed(2)) || 1),
          notes: `Waste manifest ${data.manifest_number || data.id} confirmed`,
          metadata: { manifest_id: data.id, material_type: data.material_type },
        });
      } catch (inventoryError) {
        console.warn('[manage-waste-manifests] inventory usage side effect skipped:', inventoryError.message || inventoryError);
      }
    }

    try {
      await syncJobManifestTotals(adminSb, tenantId, data?.job_id || existing.job_id);
    } catch (syncError) {
      console.warn('[manage-waste-manifests] rollup sync failed:', syncError.message || syncError);
    }

    return respond(200, { ok: true, manifest: data });
  }

  if (event.httpMethod === 'DELETE') {
    const id = clean(params.id);
    if (!id) return respond(400, { error: 'id is required' });

    const { data: existing, error: existingError } = await adminSb
      .from('waste_manifests')
      .select('id, job_id, status')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();

    if (existingError) return respond(500, { error: existingError.message });
    if (!existing) return respond(404, { error: 'Manifest not found' });
    if (existing.status !== 'in_transit') {
      return respond(409, { error: 'Only in-transit manifests can be deleted' });
    }

    const { error } = await adminSb
      .from('waste_manifests')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) return respond(500, { error: error.message });

    try {
      await syncJobManifestTotals(adminSb, tenantId, existing.job_id);
    } catch (syncError) {
      console.warn('[manage-waste-manifests] rollup sync failed:', syncError.message || syncError);
    }

    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
