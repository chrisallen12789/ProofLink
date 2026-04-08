# Payment Incident Checklist

Use this checklist when checkout, billing, webhook processing, or payout readiness is in doubt.

## 1. Classify the incident

Determine which class of failure you are seeing:

- Checkout or customer payment creation failed
- Webhook verified but processing did not complete
- Billing portal or customer portal state is wrong
- Connected-account or payout readiness is wrong
- Subscription or billing exemption state is wrong

## 2. Check admin Stripe health first

Run the admin Stripe health endpoint and confirm:

- Stripe API key is valid
- Platform webhook secret is present
- Billing webhook secret is present
- Connected-account count is reasonable
- Online payments enabled count is reasonable
- Billing customer count is reasonable

If the readiness summary is not healthy, stop and fix configuration before deeper workflow debugging.

## 3. Verify the touched workflow family

For checkout failures:

- Confirm the tenant has the expected Stripe and Connect readiness
- Confirm the checkout path still uses the correct canonical amount fields
- Confirm no recent code changed application fee or payment routing unexpectedly

For webhook failures:

- Confirm signature verification still succeeds
- Confirm the idempotency table is present and writable
- Confirm post-verification processing returns retryable failures when state is incomplete

For portal or billing-state drift:

- Confirm the portal is reading canonical amount and due fields
- Confirm subscription and invoice webhooks have processed successfully
- Confirm stale legacy fields are not driving display state

## 4. Run the minimum recovery checks

From the repo root:

```bash
npm run test:unit
npm run test:preflight:release-readiness
```

When billing or workflow schema may be involved, also run the relevant hosted preflight and integration checks.

## 5. Decide rollback versus fix-forward

Rollback immediately when:

- Payment creation is broadly broken
- Webhook processing cannot be trusted
- Billing state is mutating incorrectly
- Tenant isolation or auth correctness is in doubt

Fix forward only when:

- The issue is narrow
- Configuration is understood
- A targeted regression and verification loop exists before redeploy

## 6. Record the incident

For every payment incident, capture:

- Triggering workflow
- Time first observed
- Whether the failure was config, schema, logic, or third-party reachability
- Whether rollback was required
- Which regression or readiness check should be added so the same failure is caught earlier next time
