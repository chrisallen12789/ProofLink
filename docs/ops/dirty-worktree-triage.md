# Dirty Worktree Triage

This file groups the current active changes into intentional review batches.

Use it to stop the repo from carrying unnamed drift.

## Batch 1: Reliability core

Owner lanes:

- Backend
- QA

Files and areas:

- Tenant identity normalization across Netlify functions
- Stripe webhook and billing webhook hardening
- Recurring workflow schema-readiness handling
- Public quote acceptance and request-review hardening
- Customer portal and portal checkout normalization

Expected close-out:

- Keep changes together through review
- Verify unit and release-readiness gates
- Add direct tests for any newly hardened legacy helper

## Batch 2: Admin and platform operations

Owner lanes:

- Backend
- Admin
- Ops

Files and areas:

- Admin approval, tenant search, tester exemption, password reset, tenant messaging
- Admin Stripe health
- Team checkpoint and release-runbook docs

Expected close-out:

- Review auth consistency and admin-only access
- Confirm admin regression pack covers touched helpers
- Keep runbook and checkpoint docs aligned with actual deploy practice

## Batch 3: Operator and crew workflow

Owner lanes:

- Frontend and operator
- QA

Files and areas:

- `crew/crew.js`
- Operator and admin shell-related test files
- Cross-device operator E2E coverage

Expected close-out:

- Separate workflow or UX adjustments from unrelated reliability edits
- Confirm field and cross-device regressions are intentional

## Batch 4: Docs and roadmap system

Owner lanes:

- Ops
- Leadership

Files and areas:

- 6-month roadmap docs
- Monthly execution boards
- Regression matrix
- Schema drift register

Expected close-out:

- Treat these as the current source of truth for roadmap execution
- Update when month themes or ownership change

## Triage rules

- Do not mix exploratory edits with release-ready reliability changes in the same review batch
- If a file is still changing for unrelated reasons, record that explicitly before merging
- Any batch touching auth, tenant isolation, payments, provisioning, or recurring workflows must run the full required gates
