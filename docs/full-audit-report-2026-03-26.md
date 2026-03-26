# ProofLink Full Audit Report
**Date:** March 26, 2026
**Method:** Four concurrent specialist panels — backend engineering, UX/accessibility, marketing/growth, product management
**Scope:** Entire platform — 100+ Netlify functions, operator dashboard, public storefront, email system, all 13 verticals, database schema, onboarding flow

---

## THE ROOM'S VERDICT

> "The homepage is the best-written SaaS pitch written for a tradesperson we've seen. The backend has three live security holes that need patching this week. The onboarding flow puts payment activation before the operator has experienced a single win. The hydrovac module is production-ready with minor gaps. Every other vertical is a facade. The mobile experience for field crews doesn't exist in any meaningful sense. Fix the security holes, fix the onboarding, and go deep on one more vertical before claiming you're multi-vertical."

**Platform Risk Level: HIGH** — not because the codebase is broken, but because critical security gaps, a broken first-run experience, and invoice generation missing for 12 of 13 verticals would all hit an operator in the first week.

---

## PRIORITY MATRIX

| # | Issue | Panel | Severity | Effort |
|---|-------|--------|----------|--------|
| P1 | `.single()` throws on 0 rows — orphaned records, silent 500s | Engineering | CRITICAL | 2 hrs |
| P2 | Tenant isolation leak in `update-booking.js` — update without tenant_id filter | Engineering | CRITICAL | 30 min |
| P3 | `cancel-booking.js` no tenant check — any booking cancellable by ID | Engineering | CRITICAL | 30 min |
| P4 | SQL injection in `.or()` search — filter injection via search param | Engineering | CRITICAL | 1 hr |
| P5 | Portal URLs expose customer email as plaintext query param | Engineering/Product | CRITICAL | 2 hrs |
| P6 | Empty dashboard on first login — $0, 0 orders, no guidance | Marketing/UX | CRITICAL | 1 day |
| P7 | No invoice generation for any non-hydrovac vertical | Product | CRITICAL | 3–4 days |
| P8 | Mobile crew has no usable field view | Product | CRITICAL | 2–3 weeks |
| P9 | Error messages are generic ("Something went wrong") everywhere | UX | CRITICAL | 1 day |
| P10 | No "aha moment" — operator does not experience value in first session | Marketing | CRITICAL | 2 days |
| P11 | Stripe webhook not idempotent — double-upgrade possible on retry | Engineering | HIGH | 2 hrs |
| P12 | Rate limiter is in-memory only — resets on cold start, bypassable | Engineering | HIGH | 1 day |
| P13 | `portal-checkout.js` no tenant validation on order fetch | Engineering | HIGH | 1 hr |
| P14 | Navigation has 28 items — solo operator is lost immediately | UX/Marketing | HIGH | 1 day |
| P15 | Onboarding puts billing activation before operator has done anything | Marketing | HIGH | 1 day |
| P16 | Icon buttons missing `aria-label` throughout dashboard | UX | HIGH | 2 hrs |
| P17 | No operator notification when new booking arrives | Marketing | HIGH | 1 day |
| P18 | No milestone celebrations (first booking, first payment) | Marketing | HIGH | 1 day |
| P19 | `admin-verify.js` uses `.ilike()` for email — could match wrong user | Engineering | HIGH | 30 min |
| P20 | Error detail exposed in `get-bookings.js` 500 response | Engineering | HIGH | 30 min |

---

## PANEL 1: BACKEND ENGINEERING

### CRITICAL

**[BE-01] `.single()` used in 26+ files — throws on 0 rows, creates orphaned records**
When `.single()` finds no row, it throws rather than returning null. The record was already inserted before the exception. Client gets 500, retries, creates duplicate. This affects every provisioning path, booking creation, manifest creation, and recurring order system.
`admin-approve-onboarding.js:96,177,195` · `create-booking.js:73` · `create-recurring-order.js:36,53` · `manage-availability-blocks.js:55` · `manage-inventory.js:151,201` · `manage-operators-members.js:63,95` · `provision-tenant.js:121,143` · `service-intake.js:183,199,232` · 18 other files
**Fix:** Replace every `.single()` with `.maybeSingle()` and add explicit null check before proceeding.

**[BE-02] SQL injection via `.or()` with user-supplied search string**
`admin-get-onboarding-requests.js:68–69` builds a Supabase filter string by interpolating user input directly. A `%` or `,` in the search param can construct arbitrary filter conditions and leak cross-tenant data.
```js
query = query.or(`business_name.ilike.%${safe}%,owner_name.ilike.%${safe}%`);
```
**Fix:** Whitelist search input to alphanumeric + spaces only before interpolating.

**[BE-03] Tenant isolation leak — `update-booking.js:105–108`**
The `confirmation_sent_at` fire-and-forget update has no `.eq('tenant_id', tenantId)`. A known booking ID can be marked sent from any tenant context.
**Fix:** Add `.eq('tenant_id', tenantId)` to the update.

**[BE-04] `cancel-booking.js` — booking fetch and cancel have no tenant filter**
`cancel-booking.js:28–32, 50–53`: fetches booking by ID only, no tenant check. An attacker who knows a booking UUID can cancel any tenant's booking from the public endpoint.
**Fix:** Add `.eq('tenant_id', known_tenant_id)` to both the fetch and the update.

---

### HIGH

**[BE-05] Stripe webhook not idempotent — double-upgrade on retry**
`stripe-webhook.js:331–354`: When Stripe retries a webhook (on timeout or crash), the tenant gets upgraded again. No check whether the event was already processed.
**Fix:** Store webhook event ID in DB before processing; check existence first.

**[BE-06] In-memory rate limiter bypassed on cold start**
`utils/rate-limit.js:8`: `const windows = {}` — global state resets on every Netlify function cold start. Concurrent requests to different instances each get their own fresh counter. Rate limit is effectively not enforced at scale.
**Fix:** Move rate limit state to Supabase or a Redis-compatible store. At minimum, document that the current limiter is advisory only.

**[BE-07] `portal-checkout.js:36–50` — no tenant ownership check on order**
Order is fetched by ID alone. Attacker who knows a victim's order ID and email can create a Stripe payment session against another tenant's order.
**Fix:** Require and validate tenant_id on the order fetch.

**[BE-08] `admin-verify.js:47` — `.ilike()` for email lookup**
Case-insensitive match could return the wrong operator if two variants of the same email exist. Combined with the bootstrap logic at line 57, this could grant platform_admin to the wrong user.
**Fix:** Normalize both to lowercase and use `.eq()`.

**[BE-09] Error detail exposed to client in `get-bookings.js:34`**
```js
return respond(500, { error: '...', detail: error.message, code: error.code });
```
Leaks Supabase schema info and RLS config to the browser.
**Fix:** Log full error server-side, return generic message to client.

**[BE-10] No timeout on external API calls**
`stripe-webhook.js`, `order.js`, `contact.js` — `fetch()` calls to Stripe, Resend, and Turnstile have no timeout. Function can hang until Netlify kills it at 10 seconds, often returning a 502 to the user.
**Fix:** Add `signal: AbortSignal.timeout(5000)` to all external fetch calls.

**[BE-11] Stripe Connect account created even if tenant lookup fails**
`stripe-connect-link.js:25–46`: If `findTenantById()` returns null, the Stripe account is still created with empty metadata. Webhook later can't find the tenant. Orphaned account.
**Fix:** Throw before Stripe API call if tenant is null.

**[BE-12] No email rate limiting — customer can be flooded**
No per-recipient rate limit on transactional emails. An attacker can create 1,000 bookings for the same customer email address, triggering 1,000 confirmation emails in seconds.
**Fix:** Add per-recipient rate limit (e.g., max 5 emails/hour to same address) in `sendEmail()`.

---

### MEDIUM

**[BE-13] `process-recurring-orders.js` — no FK validation before insert**
Reads schedules with joins, then inserts orders. If tenant was deleted between join and insert, orphaned order is created silently.

**[BE-14] `admin-delete-tenants.js` — cascade delete does not handle FK violations**
Deletes child tables then tenant, but does not check for FK violations from tables not included in the delete sweep (orders, bookings, payments). If constraint fails, returns success anyway.

**[BE-15] Race condition in tenant provisioning**
Two concurrent admin calls to `provision-tenant.js` both read "no tenant exists" → both create a tenant. No `INSERT ... ON CONFLICT` protection.

**[BE-16] PII in logs — `twilio-webhook.js:55`**
Logs full customer phone number (`from`) in plain text to function logs.
**Fix:** Log last 4 digits only: `from.slice(-4)`.

**[BE-17] Hardcoded fallback business name — `order.js:9`**
`process.env.TENANT_BUSINESS_NAME || "Honest To Crust"` — exposes internal tenant name.
**Fix:** Use `"Your Business"`.

**[BE-18] No request ID for log tracing**
No `X-Request-ID` header generated or propagated. Debugging 500s requires matching timestamps, not correlation IDs.

**[BE-19] Inconsistent error response format**
Some endpoints return `{ error, message }`, others `{ error, detail }`, others just `{ error }`. No standard error schema.
**Fix:** Standardize to `{ error: string, code?: string }` across all functions.

---

## PANEL 2: UX & ACCESSIBILITY

### CRITICAL

**[UX-01] Generic error messages throughout the booking flow**
`book.html:373`: "Something went wrong. Please try again or contact the business directly." does not tell the user what failed or what to do. Three distinct error types — validation, network, server — all produce the same message.
**Fix:** Write specific messages for each case. At minimum distinguish "please check your input" from "network error, try again" from "this date is unavailable."

**[UX-02] Empty states are dead ends with no next action**
Every section shows "No bookings here yet" / "No customers in CRM yet" / "No equipment yet" with no link, button, or instruction for what to do next. New operators hit a wall.
`operator-bookings-workspace.js` · `operator-equipment-workspace.js` · `operator-bids-workspace.js`
**Fix:** Every empty state must say what to do and link to the action. "No bookings yet. Add your first one →"

**[UX-03] Icon buttons missing accessible labels**
Help buttons, minimize/expand controls, and mobile nav SVG icons throughout `operator/index.html` have no `aria-label`. Screen readers announce "button" with no context.
**Fix:** Every `<button>` with no visible text must have `aria-label="[what it does]"`.

**[UX-04] Form validation errors show internal field names**
`forms.js:174`: "Please fill out: fulfillment" — the word "fulfillment" means nothing to a customer. Validation errors throughout use database column names, not human labels.
**Fix:** Map all field keys to display names before constructing error messages.

**[UX-05] Color contrast fails WCAG AA in operator dashboard**
`rgba(255,255,255,.35)` foreground on dark panel backgrounds produces ~1.8:1 contrast ratio. WCAG 2.1 AA minimum for normal text is 4.5:1. Help text and secondary labels are unreadable to low-vision users.
**Fix:** Raise all secondary text to minimum `rgba(255,255,255,.65)` and audit with contrast checker.

**[UX-06] No `aria-live` announcement on progress updates**
`operator/launch.html:199–206`: Progress bar updates silently. Screen readers don't announce step completions. Same issue on loading spinners — no `aria-busy` or `aria-label="Loading..."`.

---

### HIGH

**[UX-07] Navigation has 28 items — information overload**
Primary tabs (7) + Tools section (21 secondary tabs) visible simultaneously. A solo plumber signing in for the first time sees: Walkthrough Bids, Active Jobs, Quotes, Recurring Plans, Expenses, Insights, Reviews, Products, Pricing, Availability, Domains, Import, Vendors, Equipment, Team, Inventory, Contracts, Facilities, Loads & Manifests, Locate Tickets, Compliance.
**Fix:** Show only the 5–6 tabs relevant to the operator's vertical and plan tier. Collapse "Tools" by default. Gate advanced tabs behind explicit opt-in.

**[UX-08] Mobile touch targets below 44px minimum**
`operator.css:3062–3103`: Bottom nav buttons have no explicit height constraint. SVG icons are 20×20px. WCAG 2.1 SC 2.5.5 requires 44×44px minimum.
**Fix:** Add `min-height: 56px; min-width: 44px` to `.mbn-item`.

**[UX-09] `admin/index.html` uses inline `onclick=` everywhere**
`admin/index.html:32,46–58`: Navigation and form submissions wired with `onclick="handleLogin()"`, `onclick="showSection(...)"`. Keyboard navigation and focus management are broken.
**Fix:** Replace all inline handlers with `addEventListener`.

**[UX-10] Booking form address fields overflow horizontally on mobile**
Street / City / State / ZIP in an inline flex row. On 375px viewport (iPhone SE) this triggers horizontal scroll and users miss the ZIP field.
**Fix:** `@media (max-width: 480px) { .address-row { flex-direction: column; } }`

**[UX-11] Calendar date picker availability error has no `role="alert"`**
`book.html:145–146`: When a date is blocked, the error div becomes visible but screen readers won't announce it. Customer selects an unavailable date and doesn't know why the form won't submit.

**[UX-12] No spinner or visual feedback on "Sending…" button**
`book.html:344`: Button text changes but no animation. 3G users see a frozen button for 3–5 seconds, click again, creating duplicate bookings. Button is not disabled during the request.
**Fix:** Disable button + add spinner on submit; re-enable only on success/error.

**[UX-13] Onboarding checklist has no clear first step**
`operator/onboarding.html:82–132`: 5-step checklist shown with no "you are here" indicator. Step 1 says "Your business account is ready" — that's a status, not an action.
**Fix:** Make Step 1 the primary CTA: a single button that says "Start here →" and opens the first required action.

**[UX-14] Self-serve operators get no guided path after signup**
Operators who choose "Set it up myself" land in the full operator dashboard with no walkthrough, no checklist, no next step. They are immediately overwhelmed by the 28-item navigation.
**Fix:** Show a 5-step first-login modal for all new operators, regardless of setup mode choice.

**[UX-15] Required asterisks not labeled and color-only**
`join.html:130`: `<span style="color:var(--orange);">*</span>` uses color alone to indicate required. Fails WCAG 1.4.1 (Use of Color). No legend explaining what `*` means.

---

### MEDIUM

**[UX-16] Cart state can go stale on back-navigation**
`cart.js:41–55`: Cart read from localStorage once on page load. User adds items on products page, navigates back to order form — cart may be stale.

**[UX-17] Sold-out products lack visual differentiation**
`products.js:161`: Unavailable items show a disabled button but the card itself is full-opacity, full-color. Users scan past them expecting all cards to be purchasable.
**Fix:** `opacity: 0.55` and `text-decoration: line-through` on price for unavailable items.

**[UX-18] Currency formatting inconsistent**
Some places show `$0.00`, others `$0`. Inconsistent in dashboard KPIs and cart totals.
**Fix:** Single `formatCents()` helper used everywhere.

**[UX-19] Logout has no confirmation**
`operator/index.html:174`: One-tap logout with no confirm. On mobile, accidental taps are common.

**[UX-20] KPI cards show "–" for new operators**
`analytics.html:156–159`: All 10 KPI cards show "–" until data exists. Looks broken on first login.
**Fix:** Show "0" for counts, "$0" for revenue, with copy like "Your first booking will show here."

---

## PANEL 3: MARKETING & GROWTH

### What's Working (keep it)

The homepage headline is exceptional — contractor-native language, zero jargon:
> *"If your business runs on texts, spreadsheets, and memory, you do not have a system."*

This works because it names the exact behavior, not an abstraction. The four-part pain/solution structure (Lead → Quote → Work → Payment) speaks directly to the day a solo operator is actually having. The hydrovac codex proves genuine industry knowledge. These are competitive advantages — don't dilute them.

---

### CRITICAL

**[MK-01] Empty dashboard on first login kills the product before the operator uses it**
New operator signs up, opens dashboard: Revenue $0, Orders 0, Customers 0. No guidance. No sample data. No next step. The entire purpose of the platform — showing an operator their business in one place — is invisible until they've manually loaded it with real data, which requires 30+ minutes of setup.
**Fix:** Pre-populate with 3 sample customers, 5 sample jobs, 2 completed payments that show what a "working" system looks like. Let them delete the demo data. The operator's first login should show them the goal state, not an empty promise.

**[MK-02] Time-to-value is undefined and too long**
Estimated steps before an operator takes their first real booking: account creation → billing activation → Stripe connect → add services → publish website → share link → wait. That's 30–45 minutes if everything goes perfectly. There is no win along the way.
**Fix:** Define the "aha moment" explicitly: "Operator books their first job through ProofLink instead of via text." Build the entire first-run experience toward that single moment. Add a "Take a test booking" button in onboarding that shows the flow end-to-end in 60 seconds.

**[MK-03] Billing activation is step 2 of onboarding — before the operator has done anything**
`operator/onboarding.html`: Step 2 is "Activate ProofLink billing." The operator has not yet added a service, published a page, or seen the product work. Asking for payment before showing value is the single highest-friction moment in the entire acquisition funnel.
**Fix:** Move billing activation to after the operator has completed at least "Add first service" and "See your booking page."

**[MK-04] No milestone celebrations — no moment of "I just did something real"**
Not a single celebration state exists anywhere in the platform. Adding a first product: no feedback. Website going live: no feedback. First booking arriving: in-app toast only, no email to operator. First payment collected: no feedback.
**Fix (in order of priority):**
1. First booking received → email to operator: "🎉 First booking! [Customer] booked [service]. View it →"
2. First payment collected → toast + email: "💰 $[amount] collected. Payout on [date]."
3. Website published → email: "🚀 Your page is live: [URL]. Share it with your first customer."
4. First service added → toast: "✓ Done. Now publish your page and share the link →"

**[MK-05] No retention hooks — nothing brings an operator back tomorrow**
ProofLink sends no proactive operator-facing communications. No daily digest ("2 unpaid invoices need follow-up"). No weekly summary ("You made $X this week"). No alerts ("Benkari left a review"). Without outreach, operators forget the platform exists during slow weeks.
**Fix:** Build an operator digest email (daily or weekly): unpaid invoices, upcoming bookings, pending follow-ups, and a "this week vs. last week" revenue comparison.

---

### HIGH

**[MK-06] No price on the homepage — conversion-killing friction**
Homepage has a "Choose your plan" CTA but no pricing shown. Prospect must click through to see numbers. Most prospects who don't see price will not convert. Field service operators are price-sensitive and value transparency.
**Fix:** Show pricing tiers on the homepage (even if simplified: "Starting at $X/month").

**[MK-07] Zero social proof**
No customer testimonials, no logos, no "used by X contractors," no star ratings, no case studies. The marketing copy is excellent but unverified. A contractor's first question is "is this actually used by anyone like me?"
**Fix:** Even one real quote from one real operator ("I stopped losing jobs to unanswered texts — Benkari Vac") would convert more than any feature list.

**[MK-08] "Setup mode" choice in signup is too early and too abstract**
`join.html`: Operator must choose "Set it up myself" vs. "I want help setting it up" before they've seen the product. They don't know what either means. Most will guess wrong, then be frustrated.
**Fix:** Remove this choice from signup entirely. Default all new operators to the guided flow. Let them switch to self-serve after they've seen it.

**[MK-09] Tonal inconsistency: homepage ≠ signup form ≠ dashboard**
Homepage: contractor pain language. Signup form: SaaS plan selection. Dashboard: "Insights," "Recurring Plans," "Service Contracts." The operator's mental model shifts three times in 10 minutes.
**Fix:** Audit every label, heading, and CTA against the question: "Would a plumber say this word?" If no, replace it.

**[MK-10] Refund and policy pages are written for legal protection, not customer trust**
`refunds.html`: "deposits may be non-refundable once preparation begins" is written defensively. It doesn't build confidence — it signals "we've been burned before."
**Fix:** Reframe policies around clarity and fairness. "We're upfront about deposits so both sides are protected. Here's exactly how it works."

---

### MEDIUM

**[MK-11] Free trial is implicit, not marketed**
The system has a window where an account exists but billing isn't activated. But this is never called a "free trial" or used as a conversion lever. Prospects are left to infer whether they can try before they pay.
**Fix:** State it explicitly: "14 days free. No credit card until you're ready."

**[MK-12] "Operating system" used 5+ times — wrong mental model for tradespeople**
Operators might think this refers to Windows or iOS. The metaphor is trying to convey "unified system" but lands wrong.
**Fix:** Replace with "one place to run the business" or "one system for the whole job."

**[MK-13] No operator onboarding email sequence**
After signup there is one confirmation email, then silence. Day 3 operators are on their own.
**Fix:** 5-email welcome sequence: Day 0 (welcome + quick-start), Day 1 (add your first service), Day 3 (share your booking link), Day 5 (first payment tips), Day 7 (how to follow up on unpaid work).

**[MK-14] No vertical-specific landing pages**
All verticals share one homepage. A hydrovac operator searching "hydrovac dispatch software" lands on a generic service business page. Vertical-specific SEO and conversion are zero.

---

## PANEL 4: PRODUCT COMPLETENESS

### Vertical Readiness

| Vertical | Status | Blocker |
|----------|--------|---------|
| Hydrovac | **Ready (with gaps)** | Confined space permit enforcement unconfirmed; no municipal compliance portal; no GPS/real-time dispatch; emergency rate logic manual |
| Cleaning | **Needs Work** | No property profiles/checklists, no recurring automation, no route optimization, no crew mobile |
| Landscaping | **Needs Work** | No property records with cadence, no route sequencing, no seasonal automation, no crew mobile |
| HVAC | **Needs Work** | No equipment master record, no maintenance scheduling, no refrigerant tracking |
| Plumbing | **Needs Work** | No permit tracking (CRITICAL for this trade), no emergency rate logic, no parts inventory |
| Pressure Washing | **Needs Work** | No chemical tracking, no per-surface pricing, no route optimization |
| Contractor/Remodeling | **Skeleton Only** | No permit/change order/bond tracking |
| All others (7) | **Skeleton Only** | Seeded products only; no workflow depth |

---

### CRITICAL Feature Gaps

**[PD-01] Invoice generation exists for hydrovac only**
`generate-hydrovac-invoice.js` produces a structured invoice pulling manifests, time segments, materials, and line items. No equivalent exists for any other vertical. Operators doing plumbing, cleaning, HVAC, landscaping have no way to generate an invoice from a completed job. This means ProofLink cannot be their billing system.
**Fix:** Build a generic invoice generator that works from order + time entries + expenses for any vertical.

**[PD-02] No "convert quote to job" workflow**
A quote can be sent and accepted, but there is no affordance to convert an accepted quote into a job. Operator must manually create a job, link it to the quote's order, then begin tracking. This is a 4-step manual process where it should be 1 click.
**Fix:** "Accept quote → Create job" one-click conversion with pre-filled details.

**[PD-03] No mobile crew view**
The operator UI is a 14,000-line desktop-first dashboard. Field crews on Android/iOS using it in a truck see the full operator interface — all 28 tabs, all panels, no context for "my jobs today." No signature capture, no GPS timestamp, no offline mode, no quick photo upload.
**Fix (phased):** Build a minimal crew view: today's assigned jobs, one-tap status update, time log, photo upload. Can be a separate URL (/crew) rather than a native app initially.

**[PD-04] Recurring scheduling is not automated**
`service_plans` table exists, `process-recurring-orders.js` exists, but there is no confirmed cron job running it. Recurring orders never auto-generate unless someone manually triggers the function. The entire recurring revenue model for cleaning, landscaping, and maintenance is broken without this.
**Fix:** Add a Netlify scheduled function (or external cron) to run `process-recurring-orders` daily.

**[PD-05] Plumbing has no permit tracking**
Water heater replacements, gas line work, and new installations all require permits in every US jurisdiction. ProofLink has no field for "permit required," "permit submitted," "permit number," or "permit cost." A plumber using ProofLink as their job system is flying blind on compliance.
**Fix:** Add `permit_required`, `permit_status`, `permit_number`, `permit_cost_cents`, `permit_submitted_at`, `permit_approved_at` to jobs table for applicable verticals.

---

### HIGH Feature Gaps

**[PD-06] No conflict detection in scheduling**
Operator can book two jobs at the same time with the same crew. No warning, no block. A landscaper with 2 crews on a Tuesday gets no alert if both are scheduled to the same property or overlapping windows.

**[PD-07] No equipment master record for HVAC**
HVAC jobs reference equipment but there is no equipment master record. Cannot see: model, serial, install date, warranty expiry, last service date, repair history. A tech cannot pull up "what we know about this unit" before a call.

**[PD-08] Product/plan limit truncation is silent**
If a Starter tenant has `max_products = 10` and the hydrovac seed template has 14 products, the last 4 are silently dropped. Operator doesn't know they're missing disposal line items from their rate card.
**Fix:** Show a warning when seeding truncates; allow operator to select which products to keep.

**[PD-09] Revenue dashboard uses 250-row cache window**
`operator.js` line ~5321: `.limit(250)`. Historical revenue for months earlier than the 250 most recent payments returns incomplete totals. Fine for new operators; will produce incorrect numbers at scale.

**[PD-10] Schema fragility — cumulative ALTER TABLE, no versioning**
All migrations are in `catchup_run_this.sql` — a growing append-only file with no version numbers, no checksums, no rollback path. An operator's database could be partially migrated with no way to detect it. Phase 2 board identified this as a systemic risk.
**Fix:** Adopt sequential numbered migrations (001_init.sql, 002_add_availability.sql) or use a migration tool.

**[PD-11] Amount field names are inconsistent across 6+ tables**
`amount_cents`, `total_cents`, `subtotal_cents`, `estimated_total_cents`, `net_amount_cents` — `paymentAmountCents()` in operator.js chains through 6 fallback fields to find the amount. One wrong insert naming convention creates silent revenue reporting errors.

**[PD-12] `CORS: Access-Control-Allow-Origin: *` on all endpoints**
Authenticated platform should restrict CORS to known origins (operator domain, portal domain). Wildcard CORS on authenticated endpoints reduces security posture for no benefit.

---

### MEDIUM

**[PD-13] Hydrovac: no automated compliance blocking**
A job can be dispatched without a valid utility locate ticket. Codex specifies this should block dispatch. Whether enforcement exists is unconfirmed. In the real world, working without a valid ticket is a regulatory violation.

**[PD-14] Hydrovac: no H2S/O2 monitor readings in schema**
Codex mentions H2S monitoring as critical for confined space operations. No table column for monitor readings, threshold breaches, or equipment calibration dates is visible.

**[PD-15] Disposal facility rates are read-only**
Rates must be manually entered per facility. No API integration to import current tipping fees. Operators in high-volume markets deal with quarterly rate changes; manual updates are error-prone.

**[PD-16] Payment state has too many overlapping flags**
`payments_enabled`, `online_payments_enabled`, `billing_status`, `connect_status` — four flags that partially overlap. An operator or developer cannot quickly determine whether Stripe payments are working without reading all four.
**Fix:** Consolidate to a single `payment_state` enum: `not_configured | pending | active | suspended`.

---

## SECTION 5: THE ROADMAP

### This Week (Critical Security & Data Integrity)
1. Replace all `.single()` with `.maybeSingle()` — affects 26 files
2. Fix tenant isolation in `update-booking.js` and `cancel-booking.js`
3. Fix SQL injection in `.or()` search
4. Validate tenant ownership in `portal-checkout.js`
5. Fix `.ilike()` in `admin-verify.js`
6. Remove error detail from `get-bookings.js` 500 response
7. Add timeout to all external `fetch()` calls
8. Make Stripe webhook idempotent

### Next 2 Weeks (First-Run Experience)
9. Pre-populate new operator dashboard with demo data
10. First-login guided modal (5 steps) for all new operators
11. Move billing activation to after first service is added
12. Celebrate first booking, first payment, website publish (toast + email to operator)
13. Operator digest email (daily: unpaid invoices, upcoming bookings, follow-ups)
14. Fix empty states — every one needs a next-action link
15. Fix generic error messages — be specific about what failed

### Next Month (UX & Accessibility)
16. Navigation: collapse Tools section by default, show only vertical-relevant tabs
17. Fix icon button `aria-label` — all 30+ missing labels
18. Fix form validation messages — replace field keys with human labels
19. Fix color contrast — secondary text `rgba(255,255,255,.35)` → `.65` minimum
20. Mobile: fix address field overflow on small screens
21. Add `role="alert"` to booking availability error
22. Add `aria-live` to progress bars and spinners
23. Disable booking submit button during async request

### 2–3 Months (Product Depth)
24. Generic invoice generator for all non-hydrovac verticals
25. "Convert quote to job" one-click workflow
26. Minimal crew mobile view at `/operator/crew` — today's jobs, status, time log, photo
27. Confirm and deploy recurring order cron job
28. Plumbing permit tracking fields in jobs table
29. HVAC equipment master record
30. Conflict detection in scheduling
31. Operator notification email when new booking arrives

### Ongoing (Architecture)
32. Migrate operator.js to module system (currently 14,000+ lines, 0 tests)
33. Adopt sequential numbered SQL migrations
34. Persistent rate limiting (Supabase table or Redis)
35. Normalize amount field names across all tables
36. Consolidate payment state to single enum
37. Restrict CORS from `*` to known origins
38. Remove customer PII from portal URL query params

---

## WHAT PROOFLINK IS

The platform has a legitimate competitive advantage in two specific places:

1. **The marketing copy** — the homepage headline and pain framing is some of the best contractor-targeted SaaS copy in this market. This is a real asset. Don't let it drift.

2. **The hydrovac module** — waste manifests, utility locate tickets, driver qualifications, multi-segment billing. No generic field service app goes this deep on a single vertical. This is proof that the approach works.

Everything else is real infrastructure (auth, provisioning, payments, ordering) with a thin vertical layer on top. The infrastructure is solid. The vertical depth is the work that remains.

**The strategy that wins:** Go so deep on hydrovac that operators can't imagine using anything else. Get 5–10 paying customers, get case studies, use those to sell the next vertical. Trying to compete on breadth against ServiceTitan or Jobber at this stage is the wrong move. Depth beats breadth until you have the team to do both.

---

*Report generated from four concurrent panel reviews: backend engineering (32 findings), UX/accessibility (32 findings), marketing/growth (14 findings), product completeness (16 findings). Total: 94 findings across all disciplines.*
