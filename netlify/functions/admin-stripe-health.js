// netlify/functions/admin-stripe-health.js
// Admin-only. Verifies Stripe API key, payout readiness, billing readiness,
// and webhook configuration.
//
// GET (no body required)

'use strict';

const { requireAdminContext, respond } = require('./utils/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(204, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireAdminContext(event);
  } catch (err) {
    return respond(err.statusCode || 401, { error: err.message });
  }

  const { supabase } = ctx;

  let stripeKeyOk = false;
  let stripeKeyMsg = 'STRIPE_SECRET_KEY is not set.';

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    try {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (res.ok) {
        stripeKeyOk = true;
        stripeKeyMsg = 'API key is valid and authenticated.';
      } else {
        const body = await res.json().catch(() => ({}));
        stripeKeyMsg = body?.error?.message || `Stripe returned ${res.status}.`;
      }
    } catch (e) {
      stripeKeyMsg = `Could not reach Stripe: ${e.message}`;
    }
  }

  let connectCount = 0;
  let onlinePaymentsCount = 0;
  let billingCustomerCount = 0;
  let connectMsg = 'No connected accounts found.';
  let connectOk = false;

  const { count: connectedCount, error: connectErr } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('connect_status', 'connect_connected');

  const { count: onlineCount, error: onlinePaymentsErr } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('online_payments_enabled', true);

  const { count: billingCount, error: billingCustomerErr } = await supabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .not('stripe_customer_id', 'is', null);

  if (!connectErr) {
    connectCount = connectedCount || 0;
    connectOk = connectCount > 0;
    connectMsg = connectCount === 1
      ? '1 business has an active payout account.'
      : `${connectCount} businesses have active payout accounts.`;
  } else {
    connectMsg = 'Could not query tenant connect status.';
  }

  if (!onlinePaymentsErr) {
    onlinePaymentsCount = onlineCount || 0;
  }

  if (!billingCustomerErr) {
    billingCustomerCount = billingCount || 0;
  }

  const hasPlatformWebhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET;
  const hasBillingWebhookSecret = !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const webhookOk = hasPlatformWebhookSecret && hasBillingWebhookSecret;
  const webhookMsg = webhookOk
    ? 'Platform and billing webhook secrets are configured.'
    : 'One or more Stripe webhook secrets are missing.';

  const readinessOk = stripeKeyOk && !connectErr && !onlinePaymentsErr && !billingCustomerErr && webhookOk;

  return respond(200, {
    summary: {
      ok: readinessOk,
      message: readinessOk
        ? 'Stripe configuration and billing readiness checks passed.'
        : 'One or more Stripe readiness checks need attention.',
    },
    stripe_key: { ok: stripeKeyOk, message: stripeKeyMsg },
    connect: {
      ok: connectOk,
      message: connectMsg,
      count: connectCount,
      online_payments_enabled_count: onlinePaymentsCount,
      billing_customer_count: billingCustomerCount,
    },
    webhook: {
      ok: webhookOk,
      message: webhookMsg,
      platform_secret_present: hasPlatformWebhookSecret,
      billing_secret_present: hasBillingWebhookSecret,
    },
  });
};
