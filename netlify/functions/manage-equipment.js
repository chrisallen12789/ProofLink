// netlify/functions/manage-equipment.js
// Operator-authenticated — CRUD for equipment (hydrovac/vactor units).
// GET /              → list active equipment for tenant (filter by ?type=)
// POST { ... }       → create equipment
// PATCH { id, ... }  → update equipment
// DELETE /?id=       → soft delete (is_active = false)

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId, operatorId } = ctx;
  const adminSb = getAdminClient();
  const params = event.queryStringParameters || {};

  // ── GET ───────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    let query = adminSb
      .from('equipment')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (params.type) {
      query = query.eq('equipment_type', params.type);
    }

    const { data, error } = await query;

    if (error) return respond(500, { error: error.message });
    return respond(200, { equipment: data || [] });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { name, equipment_type, unit_number, make, model, year, status, hourly_rate_cents, notes } = body;

    if (!name)           return respond(400, { error: 'name is required' });
    if (!equipment_type) return respond(400, { error: 'equipment_type is required' });

    const { data, error } = await adminSb.from('equipment').insert({
      tenant_id         : tenantId,
      operator_id       : operatorId,
      name              : String(name).slice(0, 100),
      equipment_type    : equipment_type,
      unit_number       : unit_number   || null,
      make              : make          || null,
      model             : model         || null,
      year              : year          || null,
      status            : status        || 'active',
      hourly_rate_cents : hourly_rate_cents != null ? Number(hourly_rate_cents) : 0,
      notes             : notes         || null,
    }).select().single();

    if (error) return respond(500, { error: error.message });
    return respond(201, { item: data });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { id, ...fields } = body;
    if (!id) return respond(400, { error: 'id is required' });

    const ALLOWED = [
      'name', 'unit_number', 'make', 'model', 'year',
      'equipment_type', 'status', 'hourly_rate_cents', 'notes', 'is_active',
    ];
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
    );
    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });

    const { data, error } = await adminSb
      .from('equipment')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select().single();

    if (error) return respond(500, { error: error.message });
    return respond(200, { item: data });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = params.id;
    if (!id) return respond(400, { error: 'id is required' });

    const { data, error } = await adminSb
      .from('equipment')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select().single();

    if (error) return respond(500, { error: error.message });
    return respond(200, { item: data });
  }

  return respond(405, { error: 'Method not allowed' });
};
