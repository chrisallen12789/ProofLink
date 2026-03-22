// netlify/functions/twilio-webhook.js
// Receives inbound SMS from Twilio and stores them in sms_messages.
// Configure this as the Twilio webhook URL for your phone number:
//   https://yoursite.netlify.app/.netlify/functions/twilio-webhook
// Twilio POST fields: From, To, Body, MessageSid, etc.

'use strict';

const twilio      = require('twilio');
const querystring = require('querystring');
const { getAdminClient, respond } = require('./utils/auth');
const { sendEmail, templates }    = require('./utils/email');
const { getConfiguredSiteUrl }    = require('./utils/runtime-config');

function validateTwilio(event) {
  const secret = process.env.TWILIO_AUTH_TOKEN;
  if (!secret) return true; // skip validation if not configured (dev only)

  const signature = event.headers?.['x-twilio-signature'] || event.headers?.['X-Twilio-Signature'];
  if (!signature) return false;

  const url    = (process.env.SITE_URL || process.env.URL || 'https://prooflink.co') + '/.netlify/functions/twilio-webhook';
  const params = querystring.parse(event.body || '');
  return twilio.validateRequest(secret, signature, url, params);
}

function twimlOk(message) {
  return {
    statusCode: 200,
    headers   : { 'Content-Type': 'text/xml' },
    body      : message
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return twimlOk();

  // Validate Twilio signature in production
  if (process.env.NODE_ENV !== 'test' && !validateTwilio(event)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  const params = querystring.parse(event.body || '');
  const from   = params.From  || '';
  const to     = params.To    || '';
  const body   = params.Body  || '';
  const sid    = params.MessageSid || '';

  if (!from || !body) return twimlOk();

  const supabase = getAdminClient();

  // Attempt to find a matching tenant by looking up recent outbound messages to this number
  let tenantId   = null;
  let customerId = null;
  const { data: recent } = await supabase
    .from('sms_messages')
    .select('tenant_id, customer_id')
    .eq('to_number', from)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (recent) {
    tenantId   = recent.tenant_id;
    customerId = recent.customer_id;
  }

  // Store the inbound message
  const { error } = await supabase
    .from('sms_messages')
    .insert({
      tenant_id  : tenantId,
      operator_id: null,
      direction  : 'inbound',
      from_number: from,
      to_number  : to,
      body,
      status     : 'received',
      twilio_sid : sid || null,
      customer_id: customerId || null,
      order_id   : null,
      created_at : new Date().toISOString(),
    });

  if (error) console.error('[twilio-webhook] db error:', error);

  // Send push notification + email to operator(s) about inbound SMS
  if (tenantId) {
    try {
      // Push notification to all operator subscriptions for this tenant
      const webpush = require('web-push');
      const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
      const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
      const vapidEmail   = process.env.VAPID_EMAIL || 'mailto:support@prooflink.co';
      if (vapidPublic && vapidPrivate) {
        webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('subscription')
          .eq('tenant_id', tenantId);
        if (subs?.length) {
          const payload = JSON.stringify({ title: 'New SMS reply', body: `From ${from}: ${body.slice(0, 80)}`, url: '/operator/#orders' });
          await Promise.allSettled(subs.map((s) => {
            try { return webpush.sendNotification(JSON.parse(s.subscription), payload); }
            catch { return Promise.resolve(); }
          }));
        }
      }

      // Email the operator(s) about the reply
      const { data: operators } = await supabase
        .from('operators')
        .select('email')
        .eq('tenant_id', tenantId)
        .limit(5);
      if (operators?.length) {
        const siteUrl = getConfiguredSiteUrl();
        for (const op of operators) {
          if (!op.email) continue;
          sendEmail({
            to     : op.email,
            subject: `New SMS reply from ${from}`,
            html   : `<p>A customer replied via SMS:</p><p><strong>${from}</strong>: ${body}</p><p><a href="${siteUrl}/operator/">View in dashboard →</a></p>`,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[twilio-webhook] notification failed:', e.message);
    }
  }

  // No auto-reply — operator handles it from the dashboard
  return twimlOk();
};
