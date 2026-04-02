# ProofLink

ProofLink is a multi-tenant SaaS platform for service and trade businesses. It gives each operator a branded storefront, CRM, scheduling and job workflows, Stripe-powered billing, and a private back-office dashboard backed by Netlify Functions and Supabase.

## What It Does

- Public storefront and booking flows
- Operator CRM, orders, jobs, quotes, invoices, and payments
- Admin-reviewed onboarding and tenant provisioning
- Stripe subscriptions plus Stripe Connect tenant payments
- Vertical modules, including hydrovac compliance and dispatch workflows

## Tech Stack

| Layer | Technology |
| --- | --- |
| Hosting and backend | Netlify + Netlify Functions |
| Database | Supabase PostgreSQL with RLS |
| Auth | Supabase Auth |
| Payments | Stripe |
| Email | Resend |
| Frontend | Plain HTML, CSS, and vanilla JavaScript |

## Repo Map

```
/admin                    Platform admin panel
/operator                 Operator dashboard SPA
/crew                     Field crew PWA
/netlify/functions        Serverless backend and shared function helpers
/sql                      Core schema plus additive migrations
/assets                   Brand assets and shared static files
/index.html               Main storefront / landing experience
/join.html                Public onboarding form
/book.html                Public booking page
/contact.html             Public contact page
/prooflink.config.js      Storefront runtime config
/prooflink.core.js        Storefront core helpers
/prooflink.tenant.js      Storefront tenant hydration
```

## Environment Variables

Copy `.env.example` and set the same values in Netlify for the deployed site.

Required platform variables include:

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CONNECT_WEBHOOK_SECRET
STRIPE_PRICE_STARTER_MONTHLY
STRIPE_PRICE_GROWTH_MONTHLY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
RESEND_API_KEY
FROM_EMAIL
MAIL_FROM
MAIL_TO
OPERATOR_ALERT_EMAIL
SITE_URL
PUBLIC_SITE_URL
INTERNAL_SECRET
PLATFORM_NAME
MAX_TESTER_SLOTS
PROOFLINK_DEFAULT_APPLICATION_FEE_BPS
TURNSTILE_SECRET_KEY
```

Use `.env.test.example` when preparing hosted integration or preflight test credentials.

## Database Setup

Run SQL files in Supabase SQL Editor in this order:

1. `sql/catchup_run_this.sql`
2. `sql/service_workflow_phase1.sql`
3. Optional modules, only when you want those capabilities enabled:
   - `sql/proposal_document_engine.sql`
   - `sql/service_recurring_plans.sql`
   - `sql/provision_failures.sql`
   - `sql/service_deposit_control.sql`
   - `sql/hydrovac_module_foundation.sql`

`sql/readme.md` is the canonical migration guide. Follow it before editing `rebuild_supabase_full.sql` or introducing new standalone migrations.

Before running service-workflow integration or E2E coverage, validate the hosted test contract:

```bash
npm run test:preflight:service-workflow
```

## Stripe Webhooks

Configure two separate Stripe webhook endpoints:

1. `/.netlify/functions/stripe-webhook`
   Use `STRIPE_WEBHOOK_SECRET` for checkout and payment-intent events.
2. `/.netlify/functions/stripe-billing-webhook`
   Use `STRIPE_CONNECT_WEBHOOK_SECRET` for subscription and invoice lifecycle events.

Keep the two signing secrets separate. Do not point both webhook configurations at the same function.

## Development Checks

```bash
npm install
npm run lint
npm run test:unit
```

Additional commands:

- `npm run test:integration`
- `npm run test:preflight:service-workflow`
- `npm run test:e2e`
- `npm run sql:build:rebuild`

## Deployment

1. Connect the repository to Netlify.
2. Set environment variables from `.env.example`.
3. Run the required SQL setup in Supabase.
4. Configure both Stripe webhook endpoints.
5. Run lint, unit tests, and any needed preflight checks.
6. Deploy.

## Source Of Truth

For current platform behavior, prefer these references in order:

1. Live code in `netlify/functions/`, `operator/`, `admin/`, `crew/`, and the root storefront files
2. `sql/readme.md` for schema rollout order
3. `AGENTS.md` for architecture and repository conventions

Historical audit docs under `docs/` are useful context, but they should be treated as dated snapshots unless they explicitly say otherwise.
