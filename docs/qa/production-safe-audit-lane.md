# Production-safe audit lane

This lane gives ProofLink a repeatable browser audit path that is safe to run
against a live deploy, plus a stronger staging loop for full click-through work.

## Production-safe audit

Use this when you want to sanity-check a live or staging deploy without creating
or mutating business data.

Requirements:
- `TEST_SITE_URL`
- optional `TEST_PUBLIC_TENANT_SLUG`

Command:
- `npm run test:e2e:prod-safe`

What it checks:
- landing page
- join flow entry page
- contact page
- public tenant home
- public order page
- portal login page
- console errors
- page errors
- failed requests

This is safe for production because it does not submit forms, create records, or
sign into privileged workspaces.

## Monitoring loop

Use this as the standing health command:
- `npm run test:monitoring-loop`

What it runs:
- release-readiness contract
- Supabase drift verification
- production-safe browser audit when `TEST_SITE_URL` is set

## Staging tenant seed

Use staging for full click-through and role-based testing.

Requirements:
- staging Supabase credentials exported as the current test env
- `TEST_SITE_URL` pointing at staging

Command:
- `npm run test:seed:staging`

This seeds:
- platform admin
- tenant owner
- tenant staff
- crew user
- customer records
- hydrovac operator/dispatch fixtures
- onboarding fixtures

After seeding staging, run:
1. `npm run test:e2e:user-classes`
2. `npm run test:e2e:service-workflow`
3. `npm run test:e2e:operator-cross-device`

## Recommended operating loop

Production:
1. `TEST_SITE_URL=https://prooflink.co npm run test:monitoring-loop`

Staging:
1. Point `TEST_SITE_URL` to the staging deploy
2. `npm run test:seed:staging`
3. `npm run test:e2e:user-classes`
4. `npm run test:e2e:service-workflow`
5. `npm run test:e2e:operator-cross-device`

## Current payment posture

ProofLink is currently in manual-payments mode.

That means:
- online checkout is disabled
- hosted billing is disabled
- payment-state tracking stays live
- invoices and offline collection methods stay available
