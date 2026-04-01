# AGENTS.md — ProofLink Codebase Guide for AI Agents

> Read this before touching anything. It covers architecture, rules, tables, functions, and coding style. Everything here is derived from actual code — no speculation.

---

## 1. What Is ProofLink?

ProofLink is a **multi-tenant SaaS platform** that gives independent service businesses (trades, field services, food producers) a branded storefront, CRM, job pipeline, and Stripe-powered payment system — provisioned in minutes via an admin-reviewed onboarding flow.

- **Domain:** prooflink.co
- **Canonical redirect aliases:** www.prooflink.co, app.prooflink.co, siteflows.netlify.app → prooflink.co
- **Operator dashboard:** prooflink.co/operator/
- **Admin panel:** prooflink.co/admin/
- **Public join form:** prooflink.co/join
- **Field crew app (PWA):** prooflink.co/crew/
- **Blog:** prooflink.co/blog/

---

## 2. Tech Stack — Immutable Constraints

| Layer | Technology | Notes |
|---|---|---|
| Hosting | Netlify | Static site + serverless functions |
| Backend | Netlify Functions (Node.js 18+) | **All server-side logic lives here** |
| Database | Supabase (PostgreSQL) | RLS enforced on all tables |
| Auth | Supabase Auth | JWT bearer tokens |
| Payments | Stripe | Connect + Subscriptions |
| Email | Resend | All transactional email |
| Spam protection | Cloudflare Turnstile + honeypot + timing gate | Multi-layer |
| SMS | Twilio | Optional, operator opt-in |
| Push notifications | Web Push API | Field crew app |
| AI | Anthropic Claude API | Operator AI copilot + daily brief |
| Frontend | **Vanilla JS only — no frameworks** | No React, Vue, Angular, Svelte |
| Styling | Plain CSS with custom properties | No Tailwind, no CSS-in-JS |

**RULE: Do NOT introduce npm frontend frameworks. No build step for frontend. No bundlers (webpack, vite) for frontend code.** All frontend JS is plain ES2020+ loaded via `<script>` tags. The backend (Netlify Functions) does use npm packages.

---

## 3. Repository Structure

```
ProofLink/
├── netlify/functions/         # ALL backend logic — Netlify serverless functions
│   ├── lib/                   # Shared internal helpers (not HTTP endpoints)
│   │   ├── auth.js            # Operator auth helper
│   │   ├── build-launch-checklist.js
│   │   ├── hydrovac-compliance.js
│   │   ├── plan-enforcement.js
│   │   ├── provision-tenant-bundle.js
│   │   └── seed-templates.js
│   ├── utils/                 # Shared utilities (not HTTP endpoints)
│   │   ├── auth.js            # Core auth helpers + respond()
│   │   ├── auth-links.js      # Magic link / password setup URLs
│   │   ├── business-type.js   # Business type normalization
│   │   ├── email.js           # Resend email sending + HTML templates
│   │   ├── hydrovac.js        # Hydrovac-specific helpers
│   │   ├── payment-policy.js  # Application fee BPS
│   │   ├── rate-limit.js      # In-memory sliding window rate limiter
│   │   ├── runtime-config.js  # SITE_URL resolution
│   │   └── slugify.js         # Slug generation + uniqueness
│   ├── agent/                 # AI copilot sub-system
│   │   ├── audit.js           # Agent event logging
│   │   ├── policy.js          # Tool permission engine
│   │   ├── prompts.js         # Prompt builders
│   │   └── tools.js           # Read-only data tools
│   ├── admin-*.js             # Platform admin endpoints (require admin JWT)
│   ├── get-*.js               # Read endpoints (require operator JWT)
│   ├── manage-*.js            # CRUD endpoints (require operator JWT)
│   ├── send-*.js              # Email/SMS/push sending endpoints
│   ├── stripe-*.js            # Stripe webhook handlers
│   ├── update-*.js            # Patch/update endpoints
│   ├── ai-brief.js            # AI daily briefing
│   ├── ai-copilot.js          # AI Q&A copilot
│   ├── onboarding.js          # Public onboarding form submission
│   ├── order.js               # Public storefront order
│   ├── contact.js             # Public contact form
│   ├── blog-comment.js        # Blog comment submission
│   ├── blog-subscribe.js      # Newsletter subscription
│   ├── check-slug.js          # Public slug availability check
│   ├── booking-reminders.js   # Scheduled: runs hourly
│   ├── platform-abuse-monitor.js  # Scheduled: runs hourly
│   └── process-recurring-orders.js # Scheduled: runs daily at 06:00 UTC
├── sql/                       # Database migrations and schema
│   ├── rebuild_supabase_full.sql  # Full consolidated rebuild script
│   ├── catchup_run_this.sql   # Comprehensive catch-up migration
│   └── [individual migration files]
├── operator/                  # Operator dashboard SPA
│   ├── index.html             # Main shell
│   ├── operator.js            # Boot, auth, navigation (9,445 lines)
│   ├── operator.css           # Dark + light theme
│   ├── operator-*.js          # Workspace modules (one per tab)
│   └── components/            # Reusable UI components
├── admin/                     # Platform admin panel
│   ├── index.html
│   ├── admin.js               # Admin logic (1,537 lines)
│   ├── admin.css
│   ├── admin.config.js        # Supabase config
│   └── tenant-control-tower.js
├── docs/blog/                 # Blog content
│   ├── index.html
│   ├── blog.css
│   └── articles/
├── crew/                      # Field crew PWA
│   ├── index.html
│   ├── crew.js                # PWA logic (1,500+ lines)
│   └── manifest.webmanifest
├── assets/brand/              # Brand design tokens
│   ├── prooflink-tokens.css
│   ├── prooflink-lockup.svg
│   └── prooflink-mark.svg
├── index.html                 # Landing page
├── join.html                  # Operator onboarding form
├── book.html                  # Customer appointment booking
├── contact.html               # Contact form
├── cart.js                    # Storefront cart management
├── cottagelink.config.js      # Storefront config builder
├── cottagelink.core.js        # Storefront core utilities
├── cottagelink.tenant.js      # Tenant hydration
├── netlify.toml               # Netlify config (build, redirects, schedules)
├── _headers                   # Netlify response headers (CSP, HSTS)
└── package.json               # Node deps: @supabase/supabase-js, stripe, twilio, web-push
```

---

## 4. Hard Rules for AI Agents

1. **No frontend frameworks.** index.html, operator/index.html, admin/index.html — all plain HTML with vanilla JS loaded via `<script>` tags.
2. **All backend in Netlify Functions.** No Express server, no standalone Node server. Every API endpoint is a file in `netlify/functions/`.
3. **Every function must export `handler`.** Pattern: `export const handler = async (event) => { ... }` (ESM) or `exports.handler = async (event) => { ... }` (CJS).
4. **Use `respond()` from `utils/auth.js`** for all JSON responses — it adds CORS headers automatically.
5. **Authenticate with `requireOperatorContext()`** for operator-facing endpoints, `requireAdminContext()` for admin endpoints. Never skip auth.
6. **Tenant isolation via `tenant_id` + RLS.** Never query across tenants. Always scope queries by `tenant_id` from the verified operator context.
7. **Stripe webhooks must verify signatures.** Use `stripe.webhooks.constructEvent()` with the correct `STRIPE_WEBHOOK_SECRET` or `STRIPE_CONNECT_WEBHOOK_SECRET`. Check `processed_webhook_events` for idempotency.
8. **No raw SQL from frontend.** All database access goes through Netlify Functions (server-side). Frontend uses Supabase anon key only for auth (login/session).
9. **Do not delete or alter RLS policies without explicit instruction.** RLS is the primary security boundary.
10. **Do not invent env vars.** Use only what's in `.env.example`.

---

## 5. Authentication Pattern

```javascript
// utils/auth.js — standard pattern for all operator endpoints
import { requireOperatorContext, respond } from './utils/auth.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const ctx = await requireOperatorContext(event);
  if (ctx.error) return respond(ctx.status, { error: ctx.error });

  const { supabase, operatorId, tenantId } = ctx;
  // ... business logic
};
```

`requireOperatorContext()` verifies the Bearer JWT, queries `operator_members` to confirm the user belongs to the tenant, and returns `{ supabase, operatorId, tenantId, user }`.

`requireAdminContext()` additionally checks the user has `platform_admin` role in `operators` table.

`INTERNAL_SECRET` header is used for inter-function calls where a Netlify function calls another function directly.

---

## 6. Database Tables

### Core Tenant Infrastructure

| Table | Purpose |
|---|---|
| `tenants` | Provisioned businesses. Columns: id, slug, business_name, billing_status, stripe_customer_id, stripe_subscription_id, stripe_account_id, connect_status, online_payments_enabled, prooflink_plan_key, max_products, max_customers, max_operator_seats, max_orders_per_month, status, conduct_action, billing_exempt, billing_exempt_until, hero_image_url, tagline, instagram, license_number |
| `tenant_onboarding_requests` | Applications before provisioning. Columns: id, status (submitted/approved/provisioning/provisioned/failed/rejected), business_name, slug, owner_name, owner_email, business_type, city, state, rejection_reason, risk_level, evaluation_result |
| `operators` | Authenticated users. Columns: id, email, name, role (owner/member/platform_admin), tenant_id, user_id |
| `operator_members` | Multi-tenant membership. Columns: operator_id, tenant_id, user_id, role |
| `tenant_config` | Key-value config per tenant |
| `tenant_settings` | Branding, contact info, business hours, storefront settings |

### Business Tables

| Table | Purpose |
|---|---|
| `products` | Catalog items. Columns: id, tenant_id, operator_id, name, description, price_cents, category, image_url, available, pricing_mode (fixed/starts_at/quote) |
| `pricing` | Additional pricing configurations |
| `availability` | Operator scheduling rules, lead times, daily order limits, timezone |
| `customers` | CRM records. Columns: id, tenant_id, operator_id, name, email, phone, address, lifetime_value_cents, order_count, last_contact_at |
| `orders` | Storefront + manual orders. Columns: id, tenant_id, operator_id, customer_id, status (new/confirmed/fulfilled/cancelled/paid/completed), items (jsonb array), subtotal_cents, total_cents, fulfillment, scheduled_date |
| `payments` | Payment records linked to orders/jobs. Stripe IDs: checkout_session_id, payment_intent_id, charge_id, customer_id |
| `expenses` | Business expense tracking |
| `customer_interactions` | CRM log: calls, emails, notes per customer |
| `quotes` | Price quotes sent to customers |
| `bookings` | Scheduled appointments |
| `leads` | Incoming leads/requests |
| `reviews` | Customer reviews |
| `bids` | On-site estimates / proposals |
| `jobs` | Scheduled field work units. Columns: id, tenant_id, operator_id, customer_id, status, deposit_policy, deposit_due_date, job_type, scheduled_at, completed_at |
| `service_plans` | Recurring service subscriptions. Cadences: weekly/biweekly/monthly/quarterly/custom_days |
| `recurring_orders` | Auto-generated orders from service plans |
| `invoices` | Invoice records with line items, tax, status (draft/sent/paid/void) |
| `sms_messages` | SMS thread records |
| `push_subscriptions` | Web push endpoint records |

### Billing & Events

| Table | Purpose |
|---|---|
| `processed_webhook_events` | Stripe idempotency log. Auto-purges after 90 days |
| `provision_failures` | Audit trail for failed provisioning attempts |

### Governance & Moderation

| Table | Purpose |
|---|---|
| `tenant_conduct_log` | Audit trail: flag/suspend/reinstate/terminate actions with reason |
| `pl_reserved_slugs` | Slugs that can never be assigned (e.g., "admin", "api", "support") |
| `pl_banned_keywords` | Keywords that trigger onboarding rejection |
| `pl_protected_brands` | Brand names that may not be impersonated |
| `pl_prohibited_categories` | Business categories not accepted on the platform |
| `pl_rate_limits` | Persistent rate limiting state |
| `pl_abuse_scans` | Abuse monitoring scan results |

### Hydrovac Module (Vertical-Specific)

| Table | Purpose |
|---|---|
| `equipment` | Trucks, vactors, trailers |
| `waste_manifests` | Haul/disposal tracking with bill of lading |
| `utility_locate_tickets` | 811 one-call tickets |
| `disposal_facilities` | Dump sites with disposal rates |
| `tenant_hydrovac_settings` | Per-tenant hydrovac config |
| `equipment_maintenance_log` | Maintenance history |
| `confined_space_permits` | Permit records |
| `driver_qualifications` | CDL, OSHA certs, expiry tracking |
| `infrastructure_assets` | Sewer/drainage assets with GIS coordinates |
| `job_time_segments` | Billable time tracking per job |
| `compliance_alerts` | Regulatory deadline alerts |

---

## 7. Key Netlify Functions

### Public (no auth required)
- `onboarding.js` — POST: submit application. Validates with Turnstile + honeypot + timing gate. Runs `evaluate-onboarding` rule engine.
- `order.js` — POST: storefront order submission. Turnstile-gated.
- `contact.js` — POST: contact form. Turnstile + Resend.
- `check-slug.js` — GET: `?slug=foo` returns `{available: bool}`. Checks `tenants`, `tenant_onboarding_requests`, and `pl_reserved_slugs`.
- `get-public-catalog.js` — GET: `?tenant=slug` returns product catalog for storefront.
- `get-public-tenant-info.js` — GET: `?tenant=slug` returns storefront branding/settings.
- `blog-comment.js` / `blog-subscribe.js` — Rate-limited public submissions.
- `cancel-booking.js` — Public booking cancellation.

### Operator (Bearer JWT required)
- `get-operator-setup.js` — Full dashboard bootstrap: tenant info, settings, plan limits, Stripe status.
- `get-launch-checklist.js` — 7-step onboarding progress tracker.
- `get-tenant-limit-health.js` — Usage percentages vs plan limits.
- `create-booking.js` / `update-booking.js` / `get-bookings.js` — Booking CRUD.
- `create-quote.js` / `get-quote.js` / `get-quotes.js` — Quote management.
- `generate-invoice.js` / `generate-hydrovac-invoice.js` — Invoice generation.
- `dispatch-job.js` — Hydrovac job dispatch with compliance pre-check.
- `complete-crew-job.js` — Mark job complete with compliance validation.
- `manage-waste-manifests.js`, `manage-locate-tickets.js`, etc. — Hydrovac CRUD.
- `ai-brief.js` — Daily AI briefing via Claude API.
- `ai-copilot.js` — Q&A copilot via Claude API.
- `bulk-import-customers.js` — CSV/paste customer import with dedup.
- `create-billing-portal-session.js` — Stripe billing portal redirect.
- `create-billing-upgrade-session.js` — Stripe Checkout for plan upgrade.
- `stripe-connect-link.js` — Generate Stripe Connect onboarding URL.
- `commit-tenant-asset.js` — Finalize file upload, count toward storage quota.

### Admin (platform_admin role required)
- `admin-verify.js` — Check admin status.
- `admin-get-onboarding-requests.js` — List/filter applications.
- `admin-approve-onboarding.js` — Approve + provision in one call.
- `admin-reject-onboarding.js` — Reject with reason.
- `admin-update-tenant-conduct.js` — Flag / suspend / reinstate / terminate tenant.
- `admin-get-audit-log.js` / `admin-get-conduct-log.js` — Audit trails.
- `admin-set-tester-exempt.js` — Grant/revoke billing exemption (max 3 slots, `MAX_TESTER_SLOTS`).
- `admin-send-tenant-message.js` — Email a tenant.
- `admin-stripe-health.js` — Verify Stripe API + webhook config.
- `get-platform-stats.js` — KPIs: total tenants, GMV, pending applications.

### Stripe Webhooks
- `stripe-webhook.js` — Handles `checkout.session.completed`, `payment_intent.*`. Verifies with `STRIPE_WEBHOOK_SECRET`.
- `stripe-billing-webhook.js` — Handles `customer.subscription.*`, `invoice.*`. Verifies with `STRIPE_CONNECT_WEBHOOK_SECRET`.

### Scheduled
- `booking-reminders.js` — Runs every hour (cron `0 * * * *`). Sends 24h booking reminder emails.
- `platform-abuse-monitor.js` — Runs every hour. Scans for abuse patterns.
- `process-recurring-orders.js` — Runs daily at 06:00 UTC. Calls `generate_due_service_plans()`.

---

## 8. Plan Limits

Defined in `netlify/functions/lib/plan-enforcement.js`:

| Plan | Key | Products | Customers | Orders/Month | Operator Seats |
|---|---|---|---|---|---|
| Starter | `starter` | 10 | 50 | 100 | 1 |
| Growth | `growth` | unlimited | unlimited | unlimited | 5 |
| Enterprise | `enterprise` | unlimited | unlimited | unlimited | unlimited |

Stripe price IDs (from `.env.example`):
- `STRIPE_PRICE_STARTER_MONTHLY=price_1TAcWbDvhvAaxXasbIDUK1aO`
- `STRIPE_PRICE_GROWTH_MONTHLY=price_1T8nOODvhvAaxXasqGKnuH85`

Billing exemptions: `billing_exempt` boolean + `billing_exempt_until` on `tenants` table. Max 3 tester slots controlled by `MAX_TESTER_SLOTS` env var.

---

## 9. Payment Gate Logic

ProofLink takes a platform fee on all customer-facing transactions:

- **Application fee:** `PROOFLINK_DEFAULT_APPLICATION_FEE_BPS=750` (7.5% of transaction)
- Stored per-tenant in `tenants.application_fee_bps`
- Applied via Stripe Connect `application_fee_amount` on checkout sessions
- Defined in `netlify/functions/utils/payment-policy.js`

Stripe Connect flow:
1. Operator completes Stripe Connect via `stripe-connect-link.js`
2. `tenants.connect_status` transitions: `connect_not_started` → `connect_incomplete` → `connect_connected`
3. `tenants.online_payments_enabled = true` only after connect is complete
4. `stripe-order-checkout.js` creates Checkout sessions on behalf of the connected account
5. `stripe-platform-checkout.js` handles platform subscription billing

Deposit enforcement via DB triggers (`enforce_order_deposit_policy`, `enforce_job_deposit_policy`). Cannot create bookings/jobs without deposit unless `deposit_override_*` columns are set.

---

## 10. Environment Variables

All required vars are in `.env.example`. The critical ones:

```
STRIPE_SECRET_KEY          # Stripe API key
STRIPE_WEBHOOK_SECRET      # For stripe-webhook.js
STRIPE_CONNECT_WEBHOOK_SECRET  # For stripe-billing-webhook.js
STRIPE_PRICE_STARTER_MONTHLY   # Stripe price ID
STRIPE_PRICE_GROWTH_MONTHLY    # Stripe price ID
SUPABASE_URL               # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY  # Admin DB access (server-side only)
SUPABASE_ANON_KEY          # Public Supabase key (used in frontend + functions)
RESEND_API_KEY             # Email sending
FROM_EMAIL                 # "ProofLink <support@prooflink.co>"
MAIL_FROM                  # Same as FROM_EMAIL
MAIL_TO                    # Admin notification target: christopher@prooflink.co
OPERATOR_ALERT_EMAIL       # Same as MAIL_TO
SITE_URL                   # https://prooflink.co
PUBLIC_SITE_URL            # https://prooflink.co
INTERNAL_SECRET            # Secret header for inter-function calls
PLATFORM_NAME              # "ProofLink"
MAX_TESTER_SLOTS           # 3
PROOFLINK_DEFAULT_APPLICATION_FEE_BPS  # 750
TURNSTILE_SECRET_KEY       # Cloudflare Turnstile (optional but recommended)
```

---

## 11. Coding Style

- **ESM imports** in Netlify Functions (import/export) — see `.eslintrc`
- **No `console.log` spam** — use structured error logging only
- **Error responses**: always use `respond(statusCode, { error: 'message' })`
- **Supabase client**: use `getAdminClient()` from `utils/auth.js` for service-role access; never expose service role key to frontend
- **SQL**: use Supabase `.from('table').select()` chaining — no raw SQL in functions (use RPC for complex logic)
- **Formatting**: Prettier defaults (`.prettierrc` in root), 2-space indent, single quotes
- **ESLint**: check `.eslintrc` before adding patterns
- **HTML**: no DOCTYPE omission, always include `lang="en"`, semantic elements
- **CSS**: custom properties for theming, no `!important` abuse
- **JS modules in browser**: use `type="module"` sparingly — most operator JS loads as classic scripts in defined order

---

## 12. Industry Templates

Seeded at provisioning time by `netlify/functions/lib/seed-templates.js`:

`pressure_washing`, `cleaning`, `lawn_care`, `handyman`, `hvac`, `hydrovac`, `plumbing`, `pet_services`, `photography`, `events`, `bakery`

Each template provides pre-built products with category, pricing mode, and description. `bakery` uses `fixed` pricing; field services use `starts_at` or `quote`.

---

## 13. Multi-Tenant Isolation Rules

- Every business table has `tenant_id uuid NOT NULL` + `operator_id uuid NOT NULL`
- RLS policies use `operator_member_access(uuid)` helper to confirm the requesting user belongs to the tenant
- The trigger `enforce_operator_tenant_membership_pair()` fires on INSERT/UPDATE on 8 core tables to block cross-tenant writes
- Admin endpoints use service role key and bypass RLS intentionally
- Public endpoints (storefront order, onboarding submission) use anon key with targeted INSERT-only RLS policies

---

## 14. Testing

- `npm run test:unit` — Vitest unit tests
- `npm run test:integration` — Integration tests against hosted Supabase (requires `.env.test` with live credentials)
- `npm run test:preflight` — Pre-deploy contract checks (env var validation)
- Playwright for E2E (configured but limited coverage)
- GitHub Actions: `.github/workflows/test.yml` runs on push to main

Test environment credentials go in `.env.test` (see `.env.test.example`). Use Stripe test mode keys (`sk_test_...`).

---

## 15. Hydrovac Vertical

ProofLink has a dedicated compliance module for hydrovac/vacuum excavation operators:

- Enabled per-tenant via `tenant_hydrovac_settings.enabled = true`
- Compliance checking in `netlify/functions/lib/hydrovac-compliance.js`
- Pre-dispatch validation: locate tickets, confined space permits, driver qualifications, waste manifests
- Separate operator workspace tab with facilities, manifests, locate tickets, compliance alerts
- Business type aliases: `vactor`, `vacuum_excavation`, `hydro_excavation` all normalize to `hydrovac`

---

*Last updated by AI agent from codebase read — verify against live code before acting on specific function names.*
