# ProofLink Onboarding — Deployment Instructions

## 1. Run the SQL Migration

Open your Supabase project → SQL Editor → run the full contents of:
  sql/onboarding-migration.sql

This creates:
  - tenant_onboarding_requests table with status constraint
  - Indexes on status, email, created_at, slug
  - Auto-update trigger for updated_at
  - Row Level Security: public INSERT, authenticated SELECT

Verify in Supabase Table Editor that tenant_onboarding_requests appears.

---

## 2. Configure Environment Variables in Netlify

Netlify → Site → Site Settings → Environment Variables

| Variable                   | Notes                                     |
|----------------------------|-------------------------------------------|
| SUPABASE_URL               | https://xxxx.supabase.co                  |
| SUPABASE_SERVICE_ROLE_KEY  | SECRET — used by functions only           |
| SUPABASE_ANON_KEY          | PUBLIC — used by browser login in op page |

---

## 3. Expose Supabase Config to Operator Browser Page

In operator/provisioning.html, find:

  const SUPABASE_URL      = window.__SUPABASE_URL__      || '';
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || '';

For local testing, replace the empty strings with your values directly.
For production, inject via a build step or Netlify environment plugin.

---

## 4. New Files Deployed

netlify/functions/submit-onboarding-request.js  (PUBLIC: receive form submissions)
netlify/functions/list-onboarding-requests.js   (OPERATOR: read queue)
netlify/functions/approve-onboarding-request.js (OPERATOR: approve requests)
netlify/functions/provision-tenant.js           (OPERATOR: create tenant)
netlify/functions/utils/auth.js                 (shared: requireOperatorContext)
netlify/functions/utils/slugify.js              (shared: slug generation)
index.html                                       (public landing page)
join.html                                        (public onboarding form)
operator/provisioning.html                       (operator provisioning queue)
operator/provisioning.js                         (config injector)
netlify.toml                                     (updated redirects)
sql/onboarding-migration.sql                     (run in Supabase)

---

## 5. Schema Extensions (run if columns are missing)

If your tenants table lacks these columns:
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_request_id UUID;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN DEFAULT false;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city_state TEXT;

If your operators table lacks these columns:
  ALTER TABLE operators ADD COLUMN IF NOT EXISTS tenant_id UUID;
  ALTER TABLE operators ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'tenant_owner';

---

## 6. Add Provisioning Link to Operator Dashboard Navigation

In your existing operator dashboard HTML, add this link to the nav:
  <a href="/operator/provisioning.html">Provisioning Queue</a>

---

## 7. Local Dev

  npm install -g netlify-cli
  netlify dev

  http://localhost:8888/                           Landing page
  http://localhost:8888/join                       Join form
  http://localhost:8888/operator/                  Operator dashboard
  http://localhost:8888/operator/provisioning.html Provisioning queue

---

## Unchanged (do not modify)

  stripe-connect-link.js
  stripe-webhook.js
  tenant-payment-status.js
