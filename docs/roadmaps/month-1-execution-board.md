# Month 1 Execution Board

Use this board as the active execution tracker for the current month.

## Goal

Reduce platform risk before any feature expansion by hardening legacy helpers, recurring workflows, release discipline, and baseline regression coverage.

## Backend lane

- [ ] Sweep older admin helpers for auth, tenant-scope, and failure-classification consistency
- [ ] Finish recurring workflow schema-readiness handling and regression coverage
- [ ] Close remaining payment or webhook failure classification gaps
- [ ] Record any intentionally deferred legacy risks in the checkpoint

## QA lane

- [ ] Confirm the baseline regression matrix reflects the real current suite
- [ ] Identify gaps in onboarding, provisioning, checkout, billing portal, quote acceptance, and recurring orders
- [ ] Add direct test ownership notes for each uncovered workflow

## Ops lane

- [ ] Adopt the release runbook for every deploy
- [ ] Record manual post-deploy checks that are still required
- [ ] Record missing observability or incident-response coverage

## Dirty worktree triage

- [ ] Group reliability changes into intentional batches
- [ ] Mark exploratory or stale changes for follow-up review
- [ ] Avoid leaving unnamed drift in active files

## Exit checks

- [ ] `npm run test:unit`
- [ ] `npm run test:preflight:release-readiness`
- [ ] Relevant workflow-specific preflight or integration checks when touching that workflow family
