# ProofLink Provider-Neutral Payments Architecture

## Goal

Replace "Stripe is the architecture" with "Stripe is one adapter."

This document is the recommended technical direction if ProofLink wants something other than Stripe without exploding compliance scope.

## Current state

The current payment system mixes three concerns together:

- ProofLink business rules
- Stripe-specific API calls and object IDs
- operator/customer UI state

That coupling shows up in:

- `_prooflink_payments.js` as a combined utility and Stripe transport layer
- Stripe-named endpoints for checkout, billing, connect, and webhooks
- Stripe-specific columns directly shaping tenant and payment state
- operator UI scripts that assume Stripe customer IDs and billing portal behavior

## Target state

ProofLink should own these layers:

1. Payment domain model
2. Provider adapter contract
3. Generic platform endpoints
4. Normalized event and reconciliation records
5. Feature flags for provider rollout

ProofLink should not own:

- raw PAN or CVV handling
- direct card vaulting unless a PCI strategy is explicitly approved
- direct network/acquirer processor logic in the initial abstraction phase

## Suggested backend shape

Recommended new internal structure:

- `netlify/functions/lib/payments/domain.js`
- `netlify/functions/lib/payments/provider-registry.js`
- `netlify/functions/lib/payments/providers/stripe.js`
- `netlify/functions/lib/payments/providers/<next-provider>.js`
- `netlify/functions/lib/payments/webhook-dispatch.js`
- `netlify/functions/lib/payments/status.js`
- `netlify/functions/lib/payments/reconciliation.js`

Generic endpoint names to move toward:

- `create-order-payment-session`
- `create-platform-billing-session`
- `create-tenant-payment-account-link`
- `create-customer-billing-session`
- `payment-webhook`
- `billing-webhook`
- `tenant-payment-status`

Migration note:

- the existing Stripe-named endpoints can remain as compatibility wrappers during the first refactor

## Suggested adapter contract

Each provider adapter should implement the same shape:

- `createTenantOnboardingLink()`
- `getTenantAccountStatus()`
- `createOrderCheckoutSession()`
- `createPlatformSubscriptionSession()`
- `createBillingPortalSession()`
- `verifyWebhookSignature()`
- `parseWebhookEvent()`
- `applyWebhookEvent()`
- `normalizePaymentReference()`

Every adapter response should normalize into ProofLink-owned objects before UI or tenant status logic sees it.

## Suggested ProofLink-owned domain objects

Do not model these as "Stripe mirrors." Model them as ProofLink concepts.

Core objects:

- `payment_provider`
- `tenant_payment_account`
- `platform_billing_account`
- `payment_session`
- `payment_attempt`
- `payment_event`
- `payout_event`
- `dispute_event`
- `refund_event`
- `reconciliation_entry`

Recommended normalized fields:

- `provider_key`
- `provider_account_ref`
- `provider_customer_ref`
- `provider_payment_ref`
- `provider_session_ref`
- `provider_subscription_ref`
- `provider_event_ref`
- `status`
- `status_reason`
- `amount_cents`
- `currency`
- `tenant_id`
- `order_id`
- `job_id`
- `invoice_id`
- `customer_id`
- `metadata`

## Suggested database direction

Short term:

- keep existing Stripe columns for continuity
- add provider-neutral columns or companion tables for new work

Medium term:

- stop making UI or business logic depend directly on `stripe_*` columns
- treat `stripe_*` fields as adapter details or legacy compatibility fields

Candidate additions:

- `tenant_payment_accounts`
- `payment_provider_events`
- `payment_reconciliation_entries`
- `platform_billing_accounts`

## Suggested rollout sequence

### Phase 0. Freeze the risk boundary

- no raw card storage
- no new direct card-data handling
- no UI change that would move ProofLink out of hosted/tokenized capture without explicit approval

### Phase 1. Extract a Stripe adapter

- move direct Stripe request logic behind one provider contract
- keep current behavior unchanged
- make generic service functions call the adapter, not Stripe directly

### Phase 2. Normalize tenant/payment state

- build one ProofLink-owned payment status object
- make operator UI read normalized status, not Stripe-specific fields
- isolate connect/onboarding/billing state translation in the adapter layer

### Phase 3. Add generic endpoints

- introduce generic endpoint names
- keep current Stripe endpoints as wrappers or aliases
- update frontend gradually behind feature flags

### Phase 4. Add second provider

- only after parity tests pass for the generic layer
- onboard a single internal test tenant first
- verify checkout, refunds, disputes, webhooks, and reconciliation

### Phase 5. Consider sponsored PayFac economics

- only after multi-provider support, stronger reporting, support workflows, and ledger/reconciliation maturity exist

## Files to abstract first

Highest-priority refactor targets:

- `netlify/functions/_prooflink_payments.js`
- `netlify/functions/stripe-order-checkout.js`
- `netlify/functions/portal-checkout.js`
- `netlify/functions/stripe-platform-checkout.js`
- `netlify/functions/stripe-webhook.js`
- `netlify/functions/stripe-billing-webhook.js`
- `netlify/functions/stripe-connect-link.js`
- `netlify/functions/create-billing-portal-session.js`
- `netlify/functions/create-billing-upgrade-session.js`
- `netlify/functions/tenant-payment-status.js`
- `operator/billing.live.js`
- `operator/payments.js`

## Non-negotiable design rules

- All backend logic remains in Netlify Functions.
- All operator/admin endpoints continue to use `requireOperatorContext()` or `requireAdminContext()`.
- Use `respond()` or the existing JSON helper patterns consistently.
- Never expose service-role secrets or provider secrets to the browser.
- Never store PAN, CVV, magnetic stripe data, or equivalent secrets.
- Webhooks remain signature-verified and idempotent.
- Tenant isolation remains enforced through `tenant_id` and RLS-aware access patterns.

## Definition of done for the abstraction

The abstraction is not done when a second provider compiles.

It is done when:

- checkout, billing, and onboarding flows call generic ProofLink services
- UI reads normalized payment status
- provider-specific IDs are no longer the main domain contract
- webhook handling is adapter-based and idempotent
- ProofLink can add a second provider without redesigning the payment model again
