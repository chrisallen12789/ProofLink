'use strict';

const { respond } = require('./utils/auth');
const { asBoolean, asMoneyCents, asNumber, clean, parseJsonBody, requireHydrovacOperatorContext } = require('./utils/hydrovac');

function lineTotalCents(item) {
  if (item.total_cents != null) return asMoneyCents(item.total_cents, 0);
  return Math.round(asNumber(item.quantity, 0) * asMoneyCents(item.unit_price_cents ?? item.unitPriceCents, 0));
}

function normalizeExistingLineItem(item) {
  return {
    kind: clean(item.kind || item.line_type || 'other') || 'other',
    name: clean(item.name || item.description || 'Line item') || 'Line item',
    description: clean(item.description || item.notes || '') || null,
    quantity: asNumber(item.quantity ?? item.qty, 1),
    unit: clean(item.unit || 'each') || 'each',
    unit_price_cents: asMoneyCents(item.unit_price_cents ?? item.unitPriceCents, 0),
    total_cents: lineTotalCents(item),
    is_optional: item.is_optional === true || item.isOptional === true,
    is_taxable: item.is_taxable === true || item.isTaxable === true,
    notes: clean(item.notes || '') || null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireHydrovacOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { tenantId, adminSb, hydrovacSettings } = ctx;

  let body;
  try {
    body = parseJsonBody(event);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const jobId = clean(body.job_id);
  if (!jobId) return respond(400, { error: 'job_id is required' });

  const includeTimeSegments = asBoolean(body.include_time_segments, true);
  const includeManifests = asBoolean(body.include_manifests, true);
  const includeMaterials = asBoolean(body.include_materials, true);

  const { data: job, error: jobError } = await adminSb
    .from('jobs')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', jobId)
    .maybeSingle();

  if (jobError) return respond(500, { error: jobError.message });
  if (!job) return respond(404, { error: 'Job not found' });

  const orderId = clean(job.order_id);
  if (!orderId) return respond(409, { error: 'Job is not linked to an order' });

  const { data: order, error: orderError } = await adminSb
    .from('orders')
    .select('id, tenant_id, items, subtotal_cents, total_cents, amount_paid_cents, amount_due_cents, notes')
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle();

  if (orderError) return respond(500, { error: orderError.message });
  if (!order) return respond(404, { error: 'Order not found' });

  const lineItems = [];

  if (asMoneyCents(job.mobilization_charge_cents ?? job.mobilization_fee_cents, 0) > 0) {
    lineItems.push({
      kind: 'mobilization',
      name: 'Mobilization',
      description: 'Truck mobilization and arrival charge.',
      quantity: 1,
      unit: 'each',
      unit_price_cents: asMoneyCents(job.mobilization_charge_cents ?? job.mobilization_fee_cents, 0),
      total_cents: asMoneyCents(job.mobilization_charge_cents ?? job.mobilization_fee_cents, 0),
      is_optional: false,
      is_taxable: false,
      notes: null,
    });
  }

  if (includeTimeSegments) {
    const { data: segments, error: segmentError } = await adminSb
      .from('job_time_segments')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('job_id', jobId)
      .eq('is_billable', true);

    if (segmentError) return respond(500, { error: segmentError.message });

    const grouped = new Map();
    for (const segment of segments || []) {
      const key = clean(segment.segment_type || 'other') || 'other';
      const entry = grouped.get(key) || { minutes: 0, amount: 0 };
      entry.minutes += asNumber(segment.duration_minutes, 0);
      if (segment.amount_cents != null) {
        entry.amount += asMoneyCents(segment.amount_cents, 0);
      } else if (segment.rate_cents_per_hour != null) {
        entry.amount += Math.round((asNumber(segment.duration_minutes, 0) / 60) * asMoneyCents(segment.rate_cents_per_hour, 0));
      }
      grouped.set(key, entry);
    }

    const labelMap = {
      on_site_work: 'Hydrovac Services - On Site',
      travel_to_site: 'Travel Time (Portal-to-Portal)',
      travel_return: 'Travel Time (Portal-to-Portal)',
      standby: 'Standby',
      dump_run_travel: 'Dump Run Travel',
      dump_run_wait: 'Dump Run Wait',
    };

    for (const [segmentType, entry] of grouped.entries()) {
      if (!entry.minutes) continue;
      lineItems.push({
        kind: segmentType === 'standby' ? 'standby' : 'hourly_labor',
        name: labelMap[segmentType] || segmentType.replace(/_/g, ' '),
        description: `${entry.minutes} billed minutes`,
        quantity: Number((entry.minutes / 60).toFixed(2)),
        unit: 'hours',
        unit_price_cents: entry.minutes ? Math.round(entry.amount / (entry.minutes / 60 || 1)) : 0,
        total_cents: entry.amount,
        is_optional: false,
        is_taxable: false,
        notes: null,
      });
    }
  }

  if (includeManifests) {
    const { data: manifests, error: manifestError } = await adminSb
      .from('waste_manifests')
      .select('id, manifest_number, material_type, disposal_charge_cents, status, is_billable, invoiced')
      .eq('tenant_id', tenantId)
      .eq('job_id', jobId)
      .eq('is_billable', true)
      .eq('invoiced', false)
      .eq('status', 'confirmed');

    if (manifestError) return respond(500, { error: manifestError.message });

    for (const manifest of manifests || []) {
      lineItems.push({
        kind: 'disposal_per_load',
        name: `Waste Disposal - ${manifest.material_type} - Manifest #${manifest.manifest_number || manifest.id}`,
        description: 'Confirmed disposal charge from licensed facility.',
        quantity: 1,
        unit: 'load',
        unit_price_cents: asMoneyCents(manifest.disposal_charge_cents, 0),
        total_cents: asMoneyCents(manifest.disposal_charge_cents, 0),
        is_optional: false,
        is_taxable: false,
        notes: null,
        _manifest_id: manifest.id,
      });
    }
  }

  if (asMoneyCents(job.water_charge_cents, 0) > 0) {
    lineItems.push({
      kind: 'water_usage',
      name: `Water Usage - ${asNumber(job.water_usage_gallons, 0)} gal`,
      description: 'Water used during hydrovac service.',
      quantity: asNumber(job.water_usage_gallons, 0),
      unit: 'gallons',
      unit_price_cents: asNumber(job.water_usage_gallons, 0) > 0 ? Math.round(asMoneyCents(job.water_charge_cents, 0) / asNumber(job.water_usage_gallons, 1)) : asMoneyCents(job.water_charge_cents, 0),
      total_cents: asMoneyCents(job.water_charge_cents, 0),
      is_optional: false,
      is_taxable: false,
      notes: null,
    });
  }

  if (includeMaterials) {
    try {
      const { data: inventoryUsage, error: inventoryError } = await adminSb
        .from('inventory_usage')
        .select('quantity, amount_cents, notes')
        .eq('tenant_id', tenantId)
        .eq('order_id', orderId);

      if (!inventoryError) {
        for (const item of inventoryUsage || []) {
          lineItems.push({
            kind: 'material',
            name: 'Materials / parts',
            description: clean(item.notes) || 'Inventory usage',
            quantity: asNumber(item.quantity, 1),
            unit: 'each',
            unit_price_cents: asNumber(item.quantity, 0) > 0 ? Math.round(asMoneyCents(item.amount_cents, 0) / asNumber(item.quantity, 1)) : asMoneyCents(item.amount_cents, 0),
            total_cents: asMoneyCents(item.amount_cents, 0),
            is_optional: false,
            is_taxable: false,
            notes: null,
          });
        }
      }
    } catch (inventoryUsageError) {
      console.warn('[generate-hydrovac-invoice] inventory usage lookup skipped:', inventoryUsageError.message || inventoryUsageError);
    }
  }

  const existingOrderItems = Array.isArray(order.items) ? order.items : [];
  const mergedLineItems = [
    ...existingOrderItems.map(normalizeExistingLineItem),
    ...lineItems.map((item) => ({
      kind: item.kind,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price_cents: item.unit_price_cents,
      total_cents: item.total_cents,
      is_optional: item.is_optional,
      is_taxable: item.is_taxable,
      notes: item.notes,
      source: 'hydrovac_invoice',
    })),
  ];

  const subtotalCents = mergedLineItems.reduce((sum, item) => sum + asMoneyCents(item.total_cents, 0), 0);
  const amountPaidCents = asMoneyCents(order.amount_paid_cents, 0);
  const totalCents = subtotalCents;
  const amountDueCents = Math.max(0, totalCents - amountPaidCents);

  const { data: updatedOrder, error: updateError } = await adminSb
    .from('orders')
    .update({
      items: mergedLineItems,
      subtotal_cents: subtotalCents,
      total_cents: totalCents,
      estimated_total_cents: totalCents,
      amount_due_cents: amountDueCents,
      payment_state: amountDueCents <= 0 ? 'paid' : (amountPaidCents > 0 ? 'partially_paid' : 'unpaid'),
      notes: clean(order.notes || job.notes || '') || null,
    })
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .select()
    .maybeSingle();

  if (updateError) return respond(500, { error: updateError.message });

  const manifestIds = lineItems.filter((item) => item._manifest_id).map((item) => item._manifest_id);
  if (manifestIds.length) {
    const invoiceId = updatedOrder?.id || orderId;
    const nextManifestStatus = clean(hydrovacSettings?.default_billing_method) === 'hourly_plus_disposal' ? 'invoiced' : 'confirmed';
    const manifestPatch = {
      invoiced: true,
      invoice_id: invoiceId,
    };
    if (nextManifestStatus === 'invoiced') manifestPatch.status = 'invoiced';
    const { error: manifestUpdateError } = await adminSb
      .from('waste_manifests')
      .update(manifestPatch)
      .eq('tenant_id', tenantId)
      .in('id', manifestIds);

    if (manifestUpdateError) {
      console.warn('[generate-hydrovac-invoice] manifest invoice sync failed:', manifestUpdateError.message || manifestUpdateError);
    }
  }

  return respond(200, {
    ok: true,
    order: updatedOrder,
    line_items: mergedLineItems,
    subtotal_cents: subtotalCents,
    total_cents: totalCents,
    amount_due_cents: amountDueCents,
  });
};
