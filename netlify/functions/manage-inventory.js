// netlify/functions/manage-inventory.js
// Manages inventory items and usage logs for the authenticated operator's tenant.
//
// GET /?id=<uuid>                          → single item
// GET /                                    → list all active items (optional ?category=<text>)
// GET /?action=get_usage&order_id=<uuid>   → usage rows for an order with item names joined
// POST { name, sku?, description?, unit?, cost_cents?, price_cents?,
//        quantity_on_hand?, reorder_point?, category? }  → create item
// POST { action: 'log_usage', inventory_item_id, order_id?, booking_id?,
//        quantity_used, unit_cost_cents?, unit_price_cents?, notes? } → log usage
// PATCH { id, ...fields }                 → update any fields on an item
// DELETE /?id=<uuid>                      → soft delete (set is_active=false)
//
// All require operator auth. Scoped to tenant.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

const ITEM_PATCH_ALLOWED = [
  'name', 'sku', 'description', 'unit', 'cost_cents', 'price_cents',
  'quantity_on_hand', 'reorder_point', 'category', 'is_active',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId } = ctx;
  const params = event.queryStringParameters || {};

  // ── GET ──────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    // get_usage: returns usage rows for an order
    if (params.action === 'get_usage') {
      const { order_id } = params;
      if (!order_id) return respond(400, { error: 'order_id query param is required' });

      const { data: usage, error } = await supabase
        .from('inventory_usage')
        .select('*, inventory_items(name, sku, unit)')
        .eq('tenant_id', tenantId)
        .eq('order_id', order_id)
        .order('created_at');

      if (error) {
        console.error('[manage-inventory] GET get_usage', error);
        return respond(500, { error: 'Failed to fetch inventory usage' });
      }

      return respond(200, { usage: usage || [] });
    }

    // Single item by id
    if (params.id) {
      const { data: item, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('id', params.id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) {
        console.error('[manage-inventory] GET single', error);
        return respond(500, { error: 'Failed to fetch inventory item' });
      }
      if (!item) return respond(404, { error: 'Item not found or access denied' });

      return respond(200, { item });
    }

    // List all active items, optional category filter
    let query = supabase
      .from('inventory_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .neq('is_active', false)
      .order('name');

    if (params.category) {
      query = query.eq('category', params.category);
    }

    const { data: items, error } = await query;

    if (error) {
      console.error('[manage-inventory] GET list', error);
      return respond(500, { error: 'Failed to fetch inventory items' });
    }

    return respond(200, { items: items || [] });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    // log_usage action
    if (body.action === 'log_usage') {
      const {
        inventory_item_id,
        order_id,
        booking_id,
        quantity_used,
        unit_cost_cents,
        unit_price_cents,
        notes,
      } = body;

      if (!inventory_item_id) return respond(400, { error: 'inventory_item_id is required' });
      if (quantity_used == null) return respond(400, { error: 'quantity_used is required' });

      const qty = parseFloat(quantity_used);
      if (isNaN(qty) || qty <= 0) return respond(400, { error: 'quantity_used must be a positive number' });

      // Verify the item belongs to this tenant
      const { data: item, error: itemErr } = await supabase
        .from('inventory_items')
        .select('id, quantity_on_hand')
        .eq('id', inventory_item_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (itemErr) {
        console.error('[manage-inventory] POST log_usage item lookup', itemErr);
        return respond(500, { error: 'Failed to verify inventory item' });
      }
      if (!item) return respond(404, { error: 'Inventory item not found or access denied' });

      const usageRecord = {
        tenant_id        : tenantId,
        inventory_item_id,
        order_id         : order_id   || null,
        booking_id       : booking_id || null,
        quantity_used    : qty,
        unit_cost_cents  : unit_cost_cents  != null ? parseInt(unit_cost_cents, 10)  : null,
        unit_price_cents : unit_price_cents != null ? parseInt(unit_price_cents, 10) : null,
        notes            : notes ? String(notes).trim() : null,
        created_at       : new Date().toISOString(),
      };

      const { data: usageRow, error: usageErr } = await supabase
        .from('inventory_usage')
        .insert(usageRecord)
        .select()
        .single();

      if (usageErr) {
        console.error('[manage-inventory] POST log_usage insert', usageErr);
        return respond(500, { error: 'Failed to log inventory usage' });
      }

      // Decrement quantity_on_hand
      const currentQty = item.quantity_on_hand != null ? parseFloat(item.quantity_on_hand) : 0;
      const newQty = currentQty - qty;
      const { error: updateErr } = await supabase
        .from('inventory_items')
        .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
        .eq('id', inventory_item_id)
        .eq('tenant_id', tenantId);

      if (updateErr) {
        console.warn('[manage-inventory] POST log_usage qty update failed', updateErr);
      }

      return respond(201, { ok: true, usage: usageRow });
    }

    // Create inventory item
    const {
      name, sku, description, unit, cost_cents, price_cents,
      quantity_on_hand, reorder_point, category,
    } = body;

    if (!name) return respond(400, { error: 'name is required' });

    const record = {
      tenant_id       : tenantId,
      name            : String(name).trim(),
      sku             : sku         ? String(sku).trim()         : null,
      description     : description ? String(description).trim() : null,
      unit            : unit        ? String(unit).trim()        : null,
      cost_cents      : cost_cents        != null ? parseInt(cost_cents, 10)        : null,
      price_cents     : price_cents       != null ? parseInt(price_cents, 10)       : null,
      quantity_on_hand: quantity_on_hand  != null ? parseFloat(quantity_on_hand)    : null,
      reorder_point   : reorder_point     != null ? parseFloat(reorder_point)       : null,
      category        : category    ? String(category).trim()    : null,
      is_active       : true,
      created_at      : new Date().toISOString(),
    };

    const { data: item, error } = await supabase
      .from('inventory_items')
      .insert(record)
      .select()
      .single();

    if (error) {
      console.error('[manage-inventory] POST create', error);
      return respond(500, { error: 'Failed to create inventory item' });
    }

    return respond(201, { item });
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PATCH') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const { id, ...rest } = body;
    if (!id) return respond(400, { error: 'id is required' });

    const patch = {};
    ITEM_PATCH_ALLOWED.forEach((f) => { if (rest[f] !== undefined) patch[f] = rest[f]; });
    if (!Object.keys(patch).length) return respond(400, { error: 'No valid fields to update' });
    patch.updated_at = new Date().toISOString();

    const { data: item, error } = await supabase
      .from('inventory_items')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[manage-inventory] PATCH', error);
      return respond(500, { error: 'Failed to update inventory item' });
    }
    if (!item) return respond(404, { error: 'Item not found or access denied' });

    return respond(200, { item });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const { id } = params;
    if (!id) return respond(400, { error: 'id query param is required' });

    const { data: item, error } = await supabase
      .from('inventory_items')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[manage-inventory] DELETE', error);
      return respond(500, { error: 'Failed to deactivate inventory item' });
    }
    if (!item) return respond(404, { error: 'Item not found or access denied' });

    return respond(200, { ok: true });
  }

  return respond(405, { error: 'Method not allowed' });
};
