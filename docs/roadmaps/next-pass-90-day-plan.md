# Next Pass 90-Day Plan

This plan assumes CI is green, hosted integration is stable, and the team agrees we can move from patch mode into focused delivery.

## Month 1 (Weeks 1-4): Reliability and Release Discipline
- CI/CD hardening (required checks, coverage thresholds, release automation)
- Test harness resilience (idempotent seed/cleanup, fixture contracts)
- Operational observability (structured logs + alerts)
- Team workflow baseline (Definition of Done)

## Month 2 (Weeks 5-8): Product UX and Conversion Improvements
- Onboarding/provisioning UX improvements
- Funnel instrumentation + CTA experiments
- Performance/offline quality checks (Lighthouse + SW validation)
- Quickstart/documentation expansion

## Month 3 (Weeks 9-12): Tooling, Security, and Scale Readiness
- Internal diagnostics tooling + “dev doctor”
- Security/dependency policy and secret rotation runbook
- Migration governance + SQL bundle drift checks
- Quarter-end direction decision (growth vs enterprise vs scale)

## Entry Criteria (Go / No-Go)
1. CI green for 5+ working days
2. Hosted failures are actionable (not flaky)
3. Prioritized backlog with owners/estimates
4. Weekly release cadence agreed
