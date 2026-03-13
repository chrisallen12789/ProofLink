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

const { createClient } = require('@supabase/supabase-js');

const VALID_ACTIONS = ['flag', 'suspend', 'reinstate', 'terminate'];

const STATUS_MAP = {
  flag     : 'flagged',
  suspend  : 'suspended',
  reinstate: 'active',
  terminate: 'terminated',
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader  = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Verify admin session
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader);
  if (authErr || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Platform admin access required' }) };
  }

  // Parse body
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { tenant_id, action, reason_code, admin_notes } = body;

  if (!tenant_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenant_id is required' }) };
  }
  if (!VALID_ACTIONS.includes(action)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid action. Must be one of: ' + VALID_ACTIONS.join(', ') }),
    };
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
    conduct_updated_by : user.id,
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

  // Apply the update
  const { error: updateErr } = await supabase
    .from('tenants')
    .update(tenantUpdate)
    .eq('id', tenant_id);

  if (updateErr) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to update tenant: ' + updateErr.message }),
    };
  }

  // Write to conduct log (best-effort — don't fail the request if the table isn't ready)
  try {
    await supabase.from('tenant_conduct_log').insert({
      tenant_id,
      action,
      reason_code  : reason_code || null,
      admin_notes  : admin_notes || null,
      performed_by : user.id,
      performed_at : now,
    });
  } catch (_) {}

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, status: newStatus }),
  };
};
