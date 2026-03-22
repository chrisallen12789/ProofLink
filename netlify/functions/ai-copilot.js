// netlify/functions/ai-copilot.js
// Operator-authenticated POST — handles free-form Q&A about the business,
// plus on-demand drafting of messages and summaries.
//
// POST { question, mode?, draft_type?, draft_extras? }
// Modes: 'copilot' (Q&A) | 'draft' (message drafting)
//
// Phase: Layer 1 (Insight) + Layer 2 (Guidance) + Layer 3 (Drafting)
// Read-only. Never writes records or sends messages.

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { getBusinessContext }              = require('./agent/tools');
const { buildCopilotPrompt, buildDraftPrompt } = require('./agent/prompts');
const { logAgentEvent }                   = require('./agent/audit');
const { evaluateToolCall }                = require('./agent/policy');
const { getAdminClient }                  = require('./utils/auth');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_QUESTION_LENGTH = 2000;

async function callClaude(prompt, maxTokens = 1024) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { text: 'AI copilot is not configured. Set ANTHROPIC_API_KEY in your Netlify environment variables.', mock: true };
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method : 'POST',
    headers: {
      'x-api-key'        : apiKey,
      'anthropic-version': '2023-06-01',
      'content-type'     : 'application/json',
    },
    body: JSON.stringify({
      model     : 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages  : [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return { text };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId, operatorId } = ctx;
  const adminSb = getAdminClient();

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const question    = String(body.question || '').trim();
  const mode        = String(body.mode || 'copilot');
  const draft_type  = String(body.draft_type || '');
  const draft_extras = body.draft_extras || {};

  if (!question && mode !== 'draft') return respond(400, { error: 'question is required' });
  if (question.length > MAX_QUESTION_LENGTH) return respond(400, { error: `question must be ${MAX_QUESTION_LENGTH} characters or fewer` });

  // Policy check — copilot and draft are always permitted read/draft operations
  const toolCheck = evaluateToolCall(mode === 'draft' ? 'draft_invoice_followup' : 'get_dashboard_summary', { tenantId, operatorId, agentMode: mode });
  if (!toolCheck.allowed) return respond(403, { error: toolCheck.reason });

  const startMs = Date.now();

  try {
    // Load business context for grounding
    const context = await getBusinessContext(supabase, tenantId);

    let prompt;
    if (mode === 'draft') {
      if (!draft_type) return respond(400, { error: 'draft_type is required for draft mode' });
      prompt = buildDraftPrompt(draft_type, context, draft_extras);
    } else {
      prompt = buildCopilotPrompt(question, context);
    }

    const { text, mock } = await callClaude(prompt, mode === 'draft' ? 512 : 1024);

    const durationMs = Date.now() - startMs;

    await logAgentEvent(adminSb, {
      tenant_id       : tenantId,
      operator_id     : operatorId,
      mode            : mode === 'draft' ? `draft:${draft_type}` : 'copilot',
      prompt_summary  : question.slice(0, 200) || draft_type,
      tools_used      : ['getBusinessContext'],
      response_summary: text.slice(0, 200),
    });

    return respond(200, {
      ok         : true,
      mode,
      answer     : text,
      is_draft   : mode === 'draft',
      is_mock    : mock || false,
      duration_ms: durationMs,
    });
  } catch (err) {
    console.error('[ai-copilot]', err);
    await logAgentEvent(adminSb, {
      tenant_id    : tenantId,
      operator_id  : operatorId,
      mode,
      prompt_summary: question.slice(0, 200),
      tools_used   : ['getBusinessContext'],
      response_summary: '',
      error        : err.message,
    }).catch(() => {});
    return respond(500, { error: 'Failed to get AI response', detail: err.message });
  }
};
