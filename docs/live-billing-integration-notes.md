# ProofLink live billing integration pack

This pack moves the upgrade flow from scaffold to live Stripe wiring.

Included:
- real Stripe Checkout subscription session creator
- Stripe billing webhook handler
- Stripe billing portal session creator
- live billing page script
- SQL patch for Stripe customer/subscription fields

## Environment variables required

- STRIPE_SECRET_KEY
- STRIPE_BILLING_WEBHOOK_SECRET
- STRIPE_PRICE_GROWTH
- STRIPE_PRICE_ENTERPRISE
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- URL

## Critical implementation notes

1. Stripe product prices must already exist.
2. The tenant payment status endpoint should return:
   - id
   - owner_email
   - prooflink_plan_key
   - billing_status
   - connect_status
   - stripe_customer_id
3. Persist `tenant_id` and `target_plan` in checkout metadata.
4. Update `tenants.prooflink_plan_key` only from webhook truth.
5. Do not unlock paid features from client redirect alone.

## Recommended next step

Connect the Stripe Connect onboarding state and the billing state into one combined payment-truth card so operators see a single authoritative status.
