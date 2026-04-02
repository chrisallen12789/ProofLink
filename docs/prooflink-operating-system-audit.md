# ProofLink Operating System Audit

Date: 2026-03-19

Historical snapshot: this audit reflects the system shape captured on March 19, 2026. Confirm current schema, functions, and tests against live code, `AGENTS.md`, and `sql/readme.md` before using it as an implementation contract.

This document defines the exact implementation work required to make ProofLink behave like a small-business operating system instead of a set of adjacent tools.

## Section 1: Current-State Gap Analysis

- `No first-class lead record.` User pain: service inquiries, quote requests, and website requests do not enter operations in a consistent way. Root cause: public intake currently centers on `submit-onboarding-request` and storefront order submission through `netlify/functions/supabase-order-proxy.js`, while the main schema only has `customers`, `orders`, `payments`, and `customer_interactions` in `sql/catchup_run_this.sql`. Implementation fix: add a `leads` table plus one canonical intake API that can create `lead`, `customer`, `order_request`, or `service_request` depending on the submission type. Expected operational result: every website interaction becomes an actionable record with an owner, status, and next step.

- `Bids are operationally important but not yet first-class backend records.` User pain: walkthrough bid work can feel excellent in-session but fragile across browsers, devices, team members, and reporting. Root cause: the operator bid flow is implemented strongly in `operator/operator.js`, but the audited schema does not include `bids`, `estimates`, `proposals`, or `bid_photos` tables. Implementation fix: add persistent `bids`, `bid_line_items`, `bid_photos`, `bid_versions`, and `bid_delivery_events` tables with tenant-scoped APIs. Expected operational result: bids become searchable, shareable, reportable business records instead of local-only workflow state.

- `Orders are carrying too much meaning.` User pain: the operator cannot instantly tell whether something is a lead, quote, booked job, completed job, or invoice-backed work item. Root cause: `orders` in `sql/catchup_run_this.sql` are being used as the main work object, but the table only has a narrow status set and storefront-shaped fields such as `items`, duplicated contact data, and `source_type/source_ref`. Implementation fix: keep `orders` for committed revenue events, add a first-class `jobs` record for scheduled/field execution, and let `bids` convert into `orders` and optionally spawn `jobs`. Expected operational result: sales, work, and payment states become understandable without overloading one object.

- `Customer records are too thin for service operations.` User pain: operators still need memory, texts, or external notes to understand the customer, location, job context, and how to follow up. Root cause: `customers` only carry basic contact fields and light aggregates. There is no model for multiple contacts, service address, billing address, property notes, access instructions, or lead source. Implementation fix: extend `customers` and add child tables for `customer_contacts`, `service_locations`, and `customer_tags`. Expected operational result: the customer record becomes the real account hub for service delivery.

- `Payment state is not normalized into accounts-receivable visibility.` User pain: owners cannot instantly answer "what work is unpaid," "what is overdue," or "what is partially paid" without mentally reconciling orders and payments. Root cause: `payments` are flexible, but order-level receivable state is not derived and surfaced as a first-class business status. The live payment state helper in `netlify/functions/_prooflink_payments.js` is tenant-billing oriented, not work-billing oriented. Implementation fix: add order/job payment summary fields or a materialized summary view, plus backend logic to derive `unpaid`, `partial`, `paid`, `overdue`, `refunded`, and `deposit_due`. Expected operational result: money owed becomes visible at the work record, customer record, and dashboard level.

- `Expenses are not linked strongly enough to operational work.` User pain: margin visibility is weak because expenses cannot reliably be tied to jobs, materials, or reimbursable work. Root cause: `expenses` currently capture vendor, category, description, and amount, but no `job_id`, `order_id`, `customer_id`, billable flag, or usage outcome. Implementation fix: add safe nullable linkage fields plus expense status and classification fields. Expected operational result: operators can see job profitability, material overages, and overhead separately.

- `Launch readiness is setup-first instead of outcome-first.` User pain: new users are told to connect Stripe and customize storefronts before they experience the core value of running the business. Root cause: the live checklist in `netlify/functions/get-launch-checklist.js` measures products, Stripe connection, and storefront customization instead of first customer, first bid/job, and first payment. Implementation fix: replace the launch checklist with a workflow checklist tied to the first completed operating cycle. Expected operational result: onboarding proves the product quickly and reduces abandonment.

- `The public join flow behaves like an application queue.` User pain: pricing feels less concrete and the transition from interest to active use is softer than it should be. Root cause: `join-page.js` persists plan intent and submits a provisioning request, then explicitly tells the user they are not paying yet. Implementation fix: keep provisioning where needed, but introduce a direct paid path for plans that are checkout-ready and a clear post-purchase route into guided onboarding. Expected operational result: plan value, buying motion, and first-run setup feel connected.

- `Website-to-operations is strong for storefront orders and weak for service intake.` User pain: service businesses still risk dead-end inquiries and manual transfer into the operator. Root cause: `netlify/functions/order.js` and `netlify/functions/supabase-order-proxy.js` only solve a storefront order shape. Implementation fix: add a service-intake endpoint and intake routing rules so requests become the right operational object by business profile. Expected operational result: no inquiry arrives without entering the pipeline.

- `The operator experience is improving but still module-heavy.` User pain: users can still feel like they are navigating a product suite instead of moving a business workflow forward. Root cause: the operator has many useful tabs, but there is not yet one dominant "work pipeline" screen and one dominant "today" view across business types. Implementation fix: make pipeline and next actions primary, relegate configuration to secondary surfaces, and let profile-aware modules appear as subordinate tools. Expected operational result: operators feel in control faster and click less.

- `Scheduling is implied more than modeled.` User pain: booked work can still feel clunky to assign, plan, and track in the field. Root cause: there is availability data and `scheduled_date/time` on orders, but no first-class job schedule object with assignee, window, dispatch, arrival, completion, and reschedule history. Implementation fix: add `jobs`, `job_assignments`, and `job_events` tables plus corresponding UI. Expected operational result: the product can own field execution, not just order capture.

- `Reporting is broad enough to distract but not normalized enough to guide action.` User pain: operators can see data but may still not know what requires attention today. Root cause: reporting is spread across cached operator summaries instead of a small, derived operational metrics layer. Implementation fix: define a tight reporting contract around revenue, outstanding payments, active jobs, pipeline load, and recent customer activity only. Expected operational result: the dashboard becomes a control panel instead of a data wall.

- `Mobile usefulness is currently concentrated in the walkthrough bid flow.` User pain: field users may still need desktop behavior for too many daily actions. Root cause: the mobile-first thinking is strongest in bid capture, but not yet consistently applied to job check-in, payment capture, scheduling updates, or quick customer lookup. Implementation fix: identify the top mobile actions and harden them as one-handed workflows with large controls and minimal typing. Expected operational result: ProofLink becomes the operator's field tool, not just the back office.

## Section 2: Prioritized Build Roadmap

- `Phase 1: Canonical Business Pipeline.` Goal: establish one authoritative lifecycle from intake to paid work. Why it matters: without a canonical flow, every later feature multiplies confusion and duplicate entry. Exact areas affected: schema, intake APIs, operator pipeline UI, dashboard summaries, customer linking, status model. Expected product outcome: every new business event enters one visible pipeline and moves forward without record ambiguity.

- `Phase 2: Remove Manual Transfer Work.` Goal: eliminate re-entry between website, CRM, bids, jobs, and payments. Why it matters: manual copying is the fastest way to make operators abandon the system. Exact areas affected: website forms, intake routing, customer dedupe, bid conversion, order/job creation, payment posting, expense linkage. Expected product outcome: one action creates the next record automatically when business rules allow it.

- `Phase 3: Make Work and Money Obvious.` Goal: turn the operator UI into a control surface for job state and receivables. Why it matters: businesses stay in tools that tell them what needs attention right now. Exact areas affected: order/job cards, payment badges, overdue logic, customer detail summaries, dashboard widgets, pipeline board. Expected product outcome: unpaid work, overdue items, active jobs, and blocked records become impossible to miss.

- `Phase 4: First-Run Activation and Pricing Clarity.` Goal: align onboarding, plan purchase, and plan value with the first successful business cycle. Why it matters: weak onboarding and unclear pricing reduce trust before the product proves itself. Exact areas affected: landing page, pricing cards, join flow, checkout routing, onboarding checklist, success states. Expected product outcome: users understand what ProofLink replaces, choose a plan confidently, and complete first value quickly.

- `Phase 5: Mobile Field Execution.` Goal: make the most frequent service-business actions fast on a phone. Why it matters: if field operators cannot use the system under pressure, the office will still end up reconstructing the truth later. Exact areas affected: customer lookup, bid photo capture, job arrival/completion, quick notes, payment entry, expense entry, schedule changes. Expected product outcome: the phone becomes the live source of operational truth.

- `Phase 6: Vertical Hardening and Tier Enforcement.` Goal: apply business-profile logic and plan gating without fragmenting the product. Why it matters: ProofLink must feel specific to the business while remaining maintainable. Exact areas affected: architecture resolver, onboarding defaults, module visibility, proposal templates, inventory behavior, plan locks, upsell surfaces. Expected product outcome: each business type sees the right workflow depth without losing the shared operating backbone.

## Section 3: System Design Requirements

### A. Unified Data Model

- `Tenant` is the root scope for all business records. Every core table must include `tenant_id` with an enforced foreign key and index.
- `Lead` is the first record for non-committed inbound activity. A lead may come from website forms, manual entry, phone intake, QR code, referral imports, or converted bids. A lead must have `id`, `tenant_id`, `source_type`, `source_ref`, `status`, `owner_operator_id`, `customer_id nullable`, `service_location_id nullable`, `summary`, `requested_service_type`, `created_at`, `last_activity_at`.
- `Customer` is the durable account record. There must be one primary source of truth for customer identity, with dedupe rules by normalized email and phone plus merge support instead of duplicate creation paths.
- `Bid` is the pre-commit commercial record. It must link to exactly one `customer_id` once known, may start from `lead_id`, and must carry status, version, scope notes, money totals, approval state, and a generated client-facing proposal view.
- `Order` is the committed commercial record. It represents accepted work or a confirmed transaction. Orders may be created from storefront checkout, approved bids, or manual office entry. Orders must not exist as a substitute for a lead when pricing is still unresolved.
- `Job` is the execution record. One order may create one or many jobs depending on service model. Jobs carry schedule, assignee, work status, location, proof, and completion timestamps.
- `Payment` must link to `order_id` and optionally `job_id` when payment is collected in the field. It may also link to `customer_id` for reporting, but the receivable source of truth is the order.
- `Expense` must link to `job_id`, `order_id`, or `customer_id` when applicable, or be explicitly marked `overhead` when not linked.
- `Interaction` must be generic and append-only. Leads, customers, bids, orders, and jobs should all be able to emit interaction records or activity events.
- `Product` and `service offering` should stay unified where possible, but the schema must support service-specific pricing structures and material usage without forcing retail inventory behavior onto service businesses.
- `Source of truth rule.` Customer identity lives on `customers`. Commercial totals live on `bids` and `orders`. Execution truth lives on `jobs`. Payment truth lives on `payments` plus derived receivable summaries. Do not duplicate primary state across unrelated tables except for cached summaries that are explicitly denormalized.

### B. Workflow Pipeline

- `Canonical pipeline:` `Lead -> Quoted -> Booked -> In Progress -> Completed -> Paid`.
- `Lead` entry paths: website inquiry, manual office entry, phone intake, imported request, converted storefront quote request.
- `Quoted` is reached when a bid exists and has been prepared or sent.
- `Booked` is reached when the bid is approved or a direct order is confirmed.
- `In Progress` begins when a job starts, a crew is dispatched, or the operator marks work underway.
- `Completed` is reached when the job is completed and proof is captured.
- `Paid` is reached only when the order receivable balance reaches zero.
- `Pipeline movement rules.` Each state transition must be evented, timestamped, and optionally automated. Every transition should be triggered by a concrete action such as `send proposal`, `approve bid`, `schedule job`, `start job`, `complete job`, `record payment`.
- `Exit rules.` Closed records remain searchable and reportable. Canceled work and lost bids need explicit terminal statuses instead of disappearing.
- `UI implication.` The operator home should show the pipeline counts and a worklist for the next blocked items in each state.

### C. Payment Linkage

- Payments must attach to an `order_id`. If the payment is collected during a visit, also attach `job_id`.
- Every order needs derived fields or a summary view for:
  - `order_total_cents`
  - `amount_paid_cents`
  - `amount_due_cents`
  - `payment_state`
  - `due_date`
  - `deposit_required_cents nullable`
  - `deposit_paid_cents`
- `payment_state` must normalize to: `unpaid`, `deposit_due`, `partial`, `paid`, `overdue`, `refunded`, `void`.
- The customer record must surface total outstanding balance across open orders.
- Job cards must show payment state inline so field operators know whether to collect payment, confirm deposit, or avoid duplicate collection.
- Payment methods must not assume Stripe. Support `cash`, `check`, `ach`, `zelle`, `venmo`, `card_present`, `card_online`, `financing`, `other`.
- UI implication: every order and customer detail view needs one visible money rail showing total, paid, due, status, payment method history, and the next money action.

### D. Website to Operations Flow

- Every public form must declare its outcome type: `lead`, `quote_request`, `direct_order`, `contact_request`, or `subscribe`.
- The form endpoint must create a canonical intake event first, then route it into the correct business record.
- `Direct storefront order` should continue creating an order immediately.
- `Service quote request` should create a lead, optionally attach or create a customer, and place the record in `Lead`.
- `Contact request` should create a lead or follow-up task, not just send an email.
- `Subscribe / join` should either create a billing/customer account followed by onboarding or create a tracked rollout request if enterprise/manual review is required.
- No public submission may terminate as email-only. Email notifications are secondary outputs, not the record of truth.
- Each intake event must carry UTM/source metadata and the page/context it came from so website activity remains connected to operations and reporting.

### E. Onboarding

- The first-run onboarding goal is `first completed order`, not `customize everything`.
- Recommended sequence:
  1. Confirm business profile and operating defaults.
  2. Add first service or import starter template.
  3. Add first customer or accept first lead.
  4. Build and send first bid or create first direct order.
  5. Schedule and complete the work.
  6. Record payment.
  7. Review "you just ran your first job in ProofLink."
- Each step must be embedded in the actual workspace, not in disconnected modal education.
- The onboarding engine should reveal only the next required action and explain why it matters in one sentence.
- Stripe or online payments should be optional during early onboarding unless the business explicitly needs them.
- Storefront customization should be deferred until after the operating loop is proven.

### F. Mobile Usability

- The most critical mobile actions are:
  - find a customer
  - create or continue a walkthrough bid
  - capture named photos with notes
  - schedule or reschedule work
  - start job
  - complete job with proof
  - log payment
  - log expense
  - add quick internal note
- These actions must work with one hand, large tap targets, sticky primary actions, and minimal typing.
- Every mobile record screen needs a visible primary action at the bottom such as `Add photo`, `Start job`, `Record payment`, or `Complete job`.
- Camera capture should support immediate naming, note entry, category tagging, and offline-safe draft state until sync completes.
- Customer and job headers should show phone, address, next action, and money state without scrolling.

### G. Reporting

- Reporting must stay limited to:
  - revenue this period
  - outstanding payments
  - active jobs
  - pipeline load by stage
  - recent customer activity
- Do not lead with vanity charts.
- Each reporting card must answer one decision:
  - what money is due now
  - what work is blocked
  - what needs scheduling
  - who has gone quiet
- Provide drill-down lists beneath summary numbers instead of broad analytics pages first.
- Advanced reporting should be additive later, not required to understand the business today.

## Section 4: UI/UX Changes

- `Replace tab-first orientation with workflow-first orientation.` The operator home should open on `Today`, showing pipeline stage counts, unpaid items, due-today jobs, overdue work, and the next recommended action.
- `Add a pipeline board view.` Show `Lead`, `Quoted`, `Booked`, `In Progress`, `Completed`, `Paid` as columns or filter chips with card counts and quick actions. This becomes the main navigation surface for operators.
- `Unify the customer record.` Create one customer detail layout with top summary, money rail, open work, past work, contacts, service locations, notes, and activity. Remove the feeling that customers, bids, and orders are separate worlds.
- `Make payment state impossible to miss.` Every order/job card must show a payment pill such as `Unpaid`, `Deposit due`, `Partially paid`, `Paid`, or `Overdue` beside the work status.
- `Reduce click depth for common actions.` Add inline actions on customer, pipeline, and job cards: `Create bid`, `Schedule`, `Record payment`, `Complete`, `Message customer`.
- `Add a quick-create surface.` A persistent `New` action should offer `Lead`, `Customer`, `Bid`, `Order`, `Job`, `Payment`, `Expense`. The form should adapt based on business profile and default to the most likely fields.
- `Turn onboarding into contextual guidance.` Replace generic checklist boxes with embedded "next step" banners on the actual screen where the action happens.
- `Clarify plan value in-product.` Locked features should explain the operational outcome they unlock, not just the tier name. Example: "Unlock rate sheets to price recurring service work without rebuilding every quote."
- `Make the website explain the system visually.` The landing page should show a simple flow from inquiry to paid job, not only feature sections. Each plan card should map to the stage of business complexity it supports.
- `Improve the transition from purchase to use.` After checkout or request submission, route the user directly into workspace setup with the selected business profile and starter tasks already loaded.
- `Make mobile job screens action-centric.` On mobile, place the next action button in a bottom action bar and collapse secondary details behind accordions.
- `Standardize record headers.` Leads, customers, bids, orders, and jobs should all show the same top-frame pattern: identity, status, amount, next action, owner.

## Section 5: Database and Backend Changes

- `Add new tables:` `leads`, `lead_events`, `bids`, `bid_line_items`, `bid_photos`, `bid_versions`, `jobs`, `job_assignments`, `job_events`, `service_locations`, `customer_contacts`.
- `Add additive columns to existing tables.`
  - `customers`: `company_name`, `lead_source`, `default_service_location_id`, `billing_address_json`, `tags jsonb`, `status`
  - `orders`: `bid_id nullable`, `primary_job_id nullable`, `payment_state`, `amount_paid_cents`, `amount_due_cents`, `due_date`, `deposit_required_cents`, `deposit_paid_cents`, `booked_at`, `completed_at`
  - `payments`: `job_id nullable`, `posted_by_operator_id`, `reference_number`, `received_at`, `external_method_label`, `is_manual`
  - `expenses`: `job_id nullable`, `order_id nullable`, `customer_id nullable`, `expense_type`, `billable`, `reimbursable`, `used_materials jsonb`, `receipt_asset_id nullable`
  - `tenants`: preserve current billing fields, but add `onboarding_state` and `workspace_activation_state`
- `Normalize statuses.` Introduce separate enums or checked text domains for:
  - `lead_status`
  - `bid_status`
  - `order_status`
  - `job_status`
  - `payment_state`
  - `expense_status`
  Do not continue using one overloaded status vocabulary.
- `Preserve current order logic.` Existing storefront order logic should remain intact. Layer new tables and conversion logic on top rather than rewriting `submit_storefront_order` immediately.
- `Create safe conversion functions.`
  - `create_or_match_customer_from_intake(payload)`
  - `create_lead_from_intake(payload)`
  - `create_bid_from_lead(lead_id)`
  - `approve_bid_to_order(bid_id)`
  - `create_job_from_order(order_id)`
  - `recompute_order_receivable_state(order_id)`
- `Add data integrity protections.`
  - foreign keys for all tenant-scoped relationships
  - uniqueness constraints where justified
  - check constraints for normalized statuses
  - soft-delete or archived status instead of hard delete for core business records
- `Add trigger opportunities.`
  - after payment insert/update, recompute order receivable fields
  - after bid approval, create order and optionally seed job
  - after job completion, emit activity event and optionally flag order ready for invoicing
  - after public intake creation, create matching customer when confidence is high
- `Add summary support.` Create SQL views or RPCs for:
  - dashboard rollups by pipeline stage
  - outstanding receivables by due bucket
  - active jobs by status and assignee
  - recent customer activity feed
- `Risky changes.` Replacing the current `orders.status` values in place is risky because existing code already relies on them. Safer path: add new normalized fields and a compatibility mapping layer first, then migrate UI and APIs gradually.

## Section 6: Automation Opportunities

- `Auto-create or match customer from intake.` Trigger: new lead, quote request, or storefront order submitted. Action: normalize email/phone, match existing customer, or create a new one. Business value: removes duplicate entry and prevents fragmented customer history. Risk or edge case: false-positive matching for shared business phone numbers; require merge review when match confidence is low.

- `Auto-create lead from service website submissions.` Trigger: service quote/contact request submitted. Action: create lead, assign source metadata, set status `new`, and place it in the pipeline. Business value: no dead-end forms and no manual copy from email. Risk or edge case: spam submissions; maintain current anti-spam gates and add intake status `spam_review` when needed.

- `Auto-create bid from lead when the operator starts pricing.` Trigger: lead opened and operator chooses `Create bid`. Action: prefill customer, service location, requested services, and notes into a new bid. Business value: removes duplicate typing and keeps sales context attached. Risk or edge case: one lead may require multiple options; support bid versions or multiple bids per lead.

- `Auto-create order from approved bid.` Trigger: bid status changes to `approved`. Action: create order, copy commercial line items, mark source references, and optionally seed a job. Business value: approved work immediately becomes operational work. Risk or edge case: businesses that require manual scheduling before booking; allow tenant setting `approval_requires_review`.

- `Auto-create job from booked order.` Trigger: order reaches `booked` and business profile requires field execution. Action: create a primary job with service location, schedule stub, and customer summary. Business value: operators move into execution without rebuilding the work record. Risk or edge case: multi-visit work; allow one order to spawn multiple jobs later.

- `Auto-update payment state on order after payment posts.` Trigger: payment insert, update, refund, or void. Action: recalculate paid, due, and payment state. Business value: money visibility stays accurate without manual reconciliation. Risk or edge case: offline payment reversals or bounced checks; support negative adjustments and status history.

- `Auto-surface overdue work and unpaid balances.` Trigger: daily scheduler or page load summary query. Action: flag overdue bids, overdue jobs, and overdue receivables into the `Today` view. Business value: operators know what needs attention first. Risk or edge case: businesses without due dates; fall back to service date or booking date aging rules.

- `Auto-show next recommended setup step.` Trigger: onboarding state changes or required setup objects remain missing. Action: update the operator guidance card with one action that unlocks the next value milestone. Business value: lowers first-use confusion and keeps onboarding in-context. Risk or edge case: advanced users may want to dismiss it; allow dismiss with easy restore.

- `Auto-capture activity feed entries.` Trigger: lead created, bid sent, order booked, job completed, payment recorded, customer edited. Action: append an activity record for the customer and system feed. Business value: provides operational history without manual note taking. Risk or edge case: noisy events; only emit business-meaningful actions, not every field change.

## Section 7: Landing Page and Pricing Requirements

- The landing page must say plainly that ProofLink runs the business from inquiry to paid job.
- It must state what it replaces: disconnected CRM, quoting, scheduling, payment tracking, and scattered notes.
- It must show one simple workflow visual: `Lead -> Quote -> Job -> Payment -> Follow-up`.
- It must explain that the system connects website activity directly to operations instead of sending requests into email limbo.
- It must keep three visible plan tiers with clear outcome framing:
  - `Starter`: one place to run customers, orders, and payments without losing track
  - `Growth`: adds online intake, walkthrough bids, photos, and stronger operational visibility
  - `Enterprise`: adds controls, automations, approvals, and rollout support
- Each plan card must explain what stage of business complexity it fits and what pain it removes.
- Pricing must be straightforward. Avoid hiding whether the plan is self-serve, sales-led, or manually provisioned.
- If a plan is checkout-ready, offer a direct subscribe path before full account setup. Use the join flow only for required business-profile capture and provisioning inputs.
- The transition from purchase to onboarding must preserve selected plan, business type, and starter workflow so the user lands in a prepared workspace, not a blank account.
- Enterprise can retain manual review, but Starter and Growth should not feel like "apply and wait" unless there is a real operational reason.

## Section 8: Execution Task List

### Frontend

- Build a unified `Today` operator home with pipeline counts, overdue money, due-today jobs, and next-step guidance.
- Add a pipeline board component bound to canonical lifecycle states.
- Create reusable record header components for lead, customer, bid, order, and job screens.
- Add payment-state badges and money rails to order and job cards.
- Build a quick-create drawer for lead, customer, bid, order, job, payment, and expense.
- Replace the current launch checklist UI with an outcome-first guided setup panel.
- Add a first-class lead list and lead detail screen.
- Add a first-class job list and job detail screen.
- Convert walkthrough bid drafts to API-backed persistence with save/resume across sessions.
- Add mobile bottom action bars to bid, job, and customer detail views.

### Backend

- Create a canonical intake function that routes submissions into lead/order/customer creation paths.
- Add API endpoints for leads CRUD, bids CRUD, bid approval, jobs CRUD, and order receivable summaries.
- Add conversion endpoints for `lead -> bid`, `bid -> order`, and `order -> job`.
- Add backend logic to recompute order payment summaries whenever payments change.
- Add feed/event creation on major lifecycle transitions.
- Add a dashboard summary endpoint returning the five core operator metrics.
- Refactor launch checklist logic to measure operational completion instead of Stripe/storefront setup.
- Preserve existing storefront order RPC flow and wrap it with richer downstream automations rather than replacing it immediately.

### Database

- Create additive migrations for `leads`, `bids`, `jobs`, `service_locations`, and related child tables.
- Add nullable linkage fields and payment summary fields to `orders`, `payments`, and `expenses`.
- Add indexes on `tenant_id`, `customer_id`, `lead_id`, `bid_id`, `order_id`, `job_id`, `status`, and `due_date`.
- Add check constraints or enum-backed domains for normalized status fields.
- Add views or materialized summaries for outstanding receivables, pipeline counts, and active jobs.
- Add trigger or function support for receivable recomputation and lifecycle event creation.
- Add dedupe support fields for normalized email and normalized phone where missing.

### Public Website

- Replace feature-only hero support copy with a visible workflow explanation.
- Update pricing cards to explain operational outcomes and self-serve versus guided rollout.
- Add plan-specific CTA routing so Starter and Growth can go directly into checkout/onboarding when operationally allowed.
- Add service-intake forms that create leads instead of relying only on storefront order shape.
- Add post-submit success screens that explain exactly what happens next in operations.

### Onboarding

- Replace the current 5-step checklist with a first-completed-order checklist.
- Seed starter services and workflow defaults based on business profile.
- Add guided actions that take the user straight to the next required screen.
- Make online payments optional during initial activation.
- Add a completion milestone screen after first paid job.

### Mobile

- Audit the top mobile actions and remove multi-screen flows where possible.
- Add sticky primary actions for start job, complete job, add photo, record payment, and add expense.
- Make customer lookup, customer call, and address navigation one tap from mobile record headers.
- Persist in-progress photo and bid drafts locally until sync succeeds.
- Reduce required text fields for mobile payment and expense entry.

### Reporting

- Build one dashboard query contract for revenue, outstanding payments, active jobs, pipeline load, and recent customer activity.
- Add drill-down lists from each dashboard metric into actionable records.
- Remove or deprioritize noisy charts that do not point to a next action.
- Add aging buckets for unpaid balances and overdue jobs.

## Section 9: Risks and Inconsistencies

- `The biggest structural risk is continuing to force service workflows through storefront-shaped orders.` If that continues, ProofLink will look powerful in demos but brittle in daily use.
- `The second major risk is shipping more UI without hardening the record model.` The operator can become visually impressive while still creating hidden duplicate-entry debt.
- `The current onboarding logic is misaligned with the product promise.` As long as "connect Stripe" outranks "run your first job," the first-run experience will undersell the platform.
- `There is still a risk of profile complexity outpacing workflow clarity.` Vertical tailoring should change defaults and required fields, not create separate product architectures per business type.
- `Local-only or client-heavy bid state is a business continuity risk.` Once teams or devices are involved, unsaved or noncanonical bid state becomes an operational liability.
- `In-place status rewrites are risky.` Existing code already depends on current order statuses, so normalization must be additive and migration-led.
- `The join flow and pricing story are not fully aligned.` If checkout-ready plans still behave like applications, users may question whether the product is truly ready to run their business.
- `Payments are at risk of being split between tenant billing and job billing in the user's mental model.` The product must clearly separate "what the tenant owes ProofLink" from "what the customer owes the business."
- `Reporting can still fail if it grows before the core lifecycle is normalized.` Fancy analytics on top of weak work-state modeling will create noise, not control.

## Recommended Build Order

1. Add canonical lead, bid, job, and payment-state backend structures.
2. Build the unified pipeline and `Today` view on top of those structures.
3. Wire website/service intake into canonical lead and order creation.
4. Replace onboarding with first-completed-order guidance.
5. Harden mobile execution for bids, jobs, payments, and expenses.
6. Apply business-profile defaults and tier gating to the normalized workflow.
