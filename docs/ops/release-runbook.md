# ProofLink Release Runbook

This is the canonical deploy checklist for ProofLink.

Use this runbook for every production-facing release.

## 1. Pre-release gating

Run these from the repo root:

```bash
npm run test:unit
npm run test:preflight:release-readiness
```

When the release touches service-workflow paths, also run:

```bash
npm run test:preflight:service-workflow
npm run test:integration:service-workflow
```

When the release touches browser-critical operator or service workflows, also run the relevant Playwright suites.

Stop if any required gate fails.

## 2. Configuration and dependency checks

Confirm:

- Stripe keys and webhook secrets are present
- Supabase environment is pointed at the intended target
- Resend configuration is present
- Turnstile configuration is present for public-surface releases
- Scheduled functions expected by the release still exist in `netlify.toml`

## 3. Payment and billing checks

Before releasing payment-related changes, confirm:

- Checkout sessions still route correctly
- Webhook endpoints and signing secrets are unchanged or intentionally updated
- Billing portal flow still opens correctly
- Billing exemptions and plan logic were not accidentally altered
- Admin Stripe health tooling still reflects expected configuration

Use [payments/payment-incident-checklist.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/payments/payment-incident-checklist.md) when a payment-related deploy or incident needs deeper diagnosis.

## 4. Hosted schema and workflow checks

If the release depends on new or existing hosted schema behavior:

- Apply required SQL in the documented order
- Run `npm run test:preflight:env-contract`
- Run `npm run test:preflight:release-readiness`
- Run `npm run test:preflight:service-workflow` when relevant

Do not proceed to hosted integration or E2E checks if schema preflight fails.

## 5. Manual spot-checks after deploy

These remain the default manual checks until replaced by stronger automation:

- Admin can load and authenticate
- Operator bootstrap loads for a valid tenant
- Public onboarding form submits
- Public checkout or quote path still works for the touched workflow family
- Billing portal or customer portal still opens when payment paths were touched
- Scheduled jobs still appear correctly configured after config changes

## 6. Rollback guidance

Rollback immediately when:

- Production auth is broken
- Tenant isolation is in doubt
- Checkout, webhook processing, or billing state is broken
- Operator bootstrap is unavailable for healthy tenants

Rollback steps:

1. Revert the deployed code change
2. Re-check required environment values
3. Re-run release-readiness and affected workflow preflight locally
4. If schema contributed to the issue, stop and document the exact mismatch before the next deploy

## 7. Release notes expectations

For each release, record:

- What changed
- Which workflows were touched
- Which gates were run
- Which manual checks were performed
- Any known follow-up risk left open
