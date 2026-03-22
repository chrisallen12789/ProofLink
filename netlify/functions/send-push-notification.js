// netlify/functions/send-push-notification.js
// Internal utility. Sends a Web Push notification to all subscribers for a tenant.
// POST { tenant_id, title, body, url? }
// Called server-to-server from other functions (not exposed to browser directly).

'use strict';

const webPush = require('web-push');
const { requireAdminContext, respond } = require('./utils/auth');

function getVapidConfig() {
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email      = process.env.VAPID_EMAIL || process.env.FROM_EMAIL || 'hello@prooflink.co';
  if (!publicKey || !privateKey) throw new Error('VAPID keys not configured');
  return { publicKey, privateKey, email };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { tenant_id, title, body: msgBody, url } = body;
  if (!tenant_id || !title) return respond(400, { error: 'Missing tenant_id or title' });

  let vapid;
  try { vapid = getVapidConfig(); }
  catch (e) { return respond(503, { error: e.message }); }

  webPush.setVapidDetails(`mailto:${vapid.email}`, vapid.publicKey, vapid.privateKey);

  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('tenant_id', tenant_id);

  if (subsErr) return respond(500, { error: 'Failed to fetch subscriptions' });
  if (!subs?.length) return respond(200, { ok: true, sent: 0, message: 'No subscribers' });

  const payload = JSON.stringify({ title, body: msgBody || '', url: url || '/operator/' });

  const results = await Promise.allSettled(
    subs.map((row) => webPush.sendNotification(row.subscription, payload))
  );

  const sent   = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;

  return respond(200, { ok: true, sent, failed });
};
