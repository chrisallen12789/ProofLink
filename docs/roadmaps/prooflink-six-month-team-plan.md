# ProofLink Six-Month Team Plan

This is the operating roadmap for the next 6 months.

Planning defaults:

- Stability first
- Operator workflow as the main product bias
- Monthly execution themes
- No frontend frameworks
- No RLS weakening
- No direct frontend database writes

Team operating rule:

- No major feature batch ships without auth and tenant-scope review, regression coverage, and release-readiness verification.

## Month 1: Platform Risk Lockdown

Primary goals:

- Finish the remaining high-risk reliability sweep across older admin helpers, recurring workflow paths, and payment or webhook failure classification gaps.
- Triage the dirty worktree into named batches with owners.
- Adopt a canonical deploy runbook.

Deliverables:

- [../ops/release-runbook.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/ops/release-runbook.md)
- [../qa/baseline-regression-matrix.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/qa/baseline-regression-matrix.md)
- [month-1-execution-board.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/roadmaps/month-1-execution-board.md)
- [../ops/monthly-team-checkpoint-template.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/ops/monthly-team-checkpoint-template.md)

Exit criteria:

- `npm run test:unit` passes
- `npm run test:preflight:release-readiness` passes
- Older admin and recurring workflows have direct tests for success, validation failure, and schema-readiness failure
- Dirty changes are grouped into intentional batches or explicitly deferred

## Month 2: Schema and SQL Reconciliation

Primary goals:

- Reconcile application assumptions against `sql/`
- Close missing schema-readiness guards on workflows that depend on RPCs or non-core tables
- Record intentional schema drift and catch-up work

Deliverables:

- [../data/schema-drift-register.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/data/schema-drift-register.md)
- [month-2-schema-reconciliation-board.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/roadmaps/month-2-schema-reconciliation-board.md)

Exit criteria:

- High-risk schema assumptions are either covered by tests, documented as accepted drift, or assigned to a migration task
- Major workflow families use consistent schema-readiness behavior

## Month 3: Stripe and Revenue System Hardening

Primary goals:

- Harden subscription lifecycle, connected-account routing, checkout correctness, webhook retries, idempotency, billing exemptions, and portal states
- Expand revenue-path regression coverage
- Improve admin billing diagnostics

Deliverables:

- [month-3-revenue-hardening-board.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/roadmaps/month-3-revenue-hardening-board.md)
- Revenue-path regression additions in tests and admin health docs

Exit criteria:

- Revenue-path regression pack covers checkout, billing, webhook retry and idempotency, and portal behavior
- Billing issues are diagnosable from admin and runbook context without code spelunking

## Month 4: Operator Workflow Upgrade

Primary goals:

- Improve dashboard bootstrap, bookings, quotes and bids, customer follow-up, recurring service management, and payments visibility
- Reduce ambiguous states and manual workarounds
- Start controlled decomposition planning for `operator/operator.js`

Deliverables:

- [month-4-operator-workflow-board.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/roadmaps/month-4-operator-workflow-board.md)
- Operator workflow UX notes tied to test coverage and endpoint changes

Exit criteria:

- Highest-friction operator workflows have clearer state and explicit regression coverage
- Large-file decomposition plan exists for the riskiest operator code

## Month 5: Admin and Team Operations Maturity

Primary goals:

- Improve admin control-tower reliability
- Expand observability around scheduled jobs, moderation, provisioning, and abuse monitoring
- Reduce reliance on tribal knowledge for internal operations

Deliverables:

- [month-5-admin-ops-board.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/roadmaps/month-5-admin-ops-board.md)
- Admin operations regression additions
- Stronger internal runbook coverage

Exit criteria:

- Admin regression pack covers approval, provisioning, messaging, password reset, tester exemption, and platform health
- Scheduled and back-office failures are easier to detect and triage

## Month 6: Expansion Readiness

Primary goals:

- Run a full platform readiness pass
- Decide the next feature wave from evidence
- Freeze the hardening program into durable operating docs

Deliverables:

- [month-6-expansion-readiness-board.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/roadmaps/month-6-expansion-readiness-board.md)
- Updated roadmap outcomes, known-risks summary, and refactor backlog

Exit criteria:

- Leadership can name what is closed, what remains risky, and which feature wave is unlocked next
- Engineering has a prioritized refactor and feature backlog based on observed risk and user pain

## Lane Ownership

### Backend lane

- Auth consistency
- Tenant isolation
- Failure classification
- Shared helpers
- Recurring workflows
- Onboarding and provisioning
- Webhook correctness

### Frontend and operator lane

- Operator and admin usability
- State clarity
- High-friction workflow cleanup
- Safe decomposition plans for oversized files

### Data and SQL lane

- Drift reconciliation
- Migration safety
- RPC dependency review
- Schema assumption documentation

### Payments lane

- Stripe correctness
- Billing lifecycle consistency
- Idempotency
- Connected-account behavior
- Admin and payment health tooling

### QA lane

- Regression growth in this order:
  - Onboarding and provisioning
  - Revenue paths
  - Recurring workflows
  - Operator high-friction flows
  - Admin operations

### Ops lane

- Release-readiness
- Runbooks
- Deploy verification
- Observability
- Incident guidance
- Environment-contract discipline
