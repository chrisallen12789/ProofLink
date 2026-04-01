# CI Gates and Reliability Policy

This document defines the minimum merge quality gates for ProofLink.

## Required status checks

Pull requests should not merge unless these are green:

1. **Unit** workflow job (includes dependency audit, `TEST_*` contract preflight, and unit tests with coverage thresholds).
2. **Hosted Integration** workflow job when hosted secrets are available.

If hosted secrets are not configured for the repository or fork, the workflow may skip hosted integration by design, and the run log will print the exact missing key list.

## Coverage threshold policy

Unit tests enforce minimum thresholds via Vitest coverage configuration:

- Lines: `70%`
- Statements: `70%`
- Functions: `65%`
- Branches: `40%`

Any threshold miss should fail CI and block merge until addressed.

## Hosted flake triage policy

When hosted integration fails intermittently:

1. Open a **Hosted test flake triage** issue using `.github/ISSUE_TEMPLATE/hosted-test-flake.yml`.
2. Include the failing run URL, exact failing step, and re-run behavior.
3. Label by likely scope (seed/cleanup/preflight/schema/API transient) and assign owner.
4. Prefer deterministic fixes (idempotency, retries, clearer error categorization) over suppressing failures.

## Branch protection recommendation

Repository admins should configure branch protection on `main` to require the `Test` workflow checks and prevent direct force pushes.
