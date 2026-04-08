# ProofLink Hosted Deployment

Canonical release procedure now lives in [ops/release-runbook.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/ops/release-runbook.md). This file remains the hosted Supabase schema and validation sequence for deployments that depend on hosted schema changes.

This repo currently applies hosted Supabase schema changes through the Supabase SQL Editor.
There is no linked Supabase CLI migration runner in this repo today, so the safe rollout path is:

1. Apply the repo SQL files in order.
2. Run schema preflight against the same hosted project.
3. Only then run hosted integration or e2e service-workflow validation.

## 1. Apply hosted schema in order

Open the target Supabase project, then open SQL Editor and run these files in this exact order:

1. `sql/catchup_run_this.sql`
2. `sql/service_workflow_phase1.sql`

Do not skip the catch-up file and do not run archive migrations instead. `service_workflow_phase1.sql` assumes the core platform schema from `catchup_run_this.sql` already exists.

## 2. Validate schema readiness before tests

From the repo root, point `.env.test` or the `TEST_*` environment variables at the same hosted Supabase project, then run:

```bash
npm run test:preflight:env-contract
npm run test:preflight:release-readiness
npm run test:preflight:service-workflow
```

If this fails, stop there. The hosted project is still behind the repo schema. Do not run integration or e2e service-workflow suites until preflight passes.

## 3. Run hosted service-workflow validation

Once preflight passes, run the hosted service-workflow validation in this order:

```bash
npm run test:cleanup
npm run test:seed
npm run test:integration:service-workflow
```

For browser validation, start Netlify dev against the same environment and then run:

```bash
npm run test:e2e:service-workflow
```

## 4. CI behavior

GitHub Actions already treats service-workflow schema readiness as a prerequisite. The hosted job runs:

1. cleanup
2. seed
3. `npm run test:preflight:service-workflow`
4. hosted integration tests

If the hosted Supabase project is missing the Phase 1 schema, CI should fail at preflight instead of producing misleading downstream test failures.

## 5. Environment required for hosted validation

Minimum test environment variables:

- `TEST_SUPABASE_URL`
- `TEST_SUPABASE_SERVICE_ROLE_KEY`
- `TEST_SUPABASE_ANON_KEY`
- `TEST_SITE_URL`
- `TEST_PLATFORM_ADMIN_EMAIL`
- `TEST_PLATFORM_ADMIN_PASSWORD`
- `TEST_TENANT_A_ADMIN_EMAIL`
- `TEST_TENANT_A_ADMIN_PASSWORD`
- `TEST_TENANT_B_ADMIN_EMAIL`
- `TEST_TENANT_B_ADMIN_PASSWORD`

## 6. Legacy note

Older onboarding-only migration instructions are no longer the rollout source of truth for a hosted ProofLink environment. Use the two SQL files above and the schema preflight instead.
