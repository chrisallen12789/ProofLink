// netlify/functions/admin-delete-tenants.js
// Admin-only. Hard-deletes one or more tenants and their related records.
//
// POST { tenant_ids: string[], force?: boolean }
//
// By default, refuses to delete tenants that have orders (force=true bypasses this).
// Cleans up: tenant_conduct_log, operator_members, then the tenant row itself.

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

function tenantBusinessName(tenant) {
  if (!tenant || typeof tenant !== 'object') return '';
  return tenant.business_name || tenant.name || tenant.slug || '';
}

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
    const { data: withOrders, error: withOrdersErr } = await supabase
      .from('tenants')
      .select('id, slug, business_name, name, order_count')
      .in('id', tenant_ids)
      .gt('order_count', 0);

    if (withOrdersErr) {
      return respond(502, { error: 'Failed to verify tenant order state: ' + withOrdersErr.message });
    }

    if (withOrders && withOrders.length) {
      return respond(409, {
        error: 'Some selected tenants have orders. Pass force=true to delete anyway.',
        tenants_with_orders: withOrders.map(t => ({
          id: t.id, name: tenantBusinessName(t), order_count: t.order_count,
        })),
      });
    }
  }

  // Clean up related records first (best-effort; DB cascades handle the rest)
  const { error: conductDeleteErr } = await supabase.from('tenant_conduct_log').delete().in('tenant_id', tenant_ids);
  if (conductDeleteErr) {
    return respond(502, { error: 'Failed to clean tenant conduct log: ' + conductDeleteErr.message });
  }
  const { error: membershipDeleteErr } = await supabase.from('operator_members').delete().in('tenant_id', tenant_ids);
  if (membershipDeleteErr) {
    return respond(502, { error: 'Failed to clean operator memberships: ' + membershipDeleteErr.message });
  }

  // Hard-delete the tenant rows
  const { error: deleteErr } = await supabase.from('tenants').delete().in('id', tenant_ids);

  const deleted = deleteErr ? [] : tenant_ids;
  const failed  = deleteErr ? tenant_ids.map(id => ({ id, error: deleteErr.message })) : [];

  return respond(200, {
    ok     : true,
    deleted: deleted.length,
    failed : failed.length,
    details: { deleted, failed },
  });
};
