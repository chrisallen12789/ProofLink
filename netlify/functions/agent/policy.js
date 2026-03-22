// netlify/functions/agent/policy.js
// Permission and safety engine for the ProofLink AI agent layer.
// Every agent action is evaluated here before execution.
//
// Design principles:
// - Tenant isolation is absolute. No cross-tenant data access.
// - Reads are always allowed for authenticated operators.
// - Drafts are always allowed (they produce text, not system changes).
// - Writes require explicit approval gates.
// - Actions are classified by risk level before execution.

'use strict';

const READ_TOOLS = new Set([
  'get_orders', 'get_bookings', 'get_customers', 'get_payments',
  'get_expenses', 'get_quotes', 'get_jobs', 'get_products',
  'get_dashboard_summary', 'get_overdue_payments', 'get_upcoming_bookings',
  'get_stale_customers', 'get_unpaid_orders', 'get_margin_issues',
  'get_missing_data_items', 'calculate_job_margin', 'find_anomalies',
]);

const DRAFT_TOOLS = new Set([
  'draft_invoice_followup', 'draft_customer_update', 'draft_daily_summary',
  'draft_estimate_message', 'draft_job_cost_explanation', 'draft_booking_reminder',
]);

// Low-risk writes: non-financial fields, no customer-visible effects
const LOW_RISK_WRITE_TOOLS = new Set([
  'flag_record_for_review', 'save_agent_note', 'create_followup_reminder',
]);

// High-risk writes: money, messages, billing, customer-facing actions
const HIGH_RISK_WRITE_TOOLS = new Set([
  'send_invoice_email', 'update_order_status', 'create_payment_record',
  'send_customer_message', 'update_price',
]);

/**
 * Evaluate whether a tool call is permitted for this context.
 * Returns { allowed: boolean, reason: string, requiresApproval: boolean }
 */
function evaluateToolCall(toolName, context) {
  const { tenantId, operatorId, agentMode } = context;

  if (!tenantId || !operatorId) {
    return { allowed: false, reason: 'Missing tenant or operator context', requiresApproval: false };
  }

  if (READ_TOOLS.has(toolName)) {
    return { allowed: true, reason: 'Read operation — always permitted for authenticated operators', requiresApproval: false };
  }

  if (DRAFT_TOOLS.has(toolName)) {
    return { allowed: true, reason: 'Draft operation — produces text only, no system changes', requiresApproval: false };
  }

  if (LOW_RISK_WRITE_TOOLS.has(toolName)) {
    // Low-risk writes are allowed with approval from the operator
    return { allowed: true, reason: 'Low-risk write — requires operator confirmation', requiresApproval: true };
  }

  if (HIGH_RISK_WRITE_TOOLS.has(toolName)) {
    return {
      allowed: false,
      reason: `High-risk write tool "${toolName}" is not permitted in the current agent phase. This must be triggered explicitly by the operator from the UI.`,
      requiresApproval: false,
    };
  }

  return { allowed: false, reason: `Unknown tool: ${toolName}`, requiresApproval: false };
}

/**
 * Validate that a data object belongs to the operator's tenant.
 * Call this before returning any record to the agent.
 */
function assertTenantScope(record, tenantId, label = 'record') {
  if (!record) return;
  if (record.tenant_id && record.tenant_id !== tenantId) {
    throw Object.assign(
      new Error(`Tenant isolation violation: ${label} belongs to a different tenant`),
      { statusCode: 403 }
    );
  }
}

/**
 * Classify the risk level of a proposed agent response.
 * Used by evaluators before surfacing to the operator.
 */
function classifyRisk(agentOutput) {
  const { mode, proposedActions = [] } = agentOutput;
  if (mode === 'insight' || mode === 'analysis') return 'low';
  if (mode === 'draft') return 'low';
  if (mode === 'monitoring') return 'low';
  if (proposedActions.some((a) => HIGH_RISK_WRITE_TOOLS.has(a.tool))) return 'high';
  if (proposedActions.some((a) => LOW_RISK_WRITE_TOOLS.has(a.tool))) return 'medium';
  return 'low';
}

module.exports = { evaluateToolCall, assertTenantScope, classifyRisk, READ_TOOLS, DRAFT_TOOLS };
