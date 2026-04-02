// netlify/functions/agent/prompts.js
// Prompt templates for each agent mode.
// These are separated by function so the system can stay grounded and readable.

'use strict';

function fmtMoney(cents) {
  if (cents == null || isNaN(cents)) return '-';
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function listItems(arr, fn, emptyMsg = 'None.') {
  if (!arr || !arr.length) return emptyMsg;
  return arr.map(fn).join('\n');
}

const SYSTEM_INSTRUCTION = `You are the ProofLink AI assistant, an operational copilot for a small service business.

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

function buildBriefingPrompt(context) {
  const {
    today_bookings,
    upcoming_bookings,
    unpaid_orders,
    overdue_orders,
    total_unpaid_cents,
    pending_quotes,
    expired_quotes,
    unread_messages,
    stale_customers,
    reminders_needed,
    top_customers,
    multi_location_customers,
    upcoming_jobs,
  } = context;

  return `${SYSTEM_INSTRUCTION}

You are generating the operator's DAILY BRIEFING. Be factual, prioritized, and actionable.

--- BUSINESS DATA ---

TODAY'S APPOINTMENTS (${today_bookings.length}):
${listItems(today_bookings, (booking) => `  - ${booking.customer_name || 'Unknown'} - ${booking.title} at ${fmtDate(booking.starts_at)}${booking.notes ? ` [Notes: ${booking.notes.slice(0, 80)}]` : ''}`, 'No appointments today.')}

UPCOMING BOOKINGS THIS WEEK (${upcoming_bookings.length}):
${listItems(upcoming_bookings.slice(0, 5), (booking) => `  - ${booking.customer_name || 'Unknown'} - ${booking.title} on ${fmtDate(booking.starts_at)}`)}

REMINDERS NEEDED - appointments within 30h with no reminder sent (${reminders_needed.length}):
${listItems(reminders_needed, (booking) => `  - ${booking.customer_name || 'Unknown'} - ${booking.title} at ${fmtDate(booking.starts_at)} - email: ${booking.customer_email}`)}

UPCOMING JOBS / ACTIVE EXECUTION THIS WEEK (${upcoming_jobs.length}):
${listItems(upcoming_jobs.slice(0, 6), (job) => `  - ${job.title || 'Job'} - ${job.service_address || 'Address missing'} - ${job.status} - ${job.scheduled_date || 'No date'} ${job.scheduled_time || ''}`)}

UNPAID ORDERS (${unpaid_orders.length} orders totaling ${fmtMoney(total_unpaid_cents)}):
${listItems(unpaid_orders.slice(0, 8), (order) => `  - ${order.customer_name || 'Unknown'} - ${order.title} - ${fmtMoney(order.total_cents ?? Math.round((order.total_amount || 0) * 100))} - status: ${order.status} - created ${fmtDate(order.created_at)}`)}

OVERDUE (older than 14 days, not paid): ${overdue_orders.length} orders
${listItems(overdue_orders.slice(0, 5), (order) => `  - ${order.customer_name || 'Unknown'} - ${order.title} - ${fmtMoney(order.total_cents ?? Math.round((order.total_amount || 0) * 100))}`)}

PENDING QUOTES (${pending_quotes.length} awaiting customer response):
${listItems(pending_quotes.slice(0, 5), (quote) => `  - ${quote.customer_name || 'Unknown'} - ${quote.title} - ${fmtMoney(quote.amount_cents)} - sent ${fmtDate(quote.created_at)}${quote.valid_until ? ` - expires ${fmtDate(quote.valid_until)}` : ''}`)}

EXPIRED QUOTES (${expired_quotes.length} past validity date):
${listItems(expired_quotes, (quote) => `  - ${quote.customer_name || 'Unknown'} - ${quote.title} - expired ${fmtDate(quote.valid_until)}`)}

UNREAD CUSTOMER MESSAGES (${unread_messages.length}):
${listItems(unread_messages.slice(0, 5), (message) => `  - ${message.customer_name || 'Unknown'} (${message.customer_email}) - "${message.message.slice(0, 100)}"`)}

CUSTOMERS NOT SEEN IN 45+ DAYS (${stale_customers.length}):
${listItems(stale_customers.slice(0, 5), (customer) => `  - ${customer.company_name || customer.name || 'Unknown'} - last activity ${fmtDate(customer.updated_at)}`)}

TOP CUSTOMERS TO PROTECT (${top_customers.length}):
${listItems(top_customers.slice(0, 5), (customer) => `  - ${(customer.company_name || customer.name || 'Unknown')} - ${fmtMoney(customer.lifetime_value_cents || 0)} lifetime - ${customer.order_count || 0} order(s)`)}

MULTI-SITE ACCOUNTS (${multi_location_customers.length}):
${listItems(multi_location_customers.slice(0, 5), (customer) => `  - ${customer.name} - ${customer.site_count} sites${customer.primary_site ? ` - primary: ${customer.primary_site}` : ''}`)}

--- END OF DATA ---

Generate a crisp, prioritized daily briefing for the operator. Structure it as:

1. **Today at a glance** - appointments, urgent items
2. **Money that needs attention** - overdue, unpaid
3. **Follow-ups needed** - quotes, messages, stale customers
4. **Recommended top 3 actions for today** - specific, actionable

Keep the tone professional but direct. This is a business operating system, not a chatbot. The operator needs to know exactly what to do.`;
}

function specialistLabel(specialist) {
  const lane = String(specialist || 'general').trim().toLowerCase();
  return {
    collections: 'collections',
    crew_prep: 'crew prep',
    quote_rescue: 'quote rescue',
    retention: 'retention',
  }[lane] || 'general operations';
}

function buildCopilotContextSummary(context, specialist = 'general') {
  const lane = String(specialist || 'general').trim().toLowerCase();

  if (lane === 'collections') {
    return `
Specialist lane: Collections
- Unpaid orders: ${context.unpaid_orders.length} totaling ${fmtMoney(context.total_unpaid_cents)}
- Overdue orders: ${context.overdue_orders.length}
- Recent payments: ${context.recent_payments.length}
- Top customers in focus: ${context.top_customers.length}

Relevant records:
Unpaid orders: ${JSON.stringify((context.unpaid_orders || []).slice(0, 12))}
Overdue orders: ${JSON.stringify((context.overdue_orders || []).slice(0, 8))}
Recent payments: ${JSON.stringify((context.recent_payments || []).slice(0, 8))}
Top customers: ${JSON.stringify((context.top_customers || []).slice(0, 6))}
`.trim();
  }

  if (lane === 'crew_prep') {
    return `
Specialist lane: Crew prep
- Today's appointments: ${context.today_bookings.length}
- Upcoming bookings this week: ${context.upcoming_bookings.length}
- Upcoming jobs this week: ${context.upcoming_jobs.length}
- Multi-site accounts: ${context.multi_location_customers.length}
- Top customers in focus: ${context.top_customers.length}

Relevant records:
Today's appointments: ${JSON.stringify((context.today_bookings || []).slice(0, 8))}
Upcoming bookings: ${JSON.stringify((context.upcoming_bookings || []).slice(0, 10))}
Upcoming jobs: ${JSON.stringify((context.upcoming_jobs || []).slice(0, 12))}
Multi-site accounts: ${JSON.stringify((context.multi_location_customers || []).slice(0, 6))}
Top customers: ${JSON.stringify((context.top_customers || []).slice(0, 6))}
`.trim();
  }

  if (lane === 'quote_rescue') {
    return `
Specialist lane: Quote rescue
- Pending quotes: ${context.pending_quotes.length}
- Expired quotes: ${context.expired_quotes.length}
- Top customers in focus: ${context.top_customers.length}
- Stale customers: ${context.stale_customers.length}

Relevant records:
Pending quotes: ${JSON.stringify((context.pending_quotes || []).slice(0, 12))}
Expired quotes: ${JSON.stringify((context.expired_quotes || []).slice(0, 8))}
Top customers: ${JSON.stringify((context.top_customers || []).slice(0, 6))}
Stale customers: ${JSON.stringify((context.stale_customers || []).slice(0, 6))}
`.trim();
  }

  if (lane === 'retention') {
    return `
Specialist lane: Retention
- Stale customers: ${context.stale_customers.length}
- Top customers in focus: ${context.top_customers.length}
- Multi-site accounts: ${context.multi_location_customers.length}
- Upcoming jobs in the next two weeks: ${context.upcoming_jobs.length}
- Recent payments: ${context.recent_payments.length}

Relevant records:
Stale customers: ${JSON.stringify((context.stale_customers || []).slice(0, 12))}
Top customers: ${JSON.stringify((context.top_customers || []).slice(0, 8))}
Multi-site accounts: ${JSON.stringify((context.multi_location_customers || []).slice(0, 8))}
Upcoming jobs: ${JSON.stringify((context.upcoming_jobs || []).slice(0, 10))}
Recent payments: ${JSON.stringify((context.recent_payments || []).slice(0, 8))}
`.trim();
  }

  return `
Business context summary:
- Unpaid orders: ${context.unpaid_orders.length} totaling ${fmtMoney(context.total_unpaid_cents)}
- Today's appointments: ${context.today_bookings.length}
- Upcoming jobs this week: ${context.upcoming_jobs.length}
- Upcoming bookings this week: ${context.upcoming_bookings.length}
- Pending quotes: ${context.pending_quotes.length}
- Unread messages: ${context.unread_messages.length}
- Overdue orders: ${context.overdue_orders.length}
- Stale customers: ${context.stale_customers.length}
- Top customers in focus: ${context.top_customers.length}
- Multi-site accounts: ${context.multi_location_customers.length}

Full data dump for reference:
Unpaid orders: ${JSON.stringify((context.unpaid_orders || []).slice(0, 10))}
Upcoming bookings: ${JSON.stringify((context.upcoming_bookings || []).slice(0, 10))}
Upcoming jobs: ${JSON.stringify((context.upcoming_jobs || []).slice(0, 10))}
Pending quotes: ${JSON.stringify((context.pending_quotes || []).slice(0, 10))}
Recent payments: ${JSON.stringify((context.recent_payments || []).slice(0, 5))}
Unread messages: ${JSON.stringify((context.unread_messages || []).slice(0, 5))}
Top customers: ${JSON.stringify((context.top_customers || []).slice(0, 5))}
Multi-site accounts: ${JSON.stringify((context.multi_location_customers || []).slice(0, 5))}
`.trim();
}

function buildCopilotPrompt(userQuestion, context, options = {}) {
  const specialist = String(options.specialist || context.specialist || 'general').trim().toLowerCase();
  const briefContext = buildCopilotContextSummary(context, specialist);

  return `${SYSTEM_INSTRUCTION}

You are answering a specific question from the business operator. Use the data below to answer accurately. If the answer requires data not included, say so clearly.
You are working in the ${specialistLabel(specialist)} specialist lane. Stay focused on that lane unless the operator clearly asks to widen the scope.

${briefContext}

OPERATOR'S QUESTION: ${userQuestion}

Answer the question directly. Be specific with names, amounts, and dates from the data. If you need to recommend an action, label it as a recommendation and note what the operator would need to do in the ProofLink dashboard.`;
}

function buildDraftPrompt(draftType, context, extras = {}) {
  const base = `${SYSTEM_INSTRUCTION}

You are in DRAFT MODE. You are writing a message on behalf of the operator. The operator MUST review and edit this draft before sending. Label it clearly as a draft.`;

  if (draftType === 'invoice_followup') {
    const {
      customer_name,
      order_title,
      amount,
      status: _status,
      days_overdue,
      business_name,
    } = extras;
    const amtStr = typeof amount === 'number' ? fmtMoney(amount) : (amount || 'the outstanding amount');
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

function buildAgentSystemInstruction(agent = {}) {
  return `${SYSTEM_INSTRUCTION}

You are running as the ProofLink ${agent.label || 'operations agent'}.

Purpose:
${agent.purpose || 'Provide a grounded operational report.'}

Allowed tools:
${(agent.allowed_tools || []).map((tool) => `- ${tool}`).join('\n') || '- read_only_context'}

Forbidden behaviors:
${(agent.forbidden_behaviors || []).map((item) => `- ${item}`).join('\n') || '- Never invent facts.'}

Output contract:
- Return structured JSON only.
- Include summary, findings, blockers, evidence, assumptions, confidence, and recommended_actions.
- If data is missing, list it explicitly instead of guessing.
- Every finding and recommendation must point back to evidence ids from the provided context.
`;
}

function buildStructuredAgentPrompt(agent = {}, context = {}) {
  return `${buildAgentSystemInstruction(agent)}

Current context snapshot:
${JSON.stringify(context, null, 2)}

Return a structured report that follows the ProofLink agent schema.`;
}

module.exports = {
  SYSTEM_INSTRUCTION,
  buildAgentSystemInstruction,
  buildStructuredAgentPrompt,
  buildBriefingPrompt,
  buildCopilotPrompt,
  buildDraftPrompt,
};
