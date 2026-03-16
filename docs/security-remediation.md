# ProofLink Security Remediation Backlog

This backlog captures the security findings from the recent code audit that remain open after the targeted remediation work already completed in the Netlify layer.

All items below are currently `open`.

## Recommended Priority Order

1. Missing application-layer plan enforcement on write paths
2. Remaining auth model split between `utils/auth.js` and `_prooflink_payments.js`
3. Legacy service-role-backed admin handlers that should continue moving to tenant-aware membership checks

## 1. Missing Application-Layer Plan Enforcement On Write Paths
- Title: Application-layer plan enforcement is not consistently wired into create and mutate paths
- Severity: Medium
- Affected files:
  - [plan-enforcement.js](/C:/Users/Chris/ProofLink/netlify/functions/lib/plan-enforcement.js)
  - [create-tenant-bundle.js](/C:/Users/Chris/ProofLink/netlify/functions/create-tenant-bundle.js)
  - [supabase-order-proxy.js](/C:/Users/Chris/ProofLink/netlify/functions/supabase-order-proxy.js)
  - any future tenant-scoped create/update handlers under [netlify/functions](/C:/Users/Chris/ProofLink/netlify/functions)
- Exploit summary:
  - The codebase has plan enforcement helpers, but they are not broadly invoked by Netlify write handlers.
  - Current protection appears to depend primarily on database triggers, RPCs, and views.
  - If a new write path bypasses the protected DB path, it can silently miss plan-limit enforcement.
- Remediation approach:
  - Keep the database as the source of truth.
  - Add a thin application-layer guard to high-risk write handlers as defense in depth.
  - Prioritize handlers that create tenant-scoped resources such as products, operators, customers, and orders.
  - Reuse [plan-enforcement.js](/C:/Users/Chris/ProofLink/netlify/functions/lib/plan-enforcement.js) rather than inventing a second policy system.
- Test coverage required:
  - Integration tests proving over-limit writes are rejected at the handler layer before side effects.
  - Regression tests for product creation, operator seat creation, and order/customer creation paths.
  - Tests confirming successful writes still work below plan limits.
- Status: open
- Recommended priority order: 1

## 2. Remaining Auth Model Split Between `utils/auth.js` And `_prooflink_payments.js`
- Title: Authorization remains split across two helper models
- Severity: Medium
- Affected files:
  - [auth.js](/C:/Users/Chris/ProofLink/netlify/functions/utils/auth.js)
  - [_prooflink_payments.js](/C:/Users/Chris/ProofLink/netlify/functions/_prooflink_payments.js)
  - remaining `utils/auth.js` consumers under [netlify/functions](/C:/Users/Chris/ProofLink/netlify/functions)
- Exploit summary:
  - The codebase now has safer tenant-aware membership checks in more places, but two authorization models still exist.
  - That increases the chance that new handlers choose the weaker or less scoped pattern by default.
  - The main risk is future drift: a tenant-scoped handler may again accept caller input and then read or mutate with broader service-role access than intended.
- Remediation approach:
  - Continue converging tenant-scoped handlers on the `operator_members` model.
  - Reserve `platform_admin` fallbacks for true platform-wide operations only.
  - Document which helper should be used for `platform-admin`, `tenant-admin`, `tenant-member`, and `public` handlers.
  - Avoid broad rewrites; migrate the remaining high-risk handlers incrementally.
- Test coverage required:
  - Integration tests for every migrated handler proving:
    - unauthenticated access is rejected
    - cross-tenant access is rejected
    - legitimate same-tenant requests still succeed
  - Unit tests for auth helper behavior with membership-backed users and platform admins.
- Status: open
- Recommended priority order: 2

## 3. Remaining Legacy Service-Role-Backed Admin Handlers Need Membership-Aware Hardening
- Title: Some legacy admin handlers still rely on the older admin helper path
- Severity: Medium
- Affected files:
  - [admin-approve-onboarding.js](/C:/Users/Chris/ProofLink/netlify/functions/admin-approve-onboarding.js)
  - [admin-get-onboarding-requests.js](/C:/Users/Chris/ProofLink/netlify/functions/admin-get-onboarding-requests.js)
  - [admin-reject-onboarding.js](/C:/Users/Chris/ProofLink/netlify/functions/admin-reject-onboarding.js)
  - [get-platform-stats.js](/C:/Users/Chris/ProofLink/netlify/functions/get-platform-stats.js)
  - [get-tenants.js](/C:/Users/Chris/ProofLink/netlify/functions/get-tenants.js)
  - [admin-set-tester-exempt.js](/C:/Users/Chris/ProofLink/netlify/functions/admin-set-tester-exempt.js)
- Exploit summary:
  - These handlers are admin-oriented and intentionally broader than tenant-member endpoints, but they still sit on the legacy `utils/auth.js` service-role path.
  - The risk is lower than the already-remediated public and tenant-scoped endpoints, but they remain sensitive because they can read or mutate cross-tenant data.
  - Any ambiguity in role resolution or future handler copy/paste from this pattern could reintroduce authorization gaps.
- Remediation approach:
  - Keep current functionality for legitimate admin users.
  - Continue migrating these handlers to explicit role and membership-aware authorization, using the hardened helper model already introduced.
  - Make platform-wide operations require `platform_admin` when appropriate, and document any handlers that intentionally permit tenant-admin access.
- Test coverage required:
  - Integration tests proving non-admin users are rejected.
  - Integration tests proving tenant admins cannot access platform-wide admin endpoints unless explicitly intended.
  - Positive-path tests for seeded platform admin users.
- Status: open
- Recommended priority order: 3
