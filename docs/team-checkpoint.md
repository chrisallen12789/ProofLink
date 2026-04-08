# Team Checkpoint

We completed a full reliability pass across tenant isolation, public quote acceptance, portal payment balance handling, release-readiness preflight, and admin tenant discovery.

Current verified status:

- `npm run test:unit` passes
- `npm run test:preflight:release-readiness` passes
- `npm run test:preflight:service-workflow` passes
- `npm run test:integration:service-workflow` passes

Current leadership direction:

1. Stripe and webhook reliability pass
2. Dirty-worktree triage and intentional grouping
3. Schema drift reconciliation against `sql/`
4. Operator/admin large-file refactor planning
5. Broader integration and e2e expansion

Roadmap source of truth:

- [roadmaps/prooflink-six-month-team-plan.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/roadmaps/prooflink-six-month-team-plan.md)
- [ops/release-runbook.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/ops/release-runbook.md)
- [qa/baseline-regression-matrix.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/qa/baseline-regression-matrix.md)
- [data/schema-drift-register.md](/Users/Chris/OneDrive/Desktop/ProofLink/docs/data/schema-drift-register.md)

Questions for each lane owner:

1. What is the single biggest production risk right now: payments, auth/isolation, schema drift, operator UX, or something else?
2. Which current uncommitted changes in the repo are intentional and must be preserved?
3. Which user workflow is creating the most friction, confusion, or support load right now?
4. Which file or subsystem feels too risky to keep extending without refactoring first?
5. What still requires manual spot-checking after deploy because we do not trust automation yet?
6. Are there any known schema/code mismatches, fragile migrations, or undocumented "do not touch yet" areas?
7. Which missing tests worry you most: Stripe/webhooks, onboarding/provisioning, portal/reviews, bookings, invoices, or operator/admin flows?
8. If we only do one more reliability batch next, what should it be and why?
