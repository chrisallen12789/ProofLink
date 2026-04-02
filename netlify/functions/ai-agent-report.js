'use strict';

const { getAdminClient, requireAdminContext, requireOperatorContext, respond } = require('./utils/auth');
const { getAgentDefinition, listAgentDefinitions, publicAgentDefinition } = require('./agent/registry');
const { runAgentReport } = require('./agent/runtime');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  if (event.httpMethod === 'GET') {
    try {
      await requireAdminContext(event);
    } catch (err) {
      return respond(err.statusCode || 403, { error: err.message || 'Forbidden' });
    }
    return respond(200, {
      ok: true,
      agents: listAgentDefinitions().map(publicAgentDefinition),
    });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const agentKey = String(body.agent_key || body.agentKey || '').trim().toLowerCase();
  if (!agentKey) return respond(400, { error: 'agent_key is required' });
  const requestedTenantId = String(body.tenant_id || body.tenantId || '').trim();

  let ctx;
  try {
    ctx = await requireOperatorContext(event, requestedTenantId);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const definition = getAgentDefinition(agentKey);
  if (definition?.admin_only && ctx.role !== 'platform_admin') {
    return respond(403, { error: 'Forbidden: admin role required for internal AI review' });
  }
  const tenantId = requestedTenantId || ctx.tenantId;
  if (!tenantId) {
    return respond(400, { error: 'tenant_id is required for this request' });
  }

  const input = { ...body };
  delete input.agent_key;
  delete input.agentKey;
  delete input.tenant_id;
  delete input.tenantId;

  try {
    const result = await runAgentReport({
      supabase: ctx.supabase,
      auditClient: getAdminClient(),
      tenantId,
      operatorId: ctx.operatorId,
      agentKey,
      input,
    });
    return respond(200, { ok: true, ...result });
  } catch (err) {
    return respond(err.statusCode || 500, {
      error: err.message || 'Failed to generate agent report',
    });
  }
};
