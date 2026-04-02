const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { normalizeBillingStatus } = require('./_prooflink_payments');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(secret);
}

function getWebhookSecret() {
  return (
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET ||
    process.env.STRIPE_WEBHOOK_CONNECT_SECRET ||
    process.env.STRIPE_BILLING_WEBHOOK_SECRET ||
    ''
  );
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createClient(url, key);
}

async function claimWebhookEvent(supabase, eventId) {
  if (!eventId) return { claimed: false, skipped: false };

  try {
    const { error } = await supabase
      .from('processed_webhook_events')
      .insert({
        event_id: eventId,
        processed_at: new Date().toISOString(),
      });

    if (!error) return { claimed: true, skipped: false };

    if (
      error.code === '23505' ||
      error.code === '409' ||
      /duplicate key/i.test(error.message || '')
    ) {
      return { claimed: false, skipped: true };
    }

    if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
      console.warn('[stripe-billing-webhook] processed_webhook_events table missing - skipping idempotency');
      return { claimed: false, skipped: false };
    }

    console.warn('[stripe-billing-webhook] idempotency claim failed:', error.message);
    return { claimed: false, skipped: false };
  } catch (err) {
    console.warn('[stripe-billing-webhook] idempotency claim failed, proceeding:', err?.message);
    return { claimed: false, skipped: false };
  }
}

async function releaseWebhookEvent(supabase, eventId) {
  if (!eventId) return;

  try {
    await supabase
      .from('processed_webhook_events')
      .delete()
      .eq('event_id', eventId);
  } catch (err) {
    console.warn('[stripe-billing-webhook] failed to release idempotency claim:', err?.message);
  }
}

async function updateTenantPlanFromSession(session, supabase) {
  const tenantId = session?.metadata?.tenant_id;
  const targetPlan = session?.metadata?.target_plan;

  if (!tenantId || !targetPlan) return;

  const { error } = await supabase
    .from('tenants')
    .update({
      prooflink_plan_key: targetPlan,
      billing_status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenantId);

  if (error) throw error;
}

async function updateSubscriptionState(subscription, supabase) {
  const tenantId = subscription?.metadata?.tenant_id;
  if (!tenantId) return;

  const billingStatus = normalizeBillingStatus(subscription.status);

  const { error } = await supabase
    .from('tenants')
    .update({
      billing_status: billingStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenantId);

  if (error) throw error;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  let supabase = null;
  let eventId = '';
  let claimedEvent = false;

  try {
    const stripe = getStripe();
    const webhookSecret = getWebhookSecret();
    if (!webhookSecret) throw new Error('Missing STRIPE_CONNECT_WEBHOOK_SECRET');

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');

    const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    const stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    eventId = String(stripeEvent?.id || '').trim();

    supabase = getSupabase();
    if (eventId) {
      const claim = await claimWebhookEvent(supabase, eventId);
      if (claim.skipped) {
        return json(200, { ok: true, received: true, skipped: true });
      }
      claimedEvent = claim.claimed;
    }

    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await updateTenantPlanFromSession(stripeEvent.data.object, supabase);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await updateSubscriptionState(stripeEvent.data.object, supabase);
        break;

      default:
        break;
    }

    return json(200, { ok: true, received: true });
  } catch (error) {
    if (claimedEvent && supabase && eventId) {
      await releaseWebhookEvent(supabase, eventId);
    }
    return json(400, { ok: false, error: error.message || 'Webhook failed' });
  }
};
