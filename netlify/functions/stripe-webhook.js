// FILE: netlify/functions/stripe-webhook.js
const {
  buildTenantPaymentState,
  clean,
  json,
  normalizeBillingStatus,
  normalizeConnectStatus,
  patchTenant,
  supabaseAdmin,
  verifyStripeSignature,
  findTenantByStripeAccount,
  findTenantByStripeCustomer,
  findTenantByStripeSubscription,
} = require('./_prooflink_payments');

function rawBody(event) {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || '', 'base64').toString('utf8');
  }
  return event.body || '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bool(value) {
  return value === true;
}

function looksLikeStripeAccountId(value) {
  return /^acct_/.test(clean(value));
}

function getConnectedAccountId(evt = {}, obj = {}) {
  const candidates = [
    evt?.account,
    obj?.account,
    obj?.account_id,
    obj?.related_object?.account,
    obj?.related_object?.id,
    obj?.object?.account,
    obj?.object?.id,
    obj?.id,
  ];

  return clean(candidates.find(looksLikeStripeAccountId) || '');
}

function verifyAgainstAnySecret(body, signature, secrets) {
  for (const secret of secrets) {
    try {
      if (verifyStripeSignature(body, signature, secret)) {
        return true;
      }
    } catch (_) {
      // continue
    }
  }
  return false;
}

function getWebhookSecrets() {
  return [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].map(s => clean(s)).filter(Boolean);
}

function getStripeSecretKey() {
  return clean(process.env.STRIPE_SECRET_KEY);
}

function getSupabaseIdempotencyClient() {
  const url = clean(process.env.SUPABASE_URL);
  const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    console.warn('[stripe-webhook] skipping idempotency check because Supabase admin env is missing');
    return null;
  }
  return require('@supabase/supabase-js').createClient(url, serviceRoleKey);
}

async function claimWebhookEvent(supabase, eventId) {
  if (!supabase || !eventId) return { claimed: false, skipped: false };

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
      console.warn('[stripe-webhook] processed_webhook_events table does not exist - skipping idempotency');
      return { claimed: false, skipped: false };
    }

    console.warn('[stripe-webhook] idempotency claim failed:', error.message);
    return { claimed: false, skipped: false };
  } catch (err) {
    console.warn('[stripe-webhook] idempotency claim failed, proceeding:', err?.message);
    return { claimed: false, skipped: false };
  }
}

async function releaseWebhookEvent(supabase, eventId) {
  if (!supabase || !eventId) return;

  try {
    await supabase
      .from('processed_webhook_events')
      .delete()
      .eq('event_id', eventId);
  } catch (err) {
    console.warn('[stripe-webhook] failed to release idempotency claim:', err?.message);
  }
}

async function stripeRequest(path, options = {}) {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }

  const res = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.headers || {}),
    },
    body: options.body || undefined,
    signal: AbortSignal.timeout(8000),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `Stripe request failed: ${res.status}`;
    throw new Error(message);
  }

  return data;
}

async function fetchStripeAccountState(accountId) {
  const id = clean(accountId);
  if (!id) return null;

  try {
    const account = await stripeRequest(`/v1/accounts/${encodeURIComponent(id)}`);
    return account || null;
  } catch (err) {
    console.error('[stripe-webhook] fetchStripeAccountState failed', {
      accountId: id,
      error: err?.message || String(err),
    });
    return null;
  }
}

async function patchPaymentBySession(sessionId, patch) {
  const value = clean(sessionId);
  if (!value) return null;

  const path = `/rest/v1/payments?stripe_checkout_session_id=eq.${encodeURIComponent(value)}`;
  return supabaseAdmin(path, 'PATCH', {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

async function resolveTenantIdFromSubscription(obj = {}) {
  const metadataTenantId = clean(obj?.metadata?.tenant_id || obj?.metadata?.tenant_slug);
  if (metadataTenantId) return metadataTenantId;

  const bySubscription = await findTenantByStripeSubscription(clean(obj?.id)).catch(() => null);
  if (bySubscription?.slug || bySubscription?.tenant_id || bySubscription?.id) {
    return clean(bySubscription.slug || bySubscription.tenant_id || bySubscription.id);
  }

  const byCustomer = await findTenantByStripeCustomer(clean(obj?.customer)).catch(() => null);
  return clean(byCustomer?.slug || byCustomer?.tenant_id || byCustomer?.id);
}

function hasNoRequirements(obj = {}) {
  const currentDue = asArray(obj?.requirements?.currently_due);
  const pastDue = asArray(obj?.requirements?.past_due);
  const eventuallyDue = asArray(obj?.requirements?.eventually_due);
  const futureCurrentDue = asArray(obj?.future_requirements?.currently_due);
  const futurePastDue = asArray(obj?.future_requirements?.past_due);

  return (
    currentDue.length === 0 &&
    pastDue.length === 0 &&
    eventuallyDue.length === 0 &&
    futureCurrentDue.length === 0 &&
    futurePastDue.length === 0
  );
}

function hasActiveCapability(obj = {}) {
  const legacyCapabilities = obj?.capabilities || {};
  const merchantCapabilities = obj?.configuration?.merchant?.capabilities || {};
  const recipientCapabilities = obj?.configuration?.recipient?.capabilities || {};
  const combined = {
    ...legacyCapabilities,
    ...merchantCapabilities,
    ...recipientCapabilities,
  };

  return Object.values(combined).some((value) => {
    if (value === true) return true;
    if (typeof value === 'string') {
      return ['active', 'enabled'].includes(value.toLowerCase());
    }
    if (value && typeof value === 'object') {
      return ['active', 'enabled'].includes(
        String(value.status || '').toLowerCase()
      );
    }
    return false;
  });
}

function isAccountReady(obj = {}) {
  const legacyReady =
    bool(obj?.charges_enabled) &&
    bool(obj?.payouts_enabled) &&
    (bool(obj?.details_submitted) || hasNoRequirements(obj));

  const v2DisabledReason = clean(
    obj?.configuration?.merchant?.disabled_reason ||
      obj?.configuration?.recipient?.disabled_reason ||
      obj?.configuration?.customer?.disabled_reason ||
      obj?.status_details?.disabled_reason ||
      obj?.disabled_reason
  );

  const v2Ready =
    !v2DisabledReason &&
    hasNoRequirements(obj) &&
    (hasActiveCapability(obj) || bool(obj?.charges_enabled) || bool(obj?.payouts_enabled));

  return legacyReady || v2Ready;
}

async function resolveTenantKeyFromAccountObject(evt = {}, obj = {}, explicitAccountId = '') {
  const metadataTenantKey = clean(
    obj?.metadata?.tenant_id ||
      obj?.metadata?.tenant_slug ||
      obj?.metadata?.tenantKey
  );
  if (metadataTenantKey) return metadataTenantKey;

  const accountId = clean(explicitAccountId || getConnectedAccountId(evt, obj));
  if (!accountId) return '';

  const tenant = await findTenantByStripeAccount(accountId).catch(() => null);
  return clean(tenant?.slug || tenant?.tenant_id || tenant?.id);
}

async function patchTenantFromConnectedAccount(evt = {}, obj = {}, eventType = '') {
  const accountId = clean(getConnectedAccountId(evt, obj));
  if (!accountId) {
    console.log('[stripe-webhook] no connected account id found for event', eventType);
    return null;
  }

  const tenantKey = await resolveTenantKeyFromAccountObject(evt, obj, accountId);
  if (!tenantKey) {
    console.log('[stripe-webhook] no tenant found for connected account', accountId);
    return null;
  }

  const existingTenant = (await findTenantByStripeAccount(accountId).catch(() => null)) || {};
  const currentState = buildTenantPaymentState(existingTenant);

  const liveAccount = await fetchStripeAccountState(accountId);
  const accountSource = liveAccount || obj;
  const accountReady = isAccountReady(accountSource);

  const patch = {
    stripe_connect_account_id: accountId || null,
    connect_status: normalizeConnectStatus(
      accountReady ? 'connect_connected' : 'connect_incomplete'
    ),
    payments_enabled: accountReady,
    online_payments_enabled: currentState.billingStatus === 'active' && accountReady,
    updated_at: new Date().toISOString(),
    last_stripe_connect_event: clean(eventType) || null,
  };

  console.log(
    '[stripe-webhook] patchTenantFromConnectedAccount',
    JSON.stringify(
      {
        eventType,
        tenantKey,
        accountId,
        usedLiveAccountFetch: !!liveAccount,
        charges_enabled: accountSource?.charges_enabled ?? null,
        payouts_enabled: accountSource?.payouts_enabled ?? null,
        details_submitted: accountSource?.details_submitted ?? null,
        requirements: accountSource?.requirements || null,
        future_requirements: accountSource?.future_requirements || null,
        accountReady,
        patch,
      },
      null,
      2
    )
  );

  return patchTenant(tenantKey, patch).catch((err) => {
    console.error('[stripe-webhook] patchTenant failed', {
      tenantKey,
      accountId,
      error: err?.message || String(err),
    });
    return null;
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const sig =
    event.headers['stripe-signature'] ||
    event.headers['Stripe-Signature'] ||
    '';

  const body = rawBody(event);
  const webhookSecrets = getWebhookSecrets();

  if (!sig || webhookSecrets.length === 0) {
    return json(400, { ok: false, error: 'Missing Stripe signature or webhook secret.' });
  }

  if (!verifyAgainstAnySecret(body, sig, webhookSecrets)) {
    return json(400, { ok: false, error: 'Invalid Stripe signature.' });
  }

  let evt = null;
  let type = '';
  let obj = {};

  try {
    evt = JSON.parse(body || '{}');
    type = String(evt?.type || '');
    obj = evt?.data?.object || {};
  } catch (e) {
    return json(400, { ok: false, error: e.message || String(e) });
  }

  let eventId = '';
  let idempotencyClient = null;
  let claimedEvent = false;

  try {
    // ── Idempotency check ──────────────────────────────────────────────────────
    // Idempotency check
    eventId = clean(evt?.id || '');
    if (eventId) {
      idempotencyClient = getSupabaseIdempotencyClient();
      const claim = await claimWebhookEvent(idempotencyClient, eventId);
      if (claim.skipped) {
        return json(200, { ok: true, skipped: true });
      }
      claimedEvent = claim.claimed;
    }

    console.log(
      '[stripe-webhook]',
      JSON.stringify(
        {
          type,
          livemode: !!evt?.livemode,
          eventAccount: evt?.account || null,
          objectId: obj?.id || null,
          objectAccount: obj?.account || null,
          relatedObject: obj?.related_object || null,
        },
        null,
        2
      )
    );

    if (type === 'checkout.session.completed') {
      const purpose = clean(obj?.metadata?.purpose);

      if (purpose === 'prooflink_platform_billing') {
        const tenantFromCustomer = await findTenantByStripeCustomer(clean(obj?.customer)).catch(
          () => null
        );
        const planKey = clean(obj?.metadata?.plan_key || obj?.metadata?.target_plan);

        const tenantId =
          clean(obj?.metadata?.tenant_id) ||
          clean(obj?.metadata?.tenant_slug) ||
          clean(obj?.client_reference_id) ||
          clean(tenantFromCustomer?.slug || tenantFromCustomer?.tenant_id || '');

        if (tenantId) {
          await patchTenant(tenantId, {
            billing_status: 'active',
            ...(planKey ? { prooflink_plan_key: planKey } : {}),
            stripe_customer_id: obj.customer || null,
            stripe_subscription_id: obj.subscription || null,
            updated_at: new Date().toISOString(),
          }).catch(() => null);
        }
      }

      if (purpose === 'tenant_order_checkout') {
        await patchPaymentBySession(obj.id, {
          status: 'paid',
          stripe_payment_intent_id: obj.payment_intent || null,
          stripe_customer_id: obj.customer || null,
          paid_at: new Date().toISOString(),
          livemode: !!obj.livemode,
        });

        const orderId = clean(obj?.metadata?.order_id);
        const tenantId = clean(obj?.metadata?.tenant_id || obj?.metadata?.tenant_slug);

        if (orderId && tenantId) {
          await supabaseAdmin(
            `/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
            'PATCH',
            {
              status: 'paid',
              updated_at: new Date().toISOString(),
            }
          );
        }
      }
    }

    if (type === 'checkout.session.expired') {
      await patchPaymentBySession(obj.id, { status: 'expired' });
    }

    if (
      type === 'customer.subscription.created' ||
      type === 'customer.subscription.updated' ||
      type === 'customer.subscription.deleted'
    ) {
      const tenantId = await resolveTenantIdFromSubscription(obj);
      if (tenantId) {
        await patchTenant(tenantId, {
          billing_status:
            type === 'customer.subscription.deleted'
              ? 'canceled'
              : normalizeBillingStatus(obj?.status),
          stripe_subscription_id: obj.id || null,
          stripe_customer_id: obj.customer || null,
          updated_at: new Date().toISOString(),
        }).catch(() => null);
      }
    }

    if (type === 'payment_intent.payment_failed') {
      const sessionId = clean(obj?.metadata?.checkout_session_id);
      if (sessionId) {
        await patchPaymentBySession(sessionId, { status: 'failed' });
      }
    }

    if (type === 'payment_intent.succeeded') {
      const sessionId = clean(obj?.metadata?.checkout_session_id);
      if (sessionId) {
        await patchPaymentBySession(sessionId, {
          status: 'paid',
          stripe_payment_intent_id: obj.id || null,
          paid_at: new Date().toISOString(),
        });
      }
    }

    if (type === 'charge.refunded') {
      const paymentIntent = clean(obj?.payment_intent);
      if (paymentIntent) {
        await supabaseAdmin(
          `/rest/v1/payments?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntent)}`,
          'PATCH',
          {
            status: 'refunded',
            refunded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        ).catch(() => null);
      }
    }

    if (
      type === 'account.updated' ||
      type === 'account.application.authorized' ||
      type === 'capability.updated' ||
      type === 'person.created' ||
      type === 'person.updated' ||
      type === 'person.deleted'
    ) {
      await patchTenantFromConnectedAccount(evt, obj, type);
    }

    if (
      type === 'v2.core.account.created' ||
      type === 'v2.core.account.updated' ||
      type === 'v2.core.account.closed' ||
      type === 'v2.core.account[requirements].updated' ||
      type === 'v2.core.account[identity].updated' ||
      type === 'v2.core.account[configuration.customer].updated' ||
      type === 'v2.core.account[configuration.merchant].updated' ||
      type === 'v2.core.account[configuration.recipient].updated' ||
      type === 'v2.core.account[configuration.customer].capability_status_updated' ||
      type === 'v2.core.account[configuration.merchant].capability_status_updated' ||
      type === 'v2.core.account[configuration.recipient].capability_status_updated' ||
      type === 'v2.core.account_person.created' ||
      type === 'v2.core.account_person.updated' ||
      type === 'v2.core.account_person.deleted'
    ) {
      await patchTenantFromConnectedAccount(evt, obj, type);
    }

    return json(200, { ok: true });
  } catch (e) {
    if (claimedEvent && idempotencyClient && eventId) {
      await releaseWebhookEvent(idempotencyClient, eventId);
    }
    return json(500, { ok: false, error: e.message || String(e) });
  }
};
