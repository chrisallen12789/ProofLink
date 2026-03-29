# ProofLink Launch Brief

Date: March 29, 2026

## Goal

Launch ProofLink as the easiest business operating system for small service companies to adopt without confusion, surprise fees, or setup paralysis.

## Core market message

ProofLink should be positioned as:

- One flat monthly fee.
- One place to run leads, customers, quotes, jobs, and payment follow-up.
- A calmer way to run a service business from phone or desktop.
- A business system that can be started alone or set up with human help.

Suggested headline:

`Run the business. Stop chasing it.`

Suggested subhead:

`ProofLink gives service businesses one flat-rate operating system for leads, customers, jobs, and payment follow-up, with guided setup when they want help.`

## Customer psychology pillars

The campaign should lean on these principles:

1. Reduce anxiety.
ProofLink should feel like relief from chaos, not another tool to learn.

2. Reduce cognitive load.
Use plain language, fewer choices, and obvious next steps.

3. Increase self-efficacy.
Show that owners can start now, and that help is available if they get stuck.

4. Signal trust.
Lead with security, clarity, human support, and predictable pricing.

5. Promise fast time to value.
The buyer should believe they can sign up today and immediately see their business in one place.

## Launch campaign structure

### 1. Awareness

Channels:

- Landing page hero and pricing section
- Founder-led email outreach
- Short-form social clips
- Demo screenshots focused on phone usability

Message angle:

- Stop losing jobs in texts, notes, and memory.
- Put the business in one place.
- Start yourself or ask us to set it up with you.

### 2. Consideration

Assets:

- Three-minute product walkthrough
- One-page comparison against spreadsheets plus disconnected apps
- Pricing page with flat-rate promise
- Guided setup page that explains what happens after signup

Message angle:

- No nickel-and-diming on core workflow.
- Clear onboarding path.
- Real support when setup feels heavy.

### 3. Conversion

Primary calls to action:

- `Start your account`
- `I want help setting it up`
- `Talk to us`

Message angle:

- Start today.
- Keep your place if you need guided help.
- Get to your business hub without waiting on a maze of setup steps.

### 4. Activation

Post-signup expectations:

- Self-serve users should land in the operator app with a clean first-run checklist.
- Guided users should get a confirmation, reference ID, and a fast human follow-up.
- Every user should know where to sign in, reset a password, and request help.

## Release gate before campaign spend

These flows should be treated as launch blockers:

1. Customer can create an account from `/join`.
2. Self-serve user can set a password and sign in.
3. Guided user can submit a request and receive a reference ID.
4. User can request help through guided setup or contact form.
5. Operator can sign in, use the app on phone, and sign out without layout issues.
6. Portal payment return and customer account views stay readable and trustworthy.
7. Public pricing matches enforced product limits.
8. Billing and Connect fee policy is decided before online checkout is promoted heavily.

## What marketing needs from product

- Final approved plan promises for Starter, Growth, and Enterprise.
- A decision on whether guided setup is included in Growth or sold separately.
- A decision on who pays tenant payment processing and Connect costs.
- A clear support promise:
  `Email only`, `guided setup included`, or `priority help`.

## Recommended launch room

- Product owner
- Frontend and mobile lead
- Browser QA lead
- Billing and payments owner
- Marketing lead
- Customer psychology / UX research lead
- Support / onboarding owner

## Immediate next assets

1. Landing page rewrite around the flat-fee promise.
2. Pricing page cleanup that explains self-serve vs guided setup in plain English.
3. Launch email sequence:
   - announcement
   - guided setup invitation
   - proof and testimonials
4. Phone-first product screenshots and 30-second walkthrough clips.
5. Support page copy that tells customers exactly how to get setup help.

## Current launch notes from the repo

- Guided setup exists in the public join flow.
- Contact support flow exists.
- Operator auth and operator phone layouts now have cross-device smoke coverage.
- Customer portal payment-return smoke exists.
- Public onboarding smoke needed a test refresh to match the current guided-setup confirmation copy.
- Growth plan marketing copy was out of sync with the internal product contract and has been aligned in code.

## Owner decisions locked on March 29, 2026

- Growth does not include guided setup by default.
- Enterprise stays custom.
- Payment-processing economics should be absorbed by the customer account, not by ProofLink platform margin.
