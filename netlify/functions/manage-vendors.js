// netlify/functions/manage-vendors.js
// Operator-authenticated — CRUD for vendor_contacts (subcontractors, suppliers).
// GET /              → list vendors
// POST { ... }      → create vendor
// PATCH { id, ... } → update vendor
// DELETE /?id=      → soft delete (is_active = false)

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId } = ctx;
  const adminSb = getAdminClient();
  const params = event.queryStringParameters || {};

  // ── GET ───────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const { data, error } = await adminSb
      .from('vendor_contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) return respond(500, { error: error.message });
    return respond(200, { vendors: data || [] });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { name, company, email, phone, trade, notes } = body;
    if (!name) return respond(400, { error: 'name is required' });

    const { data, error } = await adminSb.from('vendor_contacts').insert({
      tenant_id: tenantId,
      name: String(name).slice(0, 100),
      company  : company || null,
      email    : email || null,
      phone    : phone || null,
      trade    : trade || null,
      notes    : notes || null,
    }).select().single();

    if (error) return respond(500, { error: error.message });
    return respond(201, { vendor: data });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { id, ...fields } = body;
    if (!id) return respond(400, { error: 'id is required' });

    const ALLOWED = ['name', 'company', 'email', 'phone', 'trade', 'notes', 'is_active'];
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
    );
    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });

    const { data, error } = await adminSb
      .from('vendor_contacts')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select().single();

    if (error) return respond(500, { error: error.message });
    return respond(200, { vendor: data });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = params.id;
    if (!id) return respond(400, { error: 'id is required' });

    const { data, error } = await adminSb
      .from('vendor_contacts')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select().single();

    if (error) return respond(500, { error: error.message });
    return respond(200, { vendor: data });
  }

  return respond(405, { error: 'Method not allowed' });
};
