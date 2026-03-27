// netlify/functions/manage-service-contracts.js
// Operator-authenticated — CRUD for service_contracts (warranties, maintenance plans).
// GET /?customer_id=<uuid>   → list contracts for a customer
// GET /?order_id=<uuid>      → list contracts for an order
// POST { ... }               → create contract
// PATCH { id, ... }          → update contract
// DELETE /?id=<uuid>         → delete contract

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
    let q = adminSb
      .from('service_contracts')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('expires_at', { ascending: true });

    if (params.customer_id) q = q.eq('customer_id', params.customer_id);
    if (params.order_id)    q = q.eq('order_id', params.order_id);

    const { data, error } = await q;
    if (error) return respond(500, { error: error.message });
    return respond(200, { contracts: data || [] });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { customer_id, order_id, title, contract_type, starts_at, expires_at, terms, reminder_days } = body;
    if (!title) return respond(400, { error: 'title is required' });

    const { data, error } = await adminSb.from('service_contracts').insert({
      tenant_id    : tenantId,
      customer_id  : customer_id || null,
      order_id     : order_id || null,
      title        : String(title).slice(0, 200),
      contract_type: contract_type || 'warranty',
      starts_at    : starts_at || null,
      expires_at   : expires_at || null,
      terms        : terms || null,
      reminder_days: reminder_days != null ? Number(reminder_days) : 30,
    }).select().maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(500, { error: 'Failed to create contract: no record returned' });
    return respond(201, { contract: data });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { id, ...fields } = body;
    if (!id) return respond(400, { error: 'id is required' });

    const ALLOWED = ['title', 'contract_type', 'starts_at', 'expires_at', 'terms', 'reminder_days', 'notified_at', 'customer_id', 'order_id'];
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([k]) => ALLOWED.includes(k))
    );
    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await adminSb
      .from('service_contracts')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select().maybeSingle();

    if (error) return respond(500, { error: error.message });
    if (!data) return respond(404, { error: 'Contract not found or access denied' });
    return respond(200, { contract: data });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = params.id;
    if (!id) return respond(400, { error: 'id is required' });

    const { error } = await adminSb
      .from('service_contracts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return respond(500, { error: error.message });
    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
