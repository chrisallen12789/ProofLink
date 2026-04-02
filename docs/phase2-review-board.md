# ProofLink Phase 2 Review Board Report

**Date:** March 26, 2026
**Prepared by:** ProofLink Phase 2 Review Board (multi-discipline panel)
**Codebase reviewed:** `/operator/operator.js`, `/netlify/functions/*`, `/sql/catchup_run_this.sql`, `/docs/hydrovac-codex-master-prompt.md`, `/operator/index.html`, `/join.html`, `/index.html`, `/onboarding.html`, `prooflink-workspace-architecture.js`, `prooflink-plan-intent.js`

> Historical snapshot: this report captures the repo state reviewed on March 26, 2026. Verify current behavior against live code, `package.json`, `AGENTS.md`, and `sql/readme.md` before treating any finding here as a present-day requirement.

---

## SECTION 1 — EXECUTIVE VERDICT

### Where ProofLink Is Genuinely Strong

ProofLink has cleared the hardest hurdle in multi-tenant SaaS: it actually exists. The provisioning pipeline works end-to-end — a business submits on the join form, an admin approves, a tenant is created, products are seeded, an auth user is provisioned, and a password-setup email goes out. That full cycle being functional is not trivial and represents real infrastructure value.

The operator dashboard (`operator.js`) covers more ground than almost any comparable tool at this stage: leads, bids, jobs, orders, customers, payments, expenses, bookings/calendar, recurring plans, team members, vendors, equipment, inventory, reviews, quotes, products, pricing, availability, AI copilot, multi-operator dispatch, and a complete hydrovac compliance cell including waste manifests, 811 locate tickets, facilities, driver qualification, permits, and assets. The breadth is genuinely impressive for a platform at this point in development.

The hydrovac vertical is the clearest demonstration of what ProofLink is trying to become. The codex-driven data model (waste manifests, utility locate tickets, confined space compliance, equipment compliance, dispatch board) is not a surface layer — it represents real research into operator pain points and translates those into actual schema, actual UI surfaces, and actual workflow logic. No generic FSM tool has this. It is a real competitive moat if it is executed to completion.

Authentication and authorization are well-structured. `requireOperatorContext()` and `requireAdminContext()` from `utils/auth.js` handle multi-tenant membership resolution correctly. The feedback memory is right: using these patterns consistently is the correct approach, and the codebase now largely follows it.

The seed template system is thoughtful and detailed. The `BID_PROFILE_LIBRARY` inside `operator.js` has per-vertical scope starters, photo prompts, pricing prompts, line item templates, and proposal prompts for pressure washing, landscaping, HVAC, plumbing, contractor/remodeling, property maintenance, bakery, and hydrovac/vactor. This is genuine craft.

Plan enforcement exists at both the UI layer and server-side (`lib/plan-enforcement.js`). The governance library (`lib/tenant-governance.js`) classifies resource usage, warns at 80%, and flags over-limit states. The onboarding spam gate (time delta, honeypot website field) is sensible.

### Where ProofLink Is Uneven

The `operator.js` file is 14,000+ lines of a single JavaScript file. Every module — dashboard, leads, bids, orders, jobs, customers, payments, expenses, manifests, locates, compliance, dispatch, permits, assets, service plans, bookings, team, inventory, vendors, equipment, reviews, quotes, AI, setup — lives in one monolith. There is no module system, no component abstraction layer, no test coverage, and no separation of concerns beyond naming conventions. This is not sustainable. At current scale it is manageable with discipline; at next-phase scale it becomes the thing that slows every feature.

The data model has accumulated via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` patches rather than a structured migration system. The `catchup_run_this.sql` file is a single catch-up script that combines table creation, column additions, backfills, and constraint additions. There is no versioned migration chain, no rollback strategy, and no automated test that validates the schema matches what the application expects.

Follow-up and customer communication workflows are built (the `send-follow-up.js` function is real, the `FOLLOW_UP_KIND_META` in `operator.js` is real) but the trigger logic — specifically the part where the dashboard proactively surfaces the right follow-up at the right time with the right draft — is partially client-side and not reliably driven by server-side scheduled events.

The non-hydrovac templates — landscaping, cleaning, HVAC, plumbing, pressure washing, contractor/remodeling, handyman, photography, events, pet services, bakery/food, property maintenance, general service — have product seeds and bid profile templates but lack the vertical-specific workflow depth that hydrovac has. A landscaping operator does not have route grouping, recurring visit management, or property-note carry-forward that is native to their workflow the way manifests are native to hydrovac.

Online payment collection has infrastructure (Stripe Connect, checkout sessions, webhook handling) but the user-facing payment flow and the operator-facing payment state are confusing. The `paymentState` object from `tenant-payment-status.js` has multiple overlapping flags (`payments_enabled`, `online_payments_enabled`, `billing_status`, `connect_status`) that make it difficult for an operator to know clearly what to do next to enable online payments.

The public landing page, join flow, and customer-facing pages have inconsistent branding and copy quality. Some places use "ProofLink" and some still show "CottageLink" in variable names (`COTTAGELINK_OPERATOR_CONFIG`, `window.COTTAGELINK_BRAND`). This is a residual naming seam that needs cleanup.

### What Moves ProofLink From Strong to Category-Defining

The path to category-defining is narrow and specific:
1. Complete the hydrovac vertical to full compliance depth (see Section 4)
2. Give every other vertical one native workflow feature that no generic tool provides
3. Move operator.js from monolith to a module system with clear boundaries
4. Make payment collection as simple as one tap from the job screen
5. Build a mobile-first field view for crew members
6. Make the customer portal real enough that operators can confidently share it
7. Ship an audit trail that satisfies compliance-heavy operators
8. Add automated follow-up driven by server-side scheduled functions, not client-side logic

---

## SECTION 2 — FULL FINDINGS LIST

### Architecture and Code Structure

**F-001** `operator.js` is 14,000+ lines in a single file. It contains every UI render function, every Supabase query, every form handler, every business logic computation, and every cache management operation for every module. There is no module boundary, no import/export pattern, and no abstraction layer. This is the single largest technical risk in the codebase.

**F-002** Global state is managed through 50+ module-level `let` and `const` variables (`JOBS_CACHE`, `PAYMENTS_CACHE`, `CRM_ORDERS_CACHE`, etc.). There is no state management pattern, no subscription model, and no protection against race conditions when multiple async operations update the same cache simultaneously.

**F-003** The DOM reference section of `operator.js` spans approximately lines 163 to 620 — hundreds of `const variable = $(id)` assignments at the top level. If any single DOM element is missing or renamed, the entire file still loads but silently fails for any function that touches that element.

**F-004** All Supabase queries in `operator.js` use the direct Supabase JS client (`sb`), which uses the anon key. This means all data access is protected only by Supabase RLS policies. RLS is enabled, but there is no documented test suite that validates the RLS policies are complete and correct for each table.

**F-005** The `isMissingDatabaseFeatureError()` function is used pervasively to silently absorb schema-mismatch errors. This means a missing column or table does not cause an error — it causes silent data loss. Features that depend on missing schema silently degrade without alerting the operator or the developer.

**F-006** There are two provisioning paths: `provision-tenant.js` (which uses `requireOnboardingAdminContext`) and `admin-approve-onboarding.js` (which uses `requireAdminContext`). They share most of the same logic but are separate files with divergent behavior (different idempotency checks, different redirect URLs, different coupon logic). This is a maintenance hazard.

**F-007** The `onboarding.js` function uses a direct Supabase REST API fetch with the service role key rather than the shared `getAdminClient()` helper. This bypasses the auth utility pattern and creates two code paths for service-role database access.

**F-008** Historical finding: at review time, the board did not identify an automated test suite. The current repo now includes `npm run test:unit`, `npm run test:integration`, `npm run test:preflight:service-workflow`, and Playwright coverage, so verify current test posture against `package.json` instead of relying on this note alone.

**F-009** No migration versioning system exists. The `catchup_run_this.sql` file is a single cumulative patch. If it is run against a partially migrated database, some operations succeed and some are no-ops, with no record of what state the database was in beforehand.

**F-010** The plan enforcement in `lib/plan-enforcement.js` is a simple rules object. It is not connected to a real billing check on every write — the enforcement depends on callers to explicitly call `enforceLimit()`. Functions that do not call this will not enforce limits.

**F-011** The `WORKSPACE_CONTEXT_GROUPS` mapping defines which tabs should refresh when another tab changes. This is a clever pattern but it is hardcoded in operator.js with no way to validate that the listed tab names match actual tab identifiers.

**F-012** The `FOLLOW_UP_SNOOZE_KEY` stores snooze state in localStorage. If an operator clears their browser storage, all snoozed follow-ups immediately reappear. Snooze state should be persisted server-side.

**F-013** The AI copilot (`ai-copilot.js`) calls Claude with `claude-haiku-4-5-20251001`. Model ID should be an environment variable, not hardcoded, to allow updates without a deploy.

**F-014** There is no graceful degradation path when Supabase is unavailable. The entire dashboard fails with no offline fallback for read-only data.

### Security and Permissions

**F-015** `Access-Control-Allow-Origin: *` is set on all Netlify function responses. For an authenticated platform this is overly permissive. CORS should be restricted to known origins.

**F-016** The `create-booking.js` function accepts unauthenticated public bookings with only a `tenant_id` in the body. There is no rate limiting on this endpoint. A bot can create unlimited fake bookings for any tenant by guessing or enumerating UUIDs.

**F-017** The `SUPABASE_ANON_KEY` is hardcoded as a fallback in `operator.js` line 6: `"sb_publishable_bcILNxLX87f-G2zq_SbDGA_Vvs62biB"`. While this is a publishable key, hardcoding it in source is an anti-pattern — it should always come from `COTTAGELINK_OPERATOR_CONFIG`.

**F-018** The `requireOnboardingAdminContext()` function in `auth.js` has complex conditional logic for resolving admin status across membership rows and direct operator lookups. The role check at line 193 uses a nested conditional that is difficult to reason about (`!adminRoles.has(platformOperator?.role || operatorFromMembership?.role || resolvedRole)`) and may have edge cases where a non-admin user passes the check.

**F-019** The `operators` table role constraint allows only `tenant_owner`, `admin`, `platform_admin`. The `operator_members` role constraint allows `owner`, `manager`, `staff`. The `requireAdminContext` helper grants access to `admin`, `owner`, `manager`, `platform_admin`. The mismatch between table constraints and auth logic means a `manager` in operator_members can pass admin checks, which may be intentional but is not documented.

**F-020** The spam gate in `onboarding.js` checks a `started_at` timestamp and a honeypot `website` field. There is no CAPTCHA or email verification step before the submission is stored in Supabase and an internal notification email is sent.

**F-021** Portal URLs containing customer email addresses in query strings (`portal.html?tenant=...&email=...`) expose PII in server access logs and browser history.

**F-022** No audit logging is triggered from the client-side Supabase queries in operator.js. The `log-operator-action.js` function exists but relies on callers to invoke it manually. Most CRUD operations do not call it.

### Data Model and Schema

**F-023** The `tenants` table has accumulated 25+ columns via ALTER TABLE patches. Several columns exist in pairs that should be unified (`active` boolean vs `status` text; `stripe_charges_enabled` vs `payments_enabled` vs `online_payments_enabled`).

**F-024** The `tenant_config` table stores a JSON blob under a single `config_key = 'site_settings'`. As configuration grows, this pattern becomes unqueryable and requires loading the entire config blob to change one field.

**F-025** There is no `jobs` table schema shown in the migration file despite extensive job-related UI and logic in `operator.js`. The jobs table appears to be an assumed pre-existing table. If it is missing, all job-related functionality fails silently via `isMissingDatabaseFeatureError`.

**F-026** The `waste_manifests` data model exists in the hydrovac codex document but it is unclear whether the table has been created in the actual database. The codex is a spec, not confirmed deployed schema.

**F-027** The `utility_locate_tickets` table in the codex specifies `tenant_id text NOT NULL` but most other tables use UUID for tenant_id. This type inconsistency would cause join failures.

**F-028** `amount_cents` fields appear in some tables while `total_cents`, `subtotal_cents`, `estimated_total_cents`, and `net_amount_cents` appear in others. The `paymentAmountCents()` function in operator.js chains through six fallback fields to find the amount. This indicates unresolved schema normalization debt.

**F-029** The `bookings` table and the `jobs` table appear to be separate records. There is no enforced relationship ensuring a booking always has a linked job or vice versa. The relationship is optional via `order_id`, which is indirect.

**F-030** Usage counters (`product_count`, `customer_count`, etc.) on the tenants table are denormalized integers that must be kept in sync manually. There are no triggers ensuring these counters stay accurate when records are deleted.

### User Experience and Interface

**F-031** The sidebar navigation has a two-tier pattern: primary tabs visible by default, secondary tabs hidden behind a "Tools" button. The tabs hidden behind "Tools" include critical workflow items (Requests/Leads, Bids, Jobs, Recurring Plans, Expenses) that operators use daily. Important workflow items should not require a secondary click to reveal.

**F-032** The "Tools" button label is generic and gives no indication of what is behind it. An operator new to the platform has no way to know that "Tools" contains their bids, jobs, and expense tracking.

**F-033** The dashboard tab is labeled "Today" in the sidebar but "Business hub" in the page header and "dashboard" in the code. Inconsistent naming across three surfaces.

**F-034** The "Website" tab in the sidebar actually covers both website setup AND operator configuration. These are different tasks with different audiences and should be separated.

**F-035** Empty states throughout the app (empty leads list, empty orders list, etc.) are not consistently handled. Some show a message, some show nothing, and some show loading spinners indefinitely if the fetch never completes.

**F-036** Error states from failed API calls surface as raw `error.message` strings in message divs (`leadMsg`, `bidMsg`, etc.). These messages come from Supabase and are developer-facing, not operator-facing.

**F-037** The login form has both "Sign in" and "Email me a sign-in link" buttons with no visual hierarchy distinction. First-time users on a magic-link flow would not know which to use.

**F-038** The "First wins" checklist in the sidebar (`startupChecklist`) says "Loading your next steps…" indefinitely if the `get-launch-checklist` function fails or returns empty.

**F-039** The platform tagline "Learn business while earning" in the sidebar footer is consumer-education positioning that does not match a B2B operator tool's voice. A plumber or hydrovac operator does not want to be told they are learning.

**F-040** The `brandPowered` text reads "Keep the work, customers, and money in one place" — this is a positioning line, not a useful UI label. The space would be better used for a current-tenant status indicator.

**F-041** The global search field placeholder says "Search work, customers, money…" but the search functionality behind it is unclear — it is not obvious whether this searches locally cached data or makes server requests.

**F-042** Confirmation dialogs (e.g., for deleting a customer, canceling a booking) are handled via `window.confirm()` in multiple places. These are browser-native dialogs that cannot be styled and interrupt the page context in a jarring way.

**F-043** The bid workspace has `BID_SYNC_TIMER`, `BID_SYNC_IN_FLIGHT`, and `BID_SYNC_PROMISE` variables suggesting auto-save behavior. There is no visible auto-save indicator in the UI, so operators do not know when their work is safe.

**F-044** The "money" tab appears twice in the sidebar — once in the primary section (labeled "Money" → `data-tab="payments"`) and once in the Tools section (labeled "Insights" → `data-tab="money"`). These are different tabs but the naming is confusing.

**F-045** Date/time handling in `toDateTimeLocalValue()` applies timezone offset arithmetic manually. This pattern is fragile for operators in DST-affected time zones or non-US time zones.

**F-046** The `currentMonthRevenueCents()` function falls back to `row.updated_at` when `paid_at` and `created_at` are both missing. A payment record with no paid_at date uses its update timestamp as the revenue date — this can misattribute revenue.

**F-047** The customer lifetime value calculation in `customerLifetimeValueCents()` takes the maximum of the stored value and the computed value, never the sum. If the stored value is stale and higher than the computed value, the stored value is returned. This is a reporting accuracy bug.

### Workflow and Business Logic

**F-048** The lead-to-bid-to-order-to-job conversion path exists but requires multiple manual steps with no guided path or prompt. An operator who receives a lead and wants to convert it to a job has to know to click "Create bid from lead," then manually convert the bid to an order, then create a job from the order. The happy path is buried.

**F-049** Deposit enforcement (`orderDepositBlocksJob()`) correctly identifies when a deposit is required before a job can proceed, but the UI blocking behavior is not clearly communicated to the operator. The error message "This order requires its deposit before a job can be created" appears as a thrown error, not a proactive warning before the operator tries to create the job.

**F-050** Service plans (`plansList`, `planDetailWrap`) allow recurring orders to be created but the auto-trigger logic is in `process-recurring-orders.js`. If this scheduled function is not configured to run on a cron schedule, recurring orders are never created automatically — they require manual triggering via the "Run due plans" button.

**F-051** The quote flow (`create-quote.js`) creates a quote and sends an email, but there is no clear path from an accepted quote to an order. The `quote-accept.js` function exists but whether it automatically creates an order or simply marks the quote as accepted is not confirmed from the code reviewed.

**F-052** The follow-up queue (`FOLLOW_UP_KIND_META`) defines five follow-up types with cooldowns, but the actual email content sent by `send-follow-up.js` is template-driven and not personalized to the specific job or customer history. A payment reminder that doesn't mention the job amount or due date is less effective than one that does.

**F-053** The dispatch board (`dispatchBoard`, `dispatchDetail`) exists in the UI but the hydrovac codex specifies that dispatching a hydrovac job should be blocked when a valid locate ticket does not exist. Whether this business logic is enforced in the current code is not confirmed.

**F-054** The bulk import feature (`bulk-import-customers.js`) exists but there is no documentation visible in the UI about what CSV format is expected, what fields are required, and what happens to duplicate records.

**F-055** The recurring bookings system (`create-recurring-bookings.js`) and the service plans system (`service_plans`) appear to be parallel approaches to recurring work management. The relationship between them (which one governs which type of recurring work) is not clear from the UI.

**F-056** Time entries (`log-time-entry.js`, `TIME_ENTRIES_CACHE`) exist and a "Log time" button is visible in the dashboard. But how time entries connect to job costing, invoice generation, or payroll is not surfaced in the operator UI.

**F-057** The `prooflink-workspace-architecture.js` defines `WORKFLOW_RUBRICS_BY_FAMILY` with excellent per-family guidance rubrics (field service, recurring field service, retail/production, event/hospitality). These rubrics are defined but it is unclear whether they are actively used to drive UI guidance or are documentation-only.

**F-058** The AI copilot is hidden by default (`sectionNav?.querySelector('.tab[data-tab="ai"]')?.setAttribute("hidden", "hidden")`). There is no way for an operator to know the feature exists or to enable it through the UI.

### Customer-Facing and Copy

**F-059** The public landing page headline "If your business runs on texts, spreadsheets, and memory, you do not have a system" is strong and specific. But the sub-copy below it is dense and relies on the operator understanding what "one place to track what you sell, what customers buy" means in practice. There is no concrete outcome statement ("You will get paid faster," "You will stop missing follow-ups").

**F-060** The join form (`join.html`) asks "What kind of business needs the system?" — this is the right question but the business type icons use two-letter codes (BA, PW, CR, LS) instead of recognizable icons. The codes are initials that require reading the label to decode.

**F-061** The onboarding confirmation email says "Our team will review it within 24 hours." This creates a promise that may not be met and creates no self-service path for applicants who want to start immediately.

**F-062** The operator dashboard sidebar says "Operators only" on the sign-in card. This is a security hint that confirms the page is not public, but for a legitimate operator it reads as exclusionary rather than welcoming.

**F-063** The password setup page says "Your email is confirmed. Create a password so you can log back in directly next time." This is accurate but generic. It should be personalized: "Welcome to ProofLink. Create your password and you'll be taken straight to your [Business Name] dashboard."

**F-064** Error states in the app are inconsistently worded. Some use "Something went wrong," some use the raw Supabase error message, some use function-specific messages. There is no error message style guide.

**F-065** The review request flow (`request-review.js`, `submit-review.js`) exists but the operator-facing UI for sending review requests and the copy in the outbound email are not visible in the reviewed code. If the default subject line is generic, review request emails are likely to be ignored.

**F-066** The customer portal URL (`portal.html?tenant=...&email=...`) exposes the customer's email address in a bookmarkable URL. Customers who share this link (e.g., forwarding it to a spouse) inadvertently share their email as a URL parameter.

### Performance and Reliability

**F-067** All module data is loaded into in-memory JavaScript arrays (`JOBS_CACHE`, `CUSTOMERS_CACHE`, etc.) with a page size of 50 for some resources. Operators with large datasets will see incomplete data in list views without realizing pagination is active.

**F-068** The `TABS_LOADED` set tracks which tabs have had their initial data load. If a tab fetch fails, the tab is not added to `TABS_LOADED`, meaning every subsequent visit to that tab triggers a new fetch. If the failure is persistent (e.g., a missing table), the tab repeatedly makes failing requests on every focus.

**F-069** The `WORKSPACE_SNAPSHOT_TIMERS` and `WORKSPACE_DIRTY_TABS` patterns suggest an autosave system, but the debounce timers are per-tab and not coordinated. If an operator makes changes in multiple tabs simultaneously, the timer-based saves may interleave.

**F-070** The AI copilot calls the Anthropic API directly from a Netlify function with no caching, no retry logic, and no timeout. A slow Claude response blocks the entire function invocation.

**F-071** Booking reminders (`booking-reminders.js`) and recurring order processing (`process-recurring-orders.js`) are scheduled functions, but there is no monitoring or alerting if they fail silently. A failed scheduling run could leave operators with missed reminders or unprocessed plans for days.

**F-072** The `get-bookings.js` function defaults to returning the current month plus one additional month. For operators with heavy booking calendars, this window may be too narrow for planning without a way to query further ahead.

**F-073** The platform uses Google Fonts loaded from the CDN (`fonts.googleapis.com`) on every page. On first load in a poor network environment (field use), font loading can delay rendering of the main content.

**F-074** There is no service worker with meaningful offline capability. The PWA manifest exists and a cache version is referenced, but field crew members who lose signal mid-job have no fallback access to job details.

### Compliance and Hydrovac-Specific

**F-075** The hydrovac codex specifies that dispatching a job with `job_type IN ('hydrovac_excavation','potholing','daylighting')` MUST be blocked until a valid locate ticket exists. The frontend variable `hydrovacLocateList` exists and the locate ticket data model is specified, but the dispatch-blocking enforcement is not confirmed as implemented in the current backend functions.

**F-076** Waste manifest data is critical environmental compliance data. There is no export-to-PDF or export-to-CSV function visible for waste manifests that would allow an operator to produce documentation for a regulatory inspection.

**F-077** The confined space entry permit tracking and H2S/O2 monitor reading logging specified in the hydrovac codex are in the spec but the deployed schema and UI for these specific fields is not confirmed.

**F-078** DOT compliance tracking (driver HOS, CDL expiry, annual vehicle inspections) is mentioned in the hydrovac codex as a mid-size fleet need. The `driverQualificationsList`, `driverQualificationDetail` DOM elements exist in operator.js, suggesting the UI is partially built, but the expiry alerting and automated reminder logic is not confirmed.

**F-079** The hydrovac rate sheet (`BENKARI_HYDROVAC_RATE_SHEET`) is hardcoded in `seed-templates.js` with specific dollar amounts (e.g., `truckAndOperatorHourly: 215`). These rates are seeded as defaults but real operators need to customize their rate sheet without touching code.

**F-080** The compliance dashboard (`hydrovacComplianceSummary`, `hydrovacComplianceUrgent`, `hydrovacComplianceCoverage`) exists in the DOM but the logic for what constitutes a compliance gap (expiring locate tickets, manifests without disposal confirmation, equipment inspection overdue) and how urgently it is surfaced is not confirmed as enforced.

**F-081** Emergency response billing (24-hour callout tracking, mobilization rate vs. standby rate) is identified in the hydrovac codex as a critical need for emergency operators, but the UI does not show a dedicated emergency dispatch mode or emergency rate tier.

**F-082** Municipal/utility operators need asset-level history (specific catch basin at a geographic coordinate, cleaned X times this year). The `hydrovacAssetList`, `hydrovacAssetDetail` DOM elements exist but the data model for geographic asset tracking is not visible in the reviewed schema.

---

## SECTION 3 — BOARD-BY-BOARD FEEDBACK

### Product Architect

The workspace architecture document (`prooflink-workspace-architecture.js`) correctly identifies the core module families (CRM, intake, bids, orders/jobs, payments, expenses, schedule, proof, reporting, automation) and defines feature catalog entries for tier enforcement. This is good structure thinking. What is missing is the contract layer between these modules: when a bid is accepted, what state machine transitions happen? When a job is closed, what payment reminders are automatically triggered? These workflows exist as code scattered throughout operator.js but there is no canonical state machine document or enforcement layer. Phase 2 must define these transitions explicitly and enforce them server-side so they survive any future UI refactor.

The plan intent module (`prooflink-plan-intent.js`) is cleanly written and correctly handles plan selection, persistence, and sanitization. The pattern of storing intent in localStorage before the account is created is correct. What is missing is a clear handoff from stored intent to confirmed plan at account creation — the flow from join form submission through admin approval through first login needs to reliably carry the selected plan forward.

### Senior Frontend Systems Engineer

The `operator.js` monolith is the primary concern for this phase. The file has grown past the point where any individual change can be understood without reading thousands of lines of context. The minimum viable improvement is: extract module files for each major tab section (leads, bids, orders, jobs, customers, payments, compliance) and import them. Even without a bundler, splitting into ten 1,400-line files with clear responsibility boundaries is vastly more maintainable than one 14,000-line file.

The DOM reference pattern (200+ `const variable = $(id)` at the top) means operator.js crashes silently when any element is absent. The fix is deferred lookups: functions should call `$()` at the point of use, not at file load time. This also enables proper lazy initialization.

The cache management pattern is ad-hoc. Moving to a simple reactive store pattern (even just a Map with event listeners) would eliminate the bugs caused by multiple async operations updating the same cache array simultaneously.

TypeScript adoption — even just JSDoc type annotations — would catch the most common bugs (accessing undefined properties on null cache entries) without requiring a build step.

### Senior Backend/Data Engineer

The two provisioning paths (`admin-approve-onboarding.js` vs `provision-tenant.js`) need to be unified into a single service. Both paths create tenants, operators, operator_members, seed templates, create auth users, and send welcome emails. They diverge only in their auth check and one coupon code path. This is a maintenance landmine: the next feature added to provisioning has to be added in two places.

The `catchup_run_this.sql` approach to database migrations needs to be replaced with a proper migration tool (Flyway, Liquibase, or the simpler Supabase CLI migration system). Every future schema change should be a numbered migration file with a forward and, where possible, reverse path. The current approach makes it impossible to know which migrations have been applied to any given environment.

The absence of database-level triggers to maintain the usage counters (`product_count`, `customer_count`, etc.) on tenants is a correctness risk. Without triggers, these counts drift when records are deleted or when the application fails mid-operation. Add `AFTER INSERT/DELETE` triggers to increment/decrement these counters atomically.

The `tenant_config` table storing a JSON blob under `site_settings` is fine for the current feature set, but the key/value structure with a single JSON blob is approaching its limits. The `editable_fields` array in `get-operator-setup.js` returns 20+ editable fields from a single blob. As this grows, consider normalizing high-frequency fields into proper columns.

### UX Strategist

ProofLink's navigation hierarchy has the wrong things at the top level. The primary nav (always visible) shows: Today, Work, Customers, Calendar, Money, Website, Operations. "Work" and "Operations" are vague. An operator running a hydrovac business does not think in terms of "Work" and "Operations" — they think in terms of "Jobs," "Bids," and "Compliance." The nav should be persona-driven and business-type-aware: hydrovac operators should see a different primary nav than bakery operators.

The "First wins" checklist is an excellent pattern but it needs to be time-bounded and contextual. A checklist that shows "Add your first customer" six months after an operator has 200 customers is noise. The checklist system needs to evolve into an ongoing onboarding intelligence layer that surfaces the next most impactful action for the operator's current growth stage.

The follow-up queue (missed lead nudge, quote follow-up, deposit reminder, payment reminder, review request) is the right idea but needs to be surfaced more aggressively on the dashboard. It should be the first thing the operator sees when they open the app in the morning, not a secondary widget. This is where ProofLink becomes an operating system rather than a record-keeping tool.

### UI/Design Systems Lead

The CSS uses CSS custom properties consistently (`--accent`, `--bg0`, `--bg1`, `--panel`, `--text`, `--muted`, `--border`, `--radius`, `--shadow`). This is solid design system infrastructure. What is missing is a component library to go alongside it. The same "pill with status color" pattern, the same "list row with detail" pattern, and the same "form with save button and message div" pattern appear hundreds of times in operator.js rendered as raw HTML strings in template literals. These need to be extracted into proper reusable components.

The brand theming system (accent color, background, border) is applied through `COTTAGELINK_BRAND` at startup. The naming mismatch between "COTTAGELINK" (old brand) and "ProofLink" (current brand) is visible in the codebase throughout: `COTTAGELINK_OPERATOR_CONFIG`, `window.COTTAGELINK_BRAND`, `operator.brand.js`. This needs a complete find-and-replace rename before any public launch that positions ProofLink as a standalone product.

The mobile experience needs a dedicated design pass. The operator dashboard was designed for desktop and the column-based layout degrades poorly on phones. Field crew members who need to check job details or update status in the field deserve a genuinely mobile-first experience, not a responsive squeeze.

### Mobile/Field Workflow Specialist

Field crew members need a view that shows: their jobs for today, the address, the current job status, the notes, and a button to mark it complete or log a status update. They should not need to navigate through the full operator dashboard to do this. A separate crew-facing view (or a stripped-down mobile mode triggered by a role flag) would dramatically increase field adoption.

The "Log time" button on the dashboard is in the right place but it opens to a general time entry form. Field crew need a time entry that is pre-linked to the current job they are on. The ideal is: tap the job, tap "I'm starting," tap "I'm done." Three taps, job time recorded.

Offline capability is critical for field use. Hydrovac operators often work on industrial sites with poor cell signal. Being unable to update a waste manifest or close a job because Supabase is unreachable is a blocking failure. A service worker that queues writes for sync when connectivity returns is a must-have for field operators.

Photo capture from the job record needs to be fast and reliable. The current `bidPhotoFile` upload flow requires selecting a file, naming it, categorizing it, adding a note, and submitting. In the field, operators will upload photos as fast as possible. The flow should default to camera capture and auto-name the photo with a timestamp, with optional categorization added later.

### Onboarding/Conversion Strategist

The join form is well-structured (business type selection first, then details, then plan) but the friction between form submission and account access is high. The current flow is: submit → wait for admin approval → receive email → set password → access dashboard. This multi-day gap is a conversion killer for operators who are comparing ProofLink to tools they can sign up for immediately.

The onboarding email copy ("Our team will review it within 24 hours") sets a manual-review expectation. For lower-risk business types (pressure washing, landscaping, cleaning), consider an automated approval path that provisions the tenant immediately upon verified email and good standing, removing the manual bottleneck.

The "First wins" checklist needs to be the primary experience for the first 7 days. Every item on it should drive the operator toward their first completed workflow: add a customer, create a bid, convert to an order, record a payment. The first operator to complete this full loop will understand the value proposition. Without guided completion, many operators will stall at "add your first customer."

The platform tag "Learn business while earning" needs to go. Experienced service business operators do not want to be positioned as students. They want to be positioned as capable operators who now have better tools.

### Customer-Language/Copy Editor

The biggest language problem in ProofLink is vocabulary inconsistency. The same concept is called different things in different places:
- The tab is "Work" but the section inside is "Orders" and the sub-section is "Active Jobs"
- The sidebar has "Requests" (leads) and "Work" (orders/jobs) but these are different stages of the same workflow
- "Bids" in the UI means walkthrough estimates, but operators in different trades call these "quotes," "proposals," "estimates," "bids," or "jobs"
- The "Money" tab (primary nav) goes to payments; the "Insights" tab (tools) also covers money

Recommendations:
- Use "Jobs" or "Work" as the primary organizing concept, with Pipeline, Active, and History as sub-states
- Use the trade's own vocabulary: landscapers say "visit," plumbers say "service call," hydrovac operators say "truck dispatch"
- "Requests" is clearer than "Leads" for inbound contact
- "Proposals" is universally understood across more trades than "Bids"
- "Payments" is correct; "Money" as a tab label is too casual for a business tool

Empty state messages need to be written with operator voice:
- "No leads yet" should be "No requests yet. When customers reach out, they'll appear here."
- "No orders" should be "No active work. When you convert a request to a job, it shows up here."
- "No payments" should be "No payments recorded. Once you close a job or collect a deposit, you'll see it here."

### Security Engineer

The `Access-Control-Allow-Origin: *` header on every Netlify function needs to be tightened. For authenticated endpoints, CORS should only allow known ProofLink origins. For public endpoints (bookings, reviews, order submission), the permissive CORS is acceptable.

The public booking endpoint (`create-booking.js`) has no rate limiting. Add rate limiting keyed on `tenant_id` + client IP to prevent booking spam for any given tenant.

The email exposure in portal URLs (`?email=customer@example.com`) should be replaced with a short-lived signed token or a session-based lookup. The customer provides their email once to generate a token; the portal loads from the token, not the email.

The `listUsers` call in `admin-approve-onboarding.js` (line 232) fetches up to 1000 users to find an existing auth user by email. This is a pagination limit that will fail silently for platforms with more than 1000 users. Use `supabase.auth.admin.getUserByEmail()` instead.

The hardcoded Supabase anon key in `operator.js` line 6 should be the last remaining occurrence of a hardcoded credential. It should be removed and the `COTTAGELINK_OPERATOR_CONFIG` path should be the only source.

Operator sessions use `sessionStorage.getItem('pl_op_token')` as the token storage location in some places and `sb.auth.getSession()` in others. There is inconsistency in how the access token is retrieved that creates edge cases where the token is stale or missing.

### QA/Workflow Automation Lead

There are zero automated tests in this codebase. The minimum acceptable test coverage for Phase 2 is:
1. Unit tests for all pure utility functions (amount calculations, date formatting, status classification)
2. Integration tests for the auth middleware (`requireOperatorContext`, `requireAdminContext`) with mock Supabase responses
3. End-to-end smoke tests for the critical path: login → create customer → create bid → convert to order → record payment

The `isMissingDatabaseFeatureError()` function should be replaced with a test that validates the actual database schema at CI time. Silent schema mismatch swallowing is a testing anti-pattern.

The two provisioning paths need identical test scenarios to confirm they produce the same result. Currently there is no way to know if they have diverged.

Every Netlify function should have a health check endpoint or at minimum a test invocation that can be run after deployment to confirm the function is reachable and can authenticate.

### Performance/Reliability Engineer

The 14,000-line single JavaScript file is a performance problem independent of maintainability. The browser must parse, tokenize, and compile the entire file before any UI renders. On a mid-range phone (which is what many field operators use), this parse time is measurable in seconds.

The in-memory cache model loads all records up to `PAGE_SIZE` per tab. The `PAGE_SIZE = 50` constant means operators with more than 50 customers see a truncated list with no obvious indication that more records exist. The UX for pagination or infinite scroll needs to be visible and consistent.

The AI copilot has no timeout. Claude API calls can take 10-30 seconds. Without a timeout and abort controller, slow responses will leave the operator waiting on a frozen UI.

Google Fonts should be preloaded or replaced with system font stacks for the operator dashboard where performance is more important than brand consistency.

### Payments/Billing Workflow Specialist

The payment state model (`buildTenantPaymentState` in `_prooflink_payments.js`) is complex. An operator arrives on the dashboard and needs to understand whether they can take online payments. The current display requires understanding the relationship between `billing_status`, `connect_status`, `payments_enabled`, and `online_payments_enabled`. This needs to collapse to a single operator-facing payment status with a clear action step.

The Stripe Connect flow (for tenant operators to accept customer payments) is present but the setup UX is buried in the "Website" tab. Online payment setup should be prominently featured during onboarding as a revenue-enabling step, not hidden in website configuration.

The deposit enforcement logic is sophisticated but its failure mode is confusing. When a deposit blocks a job, the operator receives a thrown error after trying to create the job. The better UX is: show the deposit gap in the order detail before the operator navigates to create the job.

Invoice generation (`send-invoice-email.js`, `time-to-invoice.js`) exists but the invoice template and the data that flows into it is not visible in the reviewed code. Operators need professionally formatted invoices, not just notification emails.

### CRM/Service-Operations Specialist

The customer record is basic: name, email, phone, preferred contact, notes, address. For a business operating system, this is insufficient. Missing fields critical for service businesses:
- Customer type (residential vs. commercial vs. municipal)
- Account manager / assigned rep
- Next scheduled service date
- Preferred service window (weekday, weekend, morning, afternoon)
- Gate code or access instructions that carry to every job
- Key notes that populate automatically on new job creation
- Number of active service plans
- Total outstanding balance

The CRM is currently a contact list with attached orders. Phase 2 should evolve it into a true account record where the customer's entire relationship — active jobs, open invoices, recurring plans, service history, outstanding deposits — is visible on one screen without navigation.

The follow-up queue is a strong start but needs to be personalized. "Quote follow-up" as a generic type is useful; "Quote #A-2024 for $4,200 sent to Johnson Utilities 3 days ago — follow up now" is what operators actually need to see.

### Analytics/Reporting Specialist

The dashboard revenue metrics (`currentMonthRevenueCents`, `lastMonthRevenueCents`, `averageOrderValueCents`) are computed from in-memory cache data. This means they only reflect the 50 most recently loaded orders, not the full dataset. Revenue numbers on the dashboard may be materially wrong for operators with history beyond the cache window.

The "Insights" tab (`data-tab="money"`) exists but its content is not visible in the reviewed code. What financial insights are shown, how they are computed, and whether they are accurate are open questions.

The hydrovac analytics endpoint (`get-hydrovac-analytics.js`) exists. The data it returns and how it is visualized in the compliance and operations dashboards should be the model for analytics depth across all verticals. Every vertical should have its own analytics endpoint that surfaces the KPIs operators in that trade actually care about.

Growth score (`growth_score` column on tenants) is tracked but there is no visible UI that explains to operators what their score is, what it means, or how to improve it. This is a potential engagement feature that is currently invisible.

---

## SECTION 4 — TEMPLATE COUNCIL REPORT

### Hydrovac / Vactor (the benchmark vertical)

**What already works:** Product seeds with accurate rate structures. The `BENKARI_HYDROVAC_RATE_SHEET` reflects real industry economics. The bid profile library has a hydrovac-specific scope guide with correct truck, crew, and disposal framing. Waste manifest and utility locate ticket data models are specified to depth in the codex. DOM elements for facilities, manifests, locates, compliance, driver qualification, dispatch, permits, and assets all exist in operator.js. The compliance dashboard concept is the right approach.

**What feels too generic:** The locate ticket UI is present but looks like a generic form, not a 811/Dig Safe workflow. Operators need to be prompted with state-specific one-call center names, standard validity windows, and required fields. The manifest form needs to reflect actual manifest numbering conventions, waste classification codes (RCRA, DOT, state-specific), and required disposal facility fields.

**What native workflow depth is still missing:** Confined space entry permit tracking with H2S/O2 monitor readings per entry. Emergency dispatch mode with different rate tiers. Asset-level service history for catch basins and structures with geographic coordinates. DOT driver qualification expiry with automated 30/60/90-day alerts. Municipal service contract tracking with work order number matching. PDF manifest generation in compliant format.

**What should be built next:** (1) Mandatory locate ticket validation in dispatch workflow — blocking, not advisory. (2) One-click manifest generation from job closeout. (3) Equipment inspection calendar with automated expiry alerts. (4) Emergency callout rate tier that activates automatically on after-hours job creation. (5) Customer-facing compliance portal showing manifests and locate documentation for municipal clients.

---

### Landscaping / Lawn Care

**What already works:** Recurring visit product seeds. The bid profile library has a landscaping scope guide with property-specific notes, gate and pet access prompts, and seasonal cleanup framing. Recurring plans functionality is present.

**What feels too generic:** There is no concept of a "route" — the core operational unit for landscaping is the weekly route, not the individual order. Pricing the business as individual jobs misses how landscaping economics actually work (a 30-property route at $X/visit).

**What native workflow depth is still missing:** Route grouping (all Monday customers on one crew card). Property-note carry-forward from visit to visit without manual entry. Seasonal service scheduling (spring cleanup, fall cleanup as recurring one-time items). Photo proof of visit for absent customers. Crew mobile sign-off on completion.

**What should be built next:** Route card view for dispatched crew. Property notes field that surfaces automatically on every job creation for that customer. Seasonal service plan generator. Stripe recurring billing integration for monthly auto-pay.

---

### Cleaning (Residential/Commercial)

**What already works:** Product seeds for cleaning services. The general-service bid profile applies.

**What feels too generic:** Cleaning businesses need checklist-based job completion, not just a status update. "Job complete" for a cleaning business means every room on the checklist was cleaned, not just that the crew was present. There is no per-visit checklist capability.

**What native workflow depth is still missing:** Room-by-room cleaning checklist with photo proof per room. Pre/post comparison photos linked to the customer record. Customer feedback request linked to checklist completion. Tip collection at job completion.

**What should be built next:** Customizable job checklist template per product type. Photo attachment per checklist item. Post-job customer satisfaction prompt.

---

### HVAC

**What already works:** HVAC product seeds. The HVAC bid profile library entry is technically accurate (diagnostic, parts allowance, maintenance plan) and reflects real HVAC service proposal structure.

**What feels too generic:** HVAC operators need to track equipment by address, not just customer. The same address may have three units, each with its own model, serial number, refrigerant type, last service date, and warranty status. A customer record with a notes field is not sufficient.

**What native workflow depth is still missing:** Equipment asset record per address (unit type, model, serial, refrigerant, warranty expiry). Service history per equipment unit. Maintenance agreement tracking with auto-renewal reminders. Parts catalog with cost vs. sell price. Refrigerant usage logging for EPA compliance.

**What should be built next:** Equipment asset record linked to customer and address. Last-serviced date visible on customer card. Maintenance agreement renewal alert. Parts/refrigerant expense auto-linked to job cost.

---

### Plumbing

**What already works:** Plumbing product seeds and the plumbing bid profile are technically accurate. The scope prompts correctly call out fixture type, shutoff access, and finish restoration.

**What feels too generic:** Plumbing emergencies require 24/7 dispatch at emergency rates. The current system has no emergency rate tier or on-call flag. There is also no concept of municipal permit tracking for permit-required work.

**What native workflow depth is still missing:** Permit tracking per job (permit number, inspector name, inspection date). Emergency dispatch rate tier. Fixture and material cost tracking with auto-markup. Before/after photo requirement for insurance work.

**What should be built next:** Per-job permit tracking with inspection appointment. Emergency job flag that applies after-hours rate. Material cost-plus pricing in job creation.

---

### Pressure Washing

**What already works:** The pressure washing product seeds are priced realistically. The bid profile is the most detailed of the non-hydrovac templates — it has six photo categories, six scope starters, and three pricing prompts that reflect real pressure washing work.

**What feels too generic:** The pricing model is per-job. Pressure washing businesses often price by square footage or by surface type. There is no square footage input that auto-calculates price based on a stored rate.

**What native workflow depth is still missing:** Square footage calculator in job creation. Before/after photo pair linked to the same surface. Weather/wet conditions reschedule flag. Chemical usage log per job.

**What should be built next:** Optional square footage rate calculator in bid line items. Photo pair (before/after) UI in job closeout. Reschedule workflow for weather delays.

---

### Contractor / Remodeling

**What already works:** The contractor bid profile is the most sophisticated in terms of change order discipline — it correctly separates base scope, material/hidden-condition allowances, and optional upgrades. Phase/milestone language is present.

**What feels too generic:** Large remodeling projects need multi-phase management: demo phase, rough phase, finish phase, punch list. An order record with a single status is insufficient. Change orders need a formal approval workflow, not just a notes field.

**What native workflow depth is still missing:** Project phase management (`manage-project-phases.js` exists!). Change order formal approval path. Subcontractor PO management. Lien waiver tracking. Progress billing (billing by completed phase, not by job total).

**What should be built next:** Expose `manage-project-phases.js` in the operator UI. Add formal change order with customer approval email. Progress billing milestone that generates a partial invoice.

---

### Handyman

**What already works:** General service bid profile and seeds cover handyman reasonably. The flexible scope format matches how handyman work is actually sold (hourly or flat-rate).

**What feels too generic:** Handyman operators often have a menu of small jobs with fixed prices. The general product catalog structure works but there is no "quick add" for a $75 toilet repair that does not require a full walkthrough bid.

**What native workflow depth is still missing:** Rapid job creation from product catalog without a full bid. Fixed-price job confirmation text. Multi-stop same-day scheduling card.

**What should be built next:** Quick job creation that selects a product and immediately creates a job with that product's price, no bid required.

---

### Photography / Events

**What already works:** General service bid profile covers the booking and scope elements adequately.

**What feels too generic:** Photography is deliverable-based. The value is not the hours worked but the digital files delivered. There is no deliverable tracking, no file delivery workflow, and no client gallery concept.

**What native workflow depth is still missing:** Deliverable tracking (number of edited photos, video clips, albums). Delivery milestone (ready for download). Client gallery link in customer portal. Rush processing rate. Second shooter coordination.

**What should be built next:** Deliverable checklist in job closeout. Gallery/file delivery link in customer portal notification.

---

### Pet Services

**What already works:** Basic booking and customer record.

**What feels too generic:** Pet service businesses need per-pet records (breed, age, weight, vaccination status, behavioral notes, owner contact for emergencies). The customer record has no concept of a pet.

**What native workflow depth is still missing:** Pet record linked to customer. Vaccination expiry alerts. Per-pet service notes that carry to every appointment. Liability waiver collection.

**What should be built next:** Pet sub-record on customer profile. Required vaccination fields with expiry tracking. Waiver collection before first appointment.

---

### Bakery / Food

**What already works:** The bakery bid profile is appropriate. Product seeds with quantity and delivery fields apply. The production timing and pickup window framing is correct.

**What feels too generic:** Bakery orders are quantity-based, not scope-based. Ordering 200 cupcakes for a wedding is fundamentally different from ordering a single service. The general bid-to-order path is cumbersome for high-volume repeat orders.

**What native workflow depth is still missing:** Quantity-based order entry. Production calendar (how many orders are due on each day, with quantities). Order deadlines and pickup/delivery windows as first-class fields. Allergen and dietary restriction notes per order.

**What should be built next:** Simplified order form for quantity-based orders. Production calendar view. Allergen notes field required on custom orders.

---

### Property Maintenance

**What already works:** The property maintenance bid profile is solid with punch list, zone-based pricing, and recurring service framing.

**What feels too generic:** Property management companies work across multiple properties, each with their own address, contact, and service history. The customer model conflates the property manager (the customer) with the individual properties they manage.

**What native workflow depth is still missing:** Sub-property records under a commercial customer account. Turnover checklist template. Unit inspection report. Maintenance request tracking from tenant to operator.

**What should be built next:** Property sub-record under customer account. Turnover inspection checklist.

---

### General Service (catch-all)

**What already works:** The general service bid profile is a well-written template that applies to any field service business. It is the right default.

**What feels too generic:** Everything — by definition. The value of ProofLink over a generic tool is vertical depth.

**What should be built next:** During onboarding, if a business type is "general service," prompt for a more specific type after the operator sees their first active job. Use that choice to apply a more specific bid profile retroactively.

---

## SECTION 5 — PRODUCT ARCHITECTURE REPORT

### Operator Shell Structure

The operator shell is a single-page application served from `/operator/index.html` with a sidebar nav, a topbar header, and a main content area containing all panel sections in the DOM simultaneously. Panels are shown/hidden via CSS class manipulation rather than true routing. This is a functional architecture for the current feature count but it means:
- All panel HTML is loaded into the DOM on page load, even for panels the operator never visits
- Deep-linking to a specific panel requires URL hash handling that is manually maintained
- Browser back/forward history is not correctly tracked

The correct next step is not to replace this with a full SPA framework (that would be over-engineering) but to adopt a lightweight panel router that: handles URL hash state, manages panel lifecycle (init on first show, refresh on re-show), and supports back/forward navigation.

### Remaining Monolith Risk in operator.js

At 14,000+ lines, `operator.js` has the following specific failure modes that are hard to contain without modularization:
1. A bug fix in the orders section can accidentally break the jobs section because both sections share globally-scoped cache variables
2. A new developer cannot understand the codebase without reading at minimum 2,000 lines to build the required mental model
3. Profiling performance is impossible because the entire file is one execution context
4. Code splitting for performance (loading hydrovac compliance code only for hydrovac operators) is impossible without modularization

The minimum modularization plan: create a `/operator/modules/` directory. Extract: `modules/auth.js`, `modules/dashboard.js`, `modules/leads.js`, `modules/bids.js`, `modules/orders-jobs.js`, `modules/customers.js`, `modules/payments.js`, `modules/setup.js`, `modules/hydrovac.js`, `modules/shared/state.js`, `modules/shared/utils.js`. Use `<script type="module">` loading in index.html.

### Module Boundaries

The implicit module boundaries in the current codebase are correct — there are logical sections for leads, bids, orders, jobs, customers, payments, expenses, setup, compliance, etc. The problem is that these boundaries exist only as naming conventions and comments, not as enforced boundaries. A function in the leads section can directly mutate `PAYMENTS_CACHE` without any contract violation.

Explicit module contracts needed:
- Each module owns its cache variable and exposes read methods, not the variable itself
- Cross-module access goes through a shared event bus or dispatcher, not direct variable access
- The shared state module (`modules/shared/state.js`) owns `CURRENT_OPERATOR`, `TENANT_ID`, and the auth token

### Shared State and Contracts

Current shared state pattern: 50+ `let` globals at file scope. Proposed pattern: a state object with get/set methods and a simple event system (`state.on('payments:updated', handler)`). This does not require a framework — 50 lines of vanilla JavaScript achieves this.

The `WORKSPACE_CONTEXT_GROUPS` map is a good declarative contract for inter-module refresh dependencies. This pattern should be formalized and extended.

### Backend Lifecycle Enforcement

The job lifecycle (created → scheduled → dispatched → in_progress → complete → invoiced) is enforced partially in the UI and not enforced at all in the backend functions. A backend function can advance a job from `created` to `complete` in one call. The hydrovac codex correctly specifies that the transition from `scheduled` to `dispatched` should be blocked without a valid locate ticket, but this is a spec statement, not confirmed as enforced in deployed code.

Recommendation: Add a `transition_job_status.js` function that accepts `(job_id, from_status, to_status)` and enforces all business rules for that transition, returning a clear error if preconditions are not met.

### Data Model Gaps

1. No `job_status_history` table for audit trail of job status transitions
2. No `order_status_history` for order lifecycle tracking
3. No `payment_history` for payment state changes
4. No canonical `notes` table across all record types (currently each table has a notes text column, preventing structured note history)
5. No `customer_tags` or `customer_segments` for CRM filtering
6. No equipment/asset model linked to customer addresses (needed by HVAC, plumbing, landscaping)
7. No `files` table for document attachment management separate from photo records
8. No `contracts` table despite the "Contracts" nav item existing

### Audit Trail Quality

The `log-operator-action.js` function exists and `admin-get-audit-log.js` exists. But audit logging is not called from most write operations in operator.js. The audit trail is partial and inconsistent. For compliance-heavy operators (hydrovac, HVAC, contractor) a complete audit trail is a non-negotiable requirement.

### Test Strategy

Priority order for test investment:
1. Auth middleware unit tests (highest ROI, lowest effort)
2. Pure function unit tests (amount calculations, date formatting, status classification)
3. Provisioning integration test (full tenant creation end-to-end)
4. Schema validation test (confirm expected tables and columns exist)
5. Critical path smoke tests (login → create order → record payment)

### Deployment and Release Safety

Currently: push to `main`, Netlify builds and deploys. No staging environment is visible. No feature flags. No rollback process beyond reverting a Git commit and redeploying. No health checks that run post-deployment.

Minimum for Phase 2: Netlify Preview Deployments used as staging for every PR. A post-deployment smoke test script. Database migration run as a pre-deploy step, not a manual process.

---

## SECTION 6 — UX AND LANGUAGE REPORT

### Owner Language (The Person Writing Checks)

Current: Too much generic SaaS vocabulary. "Configure your workspace." "Set your operator context." "Tenant configuration."

Should sound like: "Your business is set up." "Your rates are saved." "Your crew sees the job."

Every screen an owner looks at should answer: what happened today, what money is owed, what is overdue.

### Customer Language (End Customers of the Tenant Business)

The customer-facing booking form and portal are the only surfaces the end customer sees. These need to use the language the business owner's customers expect:
- "Request a quote" not "Submit a lead"
- "We'll be in touch within [X]" not "Submission received"
- The customer portal should greet by name: "Hi Sarah, here's your project with [Business Name]"

### Crew/Mobile Language

Field crew should see job language, not system language:
- "Your next stop" not "Next scheduled job"
- "Mark complete" not "Update status to complete"
- "Add a note" not "Submit a job note record"

Error states for crew should be simple: "Can't connect. Your update will save when you get signal." Not a technical error code.

### Error States

Current pattern: raw error messages from backend (e.g., "duplicate key value violates unique constraint 'products_pkey'"). These are never acceptable in operator-facing UI.

Required pattern: every error state has a human message, a suggested action, and an escape hatch.

Example:
- Current: "duplicate key value violates unique constraint"
- Required: "A product with this name already exists. Check your product list or use a different name."

### Confirmations

Current: `window.confirm("Are you sure?")` browser dialogs.

Required: Inline confirmation panels with the specific item name, the consequence, and a cancel escape.

Example: "Delete **Johnson Utilities** and their 4 orders? This cannot be undone." [Delete] [Cancel]

### Empty States

Current: Some empty, some spinner, some raw "No data."

Required template: title + what it means + primary action.

Example: "No requests yet. When customers reach out through your booking page, their requests show up here. [Share your booking link]"

### Blocker Messages

Deposit blocks job creation: "Johnson Utilities owes a $500 deposit before this job can start. [Record deposit] [Override and explain why]"

Locate ticket missing: "This job requires a 811 locate ticket before dispatch. [Add locate ticket] [Learn more]"

These messages should be surfaced before the action fails, not after.

### Onboarding Steps

The current checklist ("First wins") needs specific, outcome-oriented items:
1. "Add your first real customer" (not "Add a customer")
2. "Create a quote or bid for that customer"
3. "Convert the quote to a job"
4. "Record a payment — even $1"
5. "Share your booking link with one real person"

Each step should have a one-sentence explanation of why it matters.

---

## SECTION 7 — RISK AND TRUST REPORT

### Places Users May Hesitate or Lose Confidence

1. The admin approval delay. An operator submits their application and waits for an email. No status page, no ETA confidence, no self-service path. During this wait, they are likely comparing ProofLink to a competitor they can sign up for immediately.

2. The payment state complexity. An operator who has signed up and wants to take online payments encounters four different flags and a confusing status display. They cannot tell if they are ready to accept payments or if something is broken.

3. Revenue numbers may be wrong. If the dashboard shows $12,000 this month but the actual figure is $18,000 because the cache only shows the last 50 payments, operators will lose trust in the reporting after their first discrepancy.

4. Deleted data has no recovery path. There is no soft delete, no recycle bin, no undo. Accidental deletion is permanent. For service businesses that rely on job history for repeat customer pricing, this is a significant trust risk.

### Risky Workflows

1. The provisioning workflow has multiple failure points. If tenant creation succeeds but operator_members creation fails, the operator cannot log in. The `failProvision()` helper marks the request as failed, but the tenant row may already exist in the database. A subsequent re-attempt will fail on the idempotency check (tenant doesn't exist yet) but will also fail on insert (slug already taken if the previous insert succeeded).

2. The quote-to-order conversion path. If the database insert for the order succeeds but the email send fails, the operator has an order that the customer doesn't know exists. The non-fatal email failure is correct from an API standpoint but the operator has no visibility into whether the customer was notified.

3. Service plan auto-generation. If `process-recurring-orders.js` fires and creates recurring orders, but the customer's payment method is invalid, the orders exist in the system with no payment. The operator may not notice until their revenue report shows unexplained unpaid orders.

### Compliance Gaps

1. Environmental compliance data (waste manifests) is not validated for completeness before a job can be closed. An operator can close a hydrovac job with an incomplete manifest.

2. Locate ticket expiry is tracked but the blocking enforcement on dispatch is not confirmed as active. An expired ticket on an active job may not generate an alert.

3. The consent/authorization trail for customer payment collection is limited. There is no visible confirmation that the customer consented to the payment amount before it was processed.

### Money-State Confusion

The payment state model has `billing_status` (ProofLink's billing of the tenant), `connect_status` (Stripe Connect setup), `payments_enabled`, and `online_payments_enabled`. These are platform-level states, not job-level states. But the dashboard payment widget shows platform state and job-level payment state in adjacent UI, which is confusing. Operators frequently confuse "my Stripe Connect isn't set up" with "this customer hasn't paid."

### Fragile Technical Seams

1. The `isMissingDatabaseFeatureError` silent-swallow pattern. Any schema migration that is not applied causes data to be read as empty instead of raising an error.

2. The COTTAGELINK/ProofLink naming seam. Code that checks `window.COTTAGELINK_OPERATOR_CONFIG` is a deployment risk if config is served under a different key name.

3. Token retrieval inconsistency. Some places use `sessionStorage.getItem('pl_op_token')`, some use `sb.auth.getSession()`. A token expiry or storage clear creates a partially-authenticated state that is difficult to diagnose.

### Audit Gaps

1. No history table for job status transitions
2. No history table for payment state changes
3. Audit log calls are voluntary (not triggered from every write)
4. No immutable audit record for compliance-critical changes (manifest data, locate ticket status)

### Field-Use Failure Points

1. No offline capability. Signal loss = app failure.
2. Photo upload from mobile requires selecting from file system, not camera capture.
3. Job detail navigation requires too many taps from the home screen for field use.
4. Status update requires going into the job detail form, not a single tap from the job list.

---

## SECTION 8 — NEXT-PHASE ROADMAP

### Immediate (next 4-6 weeks)

1. Rename all COTTAGELINK references to ProofLink throughout the codebase
2. Extract operator.js into module files with clear boundaries
3. Add server-side rate limiting to the public create-booking endpoint
4. Fix the `listUsers` pagination bug in admin-approve-onboarding.js
5. Add at least 10 unit tests for pure utility functions
6. Create a post-deployment smoke test script
7. Add a customer email token (replace email-in-URL with signed token)
8. Confirm schema: verify jobs, waste_manifests, utility_locate_tickets, driver_qualifications tables exist and have all required columns
9. Make snooze state server-persisted instead of localStorage-only
10. Add a visible auto-save indicator to the bid workspace

### Next Wave (6-12 weeks)

1. Locate ticket blocking enforcement in dispatch workflow (backend validation)
2. Waste manifest completeness validation before job close
3. Equipment inspection expiry alerts with 30/60/90-day notifications
4. Mobile-first field view for crew members (stripped-down job card + status update + photo)
5. One-tap job completion from job list
6. Camera-capture photo upload (no file picker required)
7. Customer portal with signed token instead of email in URL
8. Revenue calculation using server-side aggregate instead of client-side cache
9. Schema migration versioning (migrate to Supabase CLI migrations)
10. Unify provisioning into a single path

### Deep Foundation (3-6 months)

1. State machine enforcement for job/order/bid lifecycle transitions (backend function)
2. Complete audit trail via triggers on all write operations
3. Database-level triggers for usage counter maintenance
4. Module router with URL hash and back/forward support
5. TypeScript/JSDoc type annotations on core utility functions
6. Integration test suite for auth middleware and provisioning
7. Staging environment with automated smoke tests on every deploy
8. Offline service worker with write queue for field use

### Vertical Excellence (3-9 months)

1. Hydrovac: PDF manifest generation, mandatory locate blocking, confined space permits, emergency rate tier
2. Landscaping: Route card view, property note carry-forward, square footage pricing
3. HVAC: Equipment asset records per address, refrigerant logging, maintenance agreement auto-renewal
4. Cleaning: Per-room checklist, before/after photo pairs, post-job satisfaction prompt
5. Contractor: Formal change order approval workflow, progress billing by phase
6. All verticals: Quick job creation from product catalog without full bid

### Trust and Compliance (ongoing)

1. Soft delete with 30-day recovery for all critical records
2. Immutable audit entries for compliance-critical changes
3. Customer consent trail for payment collection
4. DOT compliance calendar with driver HOS and CDL expiry alerts
5. OSHA confined space entry log with required fields before job start

### Performance and Reliability

1. Scheduled function monitoring with alert on failure
2. AI copilot timeout with graceful degradation
3. Server-side pagination for all list views
4. Font and asset preloading optimization
5. Service worker with meaningful offline capability

### Design System

1. Component library to replace raw template literal HTML
2. Consistent error message style guide and implementation
3. Business-type-aware primary navigation
4. Empty state templates for every list view
5. Inline confirmation components to replace window.confirm()

### Data Model Evolution

1. `job_status_history` table
2. `order_status_history` table
3. `customer_notes` table with structured history
4. `equipment_assets` table per customer address
5. `files` table for document management
6. `customer_tags` for CRM segmentation
7. Soft delete (`deleted_at` column) on all critical tables

---

## SECTION 9 — PRIORITIZED BACKLOG

| # | Title | Why It Matters | Affected Area | User Impact | Difficulty | Priority | Dependencies | Success Criteria |
|---|-------|----------------|---------------|-------------|------------|----------|-------------|-----------------|
| 1 | Rename COTTAGELINK to ProofLink throughout codebase | Brand consistency, deployment correctness | Frontend, config | Medium | Low | P0 | None | No COTTAGELINK references remain |
| 2 | Extract operator.js into module files | Maintainability, future feature velocity | Frontend architecture | Low (operator) High (dev team) | High | P0 | None | operator.js under 2000 lines, modules functional |
| 3 | Add rate limiting to public create-booking endpoint | Security, prevent booking spam | Backend | High (all tenants) | Low | P0 | None | Booking spam attempts return 429 |
| 4 | Fix listUsers pagination in admin-approve-onboarding | Provisioning breaks at >1000 users | Backend provisioning | High (platform scale) | Low | P0 | None | Uses getUserByEmail instead |
| 5 | Enforce locate ticket in dispatch (blocking) | Legal/compliance, OSHA | Hydrovac backend | Critical (hydrovac ops) | Medium | P0 | locate ticket table confirmed deployed | Dispatch blocked without valid ticket |
| 6 | Serve revenue numbers from server aggregate | Reporting accuracy | Dashboard, analytics | High | Medium | P1 | None | Revenue matches actual total, not cache |
| 7 | Replace email-in-URL with signed portal token | Security, PII protection | Customer portal | Medium | Medium | P1 | None | Portal URL contains token, not email |
| 8 | Mobile-first field view for crew | Field adoption, operational use | Frontend, mobile | High (crew members) | High | P1 | Module extraction | Crew can update job status in 3 taps |
| 9 | One-tap job completion from job list | Field efficiency | Frontend | High (operators) | Low | P1 | None | Status update without entering form |
| 10 | Camera-capture photo upload | Field efficiency | Frontend, file upload | High (field operators) | Medium | P1 | None | Photo taken from camera, not file picker |
| 11 | Auto-save indicator in bid workspace | Trust, data safety | Bid module | Medium | Low | P1 | None | Visible "Saved" or "Saving" indicator |
| 12 | Persist snooze state server-side | Follow-up reliability | Follow-up system | Medium | Medium | P1 | None | Snooze survives browser clear |
| 13 | Validate manifest completeness before job close | Environmental compliance | Hydrovac | Critical (hydrovac) | Medium | P1 | waste_manifests table | Job close blocked with incomplete manifest |
| 14 | Equipment inspection expiry alerts | DOT/OSHA compliance | Hydrovac, equipment | High (hydrovac ops) | Medium | P1 | equipment table | 30/60/90-day alerts generated |
| 15 | Unify provisioning into single path | Code maintenance, bug risk | Backend provisioning | Low (visible) High (dev risk) | Medium | P1 | None | One provisioning function used everywhere |
| 16 | Add customer.type field (residential/commercial/municipal) | CRM depth, filtering | CRM | Medium | Low | P1 | None | Customer list filterable by type |
| 17 | Add customer access notes (gate codes, entry instructions) | Job quality, crew efficiency | CRM, jobs | High (recurring operators) | Low | P1 | None | Access notes shown on every job for customer |
| 18 | Schema migration versioning (Supabase CLI) | Database reliability | Infrastructure | Low (visible) High (dev safety) | Medium | P2 | None | Migrations tracked, no more catch-up SQL |
| 19 | Add unit tests for utility functions | Code quality, confidence | Backend, frontend | Low (visible) | Medium | P2 | None | ≥20 unit tests passing |
| 20 | Add integration tests for auth middleware | Security assurance | Backend auth | Low (visible) | Medium | P2 | None | Auth edge cases covered |
| 21 | End-to-end provisioning test | Deployment confidence | Backend provisioning | Low (visible) | Medium | P2 | Test infrastructure | Full tenant creation verified in CI |
| 22 | Post-deployment smoke test script | Deployment reliability | Infrastructure | Medium | Low | P2 | None | Functions reachable and returning 200 post-deploy |
| 23 | Payment state collapse to single operator-facing status | Operator confidence | Payments, onboarding | High | Medium | P2 | None | One clear payment status with action step |
| 24 | Stripe Connect setup in onboarding flow | Revenue enablement | Onboarding, payments | High | Medium | P2 | None | Operators set up Stripe during first-login experience |
| 25 | Business-type-aware primary navigation | UX relevance | Frontend | High | Medium | P2 | Module extraction | Hydrovac operators see hydrovac nav first |
| 26 | Empty state templates for all list views | Trust, onboarding | Frontend | Medium | Low | P2 | None | No blank lists; all have message + action |
| 27 | Inline confirmation components | UX, trust | Frontend | Medium | Medium | P2 | Component library | No window.confirm() calls remain |
| 28 | Consistent error messages (no raw Supabase strings) | Trust, usability | Frontend | High | Medium | P2 | None | All operator-visible errors in plain language |
| 29 | Job status history table and logging | Audit, compliance | Backend, data model | High (compliance ops) | Medium | P2 | None | Every status change recorded with timestamp/actor |
| 30 | Order status history table | Audit, reporting | Backend, data model | Medium | Low | P2 | None | Order lifecycle visible in detail view |
| 31 | Soft delete for jobs, orders, customers | Data safety | Backend, data model | High | Medium | P2 | None | Deleted records recoverable for 30 days |
| 32 | Waste manifest PDF generation | Environmental compliance | Hydrovac | Critical (hydrovac ops) | High | P2 | manifest table | One-click PDF in regulatory format |
| 33 | Emergency callout rate tier | Billing accuracy | Hydrovac, pricing | High (emergency ops) | Medium | P2 | None | Emergency job applies after-hours rate |
| 34 | Confined space entry permit tracking | OSHA compliance | Hydrovac | Critical (hydrovac ops) | High | P2 | permit table | H2S/O2 readings logged per entry |
| 35 | DOT driver qualification expiry alerts | DOT compliance | Hydrovac, team | High (fleet operators) | Medium | P2 | driver_qualifications table | Alerts at 30/60/90 days before expiry |
| 36 | Landscaping route card view | Operational depth | Landscaping | High (landscaping ops) | High | P3 | Route grouping data model | Crew sees all stops in one card |
| 37 | Property note carry-forward | Recurring visit quality | Landscaping, cleaning | High (recurring) | Low | P3 | None | Property notes auto-populate on new job |
| 38 | HVAC equipment asset record | Service depth | HVAC | High (HVAC ops) | Medium | P3 | equipment_assets table | Equipment per address with service history |
| 39 | HVAC refrigerant usage logging | EPA compliance | HVAC | High (licensed techs) | Medium | P3 | equipment_assets table | Refrigerant log per job |
| 40 | Cleaning per-room checklist | Service verification | Cleaning | High (cleaning ops) | Medium | P3 | checklist template system | Checklist completion required to close job |
| 41 | Contractor formal change order approval | Business protection | Contractor | High (remodeling) | High | P3 | Change order table | Customer approves change order via email |
| 42 | Contractor progress billing | Revenue management | Contractor | High (large projects) | High | P3 | Project phases | Invoice by phase completion |
| 43 | Quick job creation from product catalog | Operator efficiency | All verticals | High | Medium | P3 | None | Job created from product in ≤3 taps |
| 44 | Pet record sub-model on customer | Service depth | Pet services | High (pet ops) | Medium | P3 | pet_records table | Vaccination expiry tracked per pet |
| 45 | Bakery quantity-based order entry | Workflow fit | Bakery | High (bakery ops) | Medium | P3 | None | Order captures quantity + deadline |
| 46 | Municipal asset-level service history | Compliance reporting | Hydrovac, property maint | High (municipal contracts) | High | P3 | asset_history table | Per-structure service history with coordinates |
| 47 | Follow-up queue personalized with job details | Conversion rate | Follow-up system | High | Medium | P3 | None | Follow-up email includes job amount and dates |
| 48 | Automated follow-up via scheduled function | Reliability | Follow-up system | High | Medium | P3 | Cron/scheduled function | Follow-ups fire without operator initiating |
| 49 | Offline service worker with write queue | Field reliability | Frontend, PWA | High (field ops) | High | P3 | Module extraction | Job update queued offline, synced on reconnect |
| 50 | AI copilot timeout and graceful degradation | Reliability | AI module | Medium | Low | P3 | None | Copilot shows timeout message after 15 seconds |
| 51 | Model ID as environment variable in ai-copilot | Maintainability | Backend AI | Low | Low | P3 | None | claude-haiku model ID from env var |
| 52 | Customer lifetime value using live query | Reporting accuracy | CRM analytics | High | Medium | P3 | None | LTV from actual payment sum, not stale field |
| 53 | Scheduled function failure alerting | Reliability | Infrastructure | High (silent failures) | Medium | P3 | None | Alert on scheduled function non-zero exit |
| 54 | Server-side pagination for all list views | Scale | Frontend, backend | High (large datasets) | Medium | P3 | None | Lists correctly paginate beyond 50 records |
| 55 | Global search hitting server, not local cache | Feature correctness | Frontend | High | High | P3 | None | Search returns results beyond cached page |
| 56 | CORS restriction to known origins for auth endpoints | Security | Backend | Medium | Low | P3 | None | Auth endpoints reject cross-origin from unknown hosts |
| 57 | Audit trail from all write operations | Compliance | Backend | High (compliance ops) | High | P3 | audit_log table, triggers | Every write has a log entry |
| 58 | Database-level usage counter triggers | Data integrity | Database | Medium | Medium | P3 | None | Counters accurate after every insert/delete |
| 59 | Time entries linked to job cost calculation | Financial accuracy | Job costing | High | Medium | P3 | None | Job cost includes logged time at crew rate |
| 60 | Expose manage-project-phases.js in operator UI | Feature completion | Contractor module | High (contractors) | Medium | P3 | manage-project-phases.js | Phase management visible in job/order UI |
| 61 | Customer portal branded per tenant | Trust, professionalism | Customer portal | High | Medium | P3 | None | Portal shows tenant logo, color, name |
| 62 | Professional invoice template (PDF) | Business operations | Payments, billing | High | Medium | P3 | None | Printable/emailable invoice in professional format |
| 63 | Review request with job-specific copy | Conversion rate | Reviews | Medium | Low | P3 | None | Review request includes job title and date |
| 64 | Delivery day confirmation email for bakery/events | Customer experience | Bakery, events | High (bakery) | Low | P3 | None | Day-before reminder with pickup details |
| 65 | AI copilot visible by default for Growth plan | Feature discoverability | AI, plan gating | High (growth users) | Low | P4 | Plan enforcement | AI tab shown for Growth plan operators |

---

## SECTION 10 — NORTH-STAR DEFINITION

### For the Owner (The Business Decision-Maker)

When Phase 2 is complete, an owner opens ProofLink in the morning and sees in 30 seconds: how much money came in this month, what is owed and by whom, what jobs are scheduled today, and what follow-ups have been waiting too long. No clicking through menus, no calculating from a spreadsheet. The dashboard is a P&L and operations status in one glance.

They can send a professional proposal to a new customer, convert it to a job, collect a deposit, dispatch a crew member, and receive payment — all without leaving ProofLink and without touching a spreadsheet, a text thread, or a separate invoice tool.

When a big month happens, they can see exactly why: which customers drove it, which service types were most profitable, and where the margins were thin. That visibility makes the next month better, not just busier.

### For the Office Operator (Admin/Manager)

The office operator has a clear pipeline view: everything in Request → Bid → Proposal → Order → Job → Invoice → Paid, and they can move records through that pipeline without friction. They can see at a glance which jobs are stalled, which deposits are overdue, and which follow-ups haven't gone out.

They can manage a small team (2-5 people), assign jobs to crew members, see who is on what job, and communicate without leaving the platform. Their day is driven by the follow-up queue and the dispatch board, not by memory and sticky notes.

### For the Field Crew Member

The field crew member opens ProofLink on their phone and sees their three jobs for today: address, customer name, notes, and a "Start job" button. They tap Start, do the work, tap "Add photo," take a picture, tap "Complete." They are not managing a CRM — they are doing their job and recording it in 10 seconds.

When they lose signal on an industrial site, the app still shows their job details from the last sync. When they get signal back, their status update and photos sync automatically.

### For the End Customer

The end customer receives a professional quote email with a clear scope, a total amount, and an "Accept this quote" button. When they accept, they receive a booking confirmation with the date, the business name, and a link to their customer portal.

The portal shows their active job, their quote, any outstanding invoices, and a contact button. It is professional, simple, and branded with the business they hired — it does not look like generic software.

They receive a payment reminder that says "Your project at [address] is complete. Here's your invoice for $[amount]." They pay online in one click.

### For the Hydrovac Compliance-Heavy Operator

Before a truck rolls, the system has confirmed: the 811 locate ticket is valid and not expiring before the job ends, the driver's CDL and medical card are current, the truck passed its last inspection within the required interval, the customer has a current waste profile on file, and the disposal facility has been confirmed open for today's waste type.

During the job, the operator logs material as it fills the tank. When the truck dumps, the manifest is generated in the correct state format with all required fields. When the job is complete, the manifest is signed, the disposal receipt is attached, and the environmental compliance record is closed.

At the end of the month, the operator can produce a complete waste manifest report by customer and by facility for regulatory review. The customer portal shows the municipal client a history of every catch basin cleaned, the date, the volume hauled, and the disposal documentation. No paper, no lost manifests.

### For the Non-Hydrovac Template Operator

**Landscaping:** Their Monday route is a card with 12 properties, the address, the access notes, and the visit checklist. The crew completes each stop, the customer's seasonal notes carry forward, and the monthly billing runs automatically via their recurring plan.

**HVAC:** Every piece of equipment they have ever serviced is in their system with its model, serial number, and service history. When a maintenance agreement is up for renewal, the system tells them 60 days early and drafts the renewal email.

**Cleaning:** Every job has a room-by-room checklist. The crew checks off each room, snaps a photo where required, and the customer receives an "All done — your before and after photos are ready" email when the job is closed.

**Contractor:** Every bid has a formal scope, a change order discipline, and a progress billing milestone. When a change order is needed, the customer gets an email with an approve/decline button. Progress billing generates a partial invoice when a phase is signed off, not at the end of the project.

**Bakery:** Custom orders show up in a production calendar view. Three days before a wedding order is due, the system prompts the owner: "500 cupcakes are scheduled for pickup Saturday. Are you on track?" Order notes include allergen confirmations and the client's contact number for day-of questions.

---

*End of Phase 2 Review Board Report.*
*Total findings: 82. Backlog items: 65. Estimated phase 2 execution horizon: 6-9 months.*
*Next review checkpoint recommended at Phase 2 midpoint (approx. 3 months).*
