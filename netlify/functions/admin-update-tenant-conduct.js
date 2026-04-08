// netlify/functions/admin-update-tenant-conduct.js
// Platform admin endpoint for tenant lifecycle actions: flag, suspend, reinstate, terminate.
//
// POST {
//   tenant_id  : uuid   (required)
//   action     : string (required) — 'flag' | 'suspend' | 'reinstate' | 'terminate'
//   reason_code: string (optional) — machine-readable reason
//   admin_notes: string (optional) — internal notes, written to conduct log
// }
//
// Returns { ok: true, status: <new tenant status> }
//
// All actions are logged to tenant_conduct_log for the audit trail.
// 'reinstate' clears suspended_at and conduct_reason on the tenant record.
// 'terminate' sets terminated_at and is treated as permanent by convention.

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

const VALID_ACTIONS = ['flag', 'suspend', 'reinstate', 'terminate'];

const STATUS_MAP = {
  flag     : 'flagged',
  suspend  : 'suspended',
  reinstate: 'active',
  terminate: 'terminated',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return respond(204, {});
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let ctx;
  try {
    ctx = await requireAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, user, operatorId } = ctx;

  // Parse body
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { tenant_id, action, reason_code, admin_notes } = body;

  if (!tenant_id) {
    return respond(400, { error: 'tenant_id is required' });
  }
  if (!VALID_ACTIONS.includes(action)) {
    return respond(400, { error: 'Invalid action. Must be one of: ' + VALID_ACTIONS.join(', ') });
  }
  if (reason_code && reason_code.length > 100) {
    return respond(400, { error: 'reason_code must be 100 characters or fewer' });
  }
  if (admin_notes && admin_notes.length > 2000) {
    return respond(400, { error: 'admin_notes must be 2000 characters or fewer' });
  }

  const now       = new Date().toISOString();
  const newStatus = STATUS_MAP[action];

  // Build the tenant update payload
  const tenantUpdate = {
    status             : newStatus,
    conduct_action     : action,
    conduct_reason     : reason_code || null,
    conduct_notes      : admin_notes || null,
    conduct_updated_at : now,
    conduct_updated_by : operatorId || user.id,
    updated_at         : now,
  };

  if (action === 'suspend') {
    tenantUpdate.suspended_at = now;
  }
  if (action === 'reinstate') {
    tenantUpdate.suspended_at     = null;
    tenantUpdate.conduct_reason   = null; // clear on reinstate
  }
  if (action === 'terminate') {
    tenantUpdate.terminated_at = now;
    tenantUpdate.active        = false;   // belt-and-suspenders for any legacy active checks
  }
  if (action === 'flag') {
    tenantUpdate.flagged_at = now;
  }

  const { data: existingTenant, error: tenantLookupErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantLookupErr) {
    return respond(500, { error: 'Failed to load tenant: ' + tenantLookupErr.message });
  }
  if (!existingTenant) {
    return respond(404, { error: 'Tenant not found' });
  }

  // Apply the update
  const { error: updateErr } = await supabase
    .from('tenants')
    .update(tenantUpdate)
    .eq('id', tenant_id);

  if (updateErr) {
    return respond(500, { error: 'Failed to update tenant: ' + updateErr.message });
  }

  // Write to conduct log (best-effort — don't fail the request if the table isn't ready)
  try {
    await supabase.from('tenant_conduct_log').insert({
      tenant_id,
      action,
      reason_code  : reason_code || null,
      admin_notes  : admin_notes || null,
      performed_by : operatorId || user.id,
      performed_at : now,
    });
  } catch (_) {}

  return respond(200, { ok: true, status: newStatus });
};
