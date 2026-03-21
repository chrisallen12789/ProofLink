// netlify/functions/admin-send-tenant-message.js
// Admin-only. Sends a direct email message to a tenant's owner.
//
// POST { tenant_id, subject, message }

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');
const { sendEmail }                    = require('./utils/email');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return respond(400, { error: 'Invalid JSON' }); }

  const { tenant_id, subject, message } = body;

  if (!tenant_id)               return respond(400, { error: 'tenant_id is required' });
  if (!subject || !subject.trim()) return respond(400, { error: 'subject is required' });
  if (!message || !message.trim()) return respond(400, { error: 'message is required' });
  if (subject.trim().length > 200)  return respond(400, { error: 'subject must be 200 characters or fewer' });
  if (message.trim().length > 4000) return respond(400, { error: 'message must be 4000 characters or fewer' });

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, owner_email, owner_name, slug')
    .eq('id', tenant_id)
    .maybeSingle();

  if (tenantErr || !tenant) return respond(404, { error: 'Tenant not found' });

  const safeMsg = message.trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const result = await sendEmail({
    to     : tenant.owner_email,
    subject: subject.trim(),
    html   : `<p>Hi ${tenant.owner_name},</p><p>${safeMsg}</p><p style="margin-top:2em;color:#9C9490;font-size:13px;">— The ProofLink Team</p>`,
  });

  if (result && result.error) {
    return respond(502, { error: 'Email delivery failed — check RESEND_API_KEY' });
  }

  return respond(200, { ok: true, tenant_id, to: tenant.owner_email });
};
