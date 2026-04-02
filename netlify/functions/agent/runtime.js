'use strict';

const { logAgentEvent } = require('./audit');
const { evaluateToolCall } = require('./policy');
const { validateAgentReport } = require('./schemas');
const { getAgentDefinition, publicAgentDefinition } = require('./registry');

function buildTraceId(agentKey) {
  const timestamp = Date.now().toString(36);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `pl-agent-${String(agentKey || 'run').trim()}-${timestamp}-${nonce}`;
}

async function runAgentReport({ supabase, auditClient, tenantId, operatorId, agentKey, input = {} }) {
  const definition = getAgentDefinition(agentKey);
  if (!definition) {
    const err = new Error(`Unknown agent_key "${agentKey}"`);
    err.statusCode = 404;
    throw err;
  }

  const traceId = buildTraceId(definition.key);
  const toolsUsed = [];
  const startMs = Date.now();

  definition.allowed_tools.forEach((toolName) => {
    const decision = evaluateToolCall(toolName, {
      tenantId,
      operatorId,
      agentMode: definition.key,
    });
    if (!decision.allowed || decision.requiresApproval) {
      const err = new Error(decision.reason || `Tool "${toolName}" is not permitted for ${definition.key}`);
      err.statusCode = 403;
      throw err;
    }
  });

  try {
    const result = await definition.execute({
      supabase,
      tenantId,
      operatorId,
      input,
      traceId,
    });
    const validatedReport = validateAgentReport(result.report, definition);
    const durationMs = Date.now() - startMs;
    const used = Array.isArray(result.tools_used) ? result.tools_used : definition.allowed_tools;
    toolsUsed.push(...used);

    await logAgentEvent(auditClient || supabase, {
      tenant_id: tenantId,
      operator_id: operatorId,
      mode: `agent:${definition.key}`,
      prompt_summary: `[${traceId}] structured report for ${definition.key}`,
      tools_used: toolsUsed,
      response_summary: validatedReport.summary,
      action_proposals: validatedReport.recommended_actions,
    });

    return {
      trace_id: traceId,
      agent: publicAgentDefinition(definition),
      report: validatedReport,
      tools_used: toolsUsed,
      duration_ms: durationMs,
      context_summary: result.context_summary || {},
      generated_at: validatedReport.generated_at,
    };
  } catch (error) {
    await logAgentEvent(auditClient || supabase, {
      tenant_id: tenantId,
      operator_id: operatorId,
      mode: `agent:${definition.key}`,
      prompt_summary: `[${traceId}] structured report for ${definition.key}`,
      tools_used: toolsUsed.length ? toolsUsed : definition.allowed_tools,
      response_summary: '',
      error: error.message,
    }).catch(() => {});
    throw error;
  }
}

module.exports = {
  runAgentReport,
};
