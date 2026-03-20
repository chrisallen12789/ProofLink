'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');
const { sendEmail } = require('./utils/email');

const ALLOWED_KINDS = new Set(['lead_nudge', 'quote_follow_up', 'payment_reminder', 'review_request']);
const COOLDOWN_HOURS = {
  lead_nudge: 24,
  quote_follow_up: 72,
  payment_reminder: 24,
  review_request: 168,
};

function clean(value) {
  return String(value || '').trim();
}

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  return JSON.parse(body);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (token) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[token]));
}

function textToHtml(text, businessName) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const body = lines.map((line) => {
    if (!line) return '<div style="height:12px;"></div>';
    return `<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#48535a;">${escapeHtml(line)}</p>`;
  }).join('');

  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;padding:32px;background:#f4f6f8;font-family:Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9e0e5;border-radius:18px;overflow:hidden;">
        <div style="padding:18px 24px;background:#164f63;color:#ffffff;font-size:18px;font-weight:700;">${escapeHtml(businessName || 'ProofLink')}</div>
        <div style="padding:24px;">
          ${body}
        </div>
      </div>
    </body>
  </html>`;
}

async function loadBrandContext(supabase, tenantId) {
  const [{ data: tenant }, { data: cfgRow }] = await Promise.all([
    supabase.from('tenants').select('id, name').eq('id', tenantId).maybeSingle(),
    supabase.from('tenant_config').select('config_value').eq('tenant_id', tenantId).eq('config_key', 'site_settings').maybeSingle(),
  ]);

  let config = {};
  try {
    config = cfgRow?.config_value && typeof cfgRow.config_value === 'string'
      ? JSON.parse(cfgRow.config_value)
      : (cfgRow?.config_value || {});
  } catch {
    config = {};
  }

  return {
    tenantName: clean(tenant?.name) || 'ProofLink',
    replyTo: clean(config.public_contact_email || config.contact_email || ''),
    phone: clean(config.public_business_phone || config.business_phone || ''),
  };
}

async function loadCustomer(supabase, tenantId, customerId) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, tenant_id, name, email, phone, preferred_contact')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function recentKindInteraction(supabase, tenantId, customerId, kind) {
  const { data, error } = await supabase
    .from('customer_interactions')
    .select('id, created_at, metadata')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) throw error;
  return (data || []).find((row) => String(row?.metadata?.follow_up_kind || '') === kind) || null;
}

function withinCooldown(kind, interaction) {
  if (!interaction?.created_at) return false;
  const createdAt = new Date(interaction.created_at).getTime();
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  const cooldownMs = (COOLDOWN_HOURS[kind] || 24) * 60 * 60 * 1000;
  return (Date.now() - createdAt) < cooldownMs;
}

async function validateWorkflowState(supabase, tenantId, customerId, kind, refs) {
  if (kind === 'lead_nudge') {
    if (!refs.lead_id) throw Object.assign(new Error('lead_id is required for lead follow-up'), { statusCode: 400 });
    const { data, error } = await supabase
      .from('leads')
      .select('id, tenant_id, customer_id, status')
      .eq('id', refs.lead_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.customer_id !== customerId) throw Object.assign(new Error('Lead could not be resolved for this customer'), { statusCode: 404 });
    if (['converted', 'lost', 'archived'].includes(String(data.status || '').toLowerCase())) {
      throw Object.assign(new Error('This lead no longer needs follow-up'), { statusCode: 409 });
    }
    return;
  }

  if (kind === 'quote_follow_up') {
    if (!refs.bid_id) throw Object.assign(new Error('bid_id is required for quote follow-up'), { statusCode: 400 });
    const { data, error } = await supabase
      .from('bids')
      .select('id, tenant_id, customer_id, status, converted_order_id')
      .eq('id', refs.bid_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.customer_id !== customerId) throw Object.assign(new Error('Bid could not be resolved for this customer'), { statusCode: 404 });
    if (String(data.status || '').toLowerCase() !== 'sent' || data.converted_order_id) {
      throw Object.assign(new Error('This proposal no longer needs follow-up'), { statusCode: 409 });
    }
    return;
  }

  if (kind === 'payment_reminder' || kind === 'review_request') {
    if (!refs.order_id) throw Object.assign(new Error('order_id is required for this follow-up'), { statusCode: 400 });
    const { data, error } = await supabase
      .from('orders')
      .select('id, tenant_id, customer_id, status, amount_due_cents, payment_state')
      .eq('id', refs.order_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.customer_id !== customerId) throw Object.assign(new Error('Order could not be resolved for this customer'), { statusCode: 404 });

    const status = String(data.status || '').toLowerCase();
    const due = Number(data.amount_due_cents || 0);
    const paymentState = String(data.payment_state || '').toLowerCase();

    if (kind === 'payment_reminder') {
      if (['new', 'quoted', 'cancelled'].includes(status) || due <= 0 || !['unpaid', 'partially_paid', 'overdue'].includes(paymentState)) {
        throw Object.assign(new Error('This order no longer needs a payment reminder'), { statusCode: 409 });
      }
      return;
    }

    if (!['fulfilled', 'completed', 'paid'].includes(status) || due > 0 || paymentState !== 'paid') {
      throw Object.assign(new Error('This order is not ready for a review request'), { statusCode: 409 });
    }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed' });

  let body;
  try {
    body = parseJsonBody(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const tenantId = clean(body.tenant_id);
  const customerId = clean(body.customer_id);
  const kind = clean(body.kind);
  const subject = clean(body.subject);
  const message = clean(body.message);
  const contactEmail = clean(body.contact_email).toLowerCase();
  const contactName = clean(body.contact_name);

  if (!tenantId) return respond(400, { error: 'tenant_id is required' });
  if (!customerId) return respond(400, { error: 'customer_id is required' });
  if (!ALLOWED_KINDS.has(kind)) return respond(400, { error: 'Invalid follow-up kind' });
  if (!subject) return respond(400, { error: 'subject is required' });
  if (!message) return respond(400, { error: 'message is required' });
  if (!contactEmail) return respond(400, { error: 'contact_email is required for email delivery' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event, tenantId);
  } catch (error) {
    return respond(error.statusCode || 401, { error: error.message });
  }

  const { supabase, operatorId } = ctx;
  const refs = {
    lead_id: clean(body.lead_id),
    bid_id: clean(body.bid_id),
    order_id: clean(body.order_id),
    job_id: clean(body.job_id),
  };

  try {
    const customer = await loadCustomer(supabase, tenantId, customerId);
    if (!customer) return respond(404, { error: 'Customer not found for this tenant' });
    if (contactEmail !== clean(customer.email).toLowerCase()) {
      return respond(409, { error: 'Customer email no longer matches the queued follow-up' });
    }

    await validateWorkflowState(supabase, tenantId, customerId, kind, refs);

    const recent = await recentKindInteraction(supabase, tenantId, customerId, kind);
    if (withinCooldown(kind, recent)) {
      return respond(409, { error: `Cooldown active for ${kind}` });
    }

    const brand = await loadBrandContext(supabase, tenantId);
    const delivery = await sendEmail({
      to: contactEmail,
      subject,
      html: textToHtml(message, brand.tenantName),
      replyTo: brand.replyTo || undefined,
    });

    if (delivery?.error) {
      const errorMessage = typeof delivery.error === 'string'
        ? delivery.error
        : (delivery.error?.message || 'Email delivery failed');
      return respond(502, { error: errorMessage });
    }

    const nowIso = new Date().toISOString();
    const metadata = {
      follow_up_kind: kind,
      source: 'operator_follow_up_queue',
      delivery: delivery?.skipped ? 'skipped_local' : 'email',
      email_subject: subject,
      lead_id: refs.lead_id || null,
      bid_id: refs.bid_id || null,
      order_id: refs.order_id || null,
      job_id: refs.job_id || null,
    };

    const { data: interaction, error: interactionError } = await supabase
      .from('customer_interactions')
      .insert({
        tenant_id: tenantId,
        operator_id: operatorId,
        customer_id: customerId,
        type: 'email',
        summary: `${kind.replace(/_/g, ' ')} sent to ${contactName || customer.name || contactEmail}`,
        metadata,
        created_at: nowIso,
      })
      .select('id')
      .maybeSingle();
    if (interactionError) return respond(500, { error: interactionError.message });

    const { error: customerError } = await supabase
      .from('customers')
      .update({ last_contact_at: nowIso, updated_at: nowIso })
      .eq('id', customerId)
      .eq('tenant_id', tenantId);
    if (customerError) return respond(500, { error: customerError.message });

    return respond(200, {
      ok: true,
      sent: !delivery?.skipped,
      skipped: Boolean(delivery?.skipped),
      interaction_id: interaction?.id || null,
    });
  } catch (error) {
    return respond(error.statusCode || 500, { error: error.message || 'Unable to send follow-up' });
  }
};
