// netlify/functions/log-operator-action.js
// Operator-authenticated POST — logs a CRUD action to operator_audit_log.
// POST { action, entity_type, entity_id, old_value?, new_value? }
// Fire-and-forget from the operator dashboard. Never blocks the UI.

'use strict';

const { requireOperatorContext, getAdminClient, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { tenantId, operatorId } = ctx;
  const adminSb = getAdminClient();

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { action, entity_type, entity_id, old_value, new_value } = body;
  if (!action) return respond(400, { error: 'action is required' });

  const { error } = await adminSb.from('operator_audit_log').insert({
    tenant_id  : tenantId,
    operator_id: operatorId || null,
    action     : String(action).slice(0, 100),
    entity_type: entity_type ? String(entity_type).slice(0, 50) : null,
    entity_id  : entity_id   || null,
    old_value  : old_value   || null,
    new_value  : new_value   || null,
  });

  if (error) {
    console.warn('[log-operator-action] insert failed:', error.message);
    return respond(500, { error: 'Failed to log action' });
  }

  return respond(200, { ok: true });
};
