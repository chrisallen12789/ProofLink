# ProofLink Schema Drift Register

Use this file to track code-versus-SQL drift until the difference is either resolved or explicitly accepted.

## Status meanings

- `open`: drift exists and still needs a decision
- `accepted`: drift is intentional for now and has an owner
- `planned`: drift has a concrete follow-up task
- `closed`: drift has been resolved

## Current register

| Area | Drift | Status | Owner | Next action |
|---|---|---|---|---|
| Tenant identity fields | Code now prefers `business_name` over legacy `name` in many function groups, but SQL review still needs to confirm all tenant-facing reads and writes are aligned | open | Data/SQL lane | Compare tenant-related tables, policies, and seed behavior against current function assumptions |
| Recurring workflows | Recurring code now classifies missing schema more clearly, but SQL scripts and RPC definitions still need a dedicated reconciliation pass | open | Backend + Data/SQL | Compare `service_plans`, recurring order generation, and `generate_due_service_plans()` expectations against `sql/` |
| Service workflow RPC dependencies | Service workflow code uses readiness checks, but the documented rollout needs continued alignment with hosted schema evolution | open | Data/SQL + Ops | Re-verify rollout docs against active SQL files and preflight behavior |
| Payment and billing fields | Portal and billing paths have been normalized toward canonical amount fields, but SQL assumptions still need an explicit review | open | Payments + Data/SQL | Review order, payment, invoice, and tenant billing fields against code usage |
| Employee compensation foundation | Compensation resolution now exists in code and tracked SQL, but the hosted schema still needs the new labor contract and member assignment tables applied before the Team workspace can move off legacy hourly-only setup | planned | Backend + Data/SQL | Apply `sql/employee_compensation_foundation.sql`, load current union agreement data, then extend Team/job-cost UIs to the new tables |

## How to use this register

- Add new rows when code expectations and SQL reality diverge
- Move rows to `planned` once a concrete migration or code task exists
- Move rows to `accepted` only when the owner and rationale are explicit
- Move rows to `closed` only after code, SQL, docs, and tests align
