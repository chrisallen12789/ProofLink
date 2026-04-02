// netlify/functions/ai-brief.js
// Operator-authenticated GET that returns the AI daily briefing for this tenant.

'use strict';

const { requireOperatorContext, respond, getAdminClient } = require('./utils/auth');
const { getBusinessContext } = require('./agent/tools');
const { buildBriefingPrompt } = require('./agent/prompts');
const { logAgentEvent } = require('./agent/audit');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[ai-brief] ANTHROPIC_API_KEY not set - returning mock briefing');
    return {
      text: 'AI briefing is not configured yet. Set ANTHROPIC_API_KEY in your Netlify environment variables to enable this feature.',
      mock: true,
    };
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
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
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase, tenantId, operatorId } = ctx;
  const adminSb = getAdminClient();
  const startMs = Date.now();
  const toolsUsed = ['getBusinessContext'];

  try {
    const context = await getBusinessContext(supabase, tenantId);
    const prompt = buildBriefingPrompt(context);
    const { text, mock } = await callClaude(prompt);
    const durationMs = Date.now() - startMs;

    await logAgentEvent(adminSb, {
      tenant_id: tenantId,
      operator_id: operatorId,
      mode: 'brief',
      prompt_summary: 'Daily operator briefing',
      tools_used: toolsUsed,
      response_summary: text.slice(0, 200),
    });

    return respond(200, {
      ok: true,
      mode: 'brief',
      briefing: text,
      context_summary: {
        today_appointments: context.today_bookings.length,
        upcoming_week: context.upcoming_bookings.length,
        upcoming_jobs: context.upcoming_jobs.length,
        unpaid_orders: context.unpaid_orders.length,
        total_unpaid_cents: context.total_unpaid_cents,
        pending_quotes: context.pending_quotes.length,
        unread_messages: context.unread_messages.length,
        overdue_orders: context.overdue_orders.length,
        reminders_needed: context.reminders_needed.length,
        multi_site_accounts: context.multi_location_customers.length,
        top_customers: context.top_customers.length,
      },
      is_mock: mock || false,
      duration_ms: durationMs,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ai-brief]', err.message, err);
    await logAgentEvent(adminSb, {
      tenant_id: tenantId,
      operator_id: operatorId,
      mode: 'brief',
      prompt_summary: 'Daily operator briefing',
      tools_used: toolsUsed,
      response_summary: '',
      error: err.message,
    }).catch(() => {});

    return respond(500, {
      error: 'Failed to generate briefing',
      detail: err.message,
    });
  }
};
