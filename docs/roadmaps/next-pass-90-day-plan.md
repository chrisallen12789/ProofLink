# Next Pass 90-Day Plan

This plan assumes CI is green, hosted integration is stable, and the team agrees we can move from patch mode into focused delivery.

## Month 1 (Weeks 1-4): Reliability and Release Discipline

### Goals
- Stabilize quality gates so every merge is predictable.
- Improve observability for fast issue triage.
- Reduce hosted test flake and seed/cleanup risk.

### Workstreams
1. **CI/CD hardening**
   - Require unit + hosted integration status checks on PRs.
   - Add coverage reporting with minimum thresholds on critical serverless modules.
   - Add changelog/release note automation per merge.
2. **Test harness resilience**
   - Make seed/cleanup scripts idempotent and retry-aware for transient Supabase errors.
   - Add deterministic test fixture contracts for tenant/operator/customer entities.
3. **Operational observability**
   - Add structured logs in serverless handlers (request_id, tenant_id, latency, status).
   - Add alert thresholds for 5xx spikes and onboarding/provisioning failures.
4. **Team workflow baseline**
   - Publish a lightweight Definition of Done checklist (tests/docs/observability/migration notes).

### Deliverables
- CI gate policy committed.
- Logging + alert docs and dashboards published.
- Hosted test reliability report (baseline failure rate vs end-of-month).

---

## Month 2 (Weeks 5-8): Product UX and Conversion Improvements

### Goals
- Improve onboarding transparency and completion rates.
- Tighten landing-to-product conversion funnel.
- Prevent web performance regressions.

### Workstreams
1. **Onboarding/provisioning UX**
   - Add visible provisioning state timeline and clear retry/escalation options.
   - Improve admin password reset and onboarding review feedback messaging.
2. **Funnel instrumentation**
   - Track event funnel: landing -> CTA -> sign-in/start -> onboarding submit -> activation.
   - Run copy/CTA experiments and compare conversion deltas.
3. **Performance/offline quality**
   - Add Lighthouse budget checks for landing routes.
   - Validate service worker behavior to avoid stale marketing content after deploy.
4. **Docs and onboarding**
   - Expand quickstart docs for environment setup, SQL rebuild flow, and test preflights.

### Deliverables
- Funnel dashboard with baseline metrics.
- Provisioning UX updates shipped.
- Lighthouse budget check active in CI.

---

## Month 3 (Weeks 9-12): Tooling, Security, and Scale Readiness

### Goals
- Improve internal delivery speed.
- Raise operational/security confidence.
- Prepare for larger customer/tenant volume.

### Workstreams
1. **Internal tooling**
   - Build operator/admin diagnostics workflow for failed provisioning and tenant state checks.
   - Add one-command local "dev doctor" for env/dependency/contract validation.
2. **Security and dependency policy**
   - Define secret rotation cadence and runbook.
   - Add automated dependency update policy + triage cadence.
   - Review auth/permission boundaries for sensitive serverless endpoints.
3. **Data/migration governance**
   - Standardize migration lifecycle (author, verify, deploy, rollback).
   - Validate generated SQL bundle freshness in CI to prevent drift.
4. **Quarter-end direction decision**
   - Evaluate next focus: growth features, enterprise controls, or scale optimization.

### Deliverables
- Internal diagnostics utilities shipped.
- Security runbook + rotation schedule documented.
- Migration governance checklist enforced in PR template.

---

## Entry Criteria (Go / No-Go)

Start this plan when all are true:
1. CI remains green for 5+ consecutive working days.
2. Hosted integration failures are actionable (not flaky/noisy).
3. Single prioritized backlog exists with owner + estimate per item.
4. Weekly release cadence is agreed by the team.
