// netlify/functions/admin-stripe-health.js
// Admin-only. Verifies Stripe API key, counts connected accounts,
// and checks that webhook secrets are configured.
//
// GET (no body required)

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'GET')    return respond(405, { error: 'Method not allowed' });

  let ctx;
  try { ctx = await requireAdminContext(event); }
  catch (err) { return respond(err.statusCode || 401, { error: err.message }); }

  const { supabase } = ctx;

  // ── 1. Verify Stripe secret key by fetching account balance
  let stripeKeyOk  = false;
  let stripeKeyMsg = 'STRIPE_SECRET_KEY is not set.';

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    try {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (res.ok) {
        stripeKeyOk  = true;
        stripeKeyMsg = 'API key is valid and authenticated.';
      } else {
        const body = await res.json().catch(() => ({}));
        stripeKeyMsg = body?.error?.message || `Stripe returned ${res.status}.`;
      }
    } catch (e) {
      stripeKeyMsg = `Could not reach Stripe: ${e.message}`;
    }
  }

  // ── 2. Count tenants with an active Stripe Connect account
  let connectCount    = 0;
  let connectMsg      = 'No connected accounts found.';
  let connectOk       = false;

  const { count, error: connectErr } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('connect_status', 'connect_connected');

  if (!connectErr) {
    connectCount = count || 0;
    connectOk    = connectCount > 0;
    connectMsg   = connectCount === 1
      ? '1 business has an active payout account.'
      : `${connectCount} businesses have active payout accounts.`;
  } else {
    connectMsg = 'Could not query tenant connect status.';
  }

  // ── 3. Check webhook secret is present (can't verify Stripe registration from here)
  const hasWebhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET;
  const webhookOk        = hasWebhookSecret;
  const webhookMsg       = hasWebhookSecret
    ? 'Webhook secret is configured.'
    : 'STRIPE_WEBHOOK_SECRET is not set.';

  return respond(200, {
    stripe_key: { ok: stripeKeyOk, message: stripeKeyMsg },
    connect:    { ok: connectOk,   message: connectMsg, count: connectCount },
    webhook:    { ok: webhookOk,   message: webhookMsg },
  });
};
