// netlify/functions/admin-delete-tenants.js
// Admin-only. Hard-deletes one or more tenants and their related records.
//
// POST { tenant_ids: string[], force?: boolean }
//
// By default, refuses to delete tenants that have orders (force=true bypasses this).
// Cleans up: tenant_conduct_log, operator_members, then the tenant row itself.

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { tenant_ids, force } = body;

  if (!Array.isArray(tenant_ids) || !tenant_ids.length) {
    return respond(400, { error: 'tenant_ids must be a non-empty array' });
  }
  if (tenant_ids.length > 50) {
    return respond(400, { error: 'Cannot delete more than 50 tenants at once' });
  }

  // Safety check: block deletion of tenants with real orders unless force=true
  if (!force) {
    const { data: withOrders } = await supabase
      .from('tenants')
      .select('id, name, order_count')
      .in('id', tenant_ids)
      .gt('order_count', 0);

    if (withOrders && withOrders.length) {
      return respond(409, {
        error: 'Some selected tenants have orders. Pass force=true to delete anyway.',
        tenants_with_orders: withOrders.map(t => ({
          id: t.id, name: t.name, order_count: t.order_count,
        })),
      });
    }
  }

  const deleted = [];
  const failed  = [];

  for (const id of tenant_ids) {
    try {
      // Clean up related records first (best-effort; DB cascades handle the rest)
      await supabase.from('tenant_conduct_log').delete().eq('tenant_id', id);
      await supabase.from('operator_members').delete().eq('tenant_id', id);

      // Hard-delete the tenant row
      const { error } = await supabase.from('tenants').delete().eq('id', id);
      if (error) throw error;

      deleted.push(id);
    } catch (e) {
      failed.push({ id, error: e.message });
    }
  }

  return respond(200, {
    ok     : true,
    deleted: deleted.length,
    failed : failed.length,
    details: { deleted, failed },
  });
};
