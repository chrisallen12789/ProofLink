# ProofLink V1 To-Do List

This is the practical build list for making the product match the promise of each subscription tier without drifting into random feature work.

## 1. Finish the platform truth layer

These items determine whether the product is operationally trustworthy.

- Keep the payments rule strict: online checkout only when `billing_status = active` and `connect_status = connect_connected`.
- Keep tenant plan stored in one place: `tenants.prooflink_plan_key`.
- Keep onboarding status and launch checklist aligned so operators always see the next required action.
- Keep admin visibility over tenant readiness, billing readiness, and payment readiness.

## 2. Build the tier gate before adding more features

Every major area should be plan-aware. The platform already stores plan state; the missing work is enforcement.

### Starter
- Core CRM
- Products
- Orders
- Customers
- Availability
- Expenses
- Business setup
- Basic payment status view
- Manual/offline invoicing
- Guided launch checklist

### Growth
Everything in Starter, plus:
- Stripe Connect onboarding
- Online checkout once payment truth is confirmed
- Stronger analytics
- Higher or unlimited product/customer/order volume
- Better automation and reminders
- Upgrade prompts removed for Growth-only tools

### Full / Enterprise
Everything in Growth, plus:
- Multi-operator governance and role depth
- Advanced analytics and exports
- Custom domain polish and premium launch tools
- Automation rules / integrations
- White-glove onboarding or concierge controls

## 3. Add feature gating in the UI

Every page should know whether the tenant is allowed to use the feature.

Priority pages:
- Payments
- Domains
- Analytics / money view
- Advanced exports
- Multi-user or admin-like controls inside operator

Expected behavior:
- If allowed: feature works normally.
- If not allowed: feature remains visible but locked with a direct upgrade explanation.
- Locked state must explain what the feature does, why it is locked, and which tier unlocks it.

## 4. Add limit enforcement in create/update flows

The product will not actually support tier promises until write actions are constrained.

Suggested first-pass limits:

### Starter
- Product cap
- Customer cap
- Active order cap
- Single operator seat or reduced seat count
- No hosted online checkout until Growth

### Growth
- Higher or unlimited product/customer/order count
- Online checkout enabled if Stripe is fully ready
- More reporting

### Full / Enterprise
- Highest limits
- Automation and integrations
- Custom operational controls

Enforcement points:
- Product create/save flow
- Customer create flow
- Order create flow
- Operator-member invite/create flow
- Payment feature actions

## 5. Turn the checklist into the real onboarding engine

A new operator should not land on a dead dashboard. The checklist should drive the first-session workflow.

Required checklist milestones:
- Add first product
- Add branding and public profile
- Add customer
- Create first tracked order
- Review payment setup
- Review domain / launch setup

## 6. Complete the payment experience

What exists is already strong structurally. The remaining work is to make status transitions obvious and truthful.

Needed:
- Clear platform billing state
- Clear tenant payout state
- Clear online checkout state
- Upgrade path from Starter to Growth or Full
- Strong webhook-driven updates reflected in UI without implying payment readiness too early

## 7. Build the analytics layer that proves value

The product becomes harder to cancel once it explains the business back to the customer.

Minimum analytics set:
- Revenue this month
- Revenue last month
- Order count this month
- Average order value
- New customers this month
- Outstanding orders
- Expense total this month
- Top products / services

## 8. Tighten admin orchestration

The admin console should act like the control tower.

Admin priorities:
- Tenant list with plan, billing, connect, and launch status
- Onboarding request queue
- Tester-exempt visibility
- Tenant health indicators
- Quick actions for approve, reject, suspend, and review

## 9. Public experience and conversion

The operator product can be good and still underperform if the public side is unclear.

Public-side priorities:
- Join / pricing page must explain the three tiers clearly
- Locked features should upsell cleanly
- Storefront should be clean and trustworthy
- Inquiry / onboarding submission flow should feel polished and short

## 10. Release standard for V1

ProofLink is V1-ready when all of the following are true:
- A new tenant can sign up and get provisioned cleanly.
- An operator can complete the checklist without confusion.
- Products, customers, orders, setup, and expenses all save reliably.
- Payment status is truthful and never misleading.
- Tier restrictions are enforced in both UI and write actions.
- Admin can see tenant readiness across the platform.
- Upgrade path between tiers is visible and functional.
