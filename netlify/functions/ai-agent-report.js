'use strict';

const { getAdminClient, requireOperatorContext, respond } = require('./utils/auth');
const { listAgentDefinitions, publicAgentDefinition } = require('./agent/registry');
const { runAgentReport } = require('./agent/runtime');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  if (event.httpMethod === 'GET') {
    return respond(200, {
      ok: true,
      agents: listAgentDefinitions().map(publicAgentDefinition),
    });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const agentKey = String(body.agent_key || body.agentKey || '').trim().toLowerCase();
  if (!agentKey) return respond(400, { error: 'agent_key is required' });

  const input = { ...body };
  delete input.agent_key;
  delete input.agentKey;

  try {
    const result = await runAgentReport({
      supabase: ctx.supabase,
      auditClient: getAdminClient(),
      tenantId: ctx.tenantId,
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
