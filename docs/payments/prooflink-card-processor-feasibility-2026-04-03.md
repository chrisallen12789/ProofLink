# ProofLink Card Processor Feasibility

Date: 2026-04-03

## Short answer

Yes, it is possible in the broad sense.

No, it is not the recommended next move for ProofLink if "build our own card processor" means any of these:

- handling raw card data directly
- becoming the core processor of card transactions
- taking on direct network, acquiring, underwriting, settlement, and dispute operations ourselves

The recommended move is:

- build a provider-neutral payments layer inside ProofLink
- keep card data collection and primary processing with licensed, PCI-compliant providers
- add a second processor, gateway, or orchestration partner only after the Stripe-specific seams are abstracted

## Why this is a hard no for now

### 1. PCI scope jumps sharply once ProofLink owns more of the card flow

PCI SSC says SAQ A eligibility depends on all payment page elements originating from a PCI DSS compliant service provider, with no single payment-page element originating from the merchant site. That is the safest direction for ProofLink's web stack. If ProofLink starts owning hosted fields, card capture, vaulting, or processor logic, scope expands immediately.

ProofLink implication:

- keep checkout, tokenization, hosted fields, and card capture outside ProofLink whenever possible
- do not store PAN, CVV, track data, or equivalent card secrets in Supabase, Netlify Functions, logs, local storage, or browser code

### 2. Card-network and acquirer sponsorship is not optional

Mastercard's public PCI guidance classifies all third-party processors and merchant payment gateways as Level 1 service providers, and Level 1 service providers validate annually with a ROC. Mastercard also separately calls out payment facilitators by transaction volume.

Visa's public Visa Payments Processing materials are aimed at Visa clients, acquirers/processors, and sponsored merchants through a participating acquirer. The practical inference is that direct network-adjacent access still requires sponsor and bank/acquirer relationships; ProofLink does not simply "turn on" processor status in software.

ProofLink implication:

- if the goal is a real processor, this is bank, acquirer, and card-network business development work before it is engineering work
- if the goal is to move off Stripe, a processor abstraction is much more realistic than processor ownership

### 3. Money transmission and funds-flow rules can change the model

FinCEN has long distinguished merchant-payment-processor activity from broader money transmission based on facts and circumstances. In the 2009 ruling, activity done as an agent of the merchant can be treated differently from broader bill-pay or funds-transmission activity that does not fit the same exception.

ProofLink implication:

- a narrow merchant-processing model is different from a broader wallet, stored-balance, funds-holding, or transmission model
- if ProofLink starts moving or holding funds outside a sponsor's managed flow, legal and licensing analysis becomes a first-class workstream

## What is possible

### Option A. Provider-neutral payments core

What it means:

- ProofLink keeps using hosted checkout or tokenized provider components
- backend normalizes payment concepts behind an internal adapter
- Stripe becomes one provider, not the platform's payment architecture

Recommendation:

- strongly recommended now

Why:

- lowest compliance expansion
- highest near-term leverage
- unlocks "something other than Stripe" without pretending ProofLink is a processor

### Option B. Multi-processor or payment orchestration

What it means:

- Stripe remains available
- one more provider or an orchestration layer is added for routing, failover, economics, or market fit
- ProofLink keeps a provider-neutral contract and normalized ledger/events model

Recommendation:

- recommended after Option A

Why:

- gives strategic leverage without taking on direct processor obligations
- keeps ProofLink's engineering effort pointed at product and platform control

### Option C. Sponsored PayFac or PayFac-as-a-Service path

What it means:

- ProofLink owns more merchant onboarding, pricing, and economics
- sponsor bank/acquirer and payment partner still carry major regulated and network responsibilities
- underwriting, reserves, disputes, support, and reconciliation become much more serious internal functions

Recommendation:

- possible later, only after provider-neutral abstraction and stronger money operations

Why not now:

- operational lift is much larger than just replacing Stripe APIs
- ProofLink would need internal risk, finance, support, compliance, and reconciliation maturity

### Option D. True card processor

What it means:

- ProofLink would effectively sit much deeper in the card-processing chain
- direct processor-grade responsibilities, security programs, network relationships, and audit obligations become central

Recommendation:

- not recommended

Why:

- disproportionate complexity for ProofLink's current product stage
- engineering cost is only one small part of the total burden

## ProofLink-specific read of the current codebase

Today, ProofLink is not "payments abstracted with Stripe underneath." It is largely "Stripe is the payments architecture."

Strong Stripe coupling currently exists in:

- tenant state and env naming: `.env.example`
- shared backend helper: `netlify/functions/_prooflink_payments.js`
- order checkout: `netlify/functions/stripe-order-checkout.js`
- customer payment portal: `netlify/functions/portal-checkout.js`
- platform subscriptions: `netlify/functions/stripe-platform-checkout.js`
- webhooks: `netlify/functions/stripe-webhook.js` and `netlify/functions/stripe-billing-webhook.js`
- connect onboarding: `netlify/functions/stripe-connect-link.js`
- billing portal and upgrade sessions: `netlify/functions/create-billing-portal-session.js` and `netlify/functions/create-billing-upgrade-session.js`
- status/UI: `netlify/functions/tenant-payment-status.js`, `operator/billing.live.js`, `operator/payments.js`
- schema and persisted refs: `tenants.stripe_customer_id`, `tenants.stripe_subscription_id`, `tenants.stripe_account_id`, `payments.checkout_session_id`, `payments.payment_intent_id`, `payments.charge_id`

This means the correct first build is not "new processor." It is "clear seams, generic contracts, and normalized provider references."

## Recommended decision for ProofLink

Recommended on 2026-04-03:

1. Build a provider-neutral payments domain model in ProofLink.
2. Keep raw card handling outside ProofLink.
3. Keep Stripe as the first adapter while the abstraction is built.
4. Evaluate one non-Stripe path only after the abstraction exists.
5. Revisit sponsored PayFac economics only after ProofLink proves enough GMV, support maturity, and reconciliation discipline to justify it.

## Sources to re-check before acting

Official sources reviewed on 2026-04-03:

- PCI SSC FAQ on SAQ A vs SAQ A-EP for e-commerce payment pages:
  https://www.pcisecuritystandards.org/faqs/if-a-merchant-s-e-commerce-implementation-meets-the-criteria-that-all-elements-of-payment-pages-originate-from-a-pci-dss-compliant-service-provider-is-the-merchant-eligible-to-complete-saq-a-or-saq-a-ep/
- Mastercard site data protection and service provider levels:
  https://www.mastercard.com/us/en/business/cybersecurity-fraud-prevention/site-data-protection-pci.html
- FinCEN ruling FIN-2009-R004:
  https://www.fincen.gov/sites/default/files/administrative_ruling/fin-2009-r004.pdf
- Visa Payments Processing overview:
  https://developer.visa.com/capabilities/vpp

Notes:

- The Visa implication above is an inference from Visa's published audience and access model, not a claim that ProofLink can or cannot enter the ecosystem without separate commercial review.
- Any move toward wallet balances, merchant-of-record changes, reserve holding, or direct funds movement should be reviewed with payments counsel, sponsor/acquirer partners, and a PCI QSA before implementation begins.
