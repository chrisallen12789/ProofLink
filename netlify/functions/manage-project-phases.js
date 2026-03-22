// netlify/functions/manage-project-phases.js
// Manages project phases for orders.
// GET /?order_id=<uuid>   → list phases for an order
// POST { order_id, title, description?, phase_number?, amount_cents?, due_date? } → create phase
// PATCH { id, status?, title?, amount_cents?, due_date?, completed_at? } → update phase
// DELETE /?id=<uuid>      → delete phase (only if status=pending)
// All require operator auth. Scoped to tenant.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

const PATCH_ALLOWED = ['status', 'title', 'description', 'amount_cents', 'due_date', 'completed_at'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;
  const params = event.queryStringParameters || {};

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { order_id } = params;
    if (!order_id) return respond(400, { error: 'order_id query param is required' });

    const { data: phases, error } = await supabase
      .from('project_phases')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('order_id', order_id)
      .order('phase_number');

    if (error) {
      console.error('[manage-project-phases] GET', error);
      return respond(500, { error: 'Failed to fetch phases' });
    }

    return respond(200, { phases: phases || [] });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { order_id, title, description, phase_number, amount_cents, due_date } = body;
    if (!order_id) return respond(400, { error: 'order_id is required' });
    if (!title)    return respond(400, { error: 'title is required' });

    const record = {
      tenant_id   : tenantId,
      order_id,
      title       : String(title).trim(),
      description : description ? String(description).trim() : null,
      phase_number: phase_number != null ? parseInt(phase_number, 10) : null,
      amount_cents: amount_cents != null ? parseInt(amount_cents, 10) : null,
      due_date    : due_date || null,
      status      : 'pending',
      created_at  : new Date().toISOString(),
    };

    const { data: phase, error } = await supabase
      .from('project_phases')
      .insert(record)
      .select()
      .single();

    if (error) {
      console.error('[manage-project-phases] POST', error);
      return respond(500, { error: 'Failed to create phase' });
    }

    return respond(201, { phase });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { id, ...rest } = body;
    if (!id) return respond(400, { error: 'id is required' });

    const patch = {};
    PATCH_ALLOWED.forEach((f) => { if (rest[f] !== undefined) patch[f] = rest[f]; });
    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
    patch.updated_at = new Date().toISOString();

    const { data: phase, error } = await supabase
      .from('project_phases')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[manage-project-phases] PATCH', error);
      return respond(500, { error: 'Failed to update phase' });
    }
    if (!phase) return respond(404, { error: 'Phase not found or access denied' });

    return respond(200, { phase });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id } = params;
    if (!id) return respond(400, { error: 'id query param is required' });

    // Only allow deletion when status is pending
    const { data: existing, error: fetchErr } = await supabase
      .from('project_phases')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (fetchErr) {
      console.error('[manage-project-phases] DELETE fetch', fetchErr);
      return respond(500, { error: 'Failed to fetch phase' });
    }
    if (!existing) return respond(404, { error: 'Phase not found or access denied' });
    if (existing.status !== 'pending') {
      return respond(409, { error: 'Only pending phases can be deleted' });
    }

    const { error: deleteErr } = await supabase
      .from('project_phases')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (deleteErr) {
      console.error('[manage-project-phases] DELETE', deleteErr);
      return respond(500, { error: 'Failed to delete phase' });
    }

    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
