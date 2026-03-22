// netlify/functions/agent/audit.js
// Audit logging for all meaningful agent interactions.
// Creates a traceable record of every agent session: what was asked,
// what data was consulted, what was returned, and any actions proposed.
//
// Every record includes: timestamp, tenant_id, operator_id, mode,
// prompt_summary, tools_used, response_summary, action_proposals, error.
// This supports debugging, trust, compliance, and product improvement.

'use strict';

/**
 * Log an agent event to the agent_audit_events table.
 * Non-fatal: if logging fails, we warn but do not block the response.
 *
 * @param {object} supabase — admin supabase client
 * @param {object} event
 * @param {string} event.tenant_id
 * @param {string} event.operator_id
 * @param {string} event.mode — 'brief' | 'copilot' | 'draft' | 'monitor'
 * @param {string} event.prompt_summary — short description of the user's intent
 * @param {string[]} event.tools_used — names of tools called
 * @param {string} event.response_summary — short description of what was returned
 * @param {object[]} [event.action_proposals] — any proposed write actions
 * @param {string} [event.error] — error message if the run failed
 */
async function logAgentEvent(supabase, event) {
  const {
    tenant_id, operator_id, mode, prompt_summary,
    tools_used = [], response_summary, action_proposals = [], error = null,
  } = event;

  try {
    await supabase.from('agent_audit_events').insert({
      tenant_id,
      operator_id,
      mode,
      prompt_summary    : String(prompt_summary || '').slice(0, 500),
      tools_used        : tools_used,
      response_summary  : String(response_summary || '').slice(0, 1000),
      action_proposals  : action_proposals.length ? action_proposals : null,
      error             : error ? String(error).slice(0, 500) : null,
      created_at        : new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[agent/audit] Failed to log event:', err.message);
  }
}

module.exports = { logAgentEvent };
