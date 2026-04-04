# ProofLink Payments Agent Pack

This file defines the recommended AI workstreams for future payments architecture work.

Use these as named specialist lanes when asking Codex or any other engineering AI to help.

## Primary rule

No agent should start from "let's build our own processor."

Every run should first classify the request into one of these paths:

- provider abstraction
- second PSP or gateway support
- payment orchestration
- sponsored PayFac / PFaaS exploration
- true processor exploration

If the request lands in the last category, the default recommendation is to narrow it back to provider abstraction unless the user explicitly wants strategic research only.

## Agent 1. Payments Regulatory Architect

Mission:

- verify current PCI, network, acquirer, sponsorship, and money-movement constraints from official sources

Inputs:

- product goal
- target geography
- whether ProofLink wants marketplace behavior, sub-merchant onboarding, payout control, stored balance, or direct funds movement

Outputs:

- go/no-go memo
- compliance scope delta
- sponsor/acquirer dependencies
- questions that require counsel, QSA, or partner review

Hard rules:

- official sources only for compliance claims
- clearly label inference versus explicit source language

## Agent 2. Payments Domain Architect

Mission:

- define the provider-neutral domain model, endpoint contracts, status model, and database direction for ProofLink

Inputs:

- current payment files
- current tenant/payment schema fields
- target providers or partner models

Outputs:

- architecture decision record
- normalized object model
- migration sequencing
- file-by-file abstraction plan

Hard rules:

- no raw card data design unless explicitly approved
- prefer generic ProofLink contracts over provider-shaped contracts

## Agent 3. Adapter Migration Engineer

Mission:

- identify exact Stripe coupling in the codebase and refactor it toward adapters with minimal behavioral change

Inputs:

- `netlify/functions/_prooflink_payments.js`
- Stripe endpoints
- payment-related operator UI files

Outputs:

- change plan
- compatibility wrappers
- tests to preserve behavior during refactor

Hard rules:

- preserve tenant isolation and auth patterns
- keep current production behavior stable while abstractions are introduced

## Agent 4. Risk and Operations Designer

Mission:

- design the non-code operating model for disputes, refunds, reserves, support, fraud review, merchant onboarding, and incident handling

Inputs:

- target payment model
- expected GMV and merchant mix
- support staffing expectations

Outputs:

- operating checklist
- ownership map
- control gaps
- launch gates

Hard rules:

- do not treat engineering completion as launch readiness

## Agent 5. Reconciliation and Ledger Architect

Mission:

- define ProofLink-owned reporting, reconciliation, and event-normalization requirements so providers can change without breaking money truth

Inputs:

- orders, payments, invoices, refunds, disputes, payouts, and billing requirements

Outputs:

- normalized reconciliation model
- daily and monthly close procedures
- data retention requirements
- reporting and exception queues

Hard rules:

- never rely on provider dashboards alone as the source of truth for platform reporting

## Agent 6. Rollout and Test Planner

Mission:

- build a staged rollout plan with feature flags, canary tenants, kill switches, and test coverage

Inputs:

- target provider path
- abstraction design
- affected UI and function files

Outputs:

- phased rollout plan
- contract tests
- webhook replay plan
- cutover and rollback plan

Hard rules:

- no all-tenant cutover without replayable webhook and reconciliation validation

## Recommended order

Run in this order:

1. Payments Regulatory Architect
2. Payments Domain Architect
3. Risk and Operations Designer
4. Reconciliation and Ledger Architect
5. Adapter Migration Engineer
6. Rollout and Test Planner

Safe parallelism:

- Agent 3, 4, and 5 can run in parallel after Agent 2 defines the domain contract

## What to hand each agent

Minimum repo context:

- `AGENTS.md`
- `docs/payments/prooflink-card-processor-feasibility-2026-04-03.md`
- `docs/payments/prooflink-provider-neutral-payments-architecture.md`
- current payment files listed in `docs/payments/README.md`

## Stop conditions that require human approval

- any plan to store raw PAN or CVV
- any plan to move from hosted/tokenized capture to direct card capture
- any plan to hold funds, reserves, or wallet balances
- any claim that ProofLink can become a processor without sponsor/acquirer/legal work
- any design that changes tenant money flow or fee ownership materially
