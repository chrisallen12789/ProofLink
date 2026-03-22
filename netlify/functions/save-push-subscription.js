// netlify/functions/save-push-subscription.js
// Saves a Web Push subscription for the authenticated operator.
// POST { subscription: PushSubscription JSON }

'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireOperatorContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase, operatorId, tenantId } = ctx;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid JSON' }); }

  const { subscription } = body;
  if (!subscription?.endpoint) return respond(400, { error: 'Missing push subscription' });

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      operator_id  : operatorId,
      tenant_id    : tenantId,
      endpoint     : subscription.endpoint,
      subscription : subscription,
      updated_at   : new Date().toISOString(),
    }, { onConflict: 'operator_id,endpoint' });

  if (error) {
    console.error('[save-push-subscription]', error);
    return respond(500, { error: 'Failed to save subscription' });
  }

  return respond(200, { ok: true });
};
