<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
# PROOFLINK MASTER SPEC
### Comprehensive Build, Launch, Market & Scale Guide
**Version:** April 2026 | **Domain:** prooflink.co | **Stack:** Netlify + Supabase + Stripe

---

## TABLE OF CONTENTS

1. [Engineering — Frontend](#1-engineering--frontend)
2. [Engineering — Backend](#2-engineering--backend)
3. [Engineering — Database](#3-engineering--database)
4. [Engineering — Infrastructure & DevOps](#4-engineering--infrastructure--devops)
5. [Engineering — Security](#5-engineering--security)
6. [Product Management](#6-product-management)
7. [Design / UX](#7-design--ux)
8. [Marketing](#8-marketing)
9. [Sales](#9-sales)
10. [Customer Support](#10-customer-support)
11. [Legal / Compliance](#11-legal--compliance)
12. [Operations](#12-operations)
13. [QA / Testing](#13-qa--testing)
14. [Analytics / Metrics](#14-analytics--metrics)

---

## 1. Engineering — Frontend

### 1.1 Landing Page (index.html)

The marketing site lives at `index.html` in the repo root. It is a single-file, zero-framework page served directly by Netlify.

**Sections (in order):**

| Section | Content |
|---|---|
| Navigation | ProofLink lockup logo (`assets/brand/prooflink-lockup.svg`), "Sign in" link → `/operator/`, "Apply now" CTA → `/join` |
| Hero | Tagline, subheadline, primary CTA button ("Start your free account"), product screenshots, brand cosmos animation (CSS/JS, no canvas library) |
| "Why it feels different" | Three-column card grid differentiating ProofLink from generic SaaS |
| Product tour | Annotated screenshot walkthrough of dashboard |
| Capabilities | Feature grid: storefront, CRM, job pipeline, invoicing, Stripe payments, AI copilot |
| Value proposition | Founder-voice narrative, Michigan-first framing |
| Pricing | Dynamically rendered from plan data (Starter / Growth). Plan cards with feature lists and CTAs |
| How it works | Four numbered steps: Apply → Get reviewed → Set up → Get paid |
| Trust | Social proof, tester testimonials, founder photo |
| Footer | Links: About, Blog, Contact, Privacy, Terms, Accessibility; copyright |

**Scripts loaded:** `prooflink.config.js`, `prooflink.core.js`, `prooflink.tenant.js`, `cart.js` for any storefront demo elements.

---

### 1.2 /join — Operator Onboarding Form (join.html)

Multi-step form submitted to `/.netlify/functions/onboarding`. No page reload between steps — pure DOM manipulation.

**Step 1 — Business Type**
14 selectable types presented as icon cards:
`bakery`, `pressure_washing`, `landscaping`, `cleaning`, `contractor`, `photography`, `hvac`, `plumbing`, `handyman`, `pet_services`, `events`, `lawn_care`, `hydrovac`, and general service.

**Step 2 — Business Identity**
- Business name (text input, required)
- Preferred website address / slug (`check-slug.js` called on blur for live validation)
- Slug rendered as `prooflink.co/[slug]` preview

**Step 3 — Owner Details**
- Owner full name
- Phone number
- Email address
- Promo/referral code (coupon field — `BUILDWITHME` grants billing exemption for 1 year)
- Setup mode radio: "I'll set it up myself" vs. "I want guided setup"
- Password creation (optional — account can be activated later)

**Step 4 — Review & Submit**
- Summary of all collected data
- Agreement checkbox (ToS + Privacy Policy links)
- Honeypot field named `fax` (hidden via CSS, never filled by real users)
- Submission timestamp captured on page load — if form submitted in < 2s, flagged as bot
- Cloudflare Turnstile widget rendered before submit button
- Submit fires POST to `/api/onboarding`

**Success screen:** Inline confirmation with next steps, expected review timeline.

---

### 1.3 /operator/ — Operator Dashboard

**File:** `operator/index.html` (3,209 lines) + ~46 JS workspace modules

**Shell layout:** CSS grid — 256px fixed sidebar | scrollable main area.

**Auth gate:** Login form shown if no valid session token in `sessionStorage`. Supports email + password (primary) and magic link (fallback). Password reset triggers Supabase recovery email.

#### Sidebar

```
[Brand card: tenant logo + business name + owner email]
[First wins checklist — startup-checklist.js progress tracker]

Primary nav:
  Today          (command center)
  Work           (jobs workspace)
  Customers      (CRM workspace)
  Calendar       (bookings workspace)
  Money          (payments workspace)

[▼ More tools — collapsible]
  Work pipeline:
    Requests       (lead-plan workspace)
    Bids           (bids workspace)
    Active Jobs    (jobs filtered view)
    Quotes         (quotes management)
    Recurring Plans (service plans)
  Reports & Reviews:
    Expenses
    Insights       (money/analytics workspace)
    Reviews
  Website & Setup:
    Website        (setup workspace)
    Products       (catalog workspace)
    Pricing
    Availability
    Domains        [DECISION NEEDED: custom domain proxy not yet built]
    Switch & Import (import tools)
  Team & Resources:
    Vendors
    Equipment      (equipment workspace)
    Team           (team workspace)
    Inventory
    Contracts
  Guidance & AI:
    Operations
    AI Assistant   (ai-copilot endpoint)
  Hydrovac Operations:  [shown only if hydrovac enabled]
    Facilities
    Loads & Manifests
    Locate Tickets
    Compliance
```

#### Primary Tab Workspaces

**Today (Command Center) — `operator-command-center.js`**
- Daily summary: upcoming bookings, overdue invoices, pending quote responses
- Quick-action cards (create job, create invoice, send message)
- AI daily brief if enabled (calls `ai-brief.js`, renders Claude-generated summary)

**Work (Jobs) — `operator-jobs-workspace.js`** (61 KB)
- Job board: card view per job with status badge (draft / scheduled / in_progress / completed / invoiced / paid)
- Create job modal: customer selector, service type, scheduled date, crew assignment, deposit policy
- Job detail: description, notes, photos, time segments, linked invoice
- Dispatch action (hydrovac-only): calls `dispatch-job.js` with compliance pre-check
- Complete job: calls `complete-crew-job.js`, triggers invoice generation option
- Filter by: status, date range, crew member, customer

**Customers — `operator-customers-workspace.js`**
- Customer list: searchable, sortable by name / last contact / lifetime value
- Bulk import button (calls `bulk-import-customers.js`)
- Customer card: name, email, phone, address, order count, LTV, tags
- Interaction log: chronological notes, calls, emails per customer
- Follow-up flag with due date
- Customer detail side drawer (via `operator-customer-detail.js`)

**Calendar (Bookings) — `operator-bookings-workspace.js`** (72.6 KB)
- Month/week/day calendar views (pure JS, no external calendar library)
- Booking cards: customer name, service type, time, status color
- Create booking: date/time picker, service selector, customer assignment, fulfillment type
- Reschedule via drag-and-drop [TODO: drag-drop not yet implemented — uses modal reschedule]
- Availability blocks: blocked dates shown in gray (managed via `manage-availability-blocks.js`)
- Time logging per booking (links to `job_time_segments`)

**Money (Payments) — `operator-payments-workspace.js`**
- Invoice list: unpaid / partially paid / paid / overdue
- Manual payment recording (cash, check, Venmo, bank transfer)
- Stripe payment link generation
- Email invoice via `send-invoice-email.js`
- Payment reminder via `send-payment-reminder.js`
- Revenue summary card: MTD, YTD, outstanding total

#### Secondary Tab Workspaces

**Requests — `operator-lead-plan-workspace.js`** (66.4 KB)
- Incoming leads from storefront and public booking form
- Lead intake form for phone-sourced leads
- Convert lead to quote, booking, or job
- Recurring service plan creation and management

**Bids — `operator-bids-workspace.js`** (90.9 KB)
- Walkthrough bid / on-site estimate workflow
- Line-item estimate builder with cost + margin controls
- Send bid via email (`send-bid-email.js`)
- Convert accepted bid to order/job

**Expenses — `operator-money-workspace.js`** (58 KB)
- Expense entry: date, category, amount, description, receipt upload
- Category breakdown chart (pure canvas, no charting library)
- Export to CSV [TODO]

**Insights — `operator-money-workspace.js`**
- Revenue by month (bar chart)
- Top customers by LTV
- Orders by status
- Average job value
- Data from `get-hydrovac-analytics.js` (for hydrovac) or standard order queries

**Website / Setup — `operator-setup-workspace.js`**
- Storefront branding: logo upload, hero image, accent color, tagline
- Contact info: address, phone, email, social links
- Business hours
- Delivery / pickup settings
- Preview button opens storefront in new tab
- Publish toggle (`tenant_settings.storefront_published`)

**Products (Catalog) — `operator-catalog-workspace.js`** (40.2 KB)
- Product list with drag-to-reorder [TODO: reorder not yet wired to DB]
- Add product modal: name, category, description, price, pricing mode (fixed / starts_at / quote), image upload
- Image upload uses presigned URL flow: `commit-tenant-asset.js` finalizes after upload
- Plan limit badge shown when approaching max_products cap
- Feature lock overlay shown when at cap (calls `write-guards.js`)

**Equipment — `operator-equipment-workspace.js`**
- CRUD for trucks, trailers, vactors, tools
- Maintenance log per asset
- Status: active / in_maintenance / retired

**Team — `operator-team-workspace.js`**
- Invite team member by email (sends Supabase magic link)
- Role assignment: owner / member
- Hours report per team member
- Seat enforcement: plan limit on `max_operator_seats` (via `manage-operator-members.js`)

**Hydrovac Operations — `operator-hydrovac-ops-workspace.js`** (97.6 KB)
Shown only when `tenant_hydrovac_settings.enabled = true`.
- **Facilities:** disposal site CRUD (name, address, rates per gallon/barrel/ton)
- **Loads & Manifests:** waste manifest creation, bill of lading, closure tracking
- **Locate Tickets:** 811 ticket tracking, expiry alerts, job association
- **Compliance:** driver qualification expiry, equipment inspection dates, confined space permits

#### Component Library (`operator/components/`)

| Component | Purpose |
|---|---|
| `billing-cta.js` | Persistent banner prompting Stripe Connect or plan upgrade |
| `billing-status-card.js` | Shows current plan, usage, renewal date |
| `feature-lock.js` | Renders locked overlay on features above current plan |
| `upgrade-modal.js` | Full-screen plan comparison modal with Stripe checkout CTA |
| `upgrade-panel.js` | Inline upgrade prompt within workspace |
| `write-guards.js` | Checks plan limits before allowing resource creation; blocks with modal if at cap |
| `limit-banner.js` | Warning banner when usage > 80% of plan limit |
| `plan-comparison.js` | Side-by-side Starter / Growth feature table |
| `seat-enforcement.js` | Blocks team invitations when at operator seat limit |
| `checklist-engine.js` | Reusable step-based checklist renderer |
| `analytics-widgets.js` | Reusable chart/stat card components |
| `import-tools.js` | CSV parse + column mapping UI for bulk imports |
| `stripe-readiness.js` | Stripe Connect status indicator with CTA |

---

### 1.4 /admin/ — Platform Admin Panel

**File:** `admin/index.html` (557 lines), `admin.js` (1,537 lines)

Auth: email + password via Supabase. After login, `admin-verify.js` confirms `platform_admin` role.

#### Sections

**Overview**
- KPI grid: Total tenants, Pending applications, Provisioned count, Platform GMV
- Pipeline bar: Submitted → Approved → Provisioning → Provisioned → Failed (counts per status)
- Activity feed: 10 most recent onboarding requests with timestamps
- Recent tenants table

**Onboarding Requests**
- Filterable by status: submitted / needs_review / approved / provisioning / provisioned / failed / rejected
- Search by business name, owner email, slug
- Bulk actions: Delete selected, Clear selection
- Per-row actions: Approve & Launch (atomic), Approve only, Reject (with optional reason), Provision (manual trigger), Retry (failed), Details modal, Delete
- Detail modal: full application data, timestamps, risk level, evaluation result

**Tenants Management**
- Search: name/email/slug, status dropdown, city/state
- CSV export button
- Bulk selection: Flag, Suspend, Reinstate, Delete selected
- Tenant Control Tower card (`tenant-control-tower.js`): capacity risk, storage pressure, plan upgrade recommendations
- Per-tenant actions: Flag / Suspend / Reinstate / Terminate, Config editor, View detail drawer, Notify (email), Reset password, Delete
- Tenant detail drawer: full tenant record + conduct history from `tenant_conduct_log`

**Provisioning**
- "Ready to provision" table: approved requests awaiting provisioning
- Provisioning log: all attempts with status, slug, error messages

**Testers**
- Slot counter: Used / Remaining / Max (`MAX_TESTER_SLOTS=3`)
- Active exemptions table with revoke button
- Grant panel: search tenant, set duration (3/6/12/24 months), grant/revoke

**Audit Log**
- Paginated table (50/page): tenant, action, notes, performed_by, timestamp
- Source: `tenant_conduct_log` via `admin-get-audit-log.js`

**Billing**
- Links: Stripe dashboard, Stripe Connect dashboard
- Health checks: API key validity, webhook endpoint status (via `admin-stripe-health.js`)

**System Health**
- Clickable health cards: test each Netlify function + Supabase connection
- Green / yellow / red status dots with response time

**Settings**
- Environment variable checklist (required vs. recommended)
- SQL migration instructions
- Admin grant SQL snippet

---

### 1.5 Public Storefront (Per-Tenant)

Each provisioned tenant has a public storefront. URL structure: `prooflink.co/?tenant={slug}` or a custom domain [DECISION NEEDED: custom domain proxying approach — Netlify per-subdomain alias vs. CNAME with tenant lookup].

**Storefront files:** `index.html` (with tenant-specific data attributes), catalog loaded via `prooflink.core.js`, cart via `cart.js`, tenant hydration via `prooflink.tenant.js`.

**Flow:**
1. Page loads → `prooflink.tenant.js` reads `?tenant=` param or localStorage tenant key
2. `get-public-tenant-info.js` returns branding, settings, contact info
3. `get-public-catalog.js` returns available products
4. Cart stored in `localStorage` keyed by `PROOFLINK_CONFIG.storefront.cart.storageKey`
5. Checkout: `portal-checkout.js` or `stripe-order-checkout.js` creates Stripe Checkout session
6. Order confirmed → `order.js` writes to `orders` table, sends notification email

**book.html** — Standalone appointment booking form. Loads availability from `get-availability.js`, submits to `create-booking.js`. Includes date/time picker, service address, notes, referral source. Sends confirmation email via Resend.

---

### 1.6 Blog (docs/blog/)

**URL:** `/blog/` → `docs/blog/index.html`

- Article grid: 3-column responsive card layout, 6 published articles
- Each article has comment form (POST to `/api/blog-comment`) and subscribe form (POST to `/api/blog-subscribe`)
- Both endpoints are rate-limited (sliding window via `rate-limit.js`)
- Comment submissions stored in Supabase [DECISION NEEDED: table for blog_comments not yet in schema — currently email-only notification]
- Blog CSS: `docs/blog/blog.css` — 666 lines, full responsive styling

**Published articles:**
1. "Simple Workflow System for Small Businesses"
2. "Hidden Advantage Small Businesses Have Over Large Companies"
3. "How Small Businesses Stay Organized Without Office Staff"
4. "Why Small Businesses Struggle With Organization"
5. "5 Organizational Problems That Slowly Kill Small Businesses"
6. "Why Most CRM Systems Fail Small Businesses"

---

### 1.7 Field Crew App (crew/)

PWA at `/crew/`. Intended for mobile use by field workers — not operators.

- Dark-themed, mobile-optimized layout
- Offline support via IndexedDB (offline queue for time entries and job updates)
- Features: view assigned jobs, start/stop timer, log time segments, capture photos, fill business-specific checklists (landscaping, cleaning, HVAC, plumbing, hydrovac), view manifest summary, mark complete
- Submit via `complete-crew-job.js` (requires crew member Bearer token)
- PWA manifest: `crew/manifest.webmanifest`, icons at `assets/pwa-192.png`, `assets/pwa-512.png`, `assets/pwa-maskable-512.png`

---

## 2. Engineering — Backend

All backend is Netlify Functions (serverless Node.js 18+). Files live in `netlify/functions/`. Exposed as `/.netlify/functions/{name}` with clean path aliases via `netlify.toml` redirects.

### 2.1 Authentication Utilities (`utils/auth.js`)

| Export | Purpose |
|---|---|
| `getAdminClient()` | Supabase client with `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS |
| `getBearerToken(event)` | Extracts JWT from `Authorization: Bearer ...` header |
| `verifyBearerUser(token)` | Validates JWT against Supabase Auth |
| `requireOperatorContext(event)` | Full auth + `operator_members` membership check. Returns `{ supabase, operatorId, tenantId, user }` |
| `requireAdminContext(event)` | Like above but also checks `operators.role = 'platform_admin'` |
| `requireOnboardingAdminContext(event)` | Lighter admin check for onboarding operations |
| `respond(status, body, headers?)` | Returns CORS-enabled JSON response |

### 2.2 Complete Function Inventory

#### Public Endpoints (no auth)

| Function | Method | Route | Purpose |
|---|---|---|---|
| `onboarding.js` | POST | `/api/onboarding` | Application submission. Validates: Turnstile token, honeypot (`fax` field empty), timing gate (> 2s). Runs `evaluate-onboarding.js` rule engine. Inserts into `tenant_onboarding_requests`. Sends notification email to `MAIL_TO`. |
| `contact.js` | POST | `/api/contact` | Contact form. Validates Turnstile. Sends via Resend. Rate-limited per IP. |
| `order.js` | POST | `/api/order` | Storefront order. Validates Turnstile. Calls `submit_storefront_order()` Supabase RPC. Triggers `send-order-notification.js`. |
| `check-slug.js` | GET | `/.netlify/functions/check-slug?slug=foo` | Checks `tenants`, `tenant_onboarding_requests`, `pl_reserved_slugs`. Returns `{available: bool, suggestions: []}`. |
| `get-public-catalog.js` | GET | `?tenant=slug` | Returns `products` where `available=true` for the given tenant. No auth. |
| `get-public-tenant-info.js` | GET | `?tenant=slug` | Returns `tenant_settings` branding data. No auth. |
| `cancel-booking.js` | POST | — | Public booking cancellation by token. Updates `bookings.status = 'cancelled'`. |
| `blog-comment.js` | POST | `/api/blog-comment` | Rate-limited. Email notification to admin. [TODO: DB storage] |
| `blog-subscribe.js` | POST | `/api/blog-subscribe` | Rate-limited. Email to admin. [TODO: email list integration] |
| `portal-checkout.js` | POST | — | Public Stripe Checkout session for storefront orders. |

#### Operator Endpoints (Bearer JWT required)

| Function | Method | Purpose | Tables |
|---|---|---|---|
| `get-operator-setup.js` | GET | Dashboard bootstrap: tenant info, settings, Stripe status, plan limits, checklist | tenants, tenant_settings, operator_members |
| `get-launch-checklist.js` | GET | 7-step checklist progress via `build-launch-checklist.js` lib | products, customers, orders, tenant_settings |
| `get-tenant-limit-health.js` | GET | Usage % per resource vs. plan limits. Source: `v_tenant_limit_health` view | tenants |
| `get-bookings.js` | GET | List bookings by date range, status | bookings |
| `create-booking.js` | POST | Create booking. Validates deposit policy. | bookings, jobs |
| `update-booking.js` | POST | Reschedule, status change | bookings |
| `get-availability.js` | GET | Returns availability rules for booking form | availability |
| `manage-availability-blocks.js` | POST/DELETE | Block dates on availability calendar | availability |
| `create-quote.js` | POST | Generate quote, send quote email | quotes |
| `get-quote.js` | GET | Single quote by id | quotes |
| `get-quotes.js` | GET | List quotes by status | quotes |
| `generate-invoice.js` | POST | Create invoice with line items | invoices, orders |
| `generate-hydrovac-invoice.js` | POST | Hydrovac-specific invoice with manifest/material line items | invoices, waste_manifests, job_time_segments |
| `send-invoice-email.js` | POST | Email invoice PDF link to customer | invoices |
| `send-payment-reminder.js` | POST | Resend payment reminder | invoices, customers |
| `send-bid-email.js` | POST | Email bid/estimate to customer | bids |
| `send-follow-up.js` | POST | Send follow-up message to customer | customer_interactions |
| `send-booking-reminder.js` | POST | Manual booking reminder trigger | bookings |
| `send-order-notification.js` | POST | Operator notification of new order | orders |
| `send-push-notification.js` | POST | Web push to crew app | push_subscriptions |
| `send-sms.js` | POST | SMS via Twilio | sms_messages |
| `get-sms-thread.js` | GET | SMS conversation thread | sms_messages |
| `bulk-import-customers.js` | POST | CSV/paste import. Deduplicates by email per tenant. | customers |
| `create-billing-portal-session.js` | POST | Stripe billing portal session URL | tenants |
| `create-billing-upgrade-session.js` | POST | Stripe Checkout session for plan upgrade | tenants |
| `stripe-connect-link.js` | POST | Generate Stripe Connect account onboarding URL | tenants |
| `commit-tenant-asset.js` | POST | Finalize file upload, increment `storage_used_mb` | tenants |
| `get-operator-members.js` | GET | List team members | operator_members, operators |
| `manage-operator-members.js` | POST/DELETE | Invite/remove team members. Enforces seat limits. | operator_members |
| `get-reviews.js` | GET | List tenant reviews | reviews |
| `get-team-hours.js` | GET | Hours per operator for date range | job_time_segments |
| `get-time-entries.js` | GET | Time segment log | job_time_segments |
| `dispatch-job.js` | POST | Hydrovac dispatch with compliance pre-check via `hydrovac-compliance.js` | jobs, compliance_alerts |
| `complete-crew-job.js` | POST | Mark job complete. Validates compliance requirements. | jobs, waste_manifests, confined_space_permits |
| `get-job-detail.js` | GET | Full job record with linked data | jobs, customers, job_time_segments |
| `update-job-status.js` | POST | Transition job status | jobs |
| `get-crew-jobs.js` | GET | Jobs assigned to crew member (used by crew PWA) | jobs |
| `update-crew-job.js` | POST | Crew field updates (notes, photos, time entries) | jobs, job_time_segments |
| `manage-equipment.js` | POST/PUT/DELETE | Equipment CRUD | equipment |
| `manage-waste-manifests.js` | POST/PUT/DELETE | Manifest CRUD | waste_manifests |
| `manage-locate-tickets.js` | POST/PUT/DELETE | 811 ticket CRUD | utility_locate_tickets |
| `manage-disposal-facilities.js` | POST/PUT/DELETE | Disposal facility CRUD | disposal_facilities |
| `manage-driver-qualifications.js` | POST/PUT/DELETE | Driver cert CRUD | driver_qualifications |
| `manage-confined-space-permits.js` | POST/PUT/DELETE | Permit CRUD | confined_space_permits |
| `manage-compliance-alerts.js` | GET/POST | Compliance alert management | compliance_alerts |
| `manage-infrastructure-assets.js` | POST/PUT/DELETE | Sewer/drainage asset CRUD with GIS | infrastructure_assets |
| `manage-inventory.js` | POST/PUT/DELETE | Parts/materials inventory | (inventory table — [TODO: not in core schema yet]) |
| `manage-vendors.js` | POST/PUT/DELETE | Vendor/subcontractor CRUD | (vendors table — [TODO]) |
| `manage-service-contracts.js` | POST/PUT/DELETE | Service contract CRUD | (service_contracts table — [TODO]) |
| `manage-project-phases.js` | POST/PUT/DELETE | Project phase management | (project_phases table — [TODO]) |
| `get-hydrovac-analytics.js` | GET | Hydrovac KPIs: loads/month, material volumes, disposal costs | waste_manifests, job_time_segments |
| `create-recurring-order.js` | POST | Create or update a service_plan | service_plans |
| `create-recurring-bookings.js` | POST | Generate bookings from a recurring plan | bookings, service_plans |
| `get-customer-portal.js` | GET | Customer self-serve portal data | orders, bookings, invoices |
| `ai-brief.js` | POST | Claude API: build daily briefing from business context | orders, bookings, customers, quotes |
| `ai-copilot.js` | POST | Claude API: Q&A + draft generation | (read-only tools in `agent/tools.js`) |
| `update-tenant-config.js` | POST | Update `tenant_settings` (branding, hours, etc.) | tenant_settings |
| `create-quote.js` | POST | Generate quote document | quotes |
| `create-booking.js` | POST | Create appointment | bookings |

#### Admin Endpoints (`requireAdminContext()`)

| Function | Method | Purpose |
|---|---|---|
| `admin-verify.js` | GET | Verify platform_admin role. Optional bootstrap (inserts self if first admin). |
| `admin-get-onboarding-requests.js` | GET | List all applications with search/filter. Returns `tenant_onboarding_requests` joined with latest status. |
| `admin-approve-onboarding.js` | POST | Approve request + provision tenant atomically. Calls `provision-tenant-bundle.js`. |
| `admin-reject-onboarding.js` | POST | Set status = 'rejected', write rejection_reason. |
| `admin-update-tenant-conduct.js` | POST | Actions: flag / suspend / reinstate / terminate. Writes to `tenants` lifecycle columns + `tenant_conduct_log`. |
| `admin-get-conduct-log.js` | GET | Conduct history for a specific tenant. |
| `admin-get-audit-log.js` | GET | Paginated platform-wide conduct log. |
| `admin-send-tenant-message.js` | POST | Send email to tenant owner via Resend. |
| `admin-set-tester-exempt.js` | POST | Grant/revoke billing exemption. Checks slot count against `MAX_TESTER_SLOTS`. |
| `admin-stripe-health.js` | GET | Calls Stripe API to verify key + list webhooks. |
| `admin-delete-tenants.js` | POST | Hard-delete with safety checks (no active subscriptions). |
| `admin-delete-onboarding-requests.js` | POST | Hard-delete onboarding requests. |
| `get-platform-stats.js` | GET | KPIs: tenant counts by status, GMV, orders, average revenue. |
| `get-tenants.js` | GET | Tenant list with search/filter/sort for admin panel. |
| `evaluate-onboarding.js` | POST | Rule engine: checks against `pl_banned_keywords`, `pl_prohibited_categories`, `pl_reserved_slugs`, `pl_protected_brands`. Sets risk_level, evaluation_result. |
| `provision-tenant.js` | POST | Manual provision trigger for approved requests. |

#### Stripe Webhook Handlers

| Function | Webhook | Secret |
|---|---|---|
| `stripe-webhook.js` | `checkout.session.completed`, `payment_intent.succeeded/failed` | `STRIPE_WEBHOOK_SECRET` |
| `stripe-billing-webhook.js` | `customer.subscription.created/updated/deleted`, `invoice.paid/payment_failed` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Both check `processed_webhook_events` before processing (idempotency). Both use `stripe.webhooks.constructEvent()` for signature verification.

`stripe-order-checkout.js` — Creates Stripe Checkout session for customer storefront purchases. Uses Stripe Connect `application_fee_amount` from `PROOFLINK_DEFAULT_APPLICATION_FEE_BPS`.

`stripe-platform-checkout.js` — Creates Checkout session for operator plan subscriptions (Starter / Growth).

#### Scheduled Functions

| Function | Schedule | Purpose |
|---|---|---|
| `booking-reminders.js` | Every hour (`0 * * * *`) | Query bookings with `scheduled_at` in 23-25h window, send reminder emails via Resend |
| `platform-abuse-monitor.js` | Every hour (`0 * * * *`) | Scan for abuse patterns (high-velocity onboarding, suspicious slugs). Writes to `pl_abuse_scans`. |
| `process-recurring-orders.js` | Daily 06:00 UTC (`0 6 * * *`) | Calls Supabase `generate_due_service_plans()` to create orders from due service plans |

---

## 3. Engineering — Database

### 3.1 Supabase Project Configuration

- PostgreSQL 15+ on Supabase
- Row Level Security enabled on ALL tables
- Auth: Supabase Auth (JWT)
- Service role key used only server-side in Netlify Functions
- Anon key used in frontend for auth only (login, session)

### 3.2 Core Schema

#### tenants
```sql
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  business_name text NOT NULL,
  owner_email text,
  city text, state text,
  business_type text,
  status text DEFAULT 'active' CHECK (status IN ('active','suspended','terminated')),
  conduct_action text,
  conduct_reason text,
  conduct_updated_at timestamptz,
  conduct_updated_by text,
  flagged_at timestamptz,
  suspended_at timestamptz,
  terminated_at timestamptz,
  -- Stripe billing
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_account_id text,
  billing_status text DEFAULT 'onboarding' CHECK (billing_status IN ('onboarding','active','inactive')),
  connect_status text DEFAULT 'connect_not_started' CHECK (connect_status IN ('connect_not_started','connect_incomplete','connect_connected')),
  online_payments_enabled boolean DEFAULT false,
  prooflink_plan_key text DEFAULT 'starter',
  application_fee_bps integer DEFAULT 750,
  -- Plan limits
  max_products integer DEFAULT 10,
  max_customers integer DEFAULT 50,
  max_operator_seats integer DEFAULT 1,
  max_orders_per_month integer DEFAULT 100,
  storage_limit_mb integer DEFAULT 100,
  -- Usage counters
  current_products_count integer DEFAULT 0,
  current_customers_count integer DEFAULT 0,
  current_operator_seats integer DEFAULT 0,
  current_orders_this_month integer DEFAULT 0,
  storage_used_mb numeric DEFAULT 0,
  growth_score integer DEFAULT 0,
  -- Tester billing exemption
  billing_exempt boolean DEFAULT false,
  billing_exempt_until timestamptz,
  -- Branding
  hero_image_url text,
  license_number text,
  instagram text,
  tagline text,
  custom_domain text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_billing_status ON tenants(billing_status);
CREATE INDEX idx_tenants_connect_status ON tenants(connect_status);
CREATE INDEX idx_tenants_stripe_customer ON tenants(stripe_customer_id);

-- RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_read_own_tenant" ON tenants
  FOR SELECT USING (operator_member_access(id));
CREATE POLICY "service_role_all" ON tenants
  FOR ALL USING (auth.role() = 'service_role');
```

#### tenant_onboarding_requests
```sql
CREATE TABLE tenant_onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  slug text NOT NULL,
  owner_name text,
  owner_email text NOT NULL,
  phone text,
  business_type text,
  city text, state text,
  setup_mode text,
  promo_code text,
  status text DEFAULT 'submitted'
    CHECK (status IN ('submitted','needs_review','approved','provisioning','provisioned','failed','rejected')),
  rejection_reason text,
  risk_level text CHECK (risk_level IN ('low','medium','high')),
  reason_codes text[],
  evaluation_result jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: public INSERT, service_role all
CREATE POLICY "public_submit" ON tenant_onboarding_requests
  FOR INSERT WITH CHECK (true);
CREATE POLICY "service_role_all" ON tenant_onboarding_requests
  FOR ALL USING (auth.role() = 'service_role');
```

#### operators + operator_members
```sql
CREATE TABLE operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  user_id uuid REFERENCES auth.users(id),
  email text NOT NULL,
  name text,
  role text DEFAULT 'owner' CHECK (role IN ('owner','member','platform_admin')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE operator_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid REFERENCES operators(id),
  tenant_id uuid REFERENCES tenants(id),
  user_id uuid REFERENCES auth.users(id),
  role text DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (operator_id, tenant_id)
);

-- Helper function for RLS
CREATE OR REPLACE FUNCTION operator_member_access(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM operator_members
    WHERE tenant_id = p_tenant_id
    AND user_id = auth.uid()
  );
$$;
```

#### Key Business Tables

**products** — `id, tenant_id, operator_id, name, description, price_cents, category, image_url, available, pricing_mode, sort_order, created_at`

**customers** — `id, tenant_id, operator_id, name, email, phone, address, notes, lifetime_value_cents, order_count, last_contact_at, created_at`

**orders** — `id, tenant_id, operator_id, customer_id, status (new/confirmed/fulfilled/cancelled/paid/completed), items jsonb[], subtotal_cents, total_cents, fulfillment, scheduled_date, deposit_policy, cart_summary, created_at`

**jobs** — `id, tenant_id, operator_id, customer_id, order_id?, status (draft/scheduled/in_progress/completed/invoiced/paid), job_type, description, scheduled_at, completed_at, deposit_policy, deposit_due_date, deposit_override_by, deposit_override_reason`

**service_plans** — `id, tenant_id, operator_id, customer_id, status (draft/active/paused/cancelled), cadence (weekly/biweekly/monthly/quarterly/custom_days), custom_interval_days, next_run_on, started_at, ended_at`

**invoices** — `id, tenant_id, operator_id, customer_id, job_id?, status (draft/sent/paid/void), line_items jsonb[], subtotal_cents, tax_cents, total_cents, sent_at, paid_at`

### 3.3 RLS Pattern

Every business table uses this pattern:
```sql
CREATE POLICY "operator_read" ON {table}
  FOR SELECT USING (operator_member_access(tenant_id));
CREATE POLICY "operator_insert" ON {table}
  FOR INSERT WITH CHECK (operator_member_access(tenant_id));
CREATE POLICY "operator_update" ON {table}
  FOR UPDATE USING (operator_member_access(tenant_id));
CREATE POLICY "service_role_all" ON {table}
  FOR ALL USING (auth.role() = 'service_role');
```

### 3.4 Governance Tables

```sql
-- Platform rule tables (admin-managed)
CREATE TABLE pl_reserved_slugs (slug text PRIMARY KEY, reason text);
CREATE TABLE pl_banned_keywords (keyword text PRIMARY KEY, category text);
CREATE TABLE pl_protected_brands (brand text PRIMARY KEY, reason text);
CREATE TABLE pl_prohibited_categories (category text PRIMARY KEY, reason text);

-- Audit trail
CREATE TABLE tenant_conduct_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  action text CHECK (action IN ('flag','suspend','reinstate','terminate')),
  reason text,
  notes text,
  performed_by text,
  performed_at timestamptz DEFAULT now()
);

-- Stripe idempotency
CREATE TABLE processed_webhook_events (
  event_id text PRIMARY KEY,
  processed_at timestamptz DEFAULT now()
);
-- Auto-purge after 90 days via pg_cron or Supabase schedule [TODO: confirm cleanup job]
```

### 3.5 Key Database Functions

| Function | Purpose |
|---|---|
| `operator_member_access(uuid)` | Returns bool — used in all RLS policies |
| `sync_tenant_usage_counters(tenant_id)` | Recounts products, customers, orders, operators for a tenant |
| `check_storage_limit(tenant_id)` | Returns bool — blocks upload if over limit |
| `increment_tenant_storage_usage(tenant_id, mb)` | Adds to `storage_used_mb` |
| `generate_due_service_plans()` | Creates orders from service_plans where `next_run_on <= now()` |
| `create_order_from_service_plan(plan_id)` | Creates one order + advances `next_run_on` |
| `advance_service_plan_next_run_on(plan_id)` | Calculates and sets next run date by cadence |
| `get_tenant_plan_limits(tenant_id)` | Returns plan limit struct |
| `resolve_tenant_row(text)` | Finds tenant by UUID or slug |
| `submit_storefront_order()` | RPC for public order submission |
| `enforce_order_deposit_policy()` | Trigger: blocks booking without deposit |
| `enforce_operator_tenant_membership_pair()` | Trigger: blocks cross-tenant writes |

### 3.6 Migration Strategy

- Primary consolidated file: `sql/rebuild_supabase_full.sql` (4,919 lines) — run from scratch for a new Supabase project
- `sql/catchup_run_this.sql` — incremental catch-up for existing databases (1,741 lines)
- Individual migration files in `sql/` are historical and can be applied incrementally
- `sql/diagnostic.sql` — read-only health checks (safe to run anytime)
- `sql/stage_test_tenants.sql` — seed 3 test tenants for testing

---

## 4. Engineering — Infrastructure & DevOps

### 4.1 Netlify

- **Build command:** `npm install --omit=dev` (no frontend build step)
- **Publish directory:** `.` (root — all HTML served as static files)
- **Functions directory:** `netlify/functions`
- **Node version:** 18+ (set via `package.json` `engines.node >= 18`)
- **Environment variables:** Set in Netlify UI → Site → Environment variables. All listed in `.env.example`.
- **Deploy:** `git push origin main` triggers automatic Netlify deploy
- **Preview deploys:** All PRs get preview URL from Netlify
- **Canonical domain:** prooflink.co (primary). Aliases redirect 301 to canonical.

### 4.2 Supabase Setup

1. Create new Supabase project
2. Run `sql/rebuild_supabase_full.sql` in SQL editor
3. Run `sql/platform_admin_seed.sql` to insert `christopher@prooflink.co` as platform_admin
4. Enable Supabase Auth (email provider enabled)
5. Configure Auth redirect URLs: `https://prooflink.co/operator/`, `https://prooflink.co/admin/`
6. Copy Project URL and keys to Netlify env vars

### 4.3 Stripe Configuration

- Create Stripe account with Connect platform enabled
- Set `STRIPE_SECRET_KEY` (use `sk_test_...` for development, `sk_live_...` for production)
- Create two recurring price objects: Starter Monthly, Growth Monthly — copy IDs to env vars
- Configure webhooks:
  - Endpoint 1: `https://prooflink.co/.netlify/functions/stripe-webhook` — events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`
  - Endpoint 2: `https://prooflink.co/.netlify/functions/stripe-billing-webhook` — events: `customer.subscription.*`, `invoice.*`
  - Copy signing secrets to `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`
- Default application fee: 750 BPS (7.5%) set in `PROOFLINK_DEFAULT_APPLICATION_FEE_BPS`

### 4.4 Local Development

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with test credentials
npx netlify dev   # Runs functions on localhost:8888
```

For integration tests:
```bash
cp .env.test.example .env.test
# Fill with test Supabase project + Stripe test keys
npm run test:integration
```

### 4.5 DNS / Domain

- `prooflink.co` → Netlify primary domain
- `www.prooflink.co` → 301 redirect to `prooflink.co` (in `netlify.toml`)
- `app.prooflink.co` → 301 redirect to `prooflink.co` (in `netlify.toml`)
- Email: Resend domain verification for `prooflink.co` + SPF/DKIM records
- [DECISION NEEDED: Per-tenant custom domains — require Netlify Pro or Enterprise for programmatic domain alias management]

---

## 5. Engineering — Security

### 5.1 Row Level Security

All tables have RLS enabled. Three layers:
1. **Service role** (Netlify Functions) — full access, bypasses RLS
2. **Authenticated operators** — scoped to their tenant via `operator_member_access(tenant_id)`
3. **Anonymous/public** — insert-only policies on `tenant_onboarding_requests`, read-only on published catalog/storefront data

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client. Frontend uses only `SUPABASE_ANON_KEY` for Supabase Auth calls.

### 5.2 Spam Protection — Three Layers

**Layer 1 — Honeypot field**
- `contact.html` and `join.html` contain `<input name="fax">` styled `display:none`
- Server functions check: if `body.fax` is non-empty → reject silently with 200 (avoid bot retry)

**Layer 2 — Timing gate**
- Page load timestamp stored in hidden field or sessionStorage
- If form submitted in < 2 seconds → flagged as automated submission
- `onboarding.js` function checks submission elapsed time

**Layer 3 — Cloudflare Turnstile**
- Widget rendered on `contact.html`, `join.html`, `order.js`
- Server validates token against Turnstile API: `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Uses `TURNSTILE_SECRET_KEY` env var
- If `TURNSTILE_SECRET_KEY` not set, validation is skipped (dev-only fallback)

### 5.3 Webhook Signature Verification

```javascript
// stripe-webhook.js pattern
const sig = event.headers['stripe-signature'];
const stripeEvent = stripe.webhooks.constructEvent(
  event.body,
  sig,
  process.env.STRIPE_WEBHOOK_SECRET  // or STRIPE_CONNECT_WEBHOOK_SECRET
);
```

If signature fails → 400 response, no processing.

### 5.4 INTERNAL_SECRET

Used for inter-function calls (e.g., `admin-approve-onboarding.js` calling `provision-tenant.js`):
```javascript
headers: { 'x-internal-secret': process.env.INTERNAL_SECRET }
```
Receiving function validates presence and value before processing.

### 5.5 Content Moderation — Rule Engine

`evaluate-onboarding.js` runs automatically on every onboarding submission:
- Checks business name + slug against `pl_banned_keywords`
- Checks `business_type` against `pl_prohibited_categories`
- Checks slug against `pl_reserved_slugs`
- Checks business name against `pl_protected_brands` (trademark protection)
- Sets `risk_level` (low / medium / high) and `evaluation_result` on the request
- High-risk applications go to `needs_review` status (not auto-rejected)

Platform admin can add/remove rules via Supabase table edits [DECISION NEEDED: admin UI for rule management not yet built].

### 5.6 Content Security Policy

Defined in `_headers`:
- `default-src 'self'` for main site
- Separate, tighter CSP for `/admin/*` and `/operator/*`
- Allows Supabase, Stripe.js, Cloudflare Turnstile, Google Fonts, Resend tracking as explicitly whitelisted sources
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`

### 5.7 Input Sanitization

- `prooflink.core.js` exports `escapeHtml()` for all user-generated content rendered in the DOM
- `utils/email.js` exports `escHtml()` for email template rendering
- `utils/email.js` exports `sanitizeUrl()` to strip `javascript:` protocol from URLs
- All DB writes go through parameterized Supabase queries (no string interpolation)

---

## 6. Product Management

### 6.1 Feature Inventory by User Role

| Feature | Public Visitor | Tenant Operator | Platform Admin |
|---|---|---|---|
| View landing page / blog | ✓ | ✓ | ✓ |
| Submit onboarding application | ✓ | — | — |
| Submit contact form | ✓ | — | — |
| Browse storefront | ✓ | ✓ | — |
| Place storefront order | ✓ | — | — |
| Book appointment | ✓ | — | — |
| Operator dashboard | — | ✓ | — |
| CRM / customers | — | ✓ | — |
| Jobs / bookings | — | ✓ | — |
| Invoicing / payments | — | ✓ | — |
| Product catalog | — | ✓ | — |
| Availability management | — | ✓ | — |
| Team management | — | ✓ (Growth+) | — |
| AI copilot | — | ✓ | — |
| Field crew app | — | ✓ (crew members) | — |
| Hydrovac operations | — | ✓ (enabled tenants) | — |
| Admin panel | — | — | ✓ |
| Approve/reject applications | — | — | ✓ |
| Suspend/terminate tenants | — | — | ✓ |
| Platform GMV / stats | — | — | ✓ |
| Grant tester exemptions | — | — | ✓ |

### 6.2 Plan Feature Matrix

| Feature | Starter | Growth | Enterprise |
|---|---|---|---|
| Products | 10 | Unlimited | Unlimited |
| Customers | 50 | Unlimited | Unlimited |
| Orders/month | 100 | Unlimited | Unlimited |
| Operator seats | 1 | 5 | Unlimited |
| Storage | 100 MB | [DECISION NEEDED] | [DECISION NEEDED] |
| Storefront | ✓ | ✓ | ✓ |
| Online payments | ✓ (Stripe Connect) | ✓ | ✓ |
| AI copilot | ✓ | ✓ | ✓ |
| Hydrovac module | ✓ (if enabled) | ✓ | ✓ |
| Custom domain | — | [TODO] | [TODO] |
| Priority support | — | — | [TODO] |

Stripe price IDs:
- Starter Monthly: `price_1TAcWbDvhvAaxXasbIDUK1aO`
- Growth Monthly: `price_1T8nOODvhvAaxXasqGKnuH85`

### 6.3 User Journeys

**Operator Onboarding (New Tenant)**
1. Visit prooflink.co → click "Apply now"
2. Complete 4-step join.html form → submit to `onboarding.js`
3. Receive confirmation email (Resend)
4. Admin reviews application in admin panel
5. Admin clicks "Approve & Launch" → `admin-approve-onboarding.js` → `provision-tenant-bundle.js`
   - Creates Supabase Auth user (or sends invite)
   - Creates `tenants`, `operators`, `operator_members` records
   - Seeds industry template via `seed-templates.js`
   - Creates `tenant_settings` with default branding
   - Creates Stripe customer
   - Sends welcome email with dashboard link
6. Operator receives email → clicks link → sets password → enters `/operator/`
7. Startup checklist guides first 7 steps (add product, add customer, etc.)
8. Operator completes Stripe Connect to enable online payments

**Customer Purchase (Storefront)**
1. Customer visits storefront URL (`?tenant=slug` or custom domain)
2. `prooflink.tenant.js` hydrates tenant branding
3. `get-public-catalog.js` loads products
4. Customer adds items to cart (`cart.js` / localStorage)
5. Checkout: `stripe-order-checkout.js` creates Stripe Checkout session
6. Customer completes Stripe payment
7. `stripe-webhook.js` receives `checkout.session.completed`
8. Order record updated, operator notification sent
9. Confirmation email sent to customer via Resend

**Customer Booking**
1. Customer visits `book.html?tenant=slug`
2. `get-availability.js` returns available dates/times
3. Customer fills form → submit to `create-booking.js`
4. Booking created, confirmation email sent
5. `booking-reminders.js` sends 24h reminder

**Admin Application Review**
1. Admin opens admin panel → Onboarding tab
2. Views list of submissions with risk_level and evaluation_result
3. Opens detail modal to review full application
4. Either: Approve & Launch (one click) / Approve only / Reject with reason
5. Tenant receives appropriate email in all cases

### 6.4 Industry Templates

Seeded at provisioning by `netlify/functions/lib/seed-templates.js`:

| Template Key | Business Type | Pricing Mode |
|---|---|---|
| `pressure_washing` | Pressure Washing | starts_at |
| `cleaning` | Cleaning Services | starts_at |
| `lawn_care` | Lawn Care | starts_at |
| `handyman` | Handyman | quote |
| `hvac` | HVAC | quote |
| `hydrovac` | Hydrovac | quote + complex rate sheet |
| `plumbing` | Plumbing | quote |
| `pet_services` | Pet Services | fixed |
| `photography` | Photography | starts_at |
| `events` | Events | starts_at |
| `bakery` | Bakery / Food | fixed |

### 6.5 Feature Backlog / Roadmap

**90-Day Priorities** (per latest commit context):
- [ ] Custom domain support for tenant storefronts
- [ ] Blog comment DB storage (currently email-only)
- [ ] Email marketing list integration (Resend broadcasts)
- [ ] Drag-to-reorder products
- [ ] Admin UI for governance rule management
- [ ] Vendor / inventory / service contract tables finalized in schema
- [ ] Stripe test → live key migration tooling

**[TODO] Planned Features:**
- Customer-facing portal (self-serve order history, invoice download)
- Recurring plan customer portal
- SMS two-way messaging dashboard
- Review / rating collection flow
- Referral program tracking (promo codes beyond `BUILDWITHME`)
- Advanced analytics (cohort analysis, churn indicators)
- Multi-location tenants

---

## 7. Design / UX

### 7.1 Brand Design Tokens (`assets/brand/prooflink-tokens.css`)

```css
:root {
  /* Color */
  --pl-color-ink: #132027;           /* Primary text */
  --pl-color-ink-soft: #30424a;      /* Secondary text */
  --pl-color-sand: #f4efe6;          /* Background warm sand */
  --pl-color-panel: #fffaf2;         /* Card/panel background */
  --pl-color-panel-soft: #efe7db;    /* Subtle panel variant */
  --pl-color-brand: #0f6370;         /* Primary teal brand */
  --pl-color-brand-strong: #0b4650;  /* Brand dark */
  --pl-color-brand-soft: #d8ebe7;    /* Brand tint */
  --pl-color-signal: #d26e39;        /* Orange signal / CTA */
  --pl-color-gold: #f1b24a;          /* Gold accent */
  --pl-color-line: rgba(19,32,39,.12);
  --pl-color-line-strong: rgba(19,32,39,.22);

  /* Shadow */
  --pl-shadow-soft: 0 18px 40px rgba(19,32,39,.08);
  --pl-shadow-brand: 0 28px 72px rgba(11,28,33,.18);

  /* Radius */
  --pl-radius-lg: 24px;
  --pl-radius-md: 16px;
  --pl-radius-sm: 12px;

  /* Typography */
  --pl-font-display: 'Google Sans', ui-sans-serif, system-ui, sans-serif;
  --pl-font-body: 'Google Sans Text', ui-sans-serif, system-ui, sans-serif;
}
```

**Operator Dashboard Theme (operator.css)**
- Dark mode (default): bg0 `#1b1713`, bg1 `#241f1a`, panel `#312a24`, text `#f7f3ec`, accent `#c84b2f`
- Light mode: bg0 `#efe4d2`, bg1 `#ddcfba`, panel `#fff8ef`, text `#221b15`
- Radii: 18px (card), 24px (modal)

**Admin Theme (admin.css)**
- Background: `#f0ede6` (cream)
- Ink: `#0d0d0b`
- Accent: `#c84b2f` (burnt orange)

### 7.2 Responsive Breakpoints

- **860px** — Operator sidebar collapses, mobile nav appears
- **600px** — Card grids stack to single column, modal full-screen

### 7.3 Accessibility

- `accessibility.html` — Public accessibility statement with contact form link
- Semantic HTML: `<nav>`, `<main>`, `<section>`, `<aside>`, `<button>` (not `<div>` for interactions)
- Minimum 44×44px tap targets (enforced in mobile CSS)
- Focus-visible styles on all interactive elements
- `lang="en"` on all HTML documents
- Alt text required on all product images

### 7.4 Empty, Loading, and Error States

Every workspace handles three states:
- **Loading:** Skeleton shimmer cards while fetching
- **Empty:** Illustrated empty state with action prompt ("Add your first product →")
- **Error:** Toast notification bottom-right, auto-dismiss 4s. Persistent inline error for form validation.

---

## 8. Marketing

### 8.1 Positioning

ProofLink is **not Shopify**. It's not for retail merchants.

**Core positioning:** A complete business platform built specifically for independent field service and trade operators — delivered in minutes, not weeks.

**Differentiation:**
- Shopify is for product retailers. ProofLink is for service providers.
- Most CRMs are enterprise tools with SMB pricing. ProofLink is built SMB-first.
- Generic SaaS requires connecting 5+ tools. ProofLink ships storefront + CRM + jobs + invoicing + payments together.
- ProofLink is founder-led, Michigan-first, and knows the target customer personally.

### 8.2 Target Audience

**Primary: Solo operator, 1–5 person team**
- Pressure washers, lawn care, cleaners, handymen, HVAC techs, plumbers, hydrovac operators, bakers, photographers, event coordinators
- Revenue range: $40K–$300K/year
- Currently using: paper invoices, Venmo, Square, text messages, Google Sheets
- Pain point: "I'm good at the work, not the admin"

**Secondary: Michigan-first geographic focus**
- Initial sales motion targets Southeast Michigan
- Industries well-represented: landscaping, field services, hydrovac (Michigan oil/gas/construction sector)

### 8.3 SEO Strategy

**Blog pillars** (content at `docs/blog/`):
1. **Organization & Workflow** — "Simple workflow systems for small businesses," "How small businesses stay organized"
2. **CRM & Customer Management** — "Why most CRM systems fail small businesses"
3. **Business Operations** — "Hidden advantage small businesses have," "5 organizational problems that slowly kill small businesses"

**Target keywords (long-tail, low competition):**
- "simple workflow system for small service business"
- "how to organize a small cleaning business"
- "best invoicing app for pressure washing"
- "hydrovac manifest tracking software"
- "field service business software Michigan"

**Technical SEO:**
- HTML `<title>` and `<meta description>` per page
- `Strict-Transport-Security` + HTTPS enforced
- Fast load: no framework JS, static HTML, CDN via Netlify
- `sitemap.xml` [TODO: not yet generated]
- `robots.txt` [TODO: not yet created]

**Local SEO:**
- Michigan-specific landing pages [TODO]
- Google Business Profile [DECISION NEEDED: not yet claimed]

### 8.4 Conversion Funnel

```
Awareness (blog, word of mouth, referral)
    ↓
Landing page (index.html) — CTA: "Apply now"
    ↓
Join form (join.html) — 4-step, low friction
    ↓
Admin review + approval (24–48 hour target)
    ↓
Welcome email + dashboard link
    ↓
Startup checklist (7 steps to "ready")
    ↓
First transaction → convert to paid plan
    ↓
Month 12: Tester → paid conversion
```

### 8.5 Email Marketing

All email via Resend from `support@prooflink.co`:
- **Transactional:** Order confirmations, booking confirmations, invoice emails, welcome emails — built and live
- **Newsletter/Marketing:** [TODO: blog subscribe list via `blog-subscribe.js` collects emails but no broadcast pipeline yet]
- [DECISION NEEDED: Use Resend Broadcasts vs. external ESP like Mailchimp / ConvertKit for marketing emails]

---

## 9. Sales

### 9.1 Sales Motion

**Stage 1 (Current): Founder-led, invite-only**
- Christopher personally knows target operators through Michigan networks
- Direct outreach via text/call
- Demo via screen share
- Onboarding hand-held for first 10 operators (testers)
- Goal: 3 active paying operators within 90 days

### 9.2 Qualification Criteria

**Good fit:**
- Sole proprietor or 1–5 person team
- $40K+ annual revenue (has something to manage)
- Currently using 2+ disconnected tools (invoicing app + Venmo + notes)
- Michigan-based (for founder support reach)
- Technically comfortable with smartphone (not necessarily computer)

**Poor fit:**
- Retail/e-commerce (use Shopify)
- Enterprise with IT department (use ServiceTitan, Jobber)
- Pure freelancers (use HoneyBook or 17hats)
- Businesses with complex multi-location needs

### 9.3 Demo Script

1. **Open with the problem** (2 min): "Walk me through how you handle a new customer right now — from first call to getting paid."
2. **Show the storefront** (3 min): Their own slug URL, product/service listing, booking form.
3. **Show the dashboard** (5 min): Today view → create a mock customer → create a booking → generate invoice → send via email.
4. **Show payments** (3 min): Stripe Connect setup, what customers see at checkout, money flowing.
5. **Address objections** (5 min): See 9.4.
6. **Close** (2 min): "You're already approved as a tester — I'll set it up today. You'll be live by end of week."

### 9.4 Objection Handling

| Objection | Response |
|---|---|
| "I already use [Square/Jobber/Housecall Pro]" | "How much does it cost per month? Does it give you a public storefront people can find and book from? ProofLink does that for $[Starter price]." |
| "I'm not tech-savvy" | "You already use your phone for everything. This is built like a phone app. I'll sit with you while you set it up." |
| "I'm too busy right now" | "Setup takes one afternoon. After that, it saves you 2–3 hours a week on scheduling and invoicing." |
| "I need to think about it" | "Fair. Let me set you up as a free tester so you can experience it without committing. Nothing to lose." |

### 9.5 Tester-to-Paid Conversion (Month 12)

- Billing exemptions expire at `billing_exempt_until` timestamp
- 30 days before expiry: admin sends manual check-in email [TODO: automate]
- 14 days before expiry: billing CTA shown in dashboard (persistent banner)
- On expiry: `billing_exempt = false`, operator must subscribe or dashboard enters read-only mode [TODO: read-only enforcement not yet implemented]

---

## 10. Customer Support

### 10.1 Support Channels

- **Email:** `support@prooflink.co` → `christopher@prooflink.co` (MAIL_TO env var)
- **Contact form:** `contact.html` → `contact.js` → Resend notification
- **In-dashboard:** AI copilot for self-serve help (`ai-copilot.js`)
- **Knowledge base:** [TODO: not yet built — blog content partially serves this]
- **Phone/text:** Founder direct for tester accounts

### 10.2 Issue Playbooks

**"I can't log in"**
1. Confirm email address matches what's on file in operators table
2. Admin: use admin panel → Tenants → send password reset (calls `admin-send-password-reset.js`)
3. If email not found: check `operator_members` table for user_id mapping
4. Last resort: Supabase dashboard → Auth → Users → manually trigger reset

**"Checkout is broken / customers can't pay"**
1. Check `tenants.connect_status` — must be `connect_connected`
2. Check `tenants.online_payments_enabled = true`
3. Confirm Stripe account not restricted (check Stripe dashboard)
4. Check `processed_webhook_events` — confirm `checkout.session.completed` event was received
5. Check Netlify function logs for `stripe-webhook.js` errors

**"I'm not getting paid / payouts delayed"**
1. Stripe Connect payouts — direct to operator's bank account via Stripe
2. Stripe payout schedule is set by Stripe (typically 2 business days after charge)
3. Stripe account must have identity verification complete
4. Direct operator to Stripe dashboard → Payouts tab

**"My application is stuck / not reviewed"**
1. Check `tenant_onboarding_requests.status` in admin panel
2. If `needs_review`: admin manually reviews
3. If `failed`: check `provision_failures` table for error detail
4. If `provisioning` for > 10 min: retry provision from admin panel

**"Products aren't showing on my storefront"**
1. Check `products.available = true`
2. Check `tenant_settings.storefront_published = true`
3. Check `tenants.status = 'active'` (not suspended/terminated)

### 10.3 Escalation Path

Tier 1 (self-serve) → AI copilot in dashboard
Tier 2 (email) → `support@prooflink.co` → Christopher responds
Tier 3 (database intervention) → Supabase dashboard direct access (Christopher only)

---

## 11. Legal / Compliance

### 11.1 Terms of Service (Outline)

[TODO: Full ToS not yet drafted. Key sections needed:]
- Acceptance of terms
- Platform use (service businesses only — not retail merchants)
- Prohibited uses (see 11.3)
- Operator responsibilities (accurate business info, tax compliance)
- Payment terms (7.5% platform fee per transaction)
- Account termination (conduct policy)
- Limitation of liability
- Governing law: State of Michigan

### 11.2 Privacy Policy (Outline)

[TODO: Full Privacy Policy not yet drafted. Key sections needed:]
- Data collected: business name, owner name, email, phone, business data (customers, orders)
- Data use: platform operation, email communications
- Third-party processors: Supabase, Stripe, Resend, Cloudflare, Anthropic (AI features), Twilio
- Data retention: active tenants retain data; terminated tenants — [DECISION NEEDED: retention period]
- Customer data (storefront purchasers): collected per-tenant, operator is data controller
- Cookies / localStorage: used for cart persistence, session
- Contact: `support@prooflink.co`

### 11.3 Prohibited Content Categories

Maintained in `pl_prohibited_categories` table. Seeded categories include:
- Adult content / escort services
- Weapons, firearms, ammunition dealers
- Drug paraphernalia
- Gambling
- MLM / pyramid schemes
- Counterfeit goods
- Financial services / unlicensed lending
- Any business operating illegally in Michigan

### 11.4 DMCA Process

[TODO: Formal process not yet defined]
- Designated DMCA agent: Christopher [last name needed]
- Takedown request: email `support@prooflink.co` with subject "DMCA Takedown"
- Response SLA: 48 business hours
- Content removed pending investigation

### 11.5 Stripe Connect Compliance

- Operators must complete Stripe identity verification before payouts
- ProofLink is a Stripe Connect platform — operators are "connected accounts"
- Platform cannot hold funds; money flows directly Stripe → operator bank
- Stripe handles PCI compliance for card data
- Operators must agree to Stripe Connected Account Agreement (served during Connect onboarding)

### 11.6 Michigan Considerations

- Michigan Cottage Food Law: relevant for bakery tenants — operators are responsible for their own compliance
- Hydrovac operators: regulated by MDOT and MDEQ — compliance documentation tracked in platform but legal responsibility lies with operator
- Sales tax: [DECISION NEEDED: ProofLink does not currently calculate or remit sales tax on operator transactions — operators responsible]

---

## 12. Operations

### 12.1 Daily Admin Checklist

1. Check admin panel Onboarding tab for new submissions (target: review within 24 hours)
2. Check System Health panel — all green
3. Check Netlify function logs for errors (runtime → Functions tab)
4. Check `provision_failures` table for any stuck provisions
5. Check `pl_abuse_scans` for flagged activity
6. Review Stripe dashboard for any Connect account issues or disputed charges

### 12.2 Tenant Lifecycle

```
Application submitted (tenant_onboarding_requests.status = 'submitted')
    ↓ Admin review (evaluate-onboarding rule engine runs automatically)
    ↓ Admin approves
Provisioning (status = 'provisioning')
    ↓ provision-tenant-bundle.js runs atomically
    ↓ On success: tenants record created
Active (tenants.status = 'active')
    ↓ Operator sets up storefront, connects Stripe
    ↓ Billing: Starter plan free during tester period
At tester expiry → billing_exempt_until passes
Paying customer (billing_status = 'active')
    ↓ Possible conduct issues
Flagged (conduct_action = 'flag') — warning, no restriction
Suspended (conduct_action = 'suspend') — dashboard access blocked [TODO: enforcement]
Terminated (conduct_action = 'terminate') — full removal
```

### 12.3 Incident Response

**P0 — Stripe webhook not processing**
1. Check Netlify function logs for `stripe-webhook.js`
2. Check Stripe dashboard → Webhooks → recent deliveries
3. If processing: check `processed_webhook_events` for idempotency block
4. Manually replay from Stripe dashboard if needed

**P0 — Database down**
1. Check Supabase status page
2. All Netlify functions will return 500s
3. Static pages still serve (Netlify CDN)
4. Notify affected operators via email if > 15 min downtime

**P1 — Provision failure**
1. Check `provision_failures` table for failure stage and error
2. Clean up partial data if needed (delete orphaned operators/tenants)
3. Retry provision from admin panel

### 12.4 Database Maintenance

- `processed_webhook_events`: Auto-purges after 90 days [TODO: confirm pg_cron job exists]
- `pl_rate_limits`: May grow large — periodic cleanup of expired entries [TODO: cleanup job]
- Monitor `tenants.storage_used_mb` — alert at > 80% of `storage_limit_mb`
- Run `sql/diagnostic.sql` monthly for consistency checks

### 12.5 Key Metrics (Operations)

| Metric | Target | Source |
|---|---|---|
| Application review time | < 24 hours | `tenant_onboarding_requests.created_at` vs. `updated_at` |
| Provisioning success rate | > 95% | `provision_failures` count |
| Platform uptime | > 99.5% | Netlify status + Supabase status |
| Webhook processing lag | < 30 seconds | Stripe webhook delivery logs |
| Tester → paid conversion | > 50% at month 12 | `billing_exempt_until` + `billing_status` |

---

## 13. QA / Testing

### 13.1 Test Commands

```bash
npm run test:unit         # Vitest unit tests
npm run test:integration  # Integration tests (requires .env.test)
npm run test:e2e          # Playwright end-to-end
npm run test:preflight    # Env contract validation (CI gate)
npm run lint              # ESLint
```

GitHub Actions (`.github/workflows/test.yml`): runs `npm audit`, env validation, unit tests, integration tests on push to main.

### 13.2 Critical User Flows to Test

| Flow | Test Type | Key Assertions |
|---|---|---|
| Onboarding form submission | Integration | Request created in DB, risk_level set, notification email sent |
| Admin approve + provision | Integration | Tenant created, operator created, welcome email sent |
| Storefront product listing | E2E | Products appear, cart works, checkout redirects to Stripe |
| Stripe checkout completion | Integration | Webhook fires, order status updated, confirmation email sent |
| Operator login | E2E | Auth flow, dashboard loads, tenant data correct |
| Plan limit enforcement | Unit | At cap: write-guard blocks, returns 402 |
| Slug availability | Unit | Reserved slugs blocked, taken slugs blocked, available slugs allowed |
| Webhook signature verification | Unit | Invalid sig returns 400, valid sig processes |
| Hydrovac dispatch | Integration | Compliance pre-check fails gracefully, dispatch blocked if missing required data |

### 13.3 Edge Cases

- Onboarding submission < 2 seconds: must fail timing gate silently
- Honeypot field filled: must reject silently with 200
- Duplicate customer email per tenant: `customers` unique constraint on (tenant_id, email)
- At plan limit: create attempt returns 402 with upgrade CTA data
- Stripe Connect webhook for unknown account: must ignore gracefully
- Provision mid-failure (after user created, before tenant): `provision_failures` logs stage, no zombie accounts
- Duplicate Stripe webhook event: `processed_webhook_events` idempotency check returns 200 without reprocessing

### 13.4 Test Data

- `sql/stage_test_tenants.sql` seeds 3 test tenants: Northwind Field Services, Harbor Bloom Events, Granite Peak Outfitters
- `sql/diagnostic.sql` — safe to run for data health checks
- Stripe test mode: use `sk_test_...` key, test card `4242 4242 4242 4242`
- Turnstile test key: Cloudflare provides `1x0000000000000000000000000000000AA` as always-pass test sitekey

### 13.5 Stripe Test Mode Workflow

1. Set `STRIPE_SECRET_KEY=sk_test_...` in `.env.local`
2. Run `stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook` in separate terminal
3. Use Stripe test cards for checkout
4. Verify webhook delivery in Stripe CLI output and `processed_webhook_events` table

---

## 14. Analytics / Metrics

### 14.1 Platform KPIs (Admin)

| KPI | Definition | Source |
|---|---|---|
| MRR | Sum of active plan subscriptions × monthly price | Stripe subscriptions |
| Total Tenants | Count of `tenants` with `status = 'active'` | `get-platform-stats.js` |
| Pending Applications | Count of `tenant_onboarding_requests` where `status IN ('submitted', 'needs_review')` | Admin panel |
| Approval Rate | Approved / (Approved + Rejected) in trailing 30 days | `tenant_onboarding_requests` |
| Provision Success Rate | Provisioned / Approved | `tenants` + `provision_failures` |
| Platform GMV | Sum of `payments.total_cents` across all tenants | `get-platform-stats.js` |
| Platform Revenue | GMV × 7.5% (application fee) | Derived |
| Stripe Connect Adoption | % of tenants with `connect_status = 'connect_connected'` | `tenants` |
| Churn Rate | Tenants terminated or subscriptions cancelled / total active | Stripe + `tenants` |

### 14.2 Tenant-Level KPIs (Operator)

| KPI | Definition |
|---|---|
| Orders (MTD) | Count of orders in current month |
| Revenue (MTD) | Sum of completed order totals in current month |
| Average Order Value | Revenue / Orders |
| Outstanding Invoices | Sum of unpaid invoice totals |
| Customer LTV | Sum of payments per customer |
| Booking Fill Rate | Confirmed bookings / Available slots |
| Top Products | Products by revenue contribution |

### 14.3 Instrumentation Plan

**Currently instrumented:**
- Netlify function logs (all request/response in Netlify dashboard)
- Stripe events (dashboard + webhook logs)
- Supabase logs (database queries, auth events)
- `tenant_conduct_log` for admin actions
- `pl_abuse_scans` for abuse monitoring
- Agent audit log (`agent_audit_events` table) for AI interactions

**[TODO] Not yet instrumented:**
- Frontend page view / funnel tracking (no analytics script loaded)
- Conversion events (join form start → submit → approval → first transaction)
- Feature adoption per plan tier
- Storefront traffic per tenant
- Blog engagement metrics (time on page, scroll depth)

**[DECISION NEEDED: Analytics stack]**
- Option A: Plausible Analytics (privacy-first, simple, paid) — recommended for brand alignment
- Option B: Fathom Analytics (similar to Plausible)
- Option C: PostHog (self-hostable, more powerful but heavier)
- Option D: Google Analytics 4 (free but privacy concerns + CSP complexity)
- Recommended: Plausible with `data-domain="prooflink.co"` script tag in `<head>`

### 14.4 Dashboards to Build

| Dashboard | Audience | Tool | Status |
|---|---|---|---|
| Platform overview | Admin | Admin panel (built) | Live |
| Tenant health / control tower | Admin | Admin panel (built) | Live |
| Operator revenue overview | Operator | Insights tab (partial) | Partial |
| Hydrovac analytics | Operator | Hydrovac workspace (built) | Live |
| Marketing funnel | Founder | [DECISION NEEDED] | Not built |
| MRR / churn | Founder | Stripe dashboard (native) | Use Stripe |
| Site performance | Founder | Netlify Analytics | [TODO: enable] |

---

*This document reflects the actual codebase as of April 2026. Use [DECISION NEEDED] markers to identify decisions requiring founder input. Use [TODO] markers to track planned but unbuilt features. Update this document when architectural decisions are made or features ship.*
=======
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
# PROOFLINK_MASTER_SPEC.md

> **Document purpose:** This is the operating spec for ProofLink across Engineering, Product, Design, Marketing, Sales, Support, Legal, and Operations.
>
> **Canonical product identity:** ProofLink — “Sell. Track. Get Paid.”
>
> **Domain:** `https://prooflink.co`
>
> **Netlify canonical redirect source:** `https://siteflows.netlify.app` → `https://prooflink.co`

---

## 0) Scope, Sources, and Truth Model

### 0.1 Source hierarchy
1. **Runtime code** in this repository is truth for current behavior.
2. **`sql/catchup_run_this.sql`** is the schema catch-up source currently used for Supabase setup.
3. **This spec** defines operational intent, cross-functional requirements, unresolved decisions, and strict implementation contracts.

### 0.2 Known naming divergence [GAP]
- The prompt references `sql/CATCHUP_RUN_THIS.sql`; repository uses lowercase: `sql/catchup_run_this.sql`.
- The prompt references table `onboarding_requests`; repository implements `tenant_onboarding_requests` and a compatibility view `onboarding_requests`.
- Prompt references `pl_category_rules`; repository currently uses `pl_prohibited_categories` with `verdict` (`REJECT` / `FLAG`) for category governance.

### 0.3 Non-negotiable stack contract
- Hosting/functions: Netlify Functions only.
- Database/auth: Supabase Postgres + RLS + Supabase Auth.
- Payments: Stripe (platform subscriptions + Connect Express).
- Email: Resend.
- Frontend: static HTML + vanilla JS (no framework, no bundler).

---

## 1) Engineering — Frontend

### 1.1 Global visual/brand contract

#### Current implementation state [GAP]
- Prompt requires **Syne + DM Sans** and cream/orange palette.
- Current landing/join pages load **Google Sans + Google Sans Text** and use tokenized brand CSS in `assets/brand/prooflink-tokens.css`.

#### Required target token set (for standardization)
```css
:root {
  --pl-bg-cream: #FFF8F0;
  --pl-accent-orange: #FF6B35;
  --pl-text-dark: #1A1A1A;
  --pl-text-muted: #6B7280;
  --pl-border: #E7D9CC;
  --pl-radius-sm: 8px;
  --pl-radius-md: 12px;
  --pl-radius-lg: 16px;
  --pl-shadow-sm: 0 1px 2px rgba(0,0,0,.06);
  --pl-shadow-md: 0 8px 24px rgba(0,0,0,.10);
}
```

#### Responsive breakpoints
- Tablet breakpoint: `max-width: 860px`.
- Mobile breakpoint: `max-width: 600px`.
- Mobile nav: hamburger button toggles `aria-expanded` and open/closed class state.

### 1.2 Landing page (`index.html`)

#### Required section inventory
1. Nav (brand, anchors, sign-in, start CTA)
2. Hero (headline, subcopy, dual CTAs)
3. Product proof/screens section
4. Feature grid / what-it-solves
5. How-it-works path
6. Industry / who-it’s-for strip
7. Pricing section
8. CTA band
9. Footer

#### Current notable copy (present)
- Hero claim emphasizes account/work/money linkage.
- CTA labels currently include “Start your account”.

#### Landing CTA route contract
- Primary CTA routes to `/join?plan=<plan>&intent=<intent>&source=<placement>`.
- Required tracked fields for attribution: `plan`, `intent`, `source`.

### 1.3 Join flow (`/join`, `join.html`, `join-page.js`)

#### Step flow
- Step 1: business type selection
- Step 2: business identity and slug intent
- Step 3: owner/contact/setup mode + credentials
- Step 4: review + submit

#### Form field contract
| Field | Required | Validation |
|---|---:|---|
| `business_type` | Yes | must be from allowed list |
| `business_name` | Yes | non-empty |
| `city_state` | No | string |
| `requested_subdomain` | No | slugified server-side; uniqueness checked by API |
| `owner_name` | Yes | non-empty |
| `owner_email` | Yes | valid email regex |
| `phone` | Conditionally | required for self-serve path |
| `coupon_code` | No | currently `BUILDWITHME` for Growth |
| `owner_password` | Conditionally | ≥8 chars + number or symbol |
| `owner_password_confirm` | Conditionally | exact match |
| `setup_mode` | Yes | `self_serve` or `guided` |

#### Spam/abuse controls on public intake
- Honeypot fields: `fax` and/or `website` accepted in related public forms.
- Time gate policy: `MIN_SUBMIT_MS` / `MAX_SUBMIT_MS` are required policy knobs ([GAP] not consistently enforced in every public function).
- Optional Cloudflare Turnstile via `TURNSTILE_SECRET_KEY`.

#### Success states
- Standard success screen includes submitted email and request reference.
- If self-serve path approved/provisioned quickly, user receives onboarding + auth setup path email.

### 1.4 Operator dashboard (`/operator/`)

#### Required workspace inventory
- Products CRUD
- Orders pipeline
- Customers CRM list/detail
- Customer interaction timeline
- Expense tracker
- Availability/scheduling controls
- Payments/Stripe Connect status
- Billing status + upgrade prompts

#### Order status lifecycle
`new` → `confirmed` → `fulfilled`/`completed` (or `cancelled`).

#### Tenant payment gating display rule
UI must show online checkout eligibility breakdown:
- `billing_status === 'active'`
- `connect_status === 'connect_connected'`
- `payments_enabled === true`

### 1.5 Admin panel (`/admin/`)

#### Required admin queues
- Submitted / auto-approved
- Needs review
- Rejected
- Provisioning failed
- Suspended/flagged tenants

#### Required admin actions
- Approve/reject onboarding
- Conduct actions: `flag`, `suspend`, `reinstate`, `terminate`
- Tester exemption toggle (`billing_exempt`, `billing_exempt_until`)
- Governance rule maintenance (reserved slugs, brands, banned keywords, category rules)

#### Logging requirement
- Every conduct action must write to `tenant_conduct_log` with reason and operator identity.

### 1.6 Public storefront (`/site-home.html`, `public/*`)

#### Required storefront behavior
- Tenant context resolved via slug/subdomain query.
- Catalog loaded from `products` with active + available filters.
- Cart → checkout flow persists order intent.
- Customer order status page available post-checkout.

### 1.7 Blog (`/blog`)

#### Required views
- Blog index page (cards)
- Article detail pages
- Comment form (`/api/blog-comment`)
- Subscribe form (`/api/blog-subscribe`)

#### Public moderation constraints
- Comment and subscribe are rate-limited 5 requests / 10 minutes / IP.
- Honeypot fields silently accept and drop bot submissions.

---

## 2) Engineering — Backend (Netlify Functions)

## 2.1 Authentication and authorization model

### Operator context
- Bearer Supabase access token required for operator/admin functions.
- `operator_members.user_id = auth.uid()` determines tenant/operator membership.
- `requireOperatorContext` resolves tenant-scoped authorization.

### Admin context
- `requireAdminContext` allows roles: `admin`, `owner`, `manager`, `platform_admin`.
- Onboarding-specific admin checks use `requireOnboardingAdminContext`.

### Internal-only invocation
- Internal service headers use `x-prooflink-internal: INTERNAL_SECRET`.

## 2.2 Payments functions

### `stripe-platform-checkout.js`
- Method: `POST`
- Purpose: create Stripe subscription checkout for ProofLink plan billing.
- Inputs: `tenantId`, `planKey` (`starter|growth`), optional URLs.
- Auth: operator context required.
- Side effects:
  - Stripe Checkout Session `mode=subscription`
  - metadata includes `purpose='prooflink_platform_billing'`
  - tenant patched to `billing_status='checkout_started'`
- Errors:
  - 400 invalid tenant or missing plan mapping
  - 401/403 auth issues
  - 500 Stripe/config failures

### `stripe-order-checkout.js`
- Method: `POST`
- Purpose: create tenant customer payment checkout using Connect destination charges.
- Inputs: `tenantId`, `orderId`, optional currency/email/name.
- Gate: `onlinePaymentsEligible` only if billing active + connect connected + payments enabled.
- Stripe usage:
  - `payment_intent_data.application_fee_amount`
  - `payment_intent_data.transfer_data.destination`
- Rate limit: 20/min/IP.
- Returns: session URL/id and fee amount.
- Failure: `403` when payment gate fails.

### `stripe-webhook.js`
- Method: `POST`
- Signature: validates against either `STRIPE_WEBHOOK_SECRET` or `STRIPE_CONNECT_WEBHOOK_SECRET`.
- Idempotency: `processed_webhook_events` table check.
- Handles:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - Connect account updates (`account.updated` and related)
- Updates:
  - tenant billing/connect statuses
  - payment records by checkout session where applicable

### `stripe-connect-link.js`
- Method: `POST`
- Purpose: create/reuse Connect Express account + account onboarding link.
- Required capabilities requested:
  - `card_payments`
  - `transfers`
- Updates tenant connect fields to incomplete until webhook confirms readiness.

### `_prooflink_payments.js` shared module
- Required helper contracts:
  - `normalizeBillingStatus()`
  - `buildTenantPaymentState()`
  - `getEnv()`
  - plus tenant lookup/patch helpers and Stripe request wrappers.

## 2.3 Onboarding functions

### `submit-onboarding-request.js`
- Method: `POST` public
- Rate limit: 5/10min/IP
- Validates required applicant fields and email.
- Duplicate protections:
  - blocks if active tenant exists for owner email
  - blocks if non-terminal onboarding already in progress
- Inserts `tenant_onboarding_requests` row.
- Async triggers evaluation via `evaluate-onboarding` if internal secret set.
- Sends applicant + operator alert emails (Resend wrapper).

### `evaluate-onboarding.js`
- Method: `POST`
- Auth: admin bearer OR internal secret header.
- Rule engine verdicts:
  - REJECT -> `rejected`
  - FLAG -> `needs_review`
  - clear -> `approved`
- Rule sources:
  - baseline reserved slugs/disposable domains/protected brands/categories
  - DB tables `pl_banned_keywords`, `pl_protected_brands`, `pl_reserved_slugs`, `pl_prohibited_categories`
- On approved: async fire-and-forget call to `provision-tenant`.

### `provision-tenant.js`
- Method: `POST` (admin/internal)
- Idempotent behavior: if tenant already linked to request, returns existing provision state.
- Core pipeline:
  1. mark request `provisioning`
  2. create tenant row
  3. create/update operator
  4. create auth user (or recover existing)
  5. upsert operator_members with `user_id`
  6. seed template products/services
  7. mark request `provisioned`
  8. send welcome/provisioned email
- Rollback behavior:
  - deletes created auth/operator/member/tenant records on failure where possible
  - logs rollback issues into `provision_failures`

## 2.4 Blog functions

### `blog-comment.js`
- Method: `POST`
- Public, no auth.
- Requires `article_slug`, `name`, `email`, `comment` (>=10 chars).
- Rate limit: 5/10min/IP.
- Honeypot: `fax` or `website` -> silent success response.
- Writes to `blog_comments`.
- Optional subscriber upsert when `notify_subscribe=true`.

### `blog-subscribe.js`
- Method: `POST`
- Public, no auth.
- Requires `name`, `email`.
- Rate limit: 5/10min/IP.
- Honeypot supported.
- Upsert on `blog_subscribers.email`.

## 2.5 Admin operations functions

### `admin-set-tester-exempt.js`
- Methods: `GET`, `POST`
- Admin only.
- Enforces slot count from `MAX_TESTER_SLOTS` (default 3).
- Grant sets:
  - `billing_exempt=true`
  - `billing_exempt_until=now + months`
- Revoke clears exemption fields.

### `admin-update-tenant-conduct.js`
- Method: `POST`
- Admin only.
- Actions: `flag|suspend|reinstate|terminate`
- Updates tenant conduct/status columns + timestamps.
- Appends to `tenant_conduct_log`.

### `admin-get-onboarding-requests.js`
- Method: `GET`
- Admin only.
- Filters: `status`, `q`, pagination.
- Supports single request fetch by `id`.

## 2.6 Error response envelope

Recommended standard (normalize across all functions):
```json
{
  "ok": false,
  "error": "human readable message",
  "code": "machine_code_optional",
  "request_id": "trace id optional"
}
```

## 2.7 Rate limiting strategy
- Public form endpoints: IP-based in-memory limiter.
- Sensitive payment endpoints: tighter per-IP caps.
- [DECISION NEEDED] Move to durable distributed limiter (e.g., Upstash Redis) for cross-instance consistency.

---

## 3) Engineering — Database

## 3.1 Canonical migration strategy
- `sql/catchup_run_this.sql` is current setup baseline.
- All additive changes should use `IF NOT EXISTS` or safe backfills.
- Never modify historical `sql/archive/*`; only add new migration files + update catchup script.

## 3.2 Core tables and constraints (current)

### Tenant and identity
- `tenants`
- `operators`
- `operator_members`
- `profiles` (trigger-populated by `handle_new_user`)
- `tenant_config`
- `tenant_settings`

### Commerce and CRM
- `products`
- `pricing`
- `availability`
- `expenses`
- `customers`
- `orders`
- `payments`
- `customer_interactions`

### Onboarding and governance
- `tenant_onboarding_requests` (+ view `onboarding_requests`)
- `tenant_conduct_log`
- `pl_reserved_slugs`
- `pl_banned_keywords`
- `pl_protected_brands`
- `pl_prohibited_categories`

### Blog
- `blog_comments`
- `blog_subscribers`

### Limits and analytics helpers
- `plan_limits`
- `v_tenant_limit_health` view
- usage sync/storage helper functions

## 3.3 RLS model summary
- Service role has full table access policies on platform tables.
- Authenticated operator access enforced via:
  - `operator_member_access(target_operator_id)`
  - `operator_member_tenant_access(target_operator_id, target_tenant_id)`
- Tenant-scoped tables (`products`, `orders`, `customers`, etc.) use policy requiring membership pair.
- Trigger `enforce_operator_tenant_membership_pair()` prevents invalid `operator_id` + `tenant_id` combinations.

## 3.4 Critical triggers/functions
- `handle_new_user()` on `auth.users` insert -> creates `profiles` row.
- `submit_storefront_order(payload jsonb)` RPC for atomic storefront order submission.
- `get_public_catalog_by_tenant(p_tenant_slug text)` RPC for public product retrieval.
- tenant usage sync triggers on products/customers/orders/operator_members writes.

## 3.5 Backup and recovery
[DECISION NEEDED]
- Option A: Supabase daily automatic backups only (lower ops overhead, slower PIT recovery control).
- Option B: Supabase backups + weekly offsite SQL dumps to encrypted storage (higher resilience, higher ops burden).
- Required minimum: monthly restore drill in non-prod project.

---

## 4) Engineering — Infrastructure & DevOps

## 4.1 Netlify deployment contract
- Build config (`netlify.toml`):
  - `publish = "."`
  - `functions = "netlify/functions"`
  - command `npm install --omit=dev`
- Branch deploys enabled for staging validation.
- Canonical host redirects enforce `prooflink.co`.

## 4.2 Supabase project setup checklist
1. Create project and copy `SUPABASE_URL`, anon key, service key.
2. Run `sql/catchup_run_this.sql`.
3. Run any required phase modules (e.g., `sql/service_workflow_phase1.sql` if needed).
4. Verify RLS and functions exist.
5. Seed platform admin operator email.

## 4.3 Stripe setup checklist
1. Create products/prices for Starter/Growth.
2. Set env vars for price IDs.
3. Configure webhook endpoint(s) to `/.netlify/functions/stripe-webhook`.
4. Set both signing secrets.
5. Test subscription checkout and Connect onboarding in test mode before live mode cutover.

## 4.4 Domain and DNS
- Primary: `prooflink.co`.
- Redirect aliases:
  - `www.prooflink.co`
  - `app.prooflink.co`
  - `siteflows.netlify.app`

## 4.5 Monitoring and alert thresholds
- Function error rate alert: >2% over 15 min.
- Stripe webhook failure alert: >5 consecutive failed deliveries.
- Provisioning failure alert: any failure event pages founder.
- Onboarding queue SLA alert: `needs_review` older than 24 hours.

## 4.6 Local development
- Required: `.env` populated from `.env.example`.
- Use Netlify dev for function routing.
- Stripe CLI for webhook forwarding in test mode.

---

## 5) Engineering — Security

## 5.1 Supabase RLS obligations
- No tenant-scoped table may permit anonymous read/write.
- Authenticated access must require matching operator membership.
- Service role usage is restricted to trusted backend functions.

## 5.2 Spam prevention stack
- Honeypot (`fax`/`website`) fields on public forms.
- Time-to-submit constraints with `startedAt`, `MIN_SUBMIT_MS`, `MAX_SUBMIT_MS`.
- Cloudflare Turnstile optional secret validation.
- IP rate limiting for all public submission endpoints.

## 5.3 Stripe webhook verification
- Must verify signature header before parsing/acting.
- Must process idempotently by event ID table.
- On verification failure: return 400, do not mutate state.

## 5.4 `INTERNAL_SECRET` usage
- Only for service-to-service internal calls (evaluate/provision chain).
- Rotate quarterly or immediately after suspected leak.

## 5.5 Content moderation policy engine

### Hard reject categories
- Illegal drugs
- Drug paraphernalia
- Prescription drug abuse sales
- Firearms
- Adult services
- Hate/extremist content
- Counterfeit/fraud
- Illegal finance schemes
- Alcohol sales
- Tobacco/vape sales

### Restricted category (manual review)
- Cannabis/dispensary-related businesses

### Applicant messaging
- Public rejection copy must be generic (no rule-specific disclosures).
- Detailed reason codes visible to admin only.

---

## 6) Product Management

## 6.1 Feature inventory by role

### Tenant operator (shipped)
- Product catalog management
- Orders management
- CRM customer records
- Customer interactions log
- Expense tracking
- Availability management
- Stripe Connect onboarding and payment state

### Tenant customer (shipped)
- Public catalog browsing
- Cart/checkout/order submission
- Payment flow (when tenant eligible)

### Platform admin (shipped)
- Onboarding request review/approval/rejection
- Conduct lifecycle actions
- Tester billing exemption control
- Rule table governance controls (DB-backed)

### Public visitor (shipped)
- Landing page
- Join/application form
- Blog read/comment/subscribe

## 6.2 Core user journeys

### Journey A: business applicant → paid tenant
1. Discover ProofLink.
2. Submit join/onboarding form.
3. Auto-evaluation: approve/reject/needs_review.
4. If approved: async provisioning pipeline.
5. Receive onboarding email and login setup.
6. Configure catalog/storefront.
7. Connect Stripe Express.
8. Receive first order.
9. Process payment and payout.

### Journey B: tenant customer
1. Discover tenant storefront.
2. Browse products/services.
3. Add to cart and submit order.
4. Checkout/payment if online payments enabled.
5. Order progresses through status pipeline.
6. Interaction trail updates in operator CRM.

### Journey C: platform admin
1. Review onboarding queues.
2. Handle needs-review and exceptions.
3. Monitor tenant billing/connect health.
4. Apply conduct actions when policy violations occur.

## 6.3 Industry templates
Required template keys (roadmap + seeding target):
- pressure_washing
- cleaning
- landscaping
- hvac
- plumbing
- property_maintenance
- restoration
- facility_maintenance
- handyman
- bakery
- electrical
- roofing
- pest_control

[DECISION NEEDED] Repository template folder structure is not yet normalized to the full list above; seed data exists via backend seeding utilities and business-type mapping. Align filesystem + seed contract.

## 6.4 Roadmap [TODO]
- Seat-based pricing and additional operator classes.
- Regulated industry tier (cannabis) with compliance documents and license checks.
- Multi-jurisdiction override model (`jurisdiction_overrides`).
- AI-assisted application review using labeled admin outcomes.
- `invoice.payment_failed` hardening path for renewal failures.
- Custom domains per tenant.
- Marketing newsletter subsystem in Resend.
- Advanced operator analytics.
- SMS order-status updates.
- Before/after photo proof uploads for job documentation.

---

## 7) Design / UX

## 7.1 Component library baseline
- Buttons: primary/secondary/ghost
- Inputs: text/email/tel/password/select/textarea
- Cards: metric card, feature card, queue card, table-row card (mobile)
- Status chips: active, flagged, suspended, terminated, billing states
- Empty state panel + CTA
- Loading skeleton blocks
- Error callout/toast

## 7.2 Accessibility requirements
- WCAG AA contrast minimum for text/button pairs.
- Keyboard navigable forms and menus.
- Visible focus states on all interactive elements.
- ARIA labels on nav toggles and status regions.

## 7.3 Empty/loading/error states
- New tenant empty states for products/orders/customers must include first-action CTA.
- Loading states: skeletons for tables and cards >300ms fetch.
- API errors: inline field errors for forms, toast/banner for global failures.

---

## 8) Marketing

## 8.1 Positioning
ProofLink is not generic ecommerce tooling. It is an operating system for field/trade businesses where customer context + job execution + payment state must stay in one timeline.

## 8.2 ICP
- Solo operators and small crews (1–5 people).
- Service and trade verticals.
- Michigan-first go-to-market, then national expansion.

## 8.3 Landing messaging framework

### Hero headline
“Track the customer account, the work, and the money from one calm operating system.”

### Core proof pillars
- Customer account visibility
- Work pipeline clarity
- Money status transparency

### Objection handling snippets
- “I already use X” → ProofLink consolidates account/work/money context into one timeline.
- “I’m not tech-savvy” → Guided onboarding path exists.
- “I just need payments” → Checkout alone does not solve follow-up, proof, and CRM continuity.

## 8.4 SEO strategy

### Technical SEO requirements
- Canonical tags per page.
- Open Graph + Twitter cards.
- JSON-LD for `BlogPosting` on article pages.
- `robots.txt`: allow `/blog`, disallow `/operator`, disallow `/admin`.
- `sitemap.xml` includes landing, key pages, blog index, articles.

### Existing article inventory (6)
1. why-small-businesses-struggle-with-organization
2. organizational-problems-that-kill-small-business
3. why-crm-systems-fail-small-business
4. hidden-advantage-small-businesses-have-over-large-companies
5. how-small-businesses-stay-organized-without-office-staff
6. simple-workflow-system-for-small-businesses

[DECISION NEEDED] Finalize per-article meta description + target keyword mapping in one content registry file.

## 8.5 12-article content calendar [TODO]
- Publish cadence: weekly (1/week x 12 weeks).
- Pillars: organization, CRM in trades, getting paid faster, proof-of-work, customer follow-up.

## 8.6 Funnel model
- TOFU: blog content + subscriber capture.
- MOFU: landing page proof + pricing + CTA.
- BOFU: `/join` application.
- Post-conversion activation milestones:
  1) welcome email
  2) first product listed
  3) Stripe Connect complete
  4) first order
  5) first payment received

---

## 9) Sales

## 9.1 Motion
- Founder-led early-stage sales.
- High-touch onboarding for tester slots (max 3 concurrent exemptions).

## 9.2 Qualification criteria
- Has existing paying customers.
- Service/trade business model.
- Basic digital comfort (email, dashboard usage).

## 9.3 10-minute demo script (operator-first)
1. Show customer list + account context.
2. Open order board and status progression.
3. Show payment readiness and checkout flow.
4. Show interactions log proving follow-up traceability.
5. Close on “what you can see in 30 seconds that you couldn’t before.”

## 9.4 Tester-to-paid conversion
- 90-day, 60-day, 30-day reminders before exemption expiry.
- Month-12 conversion call + plan recommendation.
- If not converted: downgrade/offboard plan with export path [DECISION NEEDED on export policy].

---

## 10) Customer Support

## 10.1 Channels
- Support email
- Founder direct line for testers
- [TODO] In-app support widget

## 10.2 Common issue playbooks

### “I can’t log in”
1. Verify Supabase auth user exists.
2. Verify `operator_members.user_id` link.
3. Verify operator membership matches tenant.

### “My customers can’t check out”
Check payment gate:
- `billing_status` active
- `connect_status` connected
- `payments_enabled` true

### “I’m not getting paid”
1. Confirm Connect onboarding complete.
2. Confirm account capabilities active via webhook-updated tenant state.
3. Check Stripe dashboard payouts and account requirements.

### “Storefront looks wrong”
1. Confirm tenant config/branding values.
2. Confirm product rows are active + available.
3. Validate slug and tenant context routing.

### “Application stuck in review”
1. Check `tenant_onboarding_requests.status`.
2. Check admin queue filters.
3. Check evaluation result reason codes.

---

## 11) Legal / Compliance

## 11.1 Terms of Service outline
- Acceptable use
- Prohibited/restricted categories
- Suspension and termination rights
- Data ownership and processing boundaries
- Billing terms and fee handling

## 11.2 Privacy policy outline
- Data collected from operators/customers/applicants
- Storage at Supabase
- Processors: Stripe, Resend, Cloudflare
- Retention windows and deletion process [DECISION NEEDED]

## 11.3 Prohibited content policy
- Explicitly prohibit categories listed in Section 5.5 hard reject list.
- Cannabis treated as restricted/manual-review, not auto-prohibited.

## 11.4 DMCA/takedown
- Require designated contact email and documented review workflow [TODO].

## 11.5 Michigan-specific notes
- Maintain policy references for business registration/payment processing constraints.
- [TODO] MMFLA license format validation for future cannabis tier.

## 11.6 Stripe Connect responsibilities
- Platform must maintain policy enforcement and account monitoring.
- [DECISION NEEDED] Tax reporting responsibility boundary (platform vs connected merchant support docs).

---

## 12) Operations

## 12.1 Daily checklist
- Review `needs_review` onboarding queue.
- Review tenant conduct flags/suspensions.
- Check failed provisioning records.
- Check Stripe webhook error logs.
- Moderate recent blog comments.

## 12.2 Tenant lifecycle
`Application` → `Provisioning` → `Active` → optional `Flagged/Suspended` → `Reinstated` or `Terminated`.

## 12.3 Incident response runbooks

### Provisioning failure
- Verify root cause stage in function logs.
- Inspect `provision_failures` table.
- Retry provision only after duplicate artifact audit.

### Webhook failure
- Validate signature config.
- Replay events from Stripe dashboard after fix.
- Confirm idempotency table records.

### Data isolation concern
- Freeze affected tenant actions.
- Audit RLS policy and membership links.
- Run tenant isolation integration tests before restore.

## 12.4 Metrics targets
- Manual review rate target: `<5%` of applications.
- Provisioning success target: `>=99%`.
- Time from application to first order median: [DECISION NEEDED baseline target].

---

## 13) Quality Assurance / Testing

## 13.1 Critical E2E flow
1. Submit onboarding request
2. Evaluate/approve
3. Provision tenant/operator/auth
4. Operator login
5. Create product
6. Place customer order
7. Create checkout session
8. Webhook updates payment truth

## 13.2 Edge cases
- Duplicate onboarding submissions
- Rate-limit breach handling
- Expired tester exemption state
- Connect incomplete account status
- Missing `operator_members` row
- Reserved slug collision

## 13.3 Test data management
- Use dedicated seeded test tenants.
- Provide cleanup scripts for tenant teardown.
- Never run destructive cleanup against production IDs.

## 13.4 Stripe test workflow
- Use Stripe test cards and CLI webhook forwarder.
- Simulate subscription and Connect state transitions.
- Validate gating behavior flips online payment eligibility.

---

## 14) Analytics / Metrics

## 14.1 KPI matrix

### Engineering
- Function error rate
- Provisioning success rate
- p95 function latency

### Product
- Time to first order
- Template usage distribution
- Feature adoption by tenant

### Marketing
- Blog sessions
- Subscriber growth
- Application conversion rate
- SEO ranking movement by target keywords

### Business
- MRR
- Active tenant count
- Churn
- ARPU
- LTV

## 14.2 Instrumentation plan [TODO]
- Event taxonomy file (`docs/analytics-events.md`) with event names + properties.
- Recommended events:
  - `join_started`, `join_step_completed`, `join_submitted`
  - `onboarding_evaluated`, `tenant_provisioned`
  - `product_created`, `order_created`, `checkout_created`, `payment_completed`
  - `connect_onboarding_started`, `connect_onboarding_completed`
- Dashboards:
  - Ops dashboard (queues/failures)
  - Revenue dashboard (MRR/ARPU/churn)
  - Activation dashboard (time-to-first-order)

---

## 15) Environment Variables — Exhaustive Contract

| Variable | Required | Source | Used by | Failure if missing |
|---|---:|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | Stripe API keys | payment + webhook API calls | checkout/webhook Stripe fetch failures |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook endpoint | webhook verification | all platform webhook events rejected |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Yes | Stripe connect endpoint | webhook verification | connect events rejected |
| `STRIPE_PRICE_STARTER_MONTHLY` | Yes | Stripe Price ID | platform checkout | starter plan checkout cannot initialize |
| `STRIPE_PRICE_GROWTH_MONTHLY` | Yes | Stripe Price ID | platform checkout | growth plan checkout cannot initialize |
| `SUPABASE_URL` | Yes | Supabase project settings | all DB/auth functions | backend DB/auth unavailable |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase API keys | server-side admin operations | provisioning/admin/payment writes fail |
| `SUPABASE_ANON_KEY` | Yes | Supabase API keys | token user lookup | auth user context resolution fails |
| `RESEND_API_KEY` | Yes | Resend dashboard | email senders | onboarding/system email delivery fails |
| `FROM_EMAIL` | Yes | Verified sender identity | email templates | send errors or spoofing risk |
| `SITE_URL` | Yes | canonical domain | redirects/emails | broken callback and links |
| `INTERNAL_SECRET` | Yes | generated secret | internal function chaining | evaluate/provision internal auth path fails |
| `MAX_TESTER_SLOTS` | No (default 3) | env config | tester exemption function | defaults to 3 if missing |
| `OPERATOR_ALERT_EMAIL` | Recommended | internal ops inbox | onboarding alerts | founder won’t get new-request alerts |
| `TURNSTILE_SECRET_KEY` | Optional | Cloudflare Turnstile | form anti-spam | captcha layer disabled |
| `MIN_SUBMIT_MS` | Recommended | anti-spam policy | public forms | no lower timing bound if not applied |
| `MAX_SUBMIT_MS` | Recommended | anti-spam policy | public forms | no upper timing bound if not applied |

---

## 16) Pricing Model Contract

| Plan | Monthly | Includes |
|---|---:|---|
| Starter | $49 | Storefront, dashboard, CRM, orders, Stripe payments, 1 operator seat baseline |
| Growth | $79 | Starter + expanded limits/features |

### Growth differentiator [DECISION NEEDED]
Options:
1. Higher seat/storage/order limits only (simple, easy messaging)
2. + advanced analytics + priority support (higher perceived value, more support burden)
3. + custom domain enablement (strong differentiation, infra/legal complexity)

### Tester program
- Max active tester exemptions controlled by `MAX_TESTER_SLOTS` (default 3).
- Typical exemption duration: 12 months.
- Post-exemption outcome: convert to paid or churn.

### Application fee
- Stored per tenant as `application_fee_bps`.
- If `0`, ProofLink takes no cut on customer transaction flow.

---

## 17) Governance Rule Data Seeds (Current)

### Reserved slug seeds
- `shop`, `store`, `checkout`, `payment`, `health` (+ baseline code list in evaluator).

### Protected brand seeds
- `ebay`, `etsy`, `square`, `quickbooks` (+ baseline code list includes major brands and `prooflink`).

### Restricted category seed
- Cannabis in `pl_prohibited_categories` with `verdict='FLAG'`.

### Banned keyword baseline
- Includes profanity and abuse terms in evaluator baseline.

---

## 18) Gaps Register (Explicit)

1. **Design token/font mismatch** between prompt target and current implementation.
2. **Schema naming mismatch** (`tenant_onboarding_requests` vs `onboarding_requests` prompt name).
3. **Category table mismatch** (`pl_prohibited_categories` vs prompt `pl_category_rules`).
4. **Time trap env vars** (`MIN_SUBMIT_MS`/`MAX_SUBMIT_MS`) not uniformly enforced across all public handlers.
5. **Content metadata registry** for blog SEO not centralized yet.
6. **Analytics event schema** not yet standardized in repo docs.

---

## 19) Execution Rules

- If implementation detail is unknown, mark `[DECISION NEEDED]`; do not infer silently.
- If behavior differs from this master spec, open issue + patch spec or code the same day.
- Every production incident must result in one spec update and one test addition.

<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
>>>>>>> theirs
=======
=======
>>>>>>> theirs

---

## 20) Database Schema Appendix — Concrete Table/Column Dictionary

> This appendix translates the current `sql/catchup_run_this.sql` implementation into explicit operational language. For execution details and DDL ordering, use the SQL file directly.

### 20.1 `tenants`

| Column | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `name` | `text` | No | — | business display name |
| `slug` | `text` | No | — | unique, storefront identifier |
| `owner_email` | `text` | No | — | applicant owner email |
| `owner_name` | `text` | Yes | — | owner full name |
| `business_type` | `text` | Yes | — | template/context key |
| `city_state` | `text` | Yes | — | locale text |
| `logo_url` | `text` | Yes | — | brand asset URL |
| `stripe_account_id` | `text` | Yes | — | legacy/support alias for connect id |
| `stripe_charges_enabled` | `boolean` | Yes | `false` | legacy status field |
| `onboarding_request_id` | `uuid` | Yes | — | backlink to onboarding request |
| `setup_complete` | `boolean` | Yes | `false` | launch readiness |
| `active` | `boolean` | Yes | `true` | legacy active flag |
| `created_at` | `timestamptz` | No | `now()` | created timestamp |
| `updated_at` | `timestamptz` | No | `now()` | updated timestamp |
| `prooflink_plan_key` | `text` | Yes | — | plan lookup key |
| `billing_status` | `text` | Yes | `'onboarding'` | billing gate status |
| `stripe_customer_id` | `text` | Yes | — | Stripe customer id |
| `stripe_subscription_id` | `text` | Yes | — | Stripe subscription id |
| `stripe_connect_account_id` | `text` | Yes | — | canonical connect id |
| `connect_status` | `text` | Yes | `'connect_not_started'` | connect state |
| `application_fee_bps` | `integer` | Yes | `0` | per-tenant platform fee |
| `payments_enabled` | `boolean` | Yes | `false` | operator payments switch |
| `online_payments_enabled` | `boolean` | Yes | `false` | derived gate flag |
| `custom_domain` | `text` | Yes | — | custom domain placeholder |
| `custom_domain_status` | `text` | Yes | `'not_connected'` | domain state |
| `last_stripe_connect_event` | `text` | Yes | — | debug/audit field |
| `status` | `text` | Yes | `'active'` | constrained lifecycle |
| `conduct_action` | `text` | Yes | — | last conduct action |
| `conduct_reason` | `text` | Yes | — | reason code |
| `conduct_notes` | `text` | Yes | — | admin notes |
| `conduct_updated_at` | `timestamptz` | Yes | — | conduct mutation time |
| `conduct_updated_by` | `uuid` | Yes | — | admin/operator id |
| `flagged_at` | `timestamptz` | Yes | — | flag timestamp |
| `suspended_at` | `timestamptz` | Yes | — | suspension timestamp |
| `terminated_at` | `timestamptz` | Yes | — | termination timestamp |
| `billing_exempt` | `boolean` | Yes | `false` | tester exemption toggle |
| `billing_exempt_until` | `timestamptz` | Yes | — | tester expiry |
| `hero_image_url` | `text` | Yes | — | storefront branding |
| `license_number` | `text` | Yes | — | regulated workflows placeholder |
| `instagram` | `text` | Yes | — | social link |
| `tagline` | `text` | Yes | — | brand message |
| `product_count` | `integer` | No | `0` | synced usage metric |
| `max_products` | `integer` | No | `10` | plan/resource cap |
| `customer_count` | `integer` | No | `0` | synced usage metric |
| `max_customers` | `integer` | No | `50` | plan/resource cap |
| `operator_seat_count` | `integer` | No | `0` | synced usage metric |
| `max_operator_seats` | `integer` | No | `1` | plan/resource cap |
| `current_month_order_count` | `integer` | No | `0` | synced usage metric |
| `max_orders_per_month` | `integer` | No | `100` | plan/resource cap |
| `storage_used_mb` | `numeric(12,2)` | No | `0` | synced usage metric |
| `max_storage_mb` | `numeric(12,2)` | No | `100` | plan/resource cap |
| `allow_online_checkout` | `boolean` | No | `false` | feature flag |
| `allow_custom_domain` | `boolean` | No | `false` | feature flag |
| `allow_advanced_analytics` | `boolean` | No | `false` | feature flag |
| `allow_automation` | `boolean` | No | `false` | feature flag |
| `growth_score` | `numeric(12,2)` | No | `0` | heuristic score |

`status` check constraint values: `provisioning`, `active`, `flagged`, `suspended`, `terminated`, `inactive`.

### 20.2 `operators`

| Column | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `email` | `text` | No | — | unique login identity |
| `name` | `text` | Yes | — | display name |
| `role` | `text` | No | `'tenant_owner'` | check: tenant_owner/admin/platform_admin |
| `tenant_id` | `uuid` | Yes | — | nullable for platform admins |
| `created_at` | `timestamptz` | No | `now()` | timestamp |
| `updated_at` | `timestamptz` | No | `now()` | timestamp |

### 20.3 `operator_members`

| Column | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `operator_id` | `uuid` | No | — | FK operators(id) |
| `tenant_id` | `uuid` | No | — | FK tenants(id) |
| `role` | `text` | No | `'owner'` | check: owner/manager/staff |
| `invited_by` | `uuid` | Yes | — | FK operators(id) |
| `user_id` | `uuid` | Yes | — | linked Supabase auth user |
| `created_at` | `timestamptz` | No | `now()` | timestamp |

Primary key: `(operator_id, tenant_id)`.

### 20.4 `tenant_onboarding_requests`

| Column | Type | Null | Default | Notes |
|---|---|---:|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `status` | `text` | No | `'submitted'` | lifecycle state |
| `business_name` | `text` | No | — | applicant business name |
| `business_slug` | `text` | Yes | — | requested/derived slug |
| `owner_name` | `text` | No | — | applicant owner |
| `owner_email` | `text` | No | — | applicant email |
| `phone` | `text` | Yes | — | applicant phone |
| `business_type` | `text` | Yes | — | vertical key |
| `city_state` | `text` | Yes | — | locale |
| `requested_subdomain` | `text` | Yes | — | url intent |
| `logo_url` | `text` | Yes | — | optional logo |
| `seed_template_key` | `text` | Yes | — | seeding key |
| `selected_plan` | `text` | No | `'starter'` | starter/growth/enterprise |
| `created_at` | `timestamptz` | No | `now()` | timestamp |
| `updated_at` | `timestamptz` | No | `now()` | timestamp |
| `approved_at` | `timestamptz` | Yes | — | approval timestamp |
| `provision_error` | `text` | Yes | — | failure reason |
| `risk_level` | `text` | Yes | — | low/medium/high |
| `reason_codes` | `text[]` | Yes | — | evaluation reason codes |
| `evaluation_result` | `jsonb` | Yes | — | detailed evaluation payload |
| `evaluated_at` | `timestamptz` | Yes | — | evaluation timestamp |
| `admin_notes` | `text` | Yes | — | internal notes |
| `compliance_notes` | `text` | Yes | — | compliance notes |
| `manual_override` | `boolean` | Yes | `false` | override marker |
| `reviewed_by` | `uuid` | Yes | — | reviewer identity |
| `reviewed_at` | `timestamptz` | Yes | — | reviewed timestamp |
| `coupon_code` | `text` | Yes | — | promotional code |

`status` check values: `submitted`, `needs_review`, `approved`, `provisioning`, `provisioned`, `failed`, `rejected`.

### 20.5 `products`

| Column | Type | Null | Default |
|---|---|---:|---|
| `id` | `uuid` | No | `gen_random_uuid()` |
| `tenant_id` | `text` | No | — |
| `operator_id` | `uuid` | No | — |
| `name` | `text` | No | — |
| `slug` | `text` | No | — |
| `category` | `text` | Yes | — |
| `description` | `text` | Yes | — |
| `ingredients` | `text[]` | Yes | — |
| `image_url` | `text` | Yes | — |
| `pricing_mode` | `text` | No | `'quote'` |
| `sell_price_cents` | `integer` | No | `0` |
| `starting_price_cents` | `integer` | No | `0` |
| `delivery_eligible` | `boolean` | No | `true` |
| `is_active` | `boolean` | No | `false` |
| `is_available` | `boolean` | No | `true` |
| `sort_order` | `integer` | No | `0` |
| `trial_product_id` | `uuid` | Yes | — |
| `created_at` | `timestamptz` | No | `now()` |
| `updated_at` | `timestamptz` | No | `now()` |

### 20.6 `orders`

| Column | Type | Null | Default |
|---|---|---:|---|
| `id` | `uuid` | No | `gen_random_uuid()` |
| `tenant_id` | `text` | No | — |
| `operator_id` | `uuid` | Yes | — |
| `customer_id` | `uuid` | Yes | — |
| `status` | `text` | No | `'new'` |
| `fulfillment` | `text` | Yes | — |
| `scheduled_date` | `date` | Yes | — |
| `scheduled_time` | `text` | Yes | — |
| `items` | `jsonb` | No | `'[]'::jsonb` |
| `subtotal_cents` | `integer` | No | `0` |
| `delivery_fee_cents` | `integer` | No | `0` |
| `total_cents` | `integer` | No | `0` |
| `estimated_total_cents` | `integer` | No | `0` |
| `item_count` | `integer` | No | `0` |
| `unpriced_count` | `integer` | No | `0` |
| `cart_summary` | `text` | Yes | — |
| `notes` | `text` | Yes | — |
| `customer_name` | `text` | Yes | — |
| `email` | `text` | Yes | — |
| `phone` | `text` | Yes | — |
| `preferred_contact` | `text` | Yes | — |
| `source_type` | `text` | Yes | `'storefront'` |
| `source_ref` | `text` | Yes | — |
| `created_at` | `timestamptz` | No | `now()` |
| `updated_at` | `timestamptz` | No | `now()` |

Important checks:
- `status` in (`new`,`confirmed`,`fulfilled`,`cancelled`,`paid`,`completed`,`quoted`) (case-normalized check).
- `items` must be non-empty JSON array.

### 20.7 `customers`

| Column | Type | Null | Default |
|---|---|---:|---|
| `id` | `uuid` | No | `gen_random_uuid()` |
| `tenant_id` | `text` | No | — |
| `operator_id` | `uuid` | No | — |
| `name` | `text` | Yes | — |
| `email` | `text` | Yes | — |
| `phone` | `text` | Yes | — |
| `preferred_contact` | `text` | Yes | `'email'` |
| `notes` | `text` | Yes | — |
| `lifetime_value_cents` | `integer` | No | `0` |
| `order_count` | `integer` | No | `0` |
| `last_contact_at` | `timestamptz` | Yes | — |
| `created_at` | `timestamptz` | No | `now()` |
| `updated_at` | `timestamptz` | No | `now()` |

Unique index: `(tenant_id, lower(email))` where email present/non-empty.

### 20.8 `payments`

Tracks Stripe lifecycle and reconciliation fields.

| Column | Type |
|---|---|
| `stripe_checkout_session_id` | `text` |
| `stripe_payment_intent_id` | `text` |
| `stripe_subscription_id` | `text` |
| `stripe_charge_id` | `text` |
| `status` | `text` |
| `amount_total` | `bigint` |
| `amount_platform_fee` | `bigint` |
| `currency` | `text` |
| `metadata` | `jsonb` |

### 20.9 Governance + blog tables
- `tenant_conduct_log`
- `pl_reserved_slugs`
- `pl_banned_keywords`
- `pl_protected_brands`
- `pl_prohibited_categories`
- `blog_comments`
- `blog_subscribers`

---

## 21) RLS/Policy Appendix — Concrete Policy List

### 21.1 Service role policies
Each core table created in catch-up has `Service role full access` (for `for all` with `using (true) with check (true)`), including:
- `tenants`
- `operators`
- `operator_members`
- `tenant_config`
- `tenant_settings`
- `products`, `pricing`, `availability`, `expenses`, `customers`, `orders`, `payments`, `customer_interactions`
- governance tables and blog tables
- `profiles`

### 21.2 Authenticated read policy on memberships
- Policy: `operator_members_self_read`
- Table: `operator_members`
- Rule: `user_id = auth.uid()`

### 21.3 Authenticated operator visibility
- Policy: `operators_member_read`
- Table: `operators`
- Rule: `public.operator_member_access(id)`

### 21.4 Tenant-scoped all-access policies for authenticated
Policies with `for all`, `using` and `with check` using membership pair:
- `products_operator_all`
- `pricing_operator_all`
- `availability_operator_all`
- `expenses_operator_all`
- `customers_operator_all`
- `orders_operator_all`
- `payments_operator_all`
- `customer_interactions_operator_all`

### 21.5 Trigger-based guardrail
`enforce_operator_tenant_membership_pair()` on insert/update for the above tenant-scoped tables prevents orphan cross-tenant writes even if app-layer validation misses it.

---

## 22) Netlify Function Contracts — Request/Response Detail Tables

### 22.1 Payments endpoints

| Function | Method | Auth | Input | Success | Failure |
|---|---|---|---|---|---|
| `stripe-platform-checkout` | POST | operator | `tenantId`, `planKey` | `200 {ok,url,id,customer}` | `400/401/403/500` |
| `stripe-order-checkout` | POST | operator | `tenantId`,`orderId` | `200 {ok,url,id,amount,applicationFee}` | `400/403/404/429/500` |
| `stripe-connect-link` | POST | operator | `tenantId` | `200 {ok,url,accountId,connectStatus}` | `400/401/403/404/500` |
| `stripe-webhook` | POST | Stripe signature | raw Stripe event | `200 {ok:true}` | `400 invalid signature`, `500 processing` |

### 22.2 Onboarding/admin endpoints

| Function | Method | Auth | Input | Success |
|---|---|---|---|---|
| `submit-onboarding-request` | POST | public | applicant payload | `201 {request_id,status}` |
| `evaluate-onboarding` | POST | admin/internal | `request_id` | `200 {status,risk_level,reason_codes}` |
| `provision-tenant` | POST | onboarding-admin/internal | `id` | `201 {tenant_id,slug,operator_id}` |
| `admin-get-onboarding-requests` | GET | admin | `status,q,limit,offset,id` | `200 {requests,count}` or single `request` |
| `admin-update-tenant-conduct` | POST | admin | `tenant_id,action,reason_code,admin_notes` | `200 {ok,status}` |
| `admin-set-tester-exempt` | GET/POST | admin | `tenantId`, `exempt`, `months` | `200/201` |

### 22.3 Blog endpoints

| Function | Method | Auth | Limit | Notes |
|---|---|---|---|---|
| `blog-comment` | POST | public | 5/10min/IP | honeypot; optional subscribe upsert |
| `blog-subscribe` | POST | public | 5/10min/IP | honeypot; email upsert |

---

## 23) Frontend Copy & Flow Specs (Concrete)

### 23.1 Required landing-page copy blocks

#### Hero block
- Eyebrow: “Built for service businesses that need control”
- Headline intent: account/work/money in one operating system.
- Primary CTA text: “Start your account”
- Secondary CTA text: “See what it solves”

#### Proof strip
- Chip 1: “Track / customer accounts”
- Chip 2: “See / open money fast”
- Chip 3: “Run / the next step clearly”

### 23.2 Join flow button labels
- Step1 forward: “Continue”
- Step2 forward: “Continue”
- Step3 forward: “Review”
- Submit (dynamic):
  - Enterprise: “Request guided rollout”
  - Guided non-enterprise: `Request guided <Plan> setup`
  - Self-serve: `Start <Plan> account`

### 23.3 Join validation error copy
- Missing business type: “Please select a business type.”
- Missing business name: “Business name is required.”
- Invalid owner email: “A valid email address is required.”
- Missing phone (self-serve): “A phone number is required for instant account setup.”
- Password rule: “Create a password (8+ characters, include a number or symbol).”
- Confirm mismatch: “Passwords do not match.”

---

## 24) Onboarding Rule Engine — Exact Evaluation Ordering

1. Email domain validity
2. Disposable email reject list
3. Slug presence + format validity
4. Baseline reserved slug block
5. Existing tenant slug collision check
6. Duplicate request flag by same owner email
7. Protected brand impersonation reject
8. Baseline banned/profane keyword reject
9. Baseline prohibited category reject
10. Baseline restricted category flag
11. DB `pl_banned_keywords`
12. DB `pl_protected_brands`
13. DB `pl_reserved_slugs`
14. DB `pl_prohibited_categories` verdict application
15. Final decision synthesis:
   - any REJECT => `rejected`
   - else any FLAG => `needs_review`
   - else => `approved`

Operational guarantee: rule-table lookup failures are non-blocking (logged warnings) and do not crash onboarding evaluation.

---

## 25) Stripe Billing/Connect State Machine

### 25.1 Platform subscription states (tenant-centric)
Suggested normalized values in operation:
- `onboarding`
- `checkout_started`
- `active`
- `past_due`
- `canceled`

### 25.2 Connect states
- `connect_not_started`
- `connect_incomplete`
- `connect_connected`

### 25.3 Online payments eligibility formula
`onlinePaymentsEligible = (billing_status === 'active') AND (connect_status === 'connect_connected') AND (payments_enabled === true)`

If false, checkout creation for tenant order must return HTTP 403 with clear operator-facing message.

### 25.4 Webhook failure handling
- Signature failure: reject request immediately (400).
- Processing failure: log error context, return non-2xx so Stripe retries.
- Duplicate event id: return success with `skipped` semantics.

---

## 26) Operations Metrics Definitions (Formula-Level)

### 26.1 Application metrics
- `applications_received = count(tenant_onboarding_requests where created_at in period)`
- `applications_approved = count(status='approved' or 'provisioned')`
- `applications_rejected = count(status='rejected')`
- `applications_needs_review = count(status='needs_review')`
- `manual_review_rate = applications_needs_review / applications_received`

### 26.2 Revenue metrics
- `MRR = sum(active tenant subscription monthly amount)`
- `ARPU = MRR / active_paying_tenants`
- `churn_rate = churned_tenants_in_period / tenants_at_period_start`

### 26.3 Activation metrics
- `time_to_first_order = first_order_at - onboarding_request_created_at`
- `connect_setup_time = connect_connected_at - tenant_created_at` [requires instrumentation]

### 26.4 Reliability metrics
- `function_error_rate = failed_invocations / total_invocations`
- `provisioning_success_rate = provisioned_count / (provisioned_count + failed_count)`
- `webhook_recovery_time = webhook_fix_timestamp - first_failure_timestamp`

---

## 27) Legal Policy Draft Blocks (Execution-Ready)

### 27.1 Applicant rejection text (public-safe)
> “We’re unable to approve this application at this time. If you believe this was an error, reply to this email for manual review.”

### 27.2 Conduct action notice (tenant-facing)
> “Your tenant account status has changed due to a policy or billing/compliance review. Contact support for next steps.”

### 27.3 Suspension escalation sequence
1. Flag (`status=flagged`)
2. Suspend (`status=suspended`)
3. Reinstate OR terminate

Admin requirement: `reason_code` and internal notes are mandatory by policy even if function currently permits optional values. [DECISION NEEDED: enforce required reason in function validation].

---

## 28) Additional Decisions Required Before GA

1. **Growth plan differentiation lock** (limits-only vs premium feature bundle).
2. **Data retention windows** for applicants, logs, and comments.
3. **Tenant data export/offboarding policy** on churn/termination.
4. **Durable rate limiting backend** decision.
5. **Custom domain launch sequencing** and TLS ownership process.
6. **Compliance/tax boundaries** for Stripe Connect support docs.
7. **Brand token migration** from current Google Sans setup to Syne/DM Sans target (or update official brand decision).

---

## 29) Implementation TODO Checklist (Engineering Program Board)

- [TODO] Enforce `MIN_SUBMIT_MS` and `MAX_SUBMIT_MS` across all public forms/functions, not only selected endpoints.
- [TODO] Create `docs/analytics-events.md` with canonical event schema.
- [TODO] Add CI check ensuring `PROOFLINK_MASTER_SPEC.md` exists and references current env var names.
- [TODO] Add CI drift check for pricing env vars and plan map.
- [TODO] Add policy tests ensuring conduct actions always log to `tenant_conduct_log`.
- [TODO] Add webhook replay test fixture for idempotency branch.
- [TODO] Add explicit function-level docs for all non-core auxiliary endpoints in `docs/api.md` to match this spec depth.


---

## 30) Industry Template Seeding Specification (Concrete Seed Catalog)

> This section defines what must be seeded for each industry key at provisioning time. Where exact row content is not yet implemented, it is explicitly marked `[DECISION NEEDED]`.

### 30.1 Shared seed payload fields
Each seeded product/service row must include:
- `tenant_id`
- `operator_id`
- `name`
- `slug`
- `category`
- `description`
- `pricing_mode` (`fixed`, `starts_at`, or `quote`)
- `sell_price_cents` (for fixed)
- `starting_price_cents` (for starts_at)
- `delivery_eligible`
- `is_active`
- `is_available`
- `sort_order`

### 30.2 Pressure washing (`pressure_washing`)
Seed categories:
- Residential exterior
- Driveway/patio
- Deck/fence
- Commercial exterior

Seed examples:
1. House Wash — `starts_at` — `starting_price_cents=19900`
2. Driveway Cleaning — `starts_at` — `starting_price_cents=9900`
3. Deck Refresh — `quote`
4. Storefront Wash — `quote`

### 30.3 Cleaning (`cleaning`)
Seed categories:
- Standard clean
- Deep clean
- Move-in/out
- Commercial janitorial

Seed examples:
1. Standard Home Cleaning — `starts_at` — `12900`
2. Deep Cleaning — `starts_at` — `24900`
3. Move-Out Cleaning — `quote`
4. Office Cleaning Plan — `quote`

### 30.4 Landscaping (`landscaping`)
Seed categories:
- Lawn maintenance
- Yard cleanup
- Mulch/bed work
- Seasonal service

Seed examples:
1. Weekly Lawn Service — `fixed` — `5500`
2. Spring Cleanup — `starts_at` — `14900`
3. Mulch Installation — `quote`
4. Fall Leaf Removal — `starts_at` — `9900`

### 30.5 HVAC (`hvac`)
Seed categories:
- Diagnostics
- Maintenance
- Repair
- Install/replace

Seed examples:
1. HVAC Diagnostic Visit — `fixed` — `8900`
2. Seasonal Tune-Up — `fixed` — `12900`
3. Repair Service — `quote`
4. Full System Replacement — `quote`

### 30.6 Plumbing (`plumbing`)
Seed categories:
- Service call
- Drain and sewer
- Fixture install
- Emergency service

Seed examples:
1. Plumbing Service Call — `fixed` — `9500`
2. Drain Cleaning — `starts_at` — `14900`
3. Water Heater Install — `quote`
4. Emergency Plumbing — `starts_at` — `17500`

### 30.7 Property maintenance (`property_maintenance`)
Seed categories:
- Turnover prep
- Preventive maintenance
- Punch-list repairs
- Exterior upkeep

Seed examples:
1. Rental Turnover Checklist — `quote`
2. Monthly Maintenance Retainer — `quote`
3. Handyman Repair Block — `starts_at` — `12500`
4. Exterior Property Check — `fixed` — `7900`

### 30.8 Restoration (`restoration`)
Seed categories:
- Water mitigation
- Fire/smoke cleanup
- Mold remediation
- Emergency response

Seed examples:
1. Emergency Mitigation Callout — `quote`
2. Water Extraction Package — `quote`
3. Mold Assessment — `fixed` — `19900`
4. Smoke/Odor Treatment — `quote`

### 30.9 Facility maintenance (`facility_maintenance`)
Seed categories:
- Inspection
- Preventive programs
- Corrective work
- Vendor coordination

Seed examples:
1. Facility Walkthrough Audit — `fixed` — `14900`
2. Monthly PM Program — `quote`
3. Corrective Work Order — `quote`
4. Site Readiness Check — `fixed` — `11900`

### 30.10 Handyman (`handyman`)
Seed categories:
- Small repairs
- Assembly/install
- Exterior fixes
- Punch-list service

Seed examples:
1. 2-Hour Handyman Block — `fixed` — `18000`
2. Fixture Install — `starts_at` — `8900`
3. Drywall/Paint Patch — `quote`
4. Seasonal Repair Package — `quote`

### 30.11 Bakery (`bakery`)
Seed categories:
- Bread
- Pastries
- Custom orders
- Catering trays

Seed examples:
1. Sourdough Loaf — `fixed` — `900`
2. Cookie Dozen — `fixed` — `1800`
3. Custom Cake — `quote`
4. Event Pastry Tray — `starts_at` — `4500`

### 30.12 Electrical (`electrical`)
Seed categories:
- Diagnostics
- Fixture/outlet
- Panel work
- Safety upgrades

Seed examples:
1. Electrical Diagnostic Visit — `fixed` — `10900`
2. Outlet/Switch Replacement — `starts_at` — `7500`
3. Panel Upgrade — `quote`
4. EV Charger Install — `quote`

### 30.13 Roofing (`roofing`)
Seed categories:
- Inspection
- Repair
- Replacement
- Storm response

Seed examples:
1. Roof Inspection — `fixed` — `12900`
2. Leak Repair — `starts_at` — `18900`
3. Full Roof Replacement — `quote`
4. Storm Damage Tarp Service — `starts_at` — `14900`

### 30.14 Pest control (`pest_control`)
Seed categories:
- Inspection
- Treatment
- Recurring service
- Commercial service

Seed examples:
1. Initial Pest Inspection — `fixed` — `7900`
2. One-Time Treatment — `starts_at` — `12900`
3. Quarterly Prevention Plan — `quote`
4. Commercial Program — `quote`

### 30.15 Template governance rules
- Seed rows must be idempotent by `(tenant_id, slug)`.
- Seed rows must set `is_active=true` unless template intentionally drafts items.
- Seed ordering should preserve high-frequency services in top positions (`sort_order` ascending).
- [DECISION NEEDED] whether seeded rows include placeholder images by default.

<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
