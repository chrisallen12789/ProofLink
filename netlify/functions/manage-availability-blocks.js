// netlify/functions/manage-availability-blocks.js
// Operator-authenticated — CRUD for availability_blocks (seasonal pauses, date blocking).
// GET /                    → list blocks for tenant
// POST { ... }            → create block
// DELETE /?id=<uuid>      → delete block

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
      .from('availability_blocks')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: true });

    if (params.operator_id) q = q.eq('operator_id', params.operator_id);

    const { data, error } = await q;
    if (error) return respond(500, { error: error.message });
    return respond(200, { blocks: data || [] });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { title, starts_at, ends_at, operator_id, all_day, block_bookings } = body;
    if (!starts_at || !ends_at) return respond(400, { error: 'starts_at and ends_at are required' });
    if (starts_at > ends_at) return respond(400, { error: 'starts_at must be before ends_at' });

    const { data, error } = await adminSb.from('availability_blocks').insert({
      tenant_id    : tenantId,
      title        : title || null,
      starts_at,
      ends_at,
      operator_id  : operator_id || null,
      all_day      : all_day !== false,
      block_bookings: block_bookings !== false,
    }).select().single();

    if (error) return respond(500, { error: error.message });
    return respond(201, { block: data });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const id = params.id;
    if (!id) return respond(400, { error: 'id is required' });

    const { error } = await adminSb
      .from('availability_blocks')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return respond(500, { error: error.message });
    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};

/**
 * Helper: check if a date falls within any blocking availability_block.
 * Returns the first matching block or null.
 */
async function checkAvailabilityBlock(supabase, tenantId, dateStr) {
  const { data } = await supabase
    .from('availability_blocks')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('block_bookings', true)
    .lte('starts_at', dateStr)
    .gte('ends_at', dateStr)
    .limit(1);
  return (data && data.length > 0) ? data[0] : null;
}

module.exports.checkAvailabilityBlock = checkAvailabilityBlock;
