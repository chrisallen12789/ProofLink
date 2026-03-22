// netlify/functions/agent/prompts.js
// Prompt templates for each agent mode.
// These are separated by function — no single giant prompt blob.
// Each template receives a structured context object and returns a prompt string.

'use strict';

function fmtMoney(cents) {
  if (cents == null || isNaN(cents)) return '—';
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function listItems(arr, fn, emptyMsg = 'None.') {
  if (!arr || !arr.length) return emptyMsg;
  return arr.map(fn).join('\n');
}

// ── System instruction (shared across all modes) ──────────────────────────────

const SYSTEM_INSTRUCTION = `You are the ProofLink AI assistant — an operational copilot for a small service business.

Your role: Help the business owner understand their business state, take smart next actions, and reduce clerical work. You operate on real data from their system. You do not guess or invent facts.

Your constraints:
- Never fabricate customer names, amounts, or dates. Only reference data provided to you.
- Never recommend sending emails, making payments, or modifying records without explicitly labeling it as a "proposed action that requires your approval."
- Always be specific. Reference actual records, names, amounts, and dates from the context.
- Be concise. The operator is busy. Get to the point.
- Separate observations (what is true) from recommendations (what to do).
- If data is missing or ambiguous, say so clearly rather than guessing.

Output format guidance:
- Use short paragraphs or bullet points. Never walls of text.
- When recommending actions, list them clearly and explain why each matters.
- When drafting messages, label them clearly as drafts and note they need review before sending.
- Always end with a clear "what's most important right now" if the operator hasn't asked a specific question.`;

// ── Daily briefing prompt ─────────────────────────────────────────────────────

function buildBriefingPrompt(context) {
  const {
    today_bookings, upcoming_bookings, unpaid_orders, overdue_orders,
    total_unpaid_cents, pending_quotes, expired_quotes, unread_messages,
    stale_customers, reminders_needed,
  } = context;

  return `${SYSTEM_INSTRUCTION}

You are generating the operator's DAILY BRIEFING. Be factual, prioritized, and actionable.

--- BUSINESS DATA ---

TODAY'S APPOINTMENTS (${today_bookings.length}):
${listItems(today_bookings, (b) => `  • ${b.customer_name || 'Unknown'} — ${b.title} at ${fmtDate(b.starts_at)}${b.notes ? ` [Notes: ${b.notes.slice(0, 80)}]` : ''}`, 'No appointments today.')}

UPCOMING BOOKINGS THIS WEEK (${upcoming_bookings.length}):
${listItems(upcoming_bookings.slice(0, 5), (b) => `  • ${b.customer_name || 'Unknown'} — ${b.title} on ${fmtDate(b.starts_at)}`)}

REMINDERS NEEDED — appointments within 30h with no reminder sent (${reminders_needed.length}):
${listItems(reminders_needed, (b) => `  • ${b.customer_name || 'Unknown'} — ${b.title} at ${fmtDate(b.starts_at)} — email: ${b.customer_email}`)}

UNPAID ORDERS (${unpaid_orders.length} orders totaling ${fmtMoney(total_unpaid_cents)}):
${listItems(unpaid_orders.slice(0, 8), (o) => `  • ${o.customer_name || 'Unknown'} — ${o.title} — ${fmtMoney(o.total_cents ?? Math.round((o.total_amount || 0) * 100))} — status: ${o.status} — created ${fmtDate(o.created_at)}`)}

OVERDUE (older than 14 days, not paid): ${overdue_orders.length} orders
${listItems(overdue_orders.slice(0, 5), (o) => `  • ${o.customer_name || 'Unknown'} — ${o.title} — ${fmtMoney(o.total_cents ?? Math.round((o.total_amount || 0) * 100))}`)}

PENDING QUOTES (${pending_quotes.length} awaiting customer response):
${listItems(pending_quotes.slice(0, 5), (q) => `  • ${q.customer_name || 'Unknown'} — ${q.title} — ${fmtMoney(q.amount_cents)} — sent ${fmtDate(q.created_at)}${q.valid_until ? ` — expires ${fmtDate(q.valid_until)}` : ''}`)}

EXPIRED QUOTES (${expired_quotes.length} past validity date):
${listItems(expired_quotes, (q) => `  • ${q.customer_name || 'Unknown'} — ${q.title} — expired ${fmtDate(q.valid_until)}`)}

UNREAD CUSTOMER MESSAGES (${unread_messages.length}):
${listItems(unread_messages.slice(0, 5), (m) => `  • ${m.customer_name || 'Unknown'} (${m.customer_email}) — "${m.message.slice(0, 100)}"`)}

CUSTOMERS NOT SEEN IN 45+ DAYS (${stale_customers.length}):
${listItems(stale_customers.slice(0, 5), (c) => `  • ${c.name} — last activity ${fmtDate(c.updated_at)}`)}

--- END OF DATA ---

Generate a crisp, prioritized daily briefing for the operator. Structure it as:

1. **Today at a glance** — appointments, urgent items
2. **Money that needs attention** — overdue, unpaid
3. **Follow-ups needed** — quotes, messages, stale customers
4. **Recommended top 3 actions for today** — specific, actionable

Keep the tone professional but direct. This is a business operating system, not a chatbot. The operator needs to know exactly what to do.`;
}

// ── Copilot Q&A prompt ────────────────────────────────────────────────────────

function buildCopilotPrompt(userQuestion, context) {
  const briefContext = `
Business context summary:
- Unpaid orders: ${context.unpaid_orders.length} totaling ${fmtMoney(context.total_unpaid_cents)}
- Today's appointments: ${context.today_bookings.length}
- Upcoming this week: ${context.upcoming_bookings.length}
- Pending quotes: ${context.pending_quotes.length}
- Unread messages: ${context.unread_messages.length}
- Overdue orders: ${context.overdue_orders.length}
- Stale customers: ${context.stale_customers.length}

Full data dump for reference:
Unpaid orders: ${JSON.stringify(context.unpaid_orders.slice(0, 10))}
Upcoming bookings: ${JSON.stringify(context.upcoming_bookings.slice(0, 10))}
Pending quotes: ${JSON.stringify(context.pending_quotes.slice(0, 10))}
Recent payments: ${JSON.stringify(context.recent_payments.slice(0, 5))}
Unread messages: ${JSON.stringify(context.unread_messages.slice(0, 5))}
`.trim();

  return `${SYSTEM_INSTRUCTION}

You are answering a specific question from the business operator. Use the data below to answer accurately. If the answer requires data not included, say so clearly.

${briefContext}

OPERATOR'S QUESTION: ${userQuestion}

Answer the question directly. Be specific with names, amounts, and dates from the data. If you need to recommend an action, label it as a recommendation and note what the operator would need to do in the ProofLink dashboard.`;
}

// ── Drafting prompt ───────────────────────────────────────────────────────────

function buildDraftPrompt(draftType, context, extras = {}) {
  const base = `${SYSTEM_INSTRUCTION}

You are in DRAFT MODE. You are writing a message on behalf of the operator. The operator MUST review and edit this draft before sending. Label it clearly as a draft.`;

  if (draftType === 'invoice_followup') {
    const { customer_name, order_title, amount, status, days_overdue, business_name } = extras;
    const amtStr = typeof amount === 'number' ? fmtMoney(amount) : (amount || 'the outstanding amount');
    // Fall back to context data if extras are sparse
    const nameStr = customer_name || (context.unpaid_orders?.[0]?.customer_name) || 'the customer';
    const titleStr = order_title || (context.unpaid_orders?.[0]?.title) || 'recent work';
    return `${base}

Draft a professional but firm invoice follow-up message from ${business_name || 'the business'} to ${nameStr}.

Context:
- Order: ${titleStr}
- Amount: ${amtStr}
- Days outstanding: ${days_overdue ?? 'unknown'}

The message should:
- Be polite but clear that payment is expected
- Reference the specific work done
- Include a clear call to action
- Be 3-4 sentences max
- Work as either an email or SMS depending on preference

Return ONLY the message text, prefixed with "DRAFT:". No explanation.`;
  }

  if (draftType === 'booking_reminder') {
    const { customer_name, service, date_str, business_name } = extras;
    return `${base}

Draft a friendly appointment reminder from ${business_name} to ${customer_name}.

Context:
- Service: ${service}
- Date/time: ${date_str}

Keep it under 3 sentences. Friendly, professional. Include any relevant prep instructions if context suggests it (outdoor work = be home, cleaning = clear surfaces, etc.).

Return ONLY the message text, prefixed with "DRAFT:". No explanation.`;
  }

  if (draftType === 'customer_followup') {
    const { customer_name, last_service, days_since, business_name } = extras;
    return `${base}

Draft a warm re-engagement message from ${business_name} to ${customer_name}, a past customer.

Context:
- Last service: ${last_service || 'a prior service'}
- Days since last contact: ${days_since}

The message should:
- Feel personal, not generic
- Reference their prior business
- Invite them to rebook or reach out
- Be 2-3 sentences

Return ONLY the message text, prefixed with "DRAFT:". No explanation.`;
  }

  return `${base}\n\nDraft a professional business message for the operator. Context: ${JSON.stringify(extras)}`;
}

module.exports = { SYSTEM_INSTRUCTION, buildBriefingPrompt, buildCopilotPrompt, buildDraftPrompt };
