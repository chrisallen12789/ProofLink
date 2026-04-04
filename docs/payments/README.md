# ProofLink Payments Strategy Pack

This pack is a prebuild for future AI-assisted work on payments at ProofLink.

It is meant to answer one question first:

Should ProofLink build its own card processor, or should it build a provider-neutral payments core and keep licensed card processing with external partners?

Current recommendation as of 2026-04-03:

- Do not build a true card processor or store, process, or transmit raw card data inside ProofLink.
- Do build a provider-neutral payments core so ProofLink can support something other than Stripe and keep the door open for a second PSP, an orchestration layer, or a sponsored PayFac-style model later.

Read this pack in this order:

1. `docs/payments/prooflink-card-processor-feasibility-2026-04-03.md`
2. `docs/payments/prooflink-provider-neutral-payments-architecture.md`
3. `docs/payments/prooflink-payments-agent-pack.md`
4. `docs/payments/prooflink-payments-codex-master-prompt.md`

Current Stripe-heavy seams in ProofLink:

- `netlify/functions/_prooflink_payments.js`
- `netlify/functions/stripe-order-checkout.js`
- `netlify/functions/stripe-platform-checkout.js`
- `netlify/functions/stripe-webhook.js`
- `netlify/functions/stripe-billing-webhook.js`
- `netlify/functions/stripe-connect-link.js`
- `netlify/functions/create-billing-portal-session.js`
- `netlify/functions/create-billing-upgrade-session.js`
- `netlify/functions/portal-checkout.js`
- `netlify/functions/tenant-payment-status.js`
- `netlify/functions/utils/payment-policy.js`
- `operator/billing.live.js`
- `operator/payments.js`
- `.env.example`

Use this pack before making any of these decisions:

- replacing Stripe for tenant card acceptance
- adding a second provider or gateway
- redesigning platform billing
- building payout, reserve, dispute, or underwriting flows
- discussing "our own processor" with banks, acquirers, or vendors

This pack is intentionally opinionated:

- It assumes ProofLink is still best served by hosted fields, redirects, tokenization, and provider-managed PCI scope.
- It treats payment architecture as high-stakes and requires re-checking official sources before any legal, compliance, or network decision.
