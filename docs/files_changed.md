# ProofLink Onboarding — Files Created / Modified

## NEW FILES

### Netlify Functions
netlify/functions/submit-onboarding-request.js
  Public endpoint. Receives the onboarding form POST. No auth required.
  Writes a tenant_onboarding_requests row with status = 'submitted'.

netlify/functions/list-onboarding-requests.js
  Operator-only. Returns onboarding requests, optionally filtered by status.
  Supports ?status= and ?id= query params.

netlify/functions/approve-onboarding-request.js
  Operator-only. Sets a request status to 'approved'.
  Only allows transitions from submitted or failed.

netlify/functions/provision-tenant.js
  Operator-only. Core provisioning engine.
  Creates: tenant row, operator row, operator_members row, tenant_config seed.
  IDEMPOTENT: safe to call twice — will not duplicate tenant.
  No recursion, no polling, no loops.

netlify/functions/utils/auth.js
  Shared helper. Provides requireOperatorContext() and respond().
  Used by all operator-only functions.

netlify/functions/utils/slugify.js
  Shared helper. Converts business names to URL-safe slugs.
  Guarantees uniqueness against the tenants table.

### Public Pages
index.html
  ProofLink landing page. Contains "Sell. Track. Get Paid." tagline.
  Explains what ProofLink does, who it's for, what happens after joining.
  Links to /join.

join.html
  Multi-step public onboarding form (4 steps: type, business info, contact, review).
  Submits to submit-onboarding-request function.
  Shows success screen with reference ID on completion.

### Operator Pages
operator/provisioning.html
  Operator provisioning queue.
  Features: login gate, filterable request table, approve action, provision action,
            idempotent retry, error display, toast notifications.

operator/provisioning.js
  Config injector for provisioning.html.
  Reads Supabase config from window globals or meta tags.

### SQL
sql/onboarding-migration.sql
  Complete SQL to run in Supabase before deploying.
  Creates tenant_onboarding_requests table, indexes, trigger, RLS policies.

### Documentation
docs/DEPLOYMENT.md
  Step-by-step deployment instructions including env vars and schema extensions.

docs/TESTING_CHECKLIST.md
  Complete testing checklist: SQL, functions, form, provisioning, Stripe, storefront.

docs/FILES_CHANGED.md
  This file.

## MODIFIED FILES

netlify.toml
  ADDED: redirect for /join → /join.html
  ADDED: redirect for /operator/provisioning → /operator/provisioning.html
  ADDED: CORS headers for /.netlify/functions/*
  PRESERVED: all existing redirects and build settings

## UNTOUCHED FILES (explicitly preserved)

netlify/functions/stripe-connect-link.js   — NOT modified
netlify/functions/stripe-webhook.js        — NOT modified
netlify/functions/tenant-payment-status.js — NOT modified
All existing storefront pages               — NOT modified
All existing operator dashboard pages       — NOT modified (nav link addition required manually)
