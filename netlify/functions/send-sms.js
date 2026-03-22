// netlify/functions/send-sms.js
// Sends an outbound SMS to a customer via Twilio.
// POST { to, body, customer_id?, order_id? }
// Requires env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID

'use strict';

const twilio = require('twilio');
const { requireOperatorContext, respond } = require('./utils/auth');

function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials not configured');
  return twilio(sid, token);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, tenantId, operatorId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { to, body: msgBody, customer_id, order_id } = body;
  if (!to || !msgBody) return respond(400, { error: 'Missing to or body' });

  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!messagingServiceSid) return respond(503, { error: 'TWILIO_MESSAGING_SERVICE_SID not configured' });

  let client;
  try { client = getTwilioClient(); }
  catch (e) { return respond(503, { error: e.message }); }

  let twilioSid = null;
  let sendError = null;
  try {
    const message = await client.messages.create({
      messagingServiceSid,
      to,
      body: msgBody,
    });
    twilioSid = message.sid;
  } catch (e) {
    sendError = e.message || String(e);
  }

  // Store in sms_messages regardless of send success (for audit trail)
  const { error: dbError } = await supabase
    .from('sms_messages')
    .insert({
      tenant_id  : tenantId,
      operator_id: operatorId,
      direction  : 'outbound',
      from_number: messagingServiceSid,
      to_number  : to,
      body       : msgBody,
      status     : sendError ? 'failed' : 'sent',
      twilio_sid : twilioSid || null,
      customer_id: customer_id || null,
      order_id   : order_id   || null,
      created_at : new Date().toISOString(),
    });

  if (dbError) console.error('[send-sms] db insert error:', dbError);

  if (sendError) {
    console.error('[send-sms] Twilio error:', sendError);
    return respond(502, { error: sendError });
  }

  return respond(200, { ok: true, sid: twilioSid });
};
